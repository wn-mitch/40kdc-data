//! Single effects added for the phase-4 shapes: a test exemption, a datasheet swap, how a
//! characteristic that differs between models resolves, Firing Deck weapon borrowing and a
//! weapon binding. One lowercase-initial clause, no period; `None` for any other type.
//! Mirrors `tools/src/translate/effect-leaf-shapes.ts`.

use super::words::*;
use crate::translate::condition::{nn, P};
use crate::translate::expiry::expiry_trail;

fn test_exemption(m: &P, subj: &str) -> String {
    format!(
        "{subj} {} not need to take any further {} tests this {}",
        v(subj, "does"),
        test_name(m.get("test")),
        jstr(m.get("window")).replace('-', " ")
    )
}

fn characteristic_resolution(m: &P, subj: &str) -> String {
    let stat = format!("{} characteristic", stat_name(m.get("stat")));
    let which = if sv(m, "rule") == Some("majority") {
        let tie = if sv(m, "tie") == Some("lowest") {
            "lowest"
        } else {
            "highest"
        };
        format!("the {stat} of the majority of its models (if tied, the {tie})")
    } else {
        let end = if sv(m, "rule") == Some("lowest") {
            "lowest"
        } else {
            "highest"
        };
        format!("the {end} {stat} among its models")
    };
    if sv(m, "applies_to") == Some("wound-roll") {
        return format!(
            "each time an attack targets {subj}, use {which} to determine the Wound roll"
        );
    }
    format!("{subj} {} {which}", v(subj, "uses"))
}

fn borrow_weapons(m: &P, subj: &str, ctx: &Ctx) -> String {
    // Weapons come from models, so a unit filter reads as its models.
    let from = match nn(m, "from") {
        Some(f) => {
            let s = strip_all(&effect_subject(Some(f), ctx));
            replace_word_first(&s, "units", "models", true)
        }
        None => "models embarked within it".to_string(),
    };
    let kind = nn(m, "weapon_type")
        .map(|k| format!("{} ", jv(k)))
        .unwrap_or_default();
    let excl = match arr(m, "exclude_weapon_keyword") {
        Some(k) if !k.is_empty() => format!(
            " (excluding {} weapons)",
            k.iter()
                .map(bracket_keyword)
                .collect::<Vec<_>>()
                .join(" and ")
        ),
        _ => String::new(),
    };
    let until = expiry_trail(m.get("until"));
    let until = if until.is_empty() {
        String::new()
    } else {
        format!(" {until}")
    };
    format!(
        "{subj} can use one {kind}weapon{excl} from each of up to {} {from}{until}; those models cannot shoot",
        dice_case(m.get("max_models"))
    )
}

fn select_weapon(m: &P, subj: &str) -> String {
    let n = num(Some(
        m.get("count").filter(|c| !c.is_null()).unwrap_or(&1.into()),
    ));
    let one = n == 1.0;
    let kind = nn(m, "weapon_type")
        .map(|k| format!("{} ", jv(k)))
        .unwrap_or_default();
    let kw = nn(m, "weapon_keyword")
        .map(|k| format!(" with [{}]", jv(k).to_uppercase()))
        .unwrap_or_default();
    format!(
        "select {} {kind}weapon{}{kw} equipped by {subj}; the effects below refer to {}",
        if one { "one".to_string() } else { fnum(n) },
        if one { "" } else { "s" },
        if one {
            "it as the selected weapon"
        } else {
            "them as the selected weapons"
        }
    )
}

/// The phase-4 leaves, or `None` for any other type.
pub(super) fn describe_shape_leaf(e: &P, m: &P, subj: &str, ctx: &Ctx) -> Option<String> {
    Some(match sv(e, "type")? {
        "test-exemption" => test_exemption(m, subj),
        "datasheet-swap" => format!(
            "{subj} {} the {} datasheet from now on, keeping its lost wounds and its position",
            v(subj, "uses"),
            title_case(&jstr(m.get("datasheet")))
        ),
        "characteristic-resolution" => characteristic_resolution(m, subj),
        "borrow-weapons" => borrow_weapons(m, subj, ctx),
        "select-weapon" => select_weapon(m, subj),
        _ => return None,
    })
}
