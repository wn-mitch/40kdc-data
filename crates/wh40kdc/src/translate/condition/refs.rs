//! Shared references: unit-ref, unit-filter, range, objective, state,
//! designation, history-window and move-kind phrases, and keyword lists.

use serde_json::Value;

use super::js::*;
use crate::translate::dekebab;
use crate::translate::effect::title_case;

// ── Shared references ───────────────────────────────────────────────────────

pub(crate) fn role_phrase(role: &str) -> Option<&'static str> {
    Some(match role {
        "this-unit" => "the unit",
        "this-model" => "this model",
        "model-in-this-unit" => "a model in this unit",
        "attacker" => "the attacking unit",
        "defender" => "the target unit",
        "event-subject" => "the triggering unit",
        "event-object" => "that unit",
        "stratagem-target" => "the Stratagem's target",
        "selected-unit" => "the selected unit",
        "recipient" => "the unit",
        _ => return None,
    })
}

/// A unit filter as a noun phrase: "a friendly ADEPTUS MECHANICUS BATTLELINE unit".
pub(crate) fn unit_filter_phrase(f: &P) -> String {
    let owner = if is(f, "owner", "friendly") {
        "friendly "
    } else if is(f, "owner", "enemy") {
        "enemy "
    } else {
        ""
    };
    let all = strs(f.get("all_of"))
        .map(|k| format!("{} ", k.join(" ")))
        .unwrap_or_default();
    let noun = if is(f, "level", "model") {
        "model"
    } else {
        "unit"
    };
    let base = format!("{owner}{all}{noun}");
    // `/^(?:[aeio]|u(?!ni))/i`: "an ORKS unit", "a unit", "an UNDEAD unit".
    let lower = base.to_lowercase();
    let an = lower.starts_with(['a', 'e', 'i', 'o'])
        || (lower.starts_with('u') && !lower.starts_with("uni"));
    let mut s = format!("{} {base}", if an { "an" } else { "a" });
    if let Some(any) = strs(f.get("any_of")) {
        s.push_str(&format!(" with the {} keyword", or_list(&any)));
    }
    if let Some(none) = strs(f.get("none_of")) {
        s.push_str(&format!(" (excluding {} {noun}s)", or_list(&none)));
    }
    if let Some(d) = nn(f, "designated") {
        s.push_str(&format!(" that is {}", designation_phrase(&st(Some(d)))));
    }
    if let Some(state) = nn(f, "state") {
        s.push_str(&format!(
            " that is {}",
            state_phrase(&st(Some(state)), false)
        ));
    }
    if f.get("visible") == Some(&Value::Bool(true)) {
        s.push_str(" that is visible to it");
    }
    if let Some(within) = nn(f, "within") {
        let w = obj(Some(within));
        s.push_str(&format!(" within {}", range_phrase(w.get("range"))));
        if let Some(of) = nn(w, "of") {
            s.push_str(&format!(" of {}", unit_ref_phrase(Some(of), "the unit")));
        }
    }
    if let Some(ex) = nn(f, "excluding") {
        let other = if ex.as_str() == Some("this-unit") {
            "this unit".to_string()
        } else {
            unit_ref_phrase(Some(ex), "the unit")
        };
        s.push_str(&format!(" other than {other}"));
    }
    s
}

/// A unit-ref as a noun phrase; `fallback` names the default subject.
pub(crate) fn unit_ref_phrase(r: Option<&Value>, fallback: &str) -> String {
    match r {
        None | Some(Value::Null) => fallback.to_string(),
        Some(Value::String(s)) => role_phrase(s)
            .map(str::to_string)
            .unwrap_or_else(|| dekebab(s)),
        Some(Value::Object(o)) => {
            if o.get("event_var").is_some_and(Value::is_string) {
                return "that unit".to_string();
            }
            if o.get("selection_var").is_some_and(Value::is_string) {
                return format!("the bound {}", st(o.get("selection_var")).replace('_', " "));
            }
            unit_filter_phrase(o)
        }
        Some(_) => fallback.to_string(),
    }
}

/// The subject of a predicate.
pub(crate) fn subject_of(p: &P, fallback: &str) -> String {
    unit_ref_phrase(p.get("subject"), fallback)
}

/// A range-ref as a distance phrase ("6\"", "Engagement Range", "Contagion Range").
pub(crate) fn range_phrase(r: Option<&Value>) -> String {
    match r {
        None | Some(Value::Null) => "?\"".to_string(),
        Some(Value::String(s)) => match s.as_str() {
            "engagement" => "Engagement Range".to_string(),
            "aura" => "its aura range".to_string(),
            "weapon" => "the attacking weapon's range".to_string(),
            "half-weapon" => "half the attacking weapon's range".to_string(),
            "detection" => "detection range".to_string(),
            "objective-control" => "range".to_string(),
            other => dekebab(other),
        },
        Some(v) => {
            let o = obj(Some(v));
            if let Some(inches) = nn(o, "inches") {
                return format!("{}\"", st(Some(inches)));
            }
            if let Some(aura) = nn(o, "aura_of") {
                let id = st(Some(aura));
                return match id.as_str() {
                    "nurgle-s-gift-aura" => "Contagion Range".to_string(),
                    _ => format!("the {} range", title_case(&id)),
                };
            }
            "?\"".to_string()
        }
    }
}

