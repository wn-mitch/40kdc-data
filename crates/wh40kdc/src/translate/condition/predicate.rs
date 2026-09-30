//! Predicate phrases: verb-turned negation, then the clock, army, identity,
//! composition and state predicates; the rest live in `board.rs`.

use serde_json::Value;

use super::board::board_predicate;
use super::history::describe_happened;
use super::js::*;
use super::refs::*;
use crate::translate::effect::title_case;
use crate::translate::{battle_round_ordinal, dekebab};

/// Predicates whose phrase negates by turning its verb (see [`negate_phrase`]).
pub(crate) fn verb_negated(t: &str) -> bool {
    matches!(
        t,
        "strength"
            | "model-count"
            | "wounds"
            | "loadout"
            | "attachment"
            | "has-ability"
            | "controls"
            | "resource"
            | "attack-compare"
            | "happened-compare"
            | "operation-markers"
            | "engagement-fronts"
            | "destroyed-while-on-objective"
            | "destroyed-in-tagged-terrain"
            | "army-faction"
            | "battle-size"
    )
}

/// JS `/^(\w+ed|lost|been|fought) /.test(rest)`.
pub(crate) fn starts_with_past_word(rest: &str) -> bool {
    let word_len = rest
        .bytes()
        .take_while(|b| b.is_ascii_alphanumeric() || *b == b'_')
        .count();
    if rest.as_bytes().get(word_len) != Some(&b' ') {
        return false;
    }
    let word = &rest[..word_len];
    (word.len() >= 3 && word.ends_with("ed")) || matches!(word, "lost" | "been" | "fought")
}

/// "X is Y" -> "X is not Y", "X has Y" -> "X does not have Y", "you control" -> "you do not
/// control"; else a leading "not".
pub(crate) fn negate_phrase(phrase: &str) -> String {
    for (from, to) in [
        ("you control ", "you do not control "),
        ("you hold ", "you do not hold "),
        ("you destroyed ", "you did not destroy "),
        ("you newly control ", "you do not newly control "),
        ("you are ", "you are not "),
        ("your opponent controls ", "your opponent does not control "),
    ] {
        if let Some(rest) = phrase.strip_prefix(from) {
            return format!("{to}{rest}");
        }
    }
    if let Some(rest) = phrase.strip_prefix("1+ ") {
        return format!("no {rest}");
    }
    // `^(.*?) (is|was|contains|has) (.*)$`: the earliest verb wins.
    for i in 0..phrase.len() {
        if !phrase.is_char_boundary(i) {
            continue;
        }
        let tail = &phrase[i..];
        for verb in ["is", "was", "contains", "has"] {
            let Some(rest) = tail
                .strip_prefix(' ')
                .and_then(|t| t.strip_prefix(verb))
                .and_then(|t| t.strip_prefix(' '))
            else {
                continue;
            };
            let who = &phrase[..i];
            return match verb {
                "is" | "was" => format!("{who} {verb} not {rest}"),
                "contains" => format!("{who} does not contain {rest}"),
                _ if starts_with_past_word(rest) => format!("{who} has not {rest}"),
                _ => format!("{who} does not have {rest}"),
            };
        }
    }
    format!("not {phrase}")
}

