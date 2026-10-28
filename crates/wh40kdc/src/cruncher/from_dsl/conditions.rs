//! The three-valued condition evaluator (`Some(true)`, `Some(false)`, `None` for unknown) and
//! the aura keyword-filter check. Mirrors the "Condition evaluator" section and
//! `evaluateKeywordFilter` of `tools/src/cruncher/from-dsl.ts`.

use serde_json::Value;

use super::js::*;
use super::TranslationPerspective;
use crate::cruncher::buffs::{AbilityKind, BuffSource, EngineContext};
use crate::cruncher::scenario::{has_designation, within_objective, UnitStrength};
use crate::cruncher::scenario_conditions::{
    attachment_from_flags, attachment_from_members, evaluate_controls, evaluate_in_region,
    evaluate_rule_active, is_neighbour_filter, within_neighbour,
};
use crate::cruncher::scenario_facts::{
    bounds_verdict, evaluate_designated, evaluate_own_move, evaluate_phase_event,
    evaluate_test_result, keyword_model_bounds,
};

/// The buffed unit: the ability's own unit (or model), or the unit an aura is applied to.
pub(super) fn is_buffed_unit(subject: Option<&Value>) -> bool {
    match subject {
        None | Some(Value::Null) => true,
        Some(s) => matches!(
            s.as_str(),
            Some("this-unit" | "ability-unit" | "this-model" | "recipient")
        ),
    }
}

/// Which unit of the attack a condition's subject names, or `None` for another unit.
fn condition_side(
    subject: Option<&Value>,
    perspective: TranslationPerspective,
) -> Option<TranslationPerspective> {
    match subject.and_then(Value::as_str) {
        Some("defender") => Some(TranslationPerspective::Target),
        Some("attacker") => Some(TranslationPerspective::Attacker),
        _ if is_buffed_unit(subject) => Some(perspective),
        _ => None,
    }
}

/// The single, unrestricted keyword predicate a `matches` filter names.
pub(super) fn single_keyword(params: Option<&Obj>) -> Option<&str> {
    let filter = object(params?.get("filter"))?;
    if filter.len() != 1 {
        return None;
    }
    match list(filter.get("all_of")) {
        [only] => only.as_str(),
        _ => None,
    }
}

fn phase_name(ctx: &EngineContext) -> String {
    js_string(Some(
        &serde_json::to_value(ctx.phase).unwrap_or(Value::Null),
    ))
}

/// Evaluate a condition against the context; `None` is "unknown".
pub(crate) fn evaluate_condition(
    condition: &Obj,
    ctx: &EngineContext,
    perspective: TranslationPerspective,
) -> Option<bool> {
    evaluate_condition_for_source(condition, ctx, perspective, None)
}

