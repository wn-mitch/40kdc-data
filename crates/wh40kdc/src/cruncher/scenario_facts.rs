//! Condition evaluators for declared objectives, designations, keyword model counts, moves and
//! test results. Each returns `None` (unknown) when the context does not declare the fact it
//! needs. Mirrors `objectiveControl`, `evaluateDesignated`, `keywordModelBounds`,
//! `boundsVerdict`, `evaluateOwnMove` and `evaluateTestResult` in
//! `tools/src/cruncher/scenario-conditions.ts`.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::buffs::EngineContext;
use super::from_dsl::TranslationPerspective;
use super::scenario::{
    objective_matches, ObjectiveController, ObjectivesControlled, ScenarioObjective,
};

type Obj = Map<String, Value>;

/// A value the TS evaluator treats as stated (`!== undefined`); a stripped `null` is absent.
fn stated(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| !value.is_null())
}

/// How many of the declared objectives meeting `filter` each side controls, or `None` when an
/// objective's match, or a matching objective's controller, is unknown.
pub(crate) fn objective_control(
    filter: &Value,
    objectives: Option<&[ScenarioObjective]>,
    ability_side: TranslationPerspective,
) -> Option<ObjectivesControlled> {
    let filter = filter.as_object()?;
    let mut control = ObjectivesControlled {
        attacker: 0.0,
        target: 0.0,
        total: 0.0,
    };
    for objective in objectives? {
        if !objective_matches(filter, objective, ability_side)? {
            continue;
        }
        control.total += 1.0;
        match objective.controller? {
            ObjectiveController::Attacker => control.attacker += 1.0,
            ObjectiveController::Target => control.target += 1.0,
            ObjectiveController::None => {}
        }
    }
    Some(control)
}

/// Inclusive `count` bounds: `Some(None)` when absent, `None` when malformed.
fn count_bounds(bounds: Option<&Value>) -> Option<Option<(Option<f64>, Option<f64>)>> {
    let Some(bounds) = stated(bounds) else {
        return Some(None);
    };
    let bounds = bounds.as_object()?;
    let bound = |key: &str| match stated(bounds.get(key)) {
        None => Some(None),
        Some(value) => value.as_f64().map(Some),
    };
    Some(Some((bound("min")?, bound("max")?)))
}

/// `designated`: with `count`, how many units carry the designation that the `by` unit applied;
/// with an objective subject, how many objectives meeting the filter carry it (at least one
/// without `count`).
pub(crate) fn evaluate_designated(
    params: &Obj,
    ctx: &EngineContext,
    by_side: Option<TranslationPerspective>,
    ability_side: TranslationPerspective,
) -> Option<bool> {
    let tag = params.get("tag")?.as_str()?;
    let bounds = count_bounds(params.get("count"))?;
    let within = |count: f64| match bounds {
        None => count >= 1.0,
        Some((min, max)) => {
            min.is_none_or(|min| count >= min) && max.is_none_or(|max| count <= max)
        }
    };
    let subject = stated(params.get("subject"));
    if let Some(filter) = subject
        .and_then(Value::as_object)
        .and_then(|subject| subject.get("objective"))
        .and_then(Value::as_object)
    {
        if stated(params.get("by")).is_some() {
            return None;
        }
        let mut filter = filter.clone();
        filter.insert("designated".to_string(), Value::String(tag.to_string()));
        let mut count = 0.0;
        for objective in ctx.objectives.as_deref()? {
            if objective_matches(&filter, objective, ability_side)? {
                count += 1.0;
            }
        }
        return Some(within(count));
    }
    if bounds.is_some() {
        if subject.is_some() {
            return None;
        }
        let applied = match by_side? {
            TranslationPerspective::Attacker => ctx.attacker_designations_applied.as_ref(),
            TranslationPerspective::Target => ctx.target_designations_applied.as_ref(),
        }?;
        let wanted = tag.to_lowercase();
        let count: u32 = applied
            .iter()
            .filter(|(designation, _)| designation.to_lowercase() == wanted)
            .map(|(_, units)| *units)
            .sum();
        return Some(within(count as f64));
    }
    // A unit's own designations are a `matches` filter; the schema gives this condition no such
    // form.
    None
}

