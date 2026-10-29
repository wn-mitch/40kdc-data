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

/// "the bound reprise beneficiary" for a selection/event reference, else `fallback`.
pub(crate) fn selection_ref_name(r: Option<&Value>, fallback: &str) -> String {
    let value = r.and_then(Value::as_object).cloned().unwrap_or_default();
    let id = nn(&value, "selection_var").or_else(|| nn(&value, "event_var"));
    match id.and_then(Value::as_str).filter(|s| !s.is_empty()) {
        Some(id) => format!("the bound {}", dekebab(&id.replace('_', "-"))),
        None => fallback.to_string(),
    }
}

/// ", binding it as <name>" when a selector binds its pick.
pub(crate) fn selection_binding(sel: &P) -> String {
    match sv(sel, "bind_as").filter(|s| !s.is_empty()) {
        Some(name) => format!(
            ", binding {} as {}",
            if select_units_plural(sel) {
                "them"
            } else {
                "it"
            },
            dekebab(&name.replace('_', "-"))
        ),
        None => String::new(),
    }
}

pub(super) fn eligibility_clause(sel: &P, require_object: bool) -> String {
    match sel.get("eligibility") {
        Some(e) if (require_object && e.is_object()) || (!require_object && truthy(Some(e))) => {
            format!(" {}", describe_selection_eligibility_value(e))
        }
        _ => String::new(),
    }
}

fn target_noun(sel: &P) -> &'static str {
    selector_level(sel)
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
            format!("from {} through {}", quantity(min), quantity(max)),
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

pub(super) fn selector_subject(sel: &P, plural: bool) -> String {
    let phrase = super::subject::filter_subject(selector_filter(sel), &Ctx::default());
    let phrase = phrase.strip_prefix("all ").unwrap_or(&phrase);
    if plural {
        phrase.to_string()
    } else {
        phrase
            .replacen("units", "unit", 1)
            .replacen("models", "model", 1)
            .replacen("that are", "that is", 1)
    }
}

/// A canonical unit selector, including cardinality, eligibility and selection allowance.
pub(crate) fn select_units_subject(sel: &P) -> String {
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
    format!(
        "{quantity} {}{tail}{}{}",
        selector_subject(sel, plural),
        eligibility_clause(sel, true),
        selection_limit(sel, selector_level(sel))
    )
}

pub(crate) fn select_units_plural(sel: &P) -> bool {
    selector_count(sel).1
}

/// Global `\b[Tt]<pat>\b` replacement, with `repl(capital)` choosing the text.
fn replace_the(text: &str, pat: &str, repl: impl Fn(bool) -> String) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < text.len() {
        let rest = &text[i..];
        let capital = rest.starts_with('T');
        let hit = (rest.starts_with('T') || rest.starts_with('t'))
            && rest[1..].starts_with(pat)
            && !text[..i]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
            && !text[i + 1 + pat.len()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
        if hit {
            out.push_str(&repl(capital));
            i += 1 + pat.len();
        } else {
            let ch = rest.chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

pub(crate) fn selected_recipient(text: &str, sel: &P) -> String {
    let noun = target_noun(sel);
    let recipient = if select_units_plural(sel) {
        format!("each selected {noun}")
    } else {
        format!("the selected {noun}")
    };
    // Membership remains relative to the bearer/current unit, not the selected recipient.
    let text = text.replace("in the unit", "\u{e000}");
    let text = replace_the(&text, "he unit's", |cap| {
        if cap {
            format!("Each selected {noun}'s")
        } else {
            format!("{recipient}'s")
        }
    });
    replace_the(&text, "he unit", |cap| {
        if cap {
            format!("Each selected {noun}")
        } else {
            recipient.clone()
        }
    })
    .replace('\u{e000}', "in the unit")
}

pub(crate) fn selected_context(ctx: &Ctx, sel: &P) -> Ctx {
    let model = selector_level(sel) == "model";
    Ctx {
        selected_unit: !model,
        selected_model: model,
        unit_subject: None,
        ..ctx.clone()
    }
}

pub(crate) fn select_units_inline(sel: &P, effect: &Value, ctx: &Ctx) -> String {
    let subject = select_units_subject(sel);
    let binding = selection_binding(sel);
    let nested = selected_recipient(&inline(effect, &selected_context(ctx, sel)), sel);
    format!("select {subject}{binding}: {nested}")
}

/// "enemy unit within 6\"" — the canonical all-matches selector phrase.
pub(crate) fn for_each_unit_subject(sel: &P) -> String {
    format!(
        "{}{}{}{}",
        selector_subject(sel, false),
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
