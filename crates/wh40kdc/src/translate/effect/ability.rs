//! Whole-ability rendering: the top-level sentence or block with trigger, usage and duration
//! woven in, the `Applies to:` line, and the public typed entry points. Mirrors
//! `renderTopLevel` / `describeAbility` in `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::block::block;
use super::menu::{duration_clauses, normalize_triggers, usage_clause};
use super::words::*;
use super::{child, inline, is_container, join_nonempty, ty};
use crate::generated::{
    Ability, AbilityTrigger, AbilityUsage, EffectNode, KeywordPredicate, Scope,
};
use crate::translate::condition::{condition_lead_in_for, is_defensive_effect, nn, obj, or_list};
use crate::translate::dekebab;

/// Join non-empty clauses with ", ", capitalize the sentence, and end with a period.
pub(super) fn assemble_sentence(parts: &[&str]) -> String {
    let body = join_nonempty(parts, ", ");
    if body.is_empty() {
        return String::new();
    }
    let period = if body.ends_with('.') || body.ends_with(':') {
        ""
    } else {
        "."
    };
    format!("{}{period}", capitalize(&body))
}

/// The inch range of a top-level `within` condition, else `None`.
pub(super) fn condition_within_range(c: &Value) -> Option<f64> {
    if c.get("type").and_then(Value::as_str) != Some("within") {
        return None;
    }
    c.get("parameters")?.get("range")?.get("inches")?.as_f64()
}

pub(super) fn render_top_level(
    e: &Value,
    scope: Option<&Value>,
    usage: Option<&Value>,
    trigger: Option<&Value>,
) -> String {
    let mut ctx = Ctx::default();
    let e_map = obj(Some(e));
    let (dur_lead, trail) = duration_clauses(scope.and_then(|s| s.get("duration")));
    // An explicit usage limit supersedes the duration's coarse "once per battle" lead.
    let lead = match usage {
        Some(u) if u.is_array() => usage_clause(u),
        Some(u) if u.as_object().is_some_and(|o| nn(o, "frequency").is_some()) => usage_clause(u),
        _ => dur_lead.to_string(),
    };

    // A reactive trigger opens the sentence ("Each time …"). When a trigger's proximity just
    // restates a within-range condition on the effect, render the range once (drop it here).
    let cond_range = if ty(e_map) == "conditional" {
        condition_within_range(child(e_map, "condition"))
    } else {
        None
    };
    let triggers: Vec<&Value> = normalize_triggers(trigger)
        .into_iter()
        .filter(|t| t.get("event").is_some_and(|v| !v.is_null()))
        .collect();
    if triggers.iter().any(|t| {
        let ev = t.get("event").and_then(Value::as_str);
        ev == Some("destroyed") || ev == Some("model-destroyed")
    }) {
        ctx.destroyed_trigger = true;
    }
    let mut phrases: Vec<String> = Vec::new();
    for phrase in triggers.into_iter().map(|t| {
        let prox = t
            .get("proximity")
            .and_then(|p| p.get("range"))
            .and_then(|r| r.get("inches"))
            .and_then(Value::as_f64);
        if cond_range.is_some() && prox == cond_range {
            let mut t2 = t.as_object().cloned().unwrap_or_default();
            t2.remove("proximity");
            crate::translate::trigger::describe_trigger_value(&Value::Object(t2))
        } else {
            crate::translate::trigger::describe_trigger_value(t)
        }
    }) {
        // Two triggers that read the same are one trigger in English ("when X or when X").
        if !phrase.is_empty() && !phrases.contains(&phrase) {
            phrases.push(phrase);
        }
    }
    let trig = phrases.join(" or ");

    if ty(e_map) == "conditional" {
        let inner = child(e_map, "effect");
        let lead_in = condition_lead_in_for(child(e_map, "condition"), is_defensive_effect(inner));
        if is_container(obj(Some(inner))) {
            let header = join_nonempty(&[&trig, &lead, &lead_in, trail], ", ");
            return format!("{}:\n{}", capitalize(&header), block(inner, 1, &ctx));
        }
        return assemble_sentence(&[&trig, &lead, &lead_in, trail, &inline(inner, &ctx)]);
    }

    if is_container(e_map) || super::leaf_ability::is_defined_grant(e_map) {
        // A designation carrying its own `duration` renders that duration itself.
        let own_duration = matches!(ty(e_map), "designate-target" | "persistent-designation")
            && nn(e_map, "duration").is_some();
        let head = join_nonempty(&[&trig, &lead, if own_duration { "" } else { trail }], ", ");
        // Under a header, the block's steps are indented as they are under a condition's lead-in.
        return if head.is_empty() {
            block(e, 0, &ctx)
        } else {
            format!("{}:\n{}", capitalize(&head), block(e, 1, &ctx))
        };
    }

    assemble_sentence(&[&trig, &lead, trail, &inline(e, &ctx)])
}

pub(super) fn to_value<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

