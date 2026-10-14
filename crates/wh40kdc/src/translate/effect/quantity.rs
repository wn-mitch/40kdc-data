//! Non-literal quantities: one value per battle size, a bound roll's result, or a count on
//! the board, as the noun phrases the describers print. Mirrors the quantity helpers in
//! `tools/src/translate/effect-words.ts`.

use serde_json::Value;

use super::words::*;
use crate::translate::condition::{nn, obj, P};
use crate::translate::dekebab;

const BATTLE_SIZES: [&str; 3] = ["incursion", "strike-force", "onslaught"];

/// What a count-of / scaling source counts, as a noun phrase.
pub(crate) fn scale_of(of: &str) -> Option<&'static str> {
    Some(match of {
        "enemy-models-in-range" => "enemy models",
        "friendly-models-in-range" => "friendly models",
        "models-in-bearer-unit" => "models in this unit",
        "models-in-or-embarked-in-bearer" => "models in or embarked within this model",
        "models-embarked-in-bearer" => "models embarked within this model",
        "embarked-models-oc" => "Objective Control of the models embarked within this model",
        "models-equipped-with" => "models in this unit equipped with",
        "enemy-units-in-range" => "enemy units",
        "wounds-lost" => "wounds lost",
        "battle-round" => "battle round",
        _ => return None,
    })
}

/// A count source with its keyword / wargear qualifier: "SPYDER models in this unit".
pub(crate) fn scale_source(q: &P) -> String {
    let of = jstr(nn(q, "count_of").or_else(|| q.get("of")));
    let mut s = scale_of(&of)
        .map(str::to_string)
        .unwrap_or_else(|| dekebab(&of));
    if of == "models-equipped-with" {
        s.push_str(&format!(" {}", title_case(&jstr(q.get("wargear")))));
    }
    if let Some(k) = nn(q, "keyword") {
        if let Some(rest) = s.strip_prefix("models") {
            if !rest.chars().next().is_some_and(is_word_char) {
                s = format!("{} models{rest}", jv(k));
            }
        }
    }
    if let Some(w) = nn(q, "within_inches") {
        s.push_str(&format!(" within {}\"", jv(w)));
    }
    s
}

fn battle_sized(q: &P) -> Option<String> {
    BATTLE_SIZES.iter().all(|k| nn(q, k).is_some()).then(|| {
        BATTLE_SIZES
            .iter()
            .map(|k| jstr(q.get(*k)))
            .collect::<Vec<_>>()
            .join("/")
    })
}

/// A non-literal quantity as a noun phrase: one value per battle size, a bound roll's result,
/// or a count.
pub(crate) fn quantity_phrase(q: &P) -> String {
    if q.get("rating") == Some(&Value::Bool(true)) {
        return "its rating".to_string();
    }
    if let Some(sizes) = battle_sized(q) {
        return format!("{sizes} (Incursion/Strike Force/Onslaught)");
    }
    if q.get("roll_var").is_some_and(Value::is_string) {
        return match nn(q, "successes_on") {
            Some(n) => format!("the number of those dice that rolled a {}+", jv(n)),
            None => "the result of that roll".to_string(),
        };
    }
    match q.get("count_of").and_then(Value::as_str) {
        Some("battle-round") => "the battle round number".to_string(),
        Some("embarked-models-oc") => format!("the total {}", scale_source(q)),
        _ if nn(q, "count_of").is_some() => format!("the number of {}", scale_source(q)),
        _ => "?".to_string(),
    }
}

/// Whether a quantity is a literal number or dice expression.
pub(crate) fn is_literal(q: Option<&Value>) -> bool {
    !matches!(q, Some(v) if v.is_object() || v.is_array())
}

/// "D3 mortal wounds", or "a number of mortal wounds equal to the result of that roll".
pub(crate) fn amount_of(q: Option<&Value>, one: &str, many: &str) -> String {
    if is_literal(q) {
        let n = dice_case(q);
        return format!("{n} {}", if n == "1" { one } else { many });
    }
    let p = obj(q);
    if let Some(sizes) = battle_sized(p) {
        return format!("{sizes} {many} (Incursion/Strike Force/Onslaught)");
    }
    format!("a number of {many} equal to {}", quantity_phrase(p))
}