pub(super) fn evaluate_condition_for_source(
    condition: &Obj,
    ctx: &EngineContext,
    perspective: TranslationPerspective,
    source: Option<&BuffSource>,
) -> Option<bool> {
    if let (Some(op), Some(operands)) = (
        condition.get("operator").and_then(Value::as_str),
        condition.get("operands").and_then(Value::as_array),
    ) {
        return evaluate_compound(op, operands, ctx, perspective, source);
    }
    let params = object(condition.get("parameters"));
    let empty = Obj::new();
    let p = params.unwrap_or(&empty);
    match condition.get("type").and_then(Value::as_str) {
        Some("phase-is") => {
            let wanted = p.get("phase").and_then(Value::as_str)?;
            Some(phase_name(ctx) == wanted)
        }
        Some("attack-is") => {
            if p.keys().any(|k| k != "attack_type") {
                return None;
            }
            match p.get("attack_type").and_then(Value::as_str) {
                Some("melee") => Some(phase_name(ctx) == "fight"),
                Some("ranged") => Some(phase_name(ctx) == "shooting"),
                _ => None,
            }
        }
        Some("timing-is") => {
            let wanted = p.get("timing").and_then(Value::as_str)?;
            Some(ctx.timing.as_deref()? == wanted)
        }
        Some("happened") => {
            if let Some(moved) =
                evaluate_own_move(p, ctx, condition_side(p.get("subject"), perspective))
            {
                return Some(moved);
            }
            let side_of = |reference: Option<&Value>| condition_side(reference, perspective);
            if let Some(verdict) = evaluate_phase_event(p, ctx, &side_of) {
                return verdict;
            }
            let filter = object(p.get("filter"));
            let types = list(filter.and_then(|f| f.get("move_types")));
            let own = !p.contains_key("subject")
                && !p.contains_key("object")
                && !p.contains_key("count")
                && is_str(p, "window", "turn");
            if !own
                || !is_str(p, "event", "move-ended")
                || types.len() != 1
                || filter.map_or(0, |f| f.len()) != 1
            {
                return None;
            }
            // The buffed unit's own move this turn, as the context records it.
            match types[0].as_str() {
                Some("remain-stationary") => Some(ctx.attacker_stationary == Some(true)),
                Some("charge") => ctx.attacker_charged,
                _ => None,
            }
        }
        Some("attachment") => {
            let subject = p.get("subject");
            let explicit_side = match subject.and_then(Value::as_str) {
                Some("attacker") => Some(TranslationPerspective::Attacker),
                Some("defender") => Some(TranslationPerspective::Target),
                None | Some("this-model" | "this-unit" | "ability-unit") => None,
                _ => return None,
            };
            let flags = attachment_from_flags(p, ctx, perspective, source);
            if flags == Some(false) {
                return Some(false);
            }
            let side = explicit_side.unwrap_or(perspective);
            let sourced = match (explicit_side, source) {
                (
                    None,
                    Some(BuffSource::Ability {
                        ability_kind: AbilityKind::Attached | AbilityKind::Support,
                        source_unit_id,
                        ..
                    }),
                ) => Some(source_unit_id.as_deref()),
                _ => None,
            };
            let (own, members) = match side {
                TranslationPerspective::Attacker => {
                    (ctx.attacker_unit_id.as_deref(), &ctx.attacker_members)
                }
                TranslationPerspective::Target => {
                    (ctx.target_unit_id.as_deref(), &ctx.target_members)
                }
            };
            let with = p.get("with").filter(|value| !value.is_null());
            match attachment_from_members(
                p.get("role"),
                with,
                members.as_deref(),
                sourced.unwrap_or(own),
            ) {
                Some(verdict) => Some(verdict),
                None if with.is_none() => flags,
                None => None,
            }
        }
        Some("rule-active") => evaluate_rule_active(p, ctx),
        Some("in-region") => {
            let side = condition_side(p.get("subject"), perspective)?;
            evaluate_in_region(p, ctx, side, perspective)
        }
        Some("controls") => evaluate_controls(p, ctx, perspective),
        Some("matches") => {
            let side = condition_side(p.get("subject"), perspective)?;
            // Ownership is relative to the side whose ability it is.
            let owner = if side == perspective {
                "friendly"
            } else {
                "enemy"
            };
            matches_unit_filter(p.get("filter")?, ctx, side, owner)
        }
        Some("designated") => {
            let by = match p.get("by") {
                None => None,
                by => Some(condition_side(by, perspective)?),
            };
            evaluate_designated(p, ctx, by, perspective)
        }
        Some("roll-result") => evaluate_test_result(p, ctx),
        Some("army-faction") => {
            // "Your Army Faction" is the army of the side whose ability it is.
            let faction = p.get("faction").and_then(Value::as_str)?;
            let army = match perspective {
                TranslationPerspective::Target => ctx.target_army_faction.as_deref(),
                _ => ctx.army_faction.as_deref(),
            };
            Some(army? == faction)
        }
        Some("model-count") => {
            // "contains N or more models": min and max are inclusive. A keyword-restricted count
            // reads the declared per-keyword model counts, or every model when all of them carry
            // it.
            let side = condition_side(p.get("subject"), perspective)?;
            if let Some(keyword) = p.get("keyword") {
                let keyword = keyword.as_str()?;
                let bounds = match side {
                    TranslationPerspective::Attacker => keyword_model_bounds(
                        keyword,
                        ctx.attacker_keyword_models.as_ref(),
                        ctx.attacker_model_keywords.as_deref(),
                        ctx.attacker_model_count,
                    ),
                    TranslationPerspective::Target => keyword_model_bounds(
                        keyword,
                        ctx.target_keyword_models.as_ref(),
                        ctx.target_model_keywords.as_deref(),
                        ctx.target_model_count,
                    ),
                }?;
                return bounds_verdict(p, bounds);
            }
            let count = match side {
                TranslationPerspective::Attacker => ctx.attacker_model_count,
                TranslationPerspective::Target => ctx.target_model_count,
            }? as u64;
            if p.get("min")
                .and_then(Value::as_u64)
                .is_some_and(|min| count < min)
            {
                return Some(false);
            }
            if p.get("max")
                .and_then(Value::as_u64)
                .is_some_and(|max| count > max)
            {
                return Some(false);
            }
            Some(true)
        }
        Some("unit-wargear") => {
            // Read from the side's chosen loadout. With `models`, the bounds count the models
            // that carry the item (state carry) or lack it (state lack, which needs the unit's
            // model count).
            let side = condition_side(p.get("subject"), perspective)?;
            let wargear_id = p.get("wargear").and_then(Value::as_str)?;
            let (wargear, model_count) = match side {
                TranslationPerspective::Attacker => {
                    (ctx.attacker_wargear.as_ref(), ctx.attacker_model_count)
                }
                TranslationPerspective::Target => {
                    (ctx.target_wargear.as_ref(), ctx.target_model_count)
                }
            };
            let carried = i64::from(wargear?.get(wargear_id).copied().unwrap_or(0));
            let Some(models) = p.get("models") else {
                return Some(carried > 0);
            };
            let models = object(Some(models));
            let bounds = models.and_then(|m| object(m.get("count")));
            let counted = match models.and_then(|m| m.get("state")).and_then(Value::as_str) {
                Some("carry") => carried,
                Some("lack") => i64::from(model_count?) - carried,
                _ => return None,
            };
            let bound = |key: &str| -> Result<Option<i64>, ()> {
                match bounds.and_then(|b| b.get(key)) {
                    None => Ok(None),
                    Some(value) => value.as_i64().map(Some).ok_or(()),
                }
            };
            let (min, max) = (bound("min").ok()?, bound("max").ok()?);
            if min.is_some_and(|min| counted < min) || max.is_some_and(|max| counted > max) {
                return Some(false);
            }
            Some(true)
        }
        Some("battle-size") => {
            let size = p.get("size").and_then(Value::as_str)?;
            Some(ctx.battle_size.as_deref()? == size)
        }
        Some("battle-round") => {
            let round = f64::from(ctx.battle_round?);
            if p.get("min")
                .and_then(Value::as_f64)
                .is_some_and(|min| round < min)
            {
                return Some(false);
            }
            if p.get("max")
                .and_then(Value::as_f64)
                .is_some_and(|max| round > max)
            {
                return Some(false);
            }
            Some(true)
        }
        Some("player-turn-is") => {
            // "Your turn" is the turn of the player whose ability it is.
            let turn = p.get("turn").and_then(Value::as_str);
            if !matches!(turn, Some("your-turn" | "opponent-turn")) {
                return None;
            }
            let attacker_turn = ctx.attacker_turn?;
            let yours = if perspective == TranslationPerspective::Attacker {
                attacker_turn
            } else {
                !attacker_turn
            };
            Some(if turn == Some("your-turn") {
                yours
            } else {
                !yours
            })
        }
        Some("strength") => {
            let strength = match condition_side(p.get("subject"), perspective)? {
                TranslationPerspective::Attacker => ctx.attacker_strength,
                TranslationPerspective::Target => ctx.target_strength,
            }?;
            match p.get("below").and_then(Value::as_str) {
                Some("half") => Some(strength == UnitStrength::BelowHalf),
                Some("starting") => Some(strength != UnitStrength::Full),
                _ => None,
            }
        }
        Some("wounds") => {
            // Each listed property must hold; the Damaged bracket needs datasheet data the
            // context lacks.
            let wounds = match condition_side(p.get("subject"), perspective)? {
                TranslationPerspective::Attacker => ctx.attacker_wounds,
                TranslationPerspective::Target => ctx.target_wounds,
            }?;
            let mut unknown = p.contains_key("damaged");
            if is_true(p, "lost") && wounds.remaining >= wounds.starting {
                return Some(false);
            }
            if let Some(max) = p.get("remaining_max") {
                match max.as_f64() {
                    None => unknown = true,
                    Some(max) if wounds.remaining > max => return Some(false),
                    Some(_) => {}
                }
            }
            (!unknown).then_some(true)
        }
        Some("closest") => {
            // Only "the target is the closest eligible target to the attacker" is in the context.
            let to = p.get("to");
            let to_attacker = match to {
                None => true,
                Some(v) => {
                    v.as_str() == Some("attacker")
                        || (perspective == TranslationPerspective::Attacker
                            && is_buffed_unit(Some(v)))
                }
            };
            if condition_side(p.get("subject"), perspective) != Some(TranslationPerspective::Target)
                || !is_str(p, "among", "eligible-targets")
                || !to_attacker
            {
                return None;
            }
            if !ctx.target_closest? {
                return Some(false);
            }
            let Some(range) = p.get("range") else {
                return Some(true);
            };
            let inches = object(Some(range))?.get("inches").and_then(Value::as_f64)?;
            Some(ctx.distance_inches? <= inches)
        }
        Some("guided") => {
            // Guided is read for the attacking unit.
            let subject = p.get("subject");
            if subject.is_some() && !is_buffed_unit(subject) {
                return None;
            }
            ctx.attacker_guided
        }
        _ => None,
    }
}

