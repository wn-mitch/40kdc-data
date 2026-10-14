//! The binding containers added for the phase-4 shapes: `roll` (one roll whose result nested
//! numeric fields and dice gates share) and `select-objective` (bind objective markers for the
//! nested effect). Mirrors `tools/src/translate/effect-bind.ts`.

use serde_json::Value;

use super::block::block;
use super::words::*;
use super::{child, inline, is_container};
use crate::translate::condition::{nn, obj, objective_phrase, range_phrase, P};

/// "roll 8D6, plus one D6 for each die in your Blessings of Khorne pool (a Blessings of
/// Khorne roll)".
pub(super) fn roll_head(e: &P) -> String {
    let extra = match sv(e, "extra_dice_pool") {
        Some(pool) => format!(
            ", plus one D6 for each die in your {} pool",
            title_case(pool.strip_suffix("-pool").unwrap_or(pool))
        ),
        None => String::new(),
    };
    let kind = nn(e, "kind")
        .map(|k| format!(" ({})", roll_kind_noun(Some(k))))
        .unwrap_or_default();
    format!("roll {}{extra}{kind}", dice_case(e.get("dice")))
}

/// "one objective marker you control that the bearer's unit is within range of".
fn objective_selector_phrase(sel: &P) -> String {
    let each = sv(sel, "count") == Some("each");
    let one_value = Value::from(1);
    let n = num(Some(nn(sel, "count").unwrap_or(&one_value)));
    let noun = if each || n == 1.0 {
        "objective marker"
    } else {
        "objective markers"
    };
    let mut filter = obj(nn(sel, "filter")).clone();
    match sv(sel, "controlled_by") {
        Some("your-army") => {
            filter.insert("controlled_by".into(), "friendly".into());
        }
        Some("opponent") => {
            filter.insert("controlled_by".into(), "enemy".into());
        }
        _ => {}
    }
    let base = objective_phrase(&filter, false, noun);
    let quantity = if each {
        "each".to_string()
    } else if n == 1.0 {
        "one".to_string()
    } else {
        fnum(n)
    };
    let origin_key = nn(sel, "origin").map_or_else(|| "bearer".to_string(), jv);
    let origin = match origin_key.as_str() {
        "bearer-unit" => "the bearer's unit",
        _ => "the bearer",
    };
    let mut s = format!("{quantity} {base}");
    match nn(sel, "range") {
        Some(r) if r.as_str() == Some("objective-control") => {
            s.push_str(&format!(" that {origin} is within range of"));
        }
        Some(r) => s.push_str(&format!(" within {} of {origin}", range_phrase(Some(r)))),
        None => {
            if let Some(inches) = nn(sel, "range_inches") {
                s.push_str(&format!(" within {}\" of {origin}", jv(inches)));
            }
        }
    }
    if let Some(req) = nn(sel, "requires_unit") {
        let req = obj(Some(req));
        s.push_str(&format!(
            " with {} unit with the {} ability within range of it",
            if sv(req, "owner") == Some("enemy") {
                "an enemy"
            } else {
                "a friendly"
            },
            ability_label(req.get("requires_ability"))
        ));
    }
    s
}

fn selection_limit(sel: &P) -> String {
    let Some(limit) = nn(sel, "selection_limit") else {
        return String::new();
    };
    let limit = obj(Some(limit));
    let times = if num(limit.get("count")) == 1.0 {
        "once".to_string()
    } else {
        format!("{} times", jstr(limit.get("count")))
    };
    format!(
        " (each objective marker can be selected for this ability at most {times} per {})",
        jstr(limit.get("period")).replace('-', " ")
    )
}

fn lead(sel: &P) -> String {
    let verb = if sv(sel, "count") == Some("each") {
        "for"
    } else {
        "select"
    };
    format!(
        "{verb} {}{}",
        objective_selector_phrase(sel),
        selection_limit(sel)
    )
}

/// select-objective on one line: "select one objective marker …: <effect>".
pub(super) fn select_objective_inline(e: &P, ctx: &Ctx) -> String {
    format!(
        "{}: {}",
        lead(obj(nn(e, "selector"))),
        inline(child(e, "effect"), ctx)
    )
}

/// select-objective as a block: a header line and the nested effect one level deeper.
pub(super) fn select_objective_block(e: &P, depth: usize, ctx: &Ctx) -> String {
    let indent = "  ".repeat(depth);
    let arrow = if depth > 0 { "-> " } else { "" };
    let head = format!(
        "{indent}{arrow}{}",
        capitalize(&lead(obj(nn(e, "selector"))))
    );
    let inner = child(e, "effect");
    if is_container(obj(Some(inner))) {
        return format!("{head}:\n{}", block(inner, depth + 1, ctx));
    }
    format!("{head}: {}.", inline(inner, ctx))
}

/// A roll step as a block: the roll, then the nested effect one level deeper.
pub(super) fn roll_block(e: &P, depth: usize, ctx: &Ctx) -> String {
    let indent = "  ".repeat(depth);
    let arrow = if depth > 0 { "-> " } else { "" };
    let head = format!("{indent}{arrow}{}", capitalize(&roll_head(e)));
    let inner = child(e, "effect");
    if is_container(obj(Some(inner))) {
        return format!("{head}, then:\n{}", block(inner, depth + 1, ctx));
    }
    format!("{head}; then {}.", inline(inner, ctx))
}
