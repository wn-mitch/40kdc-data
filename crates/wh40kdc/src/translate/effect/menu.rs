//! Clause builders the containers share: duration and usage lead-ins, the scaling trail,
//! trigger lists, and the `resource-action-menu` container. Mirrors the matching helpers in
//! `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::words::*;
use super::{empty_value, inline};
use crate::translate::condition::{describe_condition_value, nn, obj, P};
use crate::translate::dekebab;
use crate::translate::expiry::expiry_trail;
use crate::translate::trigger::describe_trigger_value;

/// Duration → woven clause `(lead, trail)`. `lead` sits at the very front of the sentence
/// ("Once per battle, …"); `trail` sits after the trigger/condition and before the effect.
pub(crate) fn duration_clauses(duration: Option<&Value>) -> (&'static str, &'static str) {
    if duration.and_then(Value::as_str) == Some("one-use") {
        return ("once per battle", "");
    }
    ("", expiry_trail(duration))
}

/// Usage limit → front-of-sentence lead clause ("once per turn", "twice per battle per unit").
pub(crate) fn usage_clause(u: &Value) -> String {
    // Several limits that all apply: "once per battle per model and once per battle round per army".
    if let Some(list) = u.as_array() {
        return list
            .iter()
            .map(usage_clause)
            .collect::<Vec<_>>()
            .join(" and ");
    }
    let u = obj(Some(u));
    let n = num(Some(nn(u, "count").unwrap_or(&Value::from(1))));
    let base = match sv(u, "frequency") {
        Some("once-per-turn") => "once per turn".to_string(),
        Some("once-per-phase") => "once per phase".to_string(),
        Some("once-per-battle-round") => "once per battle round".to_string(),
        Some("once-per-command-phase") => "once per Command phase".to_string(),
        Some("once-per-opponent-turn") => "once per opponent's turn".to_string(),
        Some("first-this-battle") => "the first time this battle".to_string(),
        Some("first-time-this-phase") => "the first time this phase".to_string(),
        Some("n-per-battle") => {
            if n == 1.0 {
                "once per battle".to_string()
            } else if n == 2.0 {
                "twice per battle".to_string()
            } else {
                format!("{} times per battle", fnum(n))
            }
        }
        _ => dekebab(&jstr(u.get("frequency"))),
    };
    match nn(u, "per") {
        Some(per) => format!("{base} per {}", jv(per)),
        None => base,
    }
}

/// A `scaling` block → trailing clause ("for every 5 enemy models within 6\"").
pub(crate) fn scaling_clause(s: &P) -> String {
    let max = nn(s, "max_value")
        .map(|mx| format!(" (to a maximum of {})", jv(mx)))
        .unwrap_or_default();
    match sv(s, "of") {
        Some("battle-round") => return format!("multiplied by the battle round number{max}"),
        // A summed characteristic is counted in points.
        Some("embarked-models-oc") => {
            let per = if num(s.get("per")) == 1.0 {
                "point".to_string()
            } else {
                format!("{} points", jstr(s.get("per")))
            };
            return format!("for every {per} of {}{max}", scale_source(s));
        }
        _ => {}
    }
    let mut c = format!("for every {} {}", jstr(s.get("per")), scale_source(s));
    if let Some(w) = nn(s, "within_inches") {
        let within = format!("within {}\"", jv(w));
        if !c.ends_with(&within) {
            c.push_str(&format!(" {within}"));
        }
    }
    if sv(s, "round") == Some("up") {
        c.push_str(" (rounding up)");
    }
    c + &max
}

/// A polymorphic trigger spec as a list (empty when absent).
pub(crate) fn normalize_triggers(t: Option<&Value>) -> Vec<&Value> {
    match t {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a.iter().collect(),
        Some(t) => vec![t],
    }
}

/// Every trigger phrase of a spec, joined with " or ".
pub(crate) fn trigger_phrases(t: Option<&Value>) -> String {
    normalize_triggers(t)
        .into_iter()
        .map(describe_trigger_value)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" or ")
}

fn keywords_of(elig: &P, k: &str) -> Vec<String> {
    map_arr(elig, k, jv).unwrap_or_default()
}

/// The eligible-unit noun phrase for a menu action ("one friendly non-TITANIC unit").
fn menu_action_subject(elig: &P) -> String {
    let requires = keywords_of(elig, "requires_keyword");
    let excludes = keywords_of(elig, "excludes_keyword");
    if !excludes.is_empty() {
        return format!("one friendly non-{} unit", excludes.join("/"));
    }
    if !requires.is_empty() {
        return format!("a friendly {} unit", requires.join(" "));
    }
    "the unit".to_string()
}