/// Kleene three-valued `and` / `or` / `not`.
fn evaluate_compound(
    op: &str,
    operands: &[Value],
    ctx: &EngineContext,
    perspective: TranslationPerspective,
    source: Option<&BuffSource>,
) -> Option<bool> {
    if op == "not" {
        let first = object(operands.first())?;
        return evaluate_condition_for_source(first, ctx, perspective, source).map(|v| !v);
    }
    if op != "and" && op != "or" {
        return None;
    }
    let mut saw_unknown = false;
    for operand in operands {
        let Some(o) = operand.as_object() else {
            saw_unknown = true;
            continue;
        };
        match evaluate_condition_for_source(o, ctx, perspective, source) {
            None => saw_unknown = true,
            Some(false) if op == "and" => return Some(false),
            Some(true) if op == "or" => return Some(true),
            Some(_) => {}
        }
    }
    if saw_unknown {
        None
    } else {
        Some(op == "and")
    }
}

fn keyword_list(v: Option<&Value>) -> Option<Vec<&str>> {
    let a = v?.as_array()?;
    a.iter()
        .map(|k| k.as_str().filter(|s| !s.is_empty()))
        .collect()
}

/// Evaluate common keyword predicates without inventing board or model facts.
/// A false known conjunct wins; otherwise any spatial, state or membership
/// predicate keeps the result unknown. Model roles require actual membership,
/// never CHARACTER keywords or a unit's ability to lead.
pub(super) fn evaluate_keyword_filter(filter: &Value, keywords: Option<&[String]>) -> Option<bool> {
    evaluate_filter(filter, keywords, "friendly", None)
}

