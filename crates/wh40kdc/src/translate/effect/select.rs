//! The selection containers: `select-units`, `for-each-unit`, `designate-target`,
//! and `persistent-designation`, with their selector phrases and bound-selection names.
//! Mirrors the matching helpers in `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::inline;
use super::words::*;
use crate::translate::condition::{describe_selection_eligibility_value, nn, obj, truthy, P};
use crate::translate::dekebab;

fn selector_filter(sel: &P) -> &P {
    obj(sel.get("filter"))
}

fn selector_level(sel: &P) -> &'static str {
    if sv(selector_filter(sel), "level") == Some("model") {
        "model"
    } else {
        "unit"
    }
}

fn selector_bounds(sel: &P) -> (Option<&Value>, Option<&Value>) {
    let count = obj(sel.get("count"));
    (nn(count, "min"), nn(count, "max"))
}

/// "the chosen reprise beneficiary" for a selection/event reference, else `fallback`.
pub(crate) fn selection_ref_name(r: Option<&Value>, fallback: &str) -> String {
    let value = r.and_then(Value::as_object).cloned().unwrap_or_default();
    let id = nn(&value, "selection_var").or_else(|| nn(&value, "event_var"));
    match id.and_then(Value::as_str).filter(|s| !s.is_empty()) {
        Some(id) => format!("the chosen {}", dekebab(&id.replace('_', "-"))),
        None => fallback.to_string(),
    }
}

/// Generic internal binding names that add no player-facing information when printed.
const GENERIC_BINDINGS: &[&str] = &[
    "objective",
    "selected_objective",
    "selected-objective",
    "quarry_selection",
    "mark_selection",
    "selected_unit",
    "selected-unit",
    "enemy_unit",
    "enemy-unit",
    "target_unit",
    "target-unit",
    "friendly_unit",
    "friendly-unit",
    "unit",
    "target",
    "model",
    "trap_objective",
    "trap-objective",
];

fn normalize_binding_name(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_sep = false;
    for c in s.to_lowercase().chars() {
        if c == '-' || c == '_' || c.is_whitespace() {
            if !in_sep {
                out.push('_');
                in_sep = true;
            }
        } else {
            out.push(c);
            in_sep = false;
        }
    }
    out
}

/// " (referred to below as the <name>)" when a selector binds its pick to a non-generic name.
pub(crate) fn selection_binding(sel: &P) -> String {
    let Some(name) = sv(sel, "bind_as").filter(|s| !s.is_empty()) else {
        return String::new();
    };
    let norm = normalize_binding_name(name);
    if GENERIC_BINDINGS.contains(&norm.as_str()) {
        return String::new();
    }
    format!(
        " (referred to below as the {})",
        dekebab(&name.replace('_', "-"))
    )
}

pub(super) fn eligibility_clause(sel: &P, require_object: bool) -> String {
    match sel.get("eligibility") {
        Some(e) if (require_object && e.is_object()) || (!require_object && truthy(Some(e))) => {
            format!(" {}", describe_selection_eligibility_value(e))
        }
        _ => String::new(),
    }
}

pub(super) fn selection_limit_phrase(limit: &P, noun: &str) -> String {
    let times = if is_num(limit, "count", 1.0) {
        "once".to_string()
    } else {
        format!("{} times", jstr(limit.get("count")))
    };
    format!(
        "each {noun} can be selected for this ability at most {times} per {} across your army",
        dekebab(&jstr(limit.get("period")))
    )
}

/// Shared inclusive cardinality for unit and objective selectors.
pub(super) fn selector_count(sel: &P) -> (String, bool) {
    let (min, max) = selector_bounds(sel);
    let quantity = |value: &Value| {
        if value.as_f64() == Some(1.0) {
            "one".to_string()
        } else {
            dice_case(Some(value))
        }
    };
    match (min, max) {
        (Some(min), Some(max)) if !min.is_object() && min == max => {
            (quantity(min), max.as_f64() != Some(1.0))
        }
        (Some(min), Some(max)) if min.as_f64() != Some(0.0) => (
            format!("{} to {}", quantity(min), quantity(max)),
            max.as_f64() != Some(1.0),
        ),
        (_, Some(max)) => (
            format!("up to {}", quantity(max)),
            max.as_f64() != Some(1.0),
        ),
        // "Select one or more models", not "at least one models".
        (Some(min), _) if min.as_f64() == Some(1.0) => ("one or more".to_string(), true),
        (Some(min), _) => (format!("at least {}", quantity(min)), true),
        _ => ("each".to_string(), false),
    }
}

pub(super) fn selection_limit(sel: &P, noun: &str) -> String {
    nn(sel, "limit")
        .map(|limit| format!(" ({})", selection_limit_phrase(obj(Some(limit)), noun)))
        .unwrap_or_default()
}

/// `each_model`: inside a loop over models, a range from the pass's model reads "that model".
pub(super) fn selector_subject(sel: &P, plural: bool, each_model: bool) -> String {
    let ctx = Ctx {
        each_model,
        ..Ctx::default()
    };
    let phrase = super::subject::filter_subject(selector_filter(sel), &ctx);
    let phrase = phrase.strip_prefix("all ").unwrap_or(&phrase);
    if plural {
        phrase.to_string()
    } else {
        phrase
            .replacen("units", "unit", 1)
            .replacen("models", "model", 1)
            .replace("that are", "that is")
    }
}