/// The predicate phrase, optionally negated ("the unit is not below starting strength").
pub(crate) fn describe_predicate(c: &Value, negated: bool) -> String {
    let t = ctype(c).unwrap_or("");
    if negated {
        let pp = params(c);
        let turned = verb_negated(t)
            || (t == "happened"
                && !matches!(
                    st(pp.get("event")).as_str(),
                    "move-ended" | "selected" | "disembarked"
                ))
            || (t == "designated"
                && pp
                    .get("subject")
                    .and_then(Value::as_object)
                    .is_some_and(|s| truthy(s.get("objective"))));
        if turned {
            return negate_phrase(&describe_predicate(c, false));
        }
    }
    let neg = if negated { "not " } else { "" };
    let not_ = neg;
    let p = params(c);
    match ctype(c).unwrap_or("") {
        "phase-is" => {
            let phase = st(p.get("phase"));
            if phase == "command" {
                format!("{neg}during the Command phase")
            } else {
                format!("{neg}during the {} phase", title_case(&phase))
            }
        }
        "player-turn-is" => {
            let turn = if is(p, "turn", "your-turn") {
                "your"
            } else if is(p, "turn", "opponent-turn") {
                "the opponent's"
            } else {
                "either player's"
            };
            format!("{neg}in {turn} turn")
        }
        "battle-round" => {
            let min = crate::translate::num_param(p, "min");
            let max = crate::translate::num_param(p, "max");
            let where_ = match (min, max) {
                (Some(mn), Some(mx)) => {
                    if mn == mx {
                        format!("the {} battle round", battle_round_ordinal(mn))
                    } else {
                        format!("battle rounds {mn}-{mx}")
                    }
                }
                (Some(mn), None) => format!("the {} battle round onward", battle_round_ordinal(mn)),
                (None, Some(mx)) => format!("the first {mx} battle rounds"),
                (None, None) => "the battle round".to_string(),
            };
            format!("{neg}during {where_}")
        }
        "rule-active" => format!("the {} is {not_}active", id_label(p.get("rule"))),
        "has-keyword" => {
            let who = if is(p, "subject", "defender") {
                "the target".to_string()
            } else {
                subject_of(p, "the unit")
            };
            let verb = if negated { "does not have" } else { "has" };
            format!("{who} {verb} {}", keyword_list(p))
        }
        "owned-by" => format!(
            "{} is {not_}{}",
            subject_of(p, "the unit"),
            if is(p, "owner", "enemy") {
                "an enemy unit"
            } else {
                "friendly"
            }
        ),
        "same-unit" => format!(
            "{} is {not_}the same unit as {}",
            subject_of(p, "the unit"),
            if is(p, "as", "this-unit") {
                "this unit".to_string()
            } else {
                unit_ref_phrase(p.get("as"), "the unit")
            }
        ),
        "model-profile" => format!(
            "{} is {not_}the {} model",
            subject_of(p, "the model"),
            title_case(&st(p.get("profile")))
        ),
        "has-ability" => format!(
            "{neg}{} has the {} ability",
            subject_of(p, "the unit"),
            id_label(p.get("ability"))
        ),
        "attachment" => {
            let w = obj(p.get("with"));
            let kw = strs(w.get("all_of"))
                .map(|k| format!("{} ", k.join(" ")))
                .unwrap_or_default();
            if is(p, "role", "leading") {
                let who = if is(p, "subject", "this-model") || nn(p, "subject").is_none() {
                    "the model".to_string()
                } else {
                    subject_of(p, "the unit")
                };
                return format!("{neg}{who} is leading a {kw}unit");
            }
            if is(p, "role", "led") {
                return format!(
                    "{neg}{} is being led by {} {kw}model",
                    subject_of(p, "this unit"),
                    article(&kw)
                );
            }
            format!("{neg}{} is an attached unit", subject_of(p, "the unit"))
        }
        "strength" => format!(
            "{neg}{} is below {}",
            subject_of(p, "the unit"),
            if is(p, "below", "half") {
                "half strength"
            } else {
                "starting strength"
            }
        ),
        "model-count" => {
            let kw = nn(p, "keyword")
                .map(|k| format!("{} ", st(Some(k))))
                .unwrap_or_default();
            let range = match (nn(p, "min"), nn(p, "max")) {
                (Some(mn), Some(mx)) => format!("{}-{}", st(Some(mn)), st(Some(mx))),
                (Some(mn), None) => format!("{}+", st(Some(mn))),
                _ => format!("at most {}", st(p.get("max"))),
            };
            format!(
                "{neg}{} contains {range} {kw}models",
                subject_of(p, "the unit")
            )
        }
        "wounds" => {
            let who = if is(p, "subject", "this-model") || nn(p, "subject").is_none() {
                "the model".to_string()
            } else {
                subject_of(p, "the unit")
            };
            let mut parts: Vec<String> = Vec::new();
            if p.get("lost") == Some(&Value::Bool(true)) {
                parts.push("has lost wounds".to_string());
            }
            if let Some(r) = nn(p, "remaining_max") {
                if r.is_object() {
                    parts.push("has X or fewer wounds remaining, X being its rating".to_string());
                } else {
                    parts.push(format!("has {} or fewer wounds remaining", st(Some(r))));
                }
            }
            if p.get("damaged") == Some(&Value::Bool(true)) {
                parts.push("is Damaged".to_string());
            }
            format!("{neg}{who} {}", and_list(&parts))
        }
        "loadout" => {
            let kw = if truthy(p.get("model_keyword")) {
                format!("{} ", st(p.get("model_keyword")))
            } else {
                String::new()
            };
            format!(
                "{neg}all {} weapons equipped by each {kw}model in the unit are the same",
                st(p.get("uniform"))
            )
        }
        "unit-state" => {
            let who = subject_of(p, "the unit");
            let with_ref = nn(p, "with")
                .map(|w| format!(" with {}", unit_ref_phrase(Some(w), "the unit")))
                .unwrap_or_default();
            if is(p, "at", "phase-start") || is(p, "at", "turn-start") {
                return format!(
                    "{who} {} {}{with_ref} at the start of the {}",
                    if negated { "was not" } else { "was" },
                    state_phrase(&st(p.get("state")), false),
                    if is(p, "at", "phase-start") {
                        "phase"
                    } else {
                        "turn"
                    }
                );
            }
            if is(p, "state", "fights-first") {
                return format!("{neg}{who} has Fights First");
            }
            format!(
                "{who} is {}{with_ref}",
                state_phrase(&st(p.get("state")), negated)
            )
        }
        "eligible" => {
            if is(p, "to", "be-selected") {
                let source = obj(p.get("source_ability")).get("ability_id");
                return format!(
                    "{neg}the candidate was eligible for the {} ability at the end of the opponent's previous turn",
                    dekebab(&st(source))
                );
            }
            let to = st(p.get("to"));
            let to_phrase = match to.as_str() {
                "shoot" => "shoot".to_string(),
                "declare-charge" => "declare a charge".to_string(),
                "fight" => "fight".to_string(),
                "start-action" => "start an action".to_string(),
                other => dekebab(other),
            };
            format!(
                "{} is {not_}eligible to {to_phrase}",
                subject_of(p, "the unit")
            )
        }
        "happened" => describe_happened(p, negated),
        _ => board_predicate(c, negated),
    }
}