pub(crate) fn matches_unit_filter(
    filter: &Value,
    context: &EngineContext,
    side: TranslationPerspective,
    owner: &str,
) -> Option<bool> {
    let keywords = if side == TranslationPerspective::Attacker {
        context.attacker_keywords.as_deref()
    } else {
        context.target_keywords.as_deref()
    };
    evaluate_filter(filter, keywords, owner, Some((context, side)))
}

const KEYWORD_CLAUSES: [&str; 4] = ["all_of", "any_of", "none_of", "not_all_of"];

/// Whether one keyword clause holds for a keyword set; keywords compare by `keyword_key`.
fn clause_holds(clause: &str, list: &[&str], keywords: &[String]) -> bool {
    let has = |keyword: &&str| {
        let key = crate::scope::keyword_key(keyword);
        keywords
            .iter()
            .any(|owned| crate::scope::keyword_key(owned) == key)
    };
    match clause {
        "all_of" => list.iter().all(has),
        "any_of" => list.iter().any(has),
        "none_of" => !list.iter().any(has),
        _ => !list.iter().all(has),
    }
}

/// A keyword predicate over a unit's models: `Some(true)` when every model meets it, `Some(false)`
/// when no model can, else `None`. Every model carries `every` and none carries more than `most`.
/// Clauses that need more keywords (all_of, any_of) are settled for every model by `every` and for
/// none by `most`; clauses that need fewer (none_of, not_all_of) the other way round. The outer
/// `None` is a malformed clause.
fn model_keyword_verdict(
    f: &Obj,
    every: Option<&[String]>,
    most: Option<&[String]>,
) -> Option<Option<bool>> {
    let mut all_models = true;
    for clause in KEYWORD_CLAUSES {
        let Some(value) = f.get(clause) else {
            continue;
        };
        let list = keyword_list(Some(value))?;
        if list.is_empty() {
            continue;
        }
        let (least, upper) = if clause == "all_of" || clause == "any_of" {
            (every, most)
        } else {
            (most, every)
        };
        if upper.is_some_and(|upper| !clause_holds(clause, &list, upper)) {
            return Some(Some(false));
        }
        if !least.is_some_and(|least| clause_holds(clause, &list, least)) {
            all_models = false;
        }
    }
    Some(all_models.then_some(true))
}

