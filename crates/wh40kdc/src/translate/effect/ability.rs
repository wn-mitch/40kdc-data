//! Whole-ability rendering: the top-level sentence or block with trigger, usage and duration
//! woven in, the `Applies to:` line, and the public typed entry points. Mirrors
//! `renderTopLevel` / `describeAbility` in `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::block::block;
use super::menu::{duration_clauses, normalize_triggers, usage_clause};
use super::words::*;
use super::{child, inline, is_container, join_nonempty, ty};
use crate::generated::{
    Ability, AbilityAppliesTo, AbilityTrigger, AbilityUsage, EffectNode, Scope,
};
use crate::translate::condition::{condition_lead_in_value, nn, obj};
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
    let lead = match usage.and_then(Value::as_object) {
        Some(u) if nn(u, "frequency").is_some() => usage_clause(u),
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
        let lead_in = condition_lead_in_value(child(e_map, "condition"));
        if is_container(obj(Some(inner))) {
            let header = join_nonempty(&[&trig, &lead, &lead_in, trail], ", ");
            return format!("{}:\n{}", capitalize(&header), block(inner, 1, &ctx));
        }
        return assemble_sentence(&[&trig, &lead, &lead_in, trail, &inline(inner, &ctx)]);
    }

    if is_container(e_map) {
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

/// `Scope: <range>. Duration: <duration>.` — retained for the legacy translate footer.
pub fn describe_scope(s: &Scope) -> String {
    let s = to_value(s);
    let s = obj(Some(&s));
    if !truthy_key(s, "range") && !truthy_key(s, "duration") {
        return String::new();
    }
    let range = dekebab(sv(s, "range").unwrap_or(""));
    let inches = nn(s, "range_inches")
        .map(|r| format!(" ({}\")", jv(r)))
        .unwrap_or_default();
    let duration = match sv(s, "duration") {
        Some("until-next-battle-round") => "until the start of the next battle round".to_string(),
        Some("until-start-next-turn") => "until the start of your next turn".to_string(),
        d => dekebab(d.unwrap_or("")),
    };
    format!("Scope: {range}{inches}. Duration: {duration}.")
}

/// Effect text plus an optional trailing scope line — legacy composition.
pub fn describe_effect_with_scope(e: &EffectNode, scope: Option<&Scope>) -> String {
    let effect = describe_effect(e);
    match scope.map(describe_scope).filter(|s| !s.is_empty()) {
        Some(line) if effect.is_empty() => line,
        Some(line) => format!("{effect}\n{line}"),
        None => effect,
    }
}

/// `Applies to: units with Possessed.` Mirrors `describeAppliesTo`.
pub fn describe_applies_to(filter: Option<&AbilityAppliesTo>) -> String {
    let Some(filter) = filter.map(to_value) else {
        return String::new();
    };
    let filter = obj(Some(&filter));
    let required = map_arr(filter, "required_keywords", jv).unwrap_or_default();
    let excluded = map_arr(filter, "excluded_keywords", jv).unwrap_or_default();
    if required.is_empty() && excluded.is_empty() {
        return String::new();
    }
    let base = if required.is_empty() {
        "all units".to_string()
    } else {
        format!("units with {}", required.join(", "))
    };
    let exc = if excluded.is_empty() {
        String::new()
    } else {
        format!(" (excluding {})", excluded.join(", "))
    };
    format!("Applies to: {base}{exc}.")
}

/// Compose the full ability print: woven effect sentence + an optional `Applies to:` line.
/// The single assembler used by both [`describe_ability`] and the runner's `translate_effect` op.
pub fn describe_ability_parts(
    e: &EffectNode,
    scope: Option<&Scope>,
    applies_to: Option<&AbilityAppliesTo>,
    usage: Option<&AbilityUsage>,
    trigger: Option<&AbilityTrigger>,
) -> String {
    let base = render_top_level(
        &to_value(e),
        scope.map(to_value).as_ref(),
        usage.map(to_value).as_ref(),
        trigger.map(to_value).as_ref(),
    );
    let applies = describe_applies_to(applies_to);
    [base, applies]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Full generated text for an ability. Mirrors `describeAbility`.
pub fn describe_ability(a: &Ability) -> String {
    describe_ability_parts(
        &a.effect,
        Some(&a.scope),
        a.applies_to.as_ref(),
        a.usage.as_ref(),
        a.trigger.as_ref(),
    )
}
