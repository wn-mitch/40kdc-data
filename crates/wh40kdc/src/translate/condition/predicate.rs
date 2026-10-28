//! Predicate phrases: verb-turned negation, then the clock, army, identity,
//! composition and state predicates; the rest live in `board.rs`.

use serde_json::Value;

use super::board::board_predicate;
use super::equipment::named_equipment_phrase;
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
            | "equipped-weapon-count"
            | "attachment"
            | "controls"
            | "resource"
            | "attack-compare"
            | "happened-compare"
            | "operation-markers"
            | "engagement-fronts"
            | "destroyed-while-on-objective"
            | "destroyed-in-tagged-terrain"
            | "army-faction"
            | "army-state"
            | "oath-state"
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
        if t == "controls"
            && ["count", "compare", "proportion"]
                .iter()
                .filter(|key| nn(pp, key).is_some())
                .count()
                > 1
        {
            return format!("not ({})", describe_predicate(c, false));
        }
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
        "deployment-window" => format!("{neg}during deployment"),
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
        "matches" => describe_matches(p, negated),
        "rule-active" => format!("the {} is {not_}active", rule_ref_phrase(p.get("rule"))),
        "has-keyword" => {
            let who = if is(p, "subject", "defender") {
                "the target".to_string()
            } else {
                subject_of(p, "the unit")
            };
            let verb = if negated { "does not have" } else { "has" };
            format!(
                "{who} {verb} the keyword selected for {}",
                title_case(&st(p.get("chosen_by")))
            )
        }
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
        "attachment" => {
            let w = obj(p.get("with"));
            if w.iter()
                .any(|(key, value)| key != "all_of" && !value.is_null())
            {
                if is(p, "role", "leading") {
                    let who = if is(p, "subject", "this-model") || nn(p, "subject").is_none() {
                        "the model".to_string()
                    } else {
                        subject_of(p, "the unit")
                    };
                    return format!("{neg}{who} is leading {}", unit_filter_phrase(w));
                }
                if is(p, "role", "led") {
                    let mut filter = w.clone();
                    filter.insert("level".to_string(), Value::String("model".to_string()));
                    return format!(
                        "{neg}{} is being led by {}",
                        subject_of(p, "this unit"),
                        unit_filter_phrase(&filter)
                    );
                }
                return format!(
                    "{neg}{} is attached to {}",
                    subject_of(p, "the unit"),
                    unit_filter_phrase(w)
                );
            }
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
            // Attached to a named unit: "this model is attached to a DOMINION SQUAD unit".
            if !kw.is_empty() {
                return format!(
                    "{neg}{} is attached to {} {kw}unit",
                    subject_of(p, "the unit"),
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
        "named-weapon" | "unit-wargear" => named_equipment_phrase(t, p, negated),
        "equipped-weapon-count" => {
            let mut weapons = crate::translate::effect::weapon_noun(p);
            let count = obj(p.get("count"));
            if count.get("min").and_then(Value::as_u64) == Some(1)
                && count.get("max").and_then(Value::as_u64) == Some(1)
            {
                weapons = weapons.replacen("weapons", "weapon", 1);
            }
            format!(
                "{} is {not_}equipped with {} {weapons}",
                subject_of(p, "the model"),
                count_phrase(p.get("count"))
            )
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
            format!(
                "{who} is {}{with_ref}",
                state_phrase(&st(p.get("state")), negated)
            )
        }
        "eligible" => {
            if is(p, "to", "embark-within") {
                // The candidate being checked (this-unit) reads "that Transport".
                let transport = match p.get("transport") {
                    Some(Value::String(s)) if s == "this-unit" => "that Transport".to_string(),
                    other => unit_ref_phrase(other, "that Transport"),
                };
                return format!(
                    "{} is {not_}able to embark within {transport}",
                    subject_of(p, "the unit")
                );
            }
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

/// Ordinary predicates use the shared filter; negation applies to the complete filter.
fn describe_matches(p: &P, negated: bool) -> String {
    let f = obj(p.get("filter"));
    let who = if is(p, "subject", "defender") {
        "the target".to_string()
    } else {
        subject_of(p, "the unit")
    };
    let not = if negated { "not " } else { "" };
    let has = if negated { "does not have" } else { "has" };
    let lacks = if negated { "has" } else { "does not have" };
    if f.iter()
        .filter(|(key, value)| key.as_str() != "level" && !value.is_null())
        .count()
        == 1
    {
        if nn(f, "all_of").is_some() || nn(f, "any_of").is_some() {
            if negated
                && nn(f, "any_of").is_none()
                && f.get("all_of")
                    .and_then(Value::as_array)
                    .is_some_and(|words| words.len() > 1)
            {
                return format!("{who} does not have all of {}", keyword_list(f));
            }
            return format!("{who} {has} {}", keyword_list(f));
        }
        if let Some(words) = strs(f.get("none_of")) {
            return format!("{who} {lacks} {}", keyword_noun(words, true));
        }
        if let Some(words) = strs(f.get("not_all_of")) {
            return format!("{who} {lacks} all of {}", keyword_noun(words, false));
        }
        if nn(f, "owner").is_some() {
            let owner = if is(f, "owner", "enemy") {
                "an enemy unit"
            } else if is(f, "owner", "friendly") {
                "friendly"
            } else {
                "a unit of either player"
            };
            return format!("{} is {not}{owner}", subject_of(p, "the unit"));
        }
        if let Some(state) = nn(f, "state") {
            return if state.as_str() == Some("fights-first") {
                format!("{who} {has} Fights First")
            } else {
                format!("{who} is {}", state_phrase(&st(Some(state)), negated))
            };
        }
        if let Some(states) = strs(f.get("not_states")) {
            if states.len() == 1 {
                return format!("{who} is {}", state_phrase(&states[0], !negated));
            }
            let phrase = and_list(
                &states
                    .iter()
                    .map(|state| format!("{who} is {}", state_phrase(state, true)))
                    .collect::<Vec<_>>(),
            );
            return if negated {
                format!("not ({phrase})")
            } else {
                phrase
            };
        }
        if let Some(abilities) = f.get("has_ability").and_then(Value::as_array) {
            return format!(
                "{who} {has} the {} ability",
                and_list(
                    &abilities
                        .iter()
                        .map(|v| id_label(Some(v)))
                        .collect::<Vec<_>>()
                )
            );
        }
        if let Some(abilities) = f.get("lacks_ability").and_then(Value::as_array) {
            return format!(
                "{who} {lacks} the {} ability",
                or_list(
                    &abilities
                        .iter()
                        .map(|v| id_label(Some(v)))
                        .collect::<Vec<_>>()
                )
            );
        }
        if let Some(tag) = nn(f, "designated").or_else(|| nn(f, "not_designated")) {
            return format!(
                "{who} is {}{}",
                if nn(f, "not_designated").is_some() != negated {
                    "not "
                } else {
                    ""
                },
                designation_phrase(&st(Some(tag)), false)
            );
        }
        if let Some(visible) = nn(f, "visible") {
            let to = obj(Some(visible)).get("to");
            let observer = if to.and_then(Value::as_str) == Some("attacker") {
                "the attacking model".to_string()
            } else {
                unit_ref_phrase(to, "the unit")
            };
            return format!("{who} is {not}visible to {observer}");
        }
        if let Some(within) = nn(f, "within") {
            let within = obj(Some(within));
            let to = if matches!(
                within.get("range").and_then(Value::as_str),
                Some("weapon" | "half-weapon")
            ) {
                String::new()
            } else {
                format!(" of {}", place_ref_phrase(within.get("of")))
            };
            return format!(
                "{who} is {not}{}within {}{to}",
                if within.get("wholly").and_then(Value::as_bool) == Some(true) {
                    "wholly "
                } else {
                    ""
                },
                range_phrase(within.get("range"))
            );
        }
    }
    format!("{who} is {not}{}", unit_filter_phrase(f))
}
