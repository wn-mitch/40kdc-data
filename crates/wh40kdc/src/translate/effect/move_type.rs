//! The move-type container: a move type an army rule defines (Special Move Types), as a named mode
//! of a core move or a move of its own, with what applies before, while and after a unit makes it.
//! Mirrors `tools/src/translate/effect-move-type.ts`.

use super::inline;
use super::js::jstr;
use super::words::*;
use crate::translate::condition::{describe_condition_value, nn, range_phrase, P};

/// The display name of a core move type.
fn core_move(slug: &str) -> Option<&'static str> {
    Some(match slug {
        "normal" => "Normal",
        "advance" => "Advance",
        "fall-back" => "Fall Back",
        "charge" => "Charge",
        "pile-in" => "Pile-in",
        "consolidation" => "Consolidation",
        "surge" => "Surge",
        "scout" => "Scout",
        "ingress" => "Ingress",
        "disembark" => "Disembark",
        "embark" => "Embark",
        "pulse-jet" => "Pulse Jet",
        _ => return None,
    })
}

/// "shock-disembark" -> "Shock Disembark".
fn titled(slug: &str) -> String {
    slug.split('-')
        .map(capitalize)
        .collect::<Vec<_>>()
        .join(" ")
}

/// "Shock Disembark Move (the shock mode of a Disembark move)".
fn head(e: &P) -> String {
    let move_type = jstr(e.get("move_type"));
    let mv = core_move(&move_type)
        .map(str::to_string)
        .unwrap_or_else(|| titled(&move_type));
    match nn(e, "mode") {
        None => jstr(e.get("name")),
        Some(mode) => format!(
            "{} (the {} mode of a {mv} move)",
            jstr(e.get("name")),
            titled(&jstr(Some(mode)))
        ),
    }
}

/// Each statement the move type makes, as a clause, in the order the app prints them.
fn clauses(e: &P, ctx: &Ctx) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(distance) = nn(e, "distance") {
        out.push(format!(
            "the unit can move up to {}\"",
            dice_case(Some(distance))
        ));
    }
    if let Some(setup) = nn(e, "setup_distance") {
        out.push(format!(
            "each model is set up wholly within {} of that Transport",
            range_phrase(Some(setup))
        ));
    }
    if let Some(cond) = nn(e, "eligible_if") {
        out.push(format!(
            "a unit can make this move only if {}",
            describe_condition_value(cond)
        ));
    }
    for (key, lead) in [
        ("before", "before it moves"),
        ("while", "while it moves"),
        ("after", "after it moves"),
    ] {
        if let Some(effect) = nn(e, key) {
            out.push(format!("{lead}, {}", inline(effect, ctx)));
        }
    }
    out
}

pub(super) fn move_type_inline(e: &P, ctx: &Ctx) -> String {
    let parts = clauses(e, ctx);
    if parts.is_empty() {
        head(e)
    } else {
        format!("{}: {}", head(e), parts.join("; "))
    }
}

pub(super) fn move_type_block(e: &P, depth: usize, ctx: &Ctx) -> String {
    let indent = "  ".repeat(depth);
    let arrow = if depth > 0 { "-> " } else { "" };
    let parts = clauses(e, ctx);
    if parts.is_empty() {
        return format!("{indent}{arrow}{}.", head(e));
    }
    let mut lines = vec![format!("{indent}{arrow}{}:", head(e))];
    lines.extend(
        parts
            .iter()
            .map(|part| format!("{indent}  - {}.", capitalize(part))),
    );
    lines.join("\n")
}