/// A menu action's `eligibility` → a trailing parenthetical, or `""` when open to any unit.
fn menu_action_eligibility_clause(elig: Option<&Value>) -> String {
    let Some(elig) = elig.filter(|e| crate::translate::condition::truthy(Some(e))) else {
        return String::new();
    };
    let elig = obj(Some(elig));
    let gate = !keywords_of(elig, "requires_keyword").is_empty()
        || !keywords_of(elig, "excludes_keyword").is_empty();
    let requirements: Vec<String> = arr(elig, "requires")
        .map(|r| r.iter().map(describe_condition_value).collect())
        .unwrap_or_default();
    if !gate && requirements.is_empty() {
        return String::new();
    }
    let mut parts = Vec::new();
    if gate {
        parts.push(format!("only usable by {}", menu_action_subject(elig)));
    }
    if !requirements.is_empty() {
        parts.push(requirements.join(" and "));
    }
    format!(" ({})", parts.join(", "))
}

/// One `resource-action-menu` action → a bullet body ("Label: trigger, spend N tokens, effect.").
pub(crate) fn describe_menu_action(a: &Value, ctx: &Ctx) -> String {
    let a = obj(Some(a));
    let label = jstr(nn(a, "label").or_else(|| a.get("id")));
    let trig = trigger_phrases(a.get("when"));
    let cost = obj(nn(a, "cost"));
    let cost_phrase = format!(
        "spend {} {}",
        jstr(cost.get("amount")),
        resource_noun(
            cost.get("pool_id"),
            cost.get("resource_label"),
            cost.get("amount")
        )
    );
    let effect = inline(nn(a, "effect").unwrap_or(empty_value()), ctx);
    let duration = match sv(a, "duration") {
        Some("until-end-of-phase") => "until the end of the phase",
        Some("until-end-of-turn") => "until the end of the turn",
        _ => "",
    };
    let repeatable = is_true(obj(a.get("usage")), "repeatable_if_different_unit");
    let usage = if repeatable {
        " (may be triggered more than once per phase if a different unit performs it each time)"
    } else {
        ""
    };
    let body = [
        format!(
            "{trig}{}",
            menu_action_eligibility_clause(a.get("eligibility"))
        ),
        cost_phrase,
        effect,
        duration.to_string(),
    ]
    .into_iter()
    .filter(|p| !p.is_empty())
    .collect::<Vec<_>>()
    .join(", ");
    format!("{label}: {body}{usage}.")
}

/// `capacity` → the menu's per-refresh budget sentence. `""` when absent.
pub(crate) fn capacity_clause(capacity: Option<&Value>) -> String {
    let Some(c) = capacity.filter(|c| crate::translate::condition::truthy(Some(c))) else {
        return String::new();
    };
    let c = obj(Some(c));
    let label = jstr(c.get("resource_label"));
    let noun = jstr(c.get("ability_noun"));
    let amount = jstr(c.get("amount"));
    let refresh = jstr(c.get("refresh"));
    let refresh = match refresh.as_str() {
        "battle-round" => "battle round".to_string(),
        "turn" | "phase" | "battle" => refresh.clone(),
        other => dekebab(other),
    };
    format!(
        "This unit has a {label} of {amount}. In each {refresh}, it can use {noun} abilities whose combined {label} does not exceed {amount}."
    )
}

/// `shared_usage` → a menu-level sentence fragment. `""` when absent.
pub(crate) fn shared_usage_clause(su: Option<&Value>) -> String {
    let Some(su) = su.filter(|s| crate::translate::condition::truthy(Some(s))) else {
        return String::new();
    };
    let su = obj(Some(su));
    let mut parts = Vec::new();
    if let Some(max) = nn(su, "unit_max_manoeuvres_per_phase") {
        parts.push(if max.as_f64() == Some(1.0) {
            "a unit may perform at most one action per phase".to_string()
        } else {
            format!("a unit may perform at most {} actions per phase", jv(max))
        });
    }
    if let Some(max) = nn(su, "default_manoeuvre_max_per_phase") {
        parts.push(if max.as_f64() == Some(1.0) {
            "unless stated otherwise, a given action may be triggered once per phase".to_string()
        } else {
            format!(
                "unless stated otherwise, a given action may be triggered up to {} times per phase",
                jv(max)
            )
        });
    }
    parts.join("; ")
}

/// The inline form of a `resource-action-menu`.
pub(crate) fn menu_inline(e: &P, ctx: &Ctx) -> String {
    let actions: Vec<String> = arr(e, "actions")
        .map(|a| a.iter().map(|x| describe_menu_action(x, ctx)).collect())
        .unwrap_or_default();
    format!(
        "actions may be performed when their conditions are met: {}",
        actions.join(" / ")
    )
}

/// The block form of a `resource-action-menu`.
pub(crate) fn menu_block(e: &P, indent: &str, arrow: &str, ctx: &Ctx) -> String {
    let su = shared_usage_clause(e.get("shared_usage"));
    let intro = if su.is_empty() {
        "Actions may be performed when their conditions are met".to_string()
    } else {
        format!(
            "Actions may be performed when their conditions are met. {}",
            capitalize(&su)
        )
    };
    let mut lines = vec![format!("{indent}{arrow}{intro}:")];
    for action in arr(e, "actions").into_iter().flatten() {
        lines.push(format!("{indent}  - {}", describe_menu_action(action, ctx)));
    }
    let cap = capacity_clause(e.get("capacity"));
    if cap.is_empty() {
        lines.join("\n")
    } else {
        format!("{indent}{cap}\n{}", lines.join("\n"))
    }
}
