//! The binding containers added for the phase-4 shapes: `roll` (one roll whose result nested
//! numeric fields and dice gates share) and `select-objective` (bind objective markers for the
//! nested effect). Mirrors `tools/src/translate/effect-bind.ts`.

use super::block::block;
use super::words::*;
use super::{child, inline, is_container};
use crate::translate::condition::{nn, obj, objective_phrase, P};

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

/// An objective selector retains its own filter, count, binding and allowance.
pub(super) fn objective_selector_phrase(sel: &P) -> String {
    let (quantity, plural) = super::select::selector_count(sel);
    let noun = if plural {
        "objective markers"
    } else {
        "objective marker"
    };
    format!(
        "{quantity} {}{}{}{}",
        objective_phrase(obj(nn(sel, "filter")), false, noun),
        super::select::selection_binding(sel),
        super::select::eligibility_clause(sel, true),
        super::select::selection_limit(sel, "objective marker")
    )
}

fn lead(sel: &P) -> String {
    format!("select {}", objective_selector_phrase(sel))
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