fn evaluate_filter(
    filter: &Value,
    keywords: Option<&[String]>,
    owner: &str,
    context: Option<(&EngineContext, TranslationPerspective)>,
) -> Option<bool> {
    let f = filter.as_object()?;
    let mut unknown = false;
    let pool_member = is_str(f, "member_of", "this-unit")
        || context.is_some_and(|(_, side)| {
            is_str(
                f,
                "member_of",
                if side == TranslationPerspective::Attacker {
                    "attacker"
                } else {
                    "defender"
                },
            )
        });
    // A model-level keyword predicate is settled for the whole unit from the keywords every model
    // carries and the keywords any model carries; see `model_keyword_verdict`.
    let model_predicate = is_str(f, "level", "model")
        && context.is_some()
        && KEYWORD_CLAUSES.iter().any(|clause| f.contains_key(*clause));
    let mut every_model_matches = false;
    if let Some((ctx, side)) = context.filter(|_| model_predicate) {
        let every = if side == TranslationPerspective::Attacker {
            ctx.attacker_model_keywords.as_deref()
        } else {
            ctx.target_model_keywords.as_deref()
        };
        match model_keyword_verdict(f, every, keywords)? {
            Some(false) => return Some(false),
            None => unknown = true,
            Some(true) => every_model_matches = true,
        }
    }
    for (key, value) in f {
        match key.as_str() {
            "all_of" | "any_of" | "none_of" | "not_all_of" if model_predicate => {}
            "all_of" | "any_of" | "none_of" | "not_all_of" => {
                let list = keyword_list(Some(value))?;
                if is_str(f, "level", "model") {
                    unknown = true;
                }
                if list.is_empty() {
                    continue;
                }
                let Some(keywords) = keywords else {
                    unknown = true;
                    continue;
                };
                if !clause_holds(key, &list, keywords) {
                    return Some(false);
                }
            }
            "any_of_filters" => {
                match evaluate_alternatives(value.as_array()?, keywords, owner, context) {
                    Some(false) => return Some(false),
                    None => unknown = true,
                    Some(true) => {}
                }
            }
            "unit_ids" => {
                let ids = keyword_list(Some(value))?;
                if !is_str(f, "level", "unit") || ids.is_empty() {
                    return None;
                }
                let identity = context.and_then(|(ctx, side)| match side {
                    TranslationPerspective::Attacker => ctx.attacker_unit_id.as_deref(),
                    TranslationPerspective::Target => ctx.target_unit_id.as_deref(),
                });
                match identity {
                    Some(identity) if !ids.contains(&identity) => return Some(false),
                    None => unknown = true,
                    _ => {}
                }
            }
            "owner" => {
                if !matches!(value.as_str()?, "any") && value.as_str()? != owner {
                    return Some(false);
                }
            }
            "level" if value.as_str() == Some("unit") => {}
            // Every model of the unit meets the keyword predicate, so the filter selects the whole unit.
            "level"
                if value.as_str() == Some("model")
                    && every_model_matches
                    && !f.contains_key("attachment_role") => {}
            "level"
                if value.as_str() == Some("model")
                    && f.contains_key("attachment_role")
                    && pool_member => {}
            "member_of"
                if pool_member
                    && f.contains_key("attachment_role")
                    && is_str(f, "level", "model") => {}
            "attachment_role" if is_str(f, "level", "model") && pool_member => {
                let role = context.and_then(|(ctx, side)| {
                    if side == TranslationPerspective::Attacker {
                        ctx.attacker_attachment_role
                    } else {
                        ctx.target_attachment_role
                    }
                });
                match role {
                    Some(role) => {
                        let role = match role {
                            crate::cruncher::buffs::AttachmentRole::Leader => "leader",
                            crate::cruncher::buffs::AttachmentRole::Bodyguard => "bodyguard",
                        };
                        if value.as_str() != Some(role) {
                            return Some(false);
                        }
                    }
                    None => unknown = true,
                }
            }
            "state" if value.as_str() == Some("benefit-of-cover") => {
                match context.and_then(|(ctx, side)| {
                    if side == TranslationPerspective::Attacker {
                        ctx.attacker_in_cover
                    } else {
                        ctx.target_in_cover
                    }
                }) {
                    Some(false) => return Some(false),
                    None => unknown = true,
                    Some(true) => {}
                }
            }
            // Both units of an attack are on the battlefield, never in reserves.
            "state" if value.as_str() == Some("on-battlefield") => {}
            "state"
                if matches!(
                    value.as_str(),
                    Some("in-strategic-reserves" | "in-cult-ambush")
                ) =>
            {
                return Some(false);
            }
            "state"
                if matches!(
                    value.as_str(),
                    Some("engaged" | "battle-shocked" | "hidden")
                ) =>
            {
                let states = context.and_then(|(ctx, side)| {
                    if side == TranslationPerspective::Attacker {
                        ctx.attacker_states.as_deref()
                    } else {
                        ctx.target_states.as_deref()
                    }
                });
                match states {
                    Some(states) if !states.iter().any(|s| value.as_str() == Some(s.as_str())) => {
                        return Some(false)
                    }
                    None => unknown = true,
                    Some(_) => {}
                }
            }
            "designated" if value.is_string() => {
                let designations = context.and_then(|(ctx, side)| {
                    if side == TranslationPerspective::Attacker {
                        ctx.attacker_designations.as_deref()
                    } else {
                        ctx.target_designations.as_deref()
                    }
                });
                match designations {
                    Some(list) if !has_designation(list, value.as_str().unwrap_or_default()) => {
                        return Some(false)
                    }
                    None => unknown = true,
                    Some(_) => {}
                }
            }
            "within" => {
                let Some((ctx, side)) = context else {
                    unknown = true;
                    continue;
                };
                let flip = |side| {
                    if side == TranslationPerspective::Attacker {
                        TranslationPerspective::Target
                    } else {
                        TranslationPerspective::Attacker
                    }
                };
                // The ability belongs to `side` when the filtered unit is friendly.
                let ability_side = if owner == "friendly" {
                    side
                } else {
                    flip(side)
                };
                if value.get("wholly").and_then(Value::as_bool) == Some(true) {
                    unknown = true;
                    continue;
                }
                if let Some(objective) = object(value.get("of").and_then(|of| of.get("objective")))
                {
                    let verdict = if is_str(value.as_object()?, "range", "objective-control") {
                        let objectives = if side == TranslationPerspective::Attacker {
                            ctx.attacker_objectives.as_deref()
                        } else {
                            ctx.target_objectives.as_deref()
                        };
                        within_objective(objective, objectives, ability_side)
                    } else {
                        None
                    };
                    match verdict {
                        Some(false) => return Some(false),
                        None => unknown = true,
                        Some(true) => {}
                    }
                    continue;
                }
                let other = if side == TranslationPerspective::Attacker {
                    "defender"
                } else {
                    "attacker"
                };
                let of = value.get("of").and_then(Value::as_str);
                let measured = of == Some(other)
                    || (matches!(of, Some("this-unit" | "ability-unit")) && ability_side != side);
                if let Some(neighbours_of) =
                    object(value.get("of")).filter(|of| !measured && is_neighbour_filter(of))
                {
                    // Another unit named by keyword, within a fixed range of the filtered unit.
                    let inches = object(value.get("range"))
                        .filter(|range| range.len() == 1)
                        .and_then(|range| range.get("inches"))
                        .and_then(Value::as_f64);
                    let neighbours = if side == TranslationPerspective::Attacker {
                        ctx.attacker_neighbours.as_deref()
                    } else {
                        ctx.target_neighbours.as_deref()
                    };
                    match inches.and_then(|inches| {
                        within_neighbour(neighbours_of, inches, neighbours, side == ability_side)
                    }) {
                        Some(false) => return Some(false),
                        None => unknown = true,
                        Some(true) => {}
                    }
                    continue;
                }
                if !measured {
                    unknown = true;
                    continue;
                }
                if value.get("range").and_then(Value::as_str) == Some("half-weapon") {
                    match ctx.within_half_range {
                        Some(false) => return Some(false),
                        None => unknown = true,
                        Some(true) => {}
                    }
                    continue;
                }
                let inches = value
                    .get("range")
                    .and_then(|range| range_inches(range, ctx.battle_round));
                match (inches, ctx.distance_inches) {
                    (Some(range), Some(distance)) if distance > range => return Some(false),
                    (Some(_), Some(_)) => {}
                    _ => unknown = true,
                }
            }
            _ => unknown = true,
        }
    }
    (!unknown).then_some(true)
}

fn evaluate_alternatives(
    alternatives: &[Value],
    keywords: Option<&[String]>,
    owner: &str,
    context: Option<(&EngineContext, TranslationPerspective)>,
) -> Option<bool> {
    let mut unknown = false;
    for alternative in alternatives {
        match evaluate_filter(alternative, keywords, owner, context) {
            Some(true) => return Some(true),
            None => unknown = true,
            Some(false) => {}
        }
    }
    (!unknown).then_some(false)
}

/// A tiered range uses the final supplied tier for every later battle round.
fn range_inches(range: &Value, battle_round: Option<u32>) -> Option<f64> {
    let range = if let Some(tiers) = range.get("per_battle_round").and_then(Value::as_array) {
        if tiers.is_empty() {
            return None;
        }
        &tiers[(battle_round?.saturating_sub(1) as usize).min(tiers.len() - 1)]
    } else {
        range
    };
    range.get("inches").and_then(Value::as_f64)
}