pub(crate) fn objective_phrase(f: &P, plural: bool, noun: &str) -> String {
    let role = if is(f, "role", "non-home") {
        String::new()
    } else if let Some(r) = nn(f, "role") {
        format!("{} ", dekebab(&st(Some(r))))
    } else {
        String::new()
    };
    let mut s = format!("{role}{noun}{}", if plural { "s" } else { "" });
    if is(f, "home_of", "enemy") {
        s.push_str(" (opponent home)");
    }
    if is(f, "home_of", "friendly") {
        s.push_str(" (your home)");
    }
    if let Some(name) = nn(f, "name") {
        s.push_str(&format!(" ({})", dekebab(&st(Some(name)))));
    }
    if let Some(t) = nn(f, "territory") {
        s.push_str(&format!(" in {}", dekebab(&st(Some(t)))));
    }
    if is(f, "role", "non-home") {
        s.push_str(" (excluding home)");
    }
    if is(f, "controlled_by", "friendly") {
        s.push_str(" you control");
    }
    if is(f, "controlled_by", "enemy") {
        s.push_str(" your opponent controls");
    }
    if let Some(d) = nn(f, "designated") {
        s.push_str(&format!(" tagged {}", dekebab(&st(Some(d)))));
    }
    s
}

pub(crate) fn state_phrase_base(state: &str) -> Option<&'static str> {
    Some(match state {
        "engaged" => "engaged",
        "battle-shocked" => "Battle-shocked",
        "embarked" => "embarked",
        "in-strategic-reserves" => "in Strategic Reserves",
        "on-battlefield" => "on the battlefield",
        "hidden" => "hidden",
        "fights-first" => "a Fights First unit",
        "benefit-of-cover" => "receiving the benefit of cover",
        _ => return None,
    })
}

pub(crate) fn state_phrase(state: &str, negated: bool) -> String {
    let base = state_phrase_base(state)
        .map(str::to_string)
        .unwrap_or_else(|| dekebab(state));
    if negated {
        if state == "engaged" {
            return "unengaged".to_string();
        }
        return format!("not {base}");
    }
    base
}

/// A designation: GW-printed tags stay as printed, internal state names are spelled out.
pub(crate) fn designation_phrase(tag: &str) -> String {
    if tag == tag.to_uppercase() {
        tag.to_string()
    } else {
        format!("tagged {}", dekebab(tag))
    }
}

pub(crate) fn window_phrase(w: Option<&Value>) -> String {
    let key = st(w);
    match key.as_str() {
        "phase" => "this phase".to_string(),
        "turn" => "this turn".to_string(),
        "round" => "this battle round".to_string(),
        "battle" => "this battle".to_string(),
        "previous-turn" => "in the previous turn".to_string(),
        "event" => String::new(),
        other => dekebab(other),
    }
}

pub(crate) fn with_window(s: &str, w: Option<&Value>) -> String {
    let phrase = window_phrase(w);
    if phrase.is_empty() {
        s.to_string()
    } else {
        format!("{s} {phrase}")
    }
}

pub(crate) fn move_name(t: &str) -> String {
    match t {
        "normal" => "Normal".to_string(),
        "advance" => "Advance".to_string(),
        "remain-stationary" => "Remain Stationary".to_string(),
        "fall-back" => "Fall Back".to_string(),
        "charge" => "Charge".to_string(),
        "pile-in" => "Pile-in".to_string(),
        "consolidation" => "Consolidation".to_string(),
        "ingress" => "ingress".to_string(),
        "surge" => "Surge".to_string(),
        "scout" => "Scout".to_string(),
        "disembark" => "Disembark".to_string(),
        other => dekebab(other),
    }
}

/// Move types as an or-list of their names ("Normal, Advance or Fall Back").
pub(crate) fn move_kinds(types: Option<&Value>) -> String {
    let names: Vec<String> = types
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|t| move_name(&st(Some(t)))).collect())
        .unwrap_or_default();
    or_list(&names)
}

// ── Predicates ──────────────────────────────────────────────────────────────

pub(crate) fn quoted(items: Vec<String>) -> Vec<String> {
    items.into_iter().map(|k| format!("\"{k}\"")).collect()
}

pub(crate) fn keyword_list(p: &P) -> String {
    if let Some(chosen) = nn(p, "chosen_by") {
        return format!("the keyword selected for {}", title_case(&st(Some(chosen))));
    }
    if let Some(any) = strs(p.get("any_of")) {
        return or_list(&quoted(any));
    }
    and_list(&quoted(strs(p.get("all_of")).unwrap_or_default()))
}

/// TS `typeof p.count_min === "number" ? p.count_min : 1`, JS-formatted.
pub(crate) fn count_or_one(p: &P) -> (f64, String) {
    match p.get("count_min") {
        Some(Value::Number(n)) => (n.as_f64().unwrap_or(0.0), js_num(n)),
        _ => (1.0, "1".to_string()),
    }
}

/// TS `str(p.key ?? 1)`.
pub(crate) fn str_or_one(p: &P, k: &str) -> String {
    match nn(p, k) {
        Some(v) => st(Some(v)),
        None => "1".to_string(),
    }
}