/// Bounds on how many models of a unit carry `keyword`: the declared count, else all of them
/// when every model carries it. `None` otherwise: a unit's keywords omit its models' own names,
/// so a keyword missing from them does not show that no model carries it.
pub(crate) fn keyword_model_bounds(
    keyword: &str,
    declared: Option<&BTreeMap<String, u32>>,
    model_keywords: Option<&[String]>,
    model_count: Option<u32>,
) -> Option<(f64, f64)> {
    let wanted = keyword.to_lowercase();
    if let Some(count) = declared.and_then(|declared| {
        declared
            .iter()
            .find(|(item, _)| item.to_lowercase() == wanted)
            .map(|(_, count)| *count as f64)
    }) {
        return Some((count, count));
    }
    if !model_keywords?
        .iter()
        .any(|item| item.to_lowercase() == wanted)
    {
        return None;
    }
    Some(match model_count {
        None => (1.0, f64::INFINITY),
        Some(count) => (count as f64, count as f64),
    })
}

/// Inclusive `min`/`max` bounds against a count known to lie in `[low, high]`.
pub(crate) fn bounds_verdict(params: &Obj, (low, high): (f64, f64)) -> Option<bool> {
    let min = params.get("min").and_then(Value::as_f64);
    let max = params.get("max").and_then(Value::as_f64);
    if min.is_some_and(|min| high < min) || max.is_some_and(|max| low > max) {
        return Some(false);
    }
    (min.is_none_or(|min| low >= min) && max.is_none_or(|max| high <= max)).then_some(true)
}

/// `happened` for a unit's own moves this turn: whether the unit on `side` made any of the
/// listed moves. `None` when the condition has another form or the moves are undeclared.
pub(crate) fn evaluate_own_move(
    params: &Obj,
    ctx: &EngineContext,
    side: Option<TranslationPerspective>,
) -> Option<bool> {
    if params.get("event").and_then(Value::as_str) != Some("move-ended")
        || params.get("window").and_then(Value::as_str) != Some("turn")
    {
        return None;
    }
    if params
        .keys()
        .any(|key| !matches!(key.as_str(), "event" | "subject" | "filter" | "window"))
    {
        return None;
    }
    let filter = params.get("filter")?.as_object()?;
    let types = filter.get("move_types")?.as_array()?;
    if filter.len() != 1 || types.is_empty() || !types.iter().all(Value::is_string) {
        return None;
    }
    let moves = match side? {
        TranslationPerspective::Attacker => ctx.attacker_moves.as_ref(),
        TranslationPerspective::Target => ctx.target_moves.as_ref(),
    }?;
    Some(
        types
            .iter()
            .filter_map(Value::as_str)
            .any(|wanted| moves.iter().any(|made| made == wanted)),
    )
}

/// `roll-result` for a test the ability made, from the declared test results.
pub(crate) fn evaluate_test_result(params: &Obj, ctx: &EngineContext) -> Option<bool> {
    let roll = params.get("roll").and_then(Value::as_str)?;
    let result = params.get("result").and_then(Value::as_str)?;
    if !matches!(roll, "leadership" | "battle-shock" | "charge")
        || !matches!(result, "success" | "failure")
    {
        return None;
    }
    let declared = ctx.test_results.as_ref()?.get(roll)?;
    Some(declared == result)
}

/// Which unit of the attack a reference is, if either.
pub(crate) type SideOf<'a> = &'a dyn Fn(Option<&Value>) -> Option<TranslationPerspective>;

fn phase_event_keys(event: &str) -> Option<&'static [&'static str]> {
    Some(match event {
        "selected" => &["event", "subject", "filter", "window"],
        "model-destroyed" | "destroyed" => &["event", "object", "filter", "window", "count"],
        "after-roll" => &["event", "subject", "object", "filter", "window"],
        _ => return None,
    })
}

/// `happened` this phase, from the declared phase events: what a unit was selected for, the
/// enemy models and units it destroyed, the models it lost, and the rolls it made or that were
/// made against it. The outer `None` is another form; `Some(None)` is unknown because the fact it
/// reads is undeclared. A kill or roll filter narrower than the declared facts can still rule an
/// event out when none happened.
pub(crate) fn evaluate_phase_event(
    params: &Obj,
    ctx: &EngineContext,
    side_of: SideOf,
) -> Option<Option<bool>> {
    let event = params.get("event")?.as_str()?;
    let keys = phase_event_keys(event)?;
    if params.get("window").and_then(Value::as_str) != Some("phase")
        || params.keys().any(|key| !keys.contains(&key.as_str()))
    {
        return None;
    }
    let empty = Obj::new();
    let filter = match params.get("filter") {
        None => &empty,
        Some(filter) => filter.as_object()?,
    };
    if event == "selected" {
        let side = side_of(params.get("subject"))?;
        let to = filter.get("to")?.as_str()?;
        if filter.len() != 1 {
            return None;
        }
        let selected = match side {
            TranslationPerspective::Attacker => ctx.attacker_selected.as_ref(),
            TranslationPerspective::Target => ctx.target_selected.as_ref(),
        };
        return Some(selected.map(|list| list.iter().any(|item| item == to)));
    }
    if event == "after-roll" {
        return evaluate_rolled(params, filter, ctx, side_of);
    }
    let default_bounds = Obj::from_iter([("min".to_string(), Value::from(1))]);
    let bounds = match params.get("count") {
        None => &default_bounds,
        Some(bounds) => bounds.as_object()?,
    };
    let range = if event == "model-destroyed" && filter.is_empty() {
        loss_range(params.get("object"), ctx, side_of)?
    } else {
        kill_range(
            event == "model-destroyed",
            params.get("object"),
            filter,
            ctx,
            side_of,
        )?
    };
    Some(range.and_then(|range| bounds_verdict(bounds, range)))
}