/// A canonical unit selector, including cardinality, eligibility and selection allowance.
pub(crate) fn select_units_subject(sel: &P) -> String {
    select_units_subject_in(sel, false)
}

/// As `select_units_subject`, inside a loop over models when `each_model`.
pub(crate) fn select_units_subject_in(sel: &P, each_model: bool) -> String {
    let (mut quantity, plural) = selector_count(sel);
    let (min, max) = selector_bounds(sel);
    let mut tail = String::new();
    if let Some(cap) = max.filter(|max| max.is_object() && (min.is_none() || num(min) == 0.0)) {
        let phrase = dice_case(Some(cap));
        if cap.get("count_of").is_some() {
            quantity = "any number of".to_string();
            tail = format!(" (at most {phrase})");
        } else {
            quantity = format!("up to {}", strip_paren_tail(&phrase));
            tail = format!(" ({})", paren_inner(&phrase));
        }
    }
    let base = selector_subject(sel, plural, each_model);
    let mut eligibility = String::new();
    if let Some(e) = sel.get("eligibility").filter(|e| e.is_object()) {
        let elig = describe_selection_eligibility_value(e);
        let has_that_is = has_that_is_tail(&base);
        if has_that_is && elig.starts_with("that is ") {
            eligibility = format!(" and {}", &elig["that is ".len()..]);
        } else if has_that_is && elig.starts_with("that ") {
            eligibility = format!(" and {}", &elig["that ".len()..]);
        } else {
            eligibility = format!(" {elig}");
        }
    }
    format!(
        "{quantity} {base}{tail}{eligibility}{}",
        selection_limit(sel, selector_level(sel))
    )
}

/// `/\bthat is [^\n]+$/.test(base)`.
fn has_that_is_tail(base: &str) -> bool {
    let bytes = base.as_bytes();
    let needle = "that is ";
    let mut from = 0;
    while let Some(pos) = base[from..].find(needle) {
        let start = from + pos;
        let after = start + needle.len();
        let word_before =
            start > 0 && (bytes[start - 1].is_ascii_alphanumeric() || bytes[start - 1] == b'_');
        if !word_before && after < base.len() && !base[after..].contains('\n') {
            return true;
        }
        from = after;
    }
    false
}

pub(crate) fn select_units_plural(sel: &P) -> bool {
    selector_count(sel).1
}

/// A `for-each-unit` body: a loop over models names each pass's model "that model".
pub(crate) fn each_context(ctx: &Ctx, sel: &P) -> Ctx {
    Ctx {
        each_model: selector_level(sel) == "model",
        ..selected_context_with_plural(ctx, sel, false)
    }
}

pub(crate) fn selected_context(ctx: &Ctx, sel: &P) -> Ctx {
    selected_context_with_plural(ctx, sel, select_units_plural(sel))
}

pub(crate) fn selected_context_with_plural(ctx: &Ctx, sel: &P, plural: bool) -> Ctx {
    let model = selector_level(sel) == "model";
    Ctx {
        selected_unit: !model,
        selected_model: model,
        selected_plural: plural,
        unit_subject: None,
        ..ctx.clone()
    }
}

pub(crate) fn select_units_inline(sel: &P, effect: &Value, ctx: &Ctx) -> String {
    let subject = select_units_subject_in(sel, ctx.each_model);
    let binding = selection_binding(sel);
    let nested = inline(effect, &selected_context(ctx, sel));
    format!("select {subject}{binding}; {nested}")
}

/// "enemy unit within 6\"" — the canonical all-matches selector phrase.
/// ", up to 2/3/4 units (Incursion/Strike Force/Onslaught) of your choice": a for-each's cap on
/// the units it affects.
pub(crate) fn for_each_cap(max: Option<&Value>) -> String {
    match max {
        None | Some(Value::Null) => String::new(),
        q => format!(
            ", up to {} of your choice",
            super::quantity::amount_of(q, "unit", "units")
        ),
    }
}

pub(crate) fn for_each_unit_subject(sel: &P) -> String {
    format!(
        "{}{}{}{}",
        selector_subject(sel, false, false),
        eligibility_clause(sel, false),
        selection_binding(sel),
        selection_limit(sel, selector_level(sel))
    )
}

/// `s.replace(/ \(.*\)$/, "")`: drop everything from the first " (" when the text ends in ")".
fn strip_paren_tail(s: &str) -> String {
    match s.find(" (") {
        Some(i) if s.ends_with(')') => s[..i].to_string(),
        _ => s.to_string(),
    }
}

/// `s.replace(/^.*\((.*)\)$/, "$1")`: the text inside the last "(" of a trailing group.
fn paren_inner(s: &str) -> String {
    match s.rfind('(') {
        Some(i) if s.ends_with(')') && s.len() > i + 1 => s[i + 1..s.len() - 1].to_string(),
        _ => s.to_string(),
    }
}