/// Single-clause translation for leaf effects (lowercase-initial, no period).
pub fn describe_effect_inline(e: &EffectNode) -> String {
    inline(&to_value(e), &Ctx::default())
}

/// Block translation of a container effect tree (multi-line, two-space indentation).
pub fn describe_effect(e: &EffectNode) -> String {
    block(&to_value(e), 0, &Ctx::default())
}

/// The shared lifetime rendered as a standalone duration line.
pub fn describe_scope(s: &Scope) -> String {
    let value = to_value(s);
    let s = obj(Some(&value));
    let Some(duration) = nn(s, "duration") else {
        return String::new();
    };
    let trail = crate::translate::expiry::expiry_trail(Some(duration));
    let duration = if trail.is_empty() {
        dekebab(&jv(duration))
    } else {
        trail.to_string()
    };
    format!("Duration: {duration}.")
}

/// Effect text plus an optional trailing duration line.
pub fn describe_effect_with_scope(e: &EffectNode, scope: Option<&Scope>) -> String {
    let effect = describe_effect(e);
    match scope.map(describe_scope).filter(|s| !s.is_empty()) {
        Some(line) if effect.is_empty() => line,
        Some(line) => format!("{effect}\n{line}"),
        None => effect,
    }
}

/// `Applies to: units with Possessed.` Mirrors `describeAppliesTo`.
pub fn describe_applies_to(filter: Option<&KeywordPredicate>) -> String {
    let Some(filter) = filter.map(to_value) else {
        return String::new();
    };
    let filter = obj(Some(&filter));
    let required = map_arr(filter, "all_of", jv).unwrap_or_default();
    let any = map_arr(filter, "any_of", jv).unwrap_or_default();
    let excluded = map_arr(filter, "none_of", jv).unwrap_or_default();
    let not_all = map_arr(filter, "not_all_of", jv).unwrap_or_default();
    if required.is_empty() && any.is_empty() && excluded.is_empty() && not_all.is_empty() {
        return String::new();
    }
    let positive = [
        if required.is_empty() {
            String::new()
        } else {
            required.join(", ")
        },
        if any.is_empty() {
            String::new()
        } else {
            format!("at least one of {}", or_list(&any))
        },
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join(" and ");
    let base = if positive.is_empty() {
        "all units".to_string()
    } else {
        format!("units with {positive}")
    };
    let exc = if excluded.is_empty() {
        String::new()
    } else {
        format!(" (excluding {})", excluded.join(", "))
    };
    let partial = if not_all.is_empty() {
        String::new()
    } else {
        format!(" (excluding units with all of {})", not_all.join(", "))
    };
    format!("Applies to: {base}{exc}{partial}.")
}

/// Compose the full ability print: woven effect sentence + an optional `Applies to:` line.
/// Renders as a non-optional ability; see [`describe_ability_parts_with_optional`].
pub fn describe_ability_parts(
    e: &EffectNode,
    scope: Option<&Scope>,
    applies_to: Option<&KeywordPredicate>,
    usage: Option<&AbilityUsage>,
    trigger: Option<&AbilityTrigger>,
) -> String {
    describe_ability_parts_with_optional(e, scope, applies_to, usage, trigger, false)
}

/// [`describe_ability_parts`] with the record's `optional`: an ability the player chooses to use
/// gains a leading `You can: `. The single assembler used by both [`describe_ability`] and the
/// runner's `translate_effect` op.
pub fn describe_ability_parts_with_optional(
    e: &EffectNode,
    scope: Option<&Scope>,
    applies_to: Option<&KeywordPredicate>,
    usage: Option<&AbilityUsage>,
    trigger: Option<&AbilityTrigger>,
    optional: bool,
) -> String {
    describe_ability_value_with_optional(
        &to_value(e),
        scope.map(to_value).as_ref(),
        applies_to,
        usage.map(to_value).as_ref(),
        trigger.map(to_value).as_ref(),
        optional,
    )
}

/// [`describe_ability_parts_with_optional`] over the records' JSON form. Renders an effect the
/// generated types do not model, such as the cruncher's generated `dice-table-result` leaf.
pub fn describe_ability_value_with_optional(
    e: &Value,
    scope: Option<&Value>,
    applies_to: Option<&KeywordPredicate>,
    usage: Option<&Value>,
    trigger: Option<&Value>,
    optional: bool,
) -> String {
    let rendered = render_top_level(e, scope, usage, trigger);
    // An optional ability is the player's choice, unless its text already opens with that choice.
    let base = if optional && !rendered.is_empty() && !rendered.starts_with("You can ") {
        format!("You can: {rendered}")
    } else {
        rendered
    };
    let applies = describe_applies_to(applies_to);
    [base, applies]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Full generated text for an ability. Mirrors `describeAbility`.
pub fn describe_ability(a: &Ability) -> String {
    describe_ability_parts_with_optional(
        &a.effect,
        Some(&a.scope),
        a.applies_to.as_ref(),
        a.usage.as_ref(),
        a.trigger.as_ref(),
        a.optional == Some(true),
    )
}
