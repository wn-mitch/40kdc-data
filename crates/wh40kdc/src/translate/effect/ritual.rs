//! The ritual-menu container: Rituals attempted with a Psychic test, each with its Warp Charge.
//! Mirrors `tools/src/translate/effect-ritual.ts`.

use serde_json::Value;

use super::inline;
use super::js::jstr;
use super::words::*;
use crate::translate::condition::{nn, obj, P};

/// "(each Ritual can be attempted once per turn across your army)": the menu's limit on each Ritual.
const RITUAL_LIMIT: &str = "each Ritual can be attempted once per turn across your army";

/// "take a Psychic test: roll 2D6, and you can roll one additional D6; if any two of its dice show
/// the same result, …; if this model is not destroyed and the total of all its dice equals or
/// exceeds the Ritual's Warp Charge, this model manifests that Ritual".
fn test_phrase(e: &P, ctx: &Ctx) -> String {
    let test = obj(nn(e, "test"));
    let more = match nn(test, "extra_die") {
        Some(extra) => {
            let extra = obj(Some(extra));
            let offer = if extra.get("optional") == Some(&Value::Bool(true)) {
                "you can roll"
            } else {
                "roll"
            };
            format!(
                ", and {offer} one additional {}",
                dice_case(extra.get("dice"))
            )
        }
        None => String::new(),
    };
    let cost = match nn(test, "perils") {
        Some(perils) => format!(
            "; if any two of its dice show the same result, {}",
            inline(obj(Some(perils)).get("effect").unwrap_or(&Value::Null), ctx)
        ),
        None => String::new(),
    };
    let kind = match nn(test, "kind") {
        Some(kind) => roll_kind_noun(Some(kind)),
        None => "a test".to_string(),
    };
    format!(
        "take {kind}: roll {}{more}{cost}; if this model is not destroyed and the total of all its dice equals or exceeds the Ritual's Warp Charge, this model manifests that Ritual",
        dice_case(test.get("dice"))
    )
}

/// "Destiny's Ruin (Warp Charge 5)".
fn ritual_head(ritual: &P) -> String {
    format!(
        "{} (Warp Charge {})",
        jstr(ritual.get("name")),
        jstr(ritual.get("warp_charge"))
    )
}

fn rituals(e: &P) -> Vec<&P> {
    match e.get("rituals") {
        Some(Value::Array(list)) => list.iter().map(|ritual| obj(Some(ritual))).collect(),
        _ => Vec::new(),
    }
}

pub(super) fn ritual_menu_inline(e: &P, ctx: &Ctx) -> String {
    let list = rituals(e)
        .iter()
        .map(|ritual| {
            format!(
                "{}: {}",
                ritual_head(ritual),
                inline(ritual.get("effect").unwrap_or(&Value::Null), ctx)
            )
        })
        .collect::<Vec<_>>()
        .join(" / ");
    format!(
        "attempt one Ritual ({RITUAL_LIMIT}); to do so, {}: {list}",
        test_phrase(e, ctx)
    )
}

pub(super) fn ritual_menu_block(e: &P, depth: usize, ctx: &Ctx) -> String {
    let indent = "  ".repeat(depth);
    let arrow = if depth > 0 { "-> " } else { "" };
    let mut lines = vec![format!(
        "{indent}{arrow}Attempt one of the Rituals below ({RITUAL_LIMIT}). To do so, {}:",
        test_phrase(e, ctx)
    )];
    for ritual in rituals(e) {
        lines.push(format!(
            "{indent}  - {}: {}.",
            ritual_head(ritual),
            capitalize(&inline(ritual.get("effect").unwrap_or(&Value::Null), ctx))
        ));
    }
    lines.join("\n")
}