/// How many of the object's models the ability's unit lost this phase: this model, or any model
/// of this unit. The outer `None` is another form; the inner one is undeclared.
fn loss_range(
    object: Option<&Value>,
    ctx: &EngineContext,
    side_of: SideOf,
) -> Option<Option<(f64, f64)>> {
    let this_model = match object?.as_str()? {
        "this-model" => true,
        "model-in-this-unit" => false,
        _ => return None,
    };
    let this_unit = Value::String("this-unit".to_string());
    let losses = match side_of(Some(&this_unit)) {
        Some(TranslationPerspective::Attacker) => ctx.attacker_losses,
        Some(TranslationPerspective::Target) => ctx.target_losses,
        None => None,
    };
    Some(losses.map(|losses| {
        if this_model {
            (0.0, losses.min(1.0))
        } else {
            (losses, losses)
        }
    }))
}

/// How many enemy models (or units) the `by` unit destroyed this phase. A kill by one model, or
/// narrowed by object keywords or attack type, counts at most the unit's kills.
fn kill_range(
    models: bool,
    object: Option<&Value>,
    filter: &Obj,
    ctx: &EngineContext,
    side_of: SideOf,
) -> Option<Option<(f64, f64)>> {
    let object = object?.as_object()?;
    if object.get("owner").and_then(Value::as_str) != Some("enemy") {
        return None;
    }
    let by = filter.get("by")?;
    let level = match object.get("level") {
        None if !models => Some("unit"),
        None => None,
        Some(level) => level.as_str(),
    };
    if level != Some(if models { "model" } else { "unit" }) {
        return None;
    }
    let kills = match side_of(Some(by))? {
        TranslationPerspective::Attacker => ctx.attacker_kills,
        TranslationPerspective::Target => ctx.target_kills,
    };
    let narrowed = by.as_str() == Some("this-model")
        || object.keys().any(|key| key != "owner" && key != "level")
        || filter.keys().any(|key| key != "by");
    Some(kills.map(|kills| {
        let count = if models { kills.models } else { kills.units };
        if narrowed {
            (0.0, count)
        } else {
            (count, count)
        }
    }))
}

/// `after-roll` this phase: a roll the subject unit made, or with an object (and no subject), one
/// made against the object unit. A filter beyond the roll and result can only rule the roll out.
fn evaluate_rolled(
    params: &Obj,
    filter: &Obj,
    ctx: &EngineContext,
    side_of: SideOf,
) -> Option<Option<bool>> {
    let roll = filter.get("roll")?.as_str()?;
    let result = filter.get("result")?.as_str()?;
    if !matches!(result, "success" | "failure" | "critical") {
        return None;
    }
    if params.contains_key("subject") && params.contains_key("object") {
        return None;
    }
    let against = params.contains_key("object");
    let side = side_of(params.get(if against { "object" } else { "subject" }))?;
    let rolls = match (side, against) {
        (TranslationPerspective::Attacker, false) => ctx.attacker_rolls.as_ref(),
        (TranslationPerspective::Target, false) => ctx.target_rolls.as_ref(),
        (TranslationPerspective::Attacker, true) => ctx.attacker_rolled_against.as_ref(),
        (TranslationPerspective::Target, true) => ctx.target_rolled_against.as_ref(),
    };
    let Some(rolls) = rolls else {
        return Some(None);
    };
    let rolled = rolls.iter().any(|entry| {
        entry.roll == roll
            && (entry.result == result || (result == "success" && entry.result == "critical"))
    });
    if !rolled {
        return Some(Some(false));
    }
    Some((!filter.keys().any(|key| key != "roll" && key != "result")).then_some(true))
}
