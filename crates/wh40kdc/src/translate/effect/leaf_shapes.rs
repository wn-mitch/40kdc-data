//! Single effects added for the phase-4 shapes: a test exemption, a datasheet swap, how a
//! characteristic that differs between models resolves, Firing Deck weapon borrowing and a
//! weapon binding. One lowercase-initial clause, no period; `None` for any other type.
//! Mirrors `tools/src/translate/effect-leaf-shapes.ts`.

use serde_json::Value;

use super::words::*;
use crate::translate::condition::{designation_phrase, key_count, nn, obj, P};
use crate::translate::expiry::expiry_trail;

/// "PAIN" → "Pain", "BLOOD RITE" → "Blood Rite": an ability tag as the rules print it.
fn ability_tag(keyword: &str) -> String {
    keyword
        .to_lowercase()
        .split(' ')
        .map(capitalize)
        .collect::<Vec<_>>()
        .join(" ")
}

/// A suppression of every ability with a tag (`{rule: {ability_keyword}}`). On the units neither
/// carrying a tag nor part of a unit that carries it, it is the two sentences the rules print;
/// otherwise "<subject> cannot use <Tag> abilities". `None` when the rule names one ability.
pub(super) fn ability_class_state(target: Option<&Value>, m: &P, subj: &str) -> Option<String> {
    let keyword = m
        .get("rule")?
        .as_object()?
        .get("ability_keyword")?
        .as_str()?;
    let tag = ability_tag(keyword);
    let t = obj(target);
    let mark = t.get("not_designated").and_then(Value::as_str);
    let excluding = nn(t, "excluding").and_then(Value::as_object);
    let member_of = excluding
        .and_then(|x| nn(x, "member_of"))
        .and_then(Value::as_object);
    let unmarked = match (mark, excluding, member_of) {
        (Some(mark), Some(x), Some(mo)) => {
            key_count(t) == 2
                && key_count(x) == 1
                && key_count(mo) == 1
                && mo.get("designated").and_then(Value::as_str) == Some(mark)
        }
        _ => false,
    };
    let Some(mark) = mark.filter(|_| unmarked) else {
        return Some(format!("{subj} cannot use {tag} abilities"));
    };
    let state = designation_phrase(mark, false);
    Some(format!("{tag} abilities only apply to a unit while it is {state}. While an Attached unit is {state}, the {tag} abilities of all its Leader and Bodyguard units take effect, with no additional spend"))
}

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
    let until = expiry_trail(m.get("until"));
    let until = if until.is_empty() {
        String::new()
    } else {
        format!(" {until}")
    };
    format!(
        "{subj} can use one {} from each of up to {} {from}{until}; those models cannot shoot",
        weapon_noun(m),
        dice_case(m.get("max_models"))
    )
}

fn select_weapon(m: &P, subj: &str) -> String {
    let n = num(Some(
        m.get("count").filter(|c| !c.is_null()).unwrap_or(&1.into()),
    ));
    let one = n == 1.0;
    let weapon = if one {
        weapon_noun(m).replacen("weapons", "weapon", 1)
    } else {
        weapon_noun(m)
    };
    format!(
        "select {} {} equipped by {subj}; the effects below refer to {}",
        if one { "one".to_string() } else { fnum(n) },
        weapon,
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
