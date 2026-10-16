//! English for the named-equipment predicates (`named-weapon`, `unit-wargear`): the Rust mirror of
//! `tools/src/translate/condition-equipment.ts`. Negation is written here rather than through
//! `negate_phrase`, because a printed weapon name may contain " is " or " has ".

use serde_json::Value;

use super::js::{st, P};
use crate::translate::effect::title_case;

/// The English for one named-equipment predicate, negated when `negated`.
pub(crate) fn named_equipment_phrase(t: &str, p: &P, negated: bool) -> String {
    if t == "unit-wargear" {
        return wargear_phrase(p, negated);
    }
    weapon_phrase(p, negated)
}

fn wargear_phrase(p: &P, negated: bool) -> String {
    let label = title_case(&st(p.get("wargear")));
    match p.get("models").and_then(Value::as_object) {
        None => {
            let verb = if negated { "does not have" } else { "has" };
            format!("this unit {verb} the {label} wargear")
        }
        Some(models) => {
            let verb = if st(models.get("state")) == "lack" {
                "are not equipped with"
            } else {
                "are equipped with"
            };
            unit_level(
                &format!("{} {verb} the {label} wargear", models_subject(models)),
                negated,
            )
        }
    }
}

fn weapon_phrase(p: &P, negated: bool) -> String {
    let name = st(p.get("name"));
    let count = st(p.get("count"));
    let one = p.get("count").and_then(Value::as_f64) == Some(1.0);
    let weapons = if one {
        format!("one weapon named \"{name}\"")
    } else {
        format!("exactly {count} weapons named \"{name}\"")
    };
    if st(p.get("subject")) == "this-model" {
        let verb = if negated { "is not" } else { "is" };
        return format!("this model {verb} equipped with {weapons}");
    }
    let empty = Default::default();
    let models = p.get("models").and_then(Value::as_object).unwrap_or(&empty);
    if st(models.get("state")) == "lack" {
        let none = if one {
            format!("no weapon named \"{name}\"")
        } else {
            format!("fewer than {count} weapons named \"{name}\"")
        };
        return unit_level(&format!("{} have {none}", models_subject(models)), negated);
    }
    unit_level(
        &format!(
            "{} are each equipped with {weapons}",
            models_subject(models)
        ),
        negated,
    )
}

fn models_subject(models: &P) -> String {
    let count = models.get("count");
    let minimum = count.and_then(|count| count.get("min"));
    if count.and_then(|count| count.get("max")).is_some() {
        format!("{} models in this unit", super::refs::count_phrase(count))
    } else if minimum.and_then(Value::as_u64) == Some(1) {
        "one or more models in this unit".to_string()
    } else {
        format!(
            "at least {} models in this unit",
            crate::translate::effect::dice_case(minimum)
        )
    }
}

fn unit_level(phrase: &str, negated: bool) -> String {
    if negated {
        format!("it is not the case that {phrase}")
    } else {
        phrase.to_string()
    }
}
