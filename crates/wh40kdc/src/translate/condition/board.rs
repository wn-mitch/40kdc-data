//! Predicate phrases for history counts, position, the board, attacks,
//! visibility, designations, resources and mission cards.

use serde_json::Value;

use super::history::destroyed_count;
use super::js::*;
use super::refs::*;
use crate::translate::dekebab;
use crate::translate::effect::title_case;

/// The predicate phrase for the history-count, position, board, attack,
/// visibility, designation, resource and mission-card predicates (the rest of
/// [`describe_predicate`](super::predicate::describe_predicate)).
pub(crate) fn board_predicate(c: &Value, negated: bool) -> String {
    let neg = if negated { "not " } else { "" };
    let not_ = neg;
    let p = params(c);
    match ctype(c).unwrap_or("") {
        "happened-compare" => {
            let left = obj(p.get("left"));
            let right = obj(p.get("right"));
            let ge = is(p, "comparison", "gte");
            if let Some(pool) = nn(right, "pool").filter(|_| ge) {
                return format!(
                    "{neg}you destroyed at least as many {} as your {}",
                    destroyed_count(left),
                    dekebab(&st(Some(pool)))
                );
            }
            if let Some(value) = nn(right, "value") {
                return format!(
                    "{neg}you destroyed {} {} {}",
                    comparison_phrase(p.get("comparison")),
                    st(Some(value)),
                    destroyed_count(left)
                );
            }
            if !ge && !is(p, "comparison", "gt") {
                let right = if let Some(pool) = nn(right, "pool") {
                    format!("your {}", dekebab(&st(Some(pool))))
                } else {
                    format!("the number of {} you destroyed", destroyed_count(right))
                };
                return format!(
                    "{neg}the number of {} you destroyed is {} {right}",
                    destroyed_count(left),
                    comparison_phrase(p.get("comparison"))
                );
            }
            format!(
                "{neg}you destroyed {} {} {} {}",
                if ge { "at least as many" } else { "more" },
                destroyed_count(left),
                if ge { "as" } else { "than" },
                destroyed_count(right)
            )
        }
        "within" => {
            let every = is(p, "models", "every");
            let counted = nn(p, "count").is_some();
            let plural = counted && !every;
            let who = if every {
                format!(
                    "every model in {}{}",
                    subject_of(p, "the unit"),
                    if counted {
                        format!(" ({} models)", count_phrase(p.get("count")))
                    } else {
                        String::new()
                    }
                )
            } else if counted {
                format!(
                    "{} models in {}",
                    count_phrase(p.get("count")),
                    subject_of(p, "the unit")
                )
            } else {
                subject_of(p, "the unit")
            };
            let wholly = if p.get("wholly").and_then(Value::as_bool) == Some(true) {
                "wholly "
            } else {
                ""
            };
            let target = if matches!(
                p.get("range").and_then(Value::as_str),
                Some("half-weapon" | "weapon")
            ) {
                String::new()
            } else {
                format!(" of {}", place_ref_phrase(p.get("of")))
            };
            let verb = if is(p, "at", "phase-start") {
                if plural {
                    "were"
                } else {
                    "was"
                }
            } else if plural {
                "are"
            } else {
                "is"
            };
            format!(
                "{who} {verb} {not_}{wholly}within {}{target}{}",
                range_phrase(p.get("range")),
                if is(p, "at", "phase-start") {
                    " at the start of the phase"
                } else {
                    ""
                }
            )
        }
        "in-region" => {
            let r = obj(p.get("region"));
            let wholly = if p.get("wholly") == Some(&Value::Bool(true)) {
                "wholly "
            } else {
                ""
            };
            let who = if is(p, "models", "every") {
                format!("every model in {}", subject_of(p, "the unit"))
            } else {
                subject_of(p, "the unit")
            };
            let where_ = if truthy(r.get("rule_region")) {
                title_case(&st(obj(r.get("rule_region")).get("region_id")))
            } else if truthy(r.get("territory")) {
                dekebab(&st(r.get("territory")))
            } else {
                let area = obj(r.get("terrain_area"));
                let mut w = match nn(area, "footprint") {
                    Some(fp) => format!("the {} terrain area", dekebab(&st(Some(fp)))),
                    None => "a terrain area".to_string(),
                };
                if let Some(d) = nn(area, "designated") {
                    w.push_str(&format!(" tagged {}", dekebab(&st(Some(d)))));
                }
                w
            };
            format!("{who} is {not_}{wholly}within {where_}")
        }
        "closest" => {
            let who = if is(p, "subject", "defender") {
                "the target".to_string()
            } else {
                subject_of(p, "the unit")
            };
            let within = nn(p, "range")
                .map(|r| format!(" within {}", range_phrase(Some(r))))
                .unwrap_or_default();
            let among = if is(p, "among", "eligible-targets") {
                "eligible target".to_string()
            } else if let Some(among) = p.get("among").and_then(Value::as_object) {
                strip_article(&unit_filter_phrase(among))
            } else {
                "unit".to_string()
            };
            let to = nn(p, "to")
                .filter(|to| to.as_str() != Some("attacker"))
                .map(|to| {
                    format!(
                        " to {}",
                        if to.as_str() == Some("defender") {
                            "the target".to_string()
                        } else {
                            unit_ref_phrase(Some(to), "the unit")
                        }
                    )
                })
                .unwrap_or_default();
            format!("{neg}{who} is the closest {among}{to}{within}")
        }
        "controls" => {
            let who = if is(p, "by", "enemy") {
                "your opponent controls"
            } else {
                "you control"
            };
            let objective = objective_phrase(obj(p.get("objective")), true, "objective");
            let mut clauses = Vec::new();
            if nn(p, "count").is_some()
                || (nn(p, "compare").is_none() && nn(p, "proportion").is_none())
            {
                clauses.push(format!(
                    "{who} {} {objective}",
                    count_phrase(p.get("count"))
                ));
            }
            if let Some(compare) = nn(p, "compare") {
                let compare = obj(Some(compare));
                let other = if is(compare, "owner", "friendly") {
                    "you"
                } else {
                    "the opponent"
                };
                let holder = if is(p, "by", "enemy") {
                    "your opponent holds"
                } else {
                    "you hold"
                };
                if is(compare, "comparison", "gt") {
                    clauses.push(format!("{holder} more {objective} than {other}"));
                } else {
                    clauses.push(format!(
                        "the number of {objective} {who} is {} the number {}",
                        comparison_phrase(compare.get("comparison")),
                        if is(compare, "owner", "friendly") {
                            "you control"
                        } else {
                            "the opponent controls"
                        }
                    ));
                }
            }
            if let Some(proportion) = nn(p, "proportion") {
                let proportion = obj(Some(proportion));
                let fraction = proportion
                    .get("fraction")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                let fraction = if fraction == 0.5 {
                    "half".to_string()
                } else {
                    format!("{}%", fraction * 100.0)
                };
                clauses.push(format!(
                    "{who} {} {fraction} of the {objective}",
                    comparison_phrase(proportion.get("comparison"))
                ));
            }
            format!("{neg}{}", clauses.join(" and "))
        }
        "attack-is" => {
            let attack_type = if truthy(p.get("attack_type")) {
                Some(st(p.get("attack_type")))
            } else {
                None
            };
            let mut kinds: Vec<String> = Vec::new();
            if truthy(p.get("shooting_type")) {
                kinds.push(format!("{} shooting", dekebab(&st(p.get("shooting_type")))));
            }
            if truthy(p.get("fight_type")) {
                kinds.push(format!("{} fight", dekebab(&st(p.get("fight_type")))));
            }
            if let Some(a) = attack_type {
                kinds.push(a);
            }
            let kinds: Vec<String> = kinds.into_iter().filter(|k| !k.is_empty()).collect();
            let kind = kinds.join(" ");
            if p.get("all_target_same_unit") == Some(&Value::Bool(true)) {
                let weapons = if nn(p, "weapons").is_some() {
                    format!(" made with {}", crate::translate::effect::weapon_noun(p))
                } else {
                    String::new()
                };
                return format!(
                    "{neg}all of the unit's {}attacks{weapons} target the same enemy unit",
                    if kind.is_empty() {
                        String::new()
                    } else {
                        format!("{kind} ")
                    }
                );
            }
            let mut parts = vec![format!(
                "for {}attacks",
                if kind.is_empty() {
                    String::new()
                } else {
                    format!("{kind} ")
                }
            )];
            if let Some(weapons) = nn(p, "weapons") {
                let weapons = obj(Some(weapons));
                if weapons
                    .iter()
                    .all(|(key, value)| value.is_null() || key == "keyword" || key == "name")
                    && !weapons.get("keyword").is_some_and(Value::is_array)
                {
                    if let Some(keyword) = nn(weapons, "keyword") {
                        parts.push(format!(
                            "made with {} weapons",
                            crate::translate::effect::bracket_keyword(keyword)
                        ));
                    }
                    if let Some(name) = nn(weapons, "name") {
                        parts.push(format!("made with {}", st(Some(name))));
                    }
                } else {
                    parts.push(format!(
                        "made with {}",
                        crate::translate::effect::weapon_noun(p)
                    ));
                }
            }
            format!("{neg}{}", parts.join(" "))
        }
        "attack-compare" => {
            let side = |o: &P| -> String {
                if let Some(v) = nn(o, "value") {
                    return st(Some(v));
                }
                let whose = if is(o, "of", "defender") {
                    "the target's"
                } else {
                    "the attack's"
                };
                let reduce = if is(o, "reduce", "max") {
                    "highest "
                } else if is(o, "reduce", "min") {
                    "lowest "
                } else {
                    ""
                };
                format!("{whose} {reduce}{}", st(o.get("stat")))
            };
            format!(
                "{neg}{} is {} {}",
                side(obj(p.get("left"))),
                comparison_phrase(p.get("comparison")),
                side(obj(p.get("right")))
            )
        }
        "roll-result" => format!(
            "{neg}the triggering {} roll {}",
            roll_word(p.get("roll")),
            if is(p, "result", "success") {
                "succeeded".to_string()
            } else {
                format!("was a {}", st(p.get("result")))
            }
        ),
        "visible" => {
            let who = if is(p, "subject", "defender") {
                "the target".to_string()
            } else {
                subject_of(p, "the unit")
            };
            let to = if nn(p, "to").is_none() || is(p, "to", "attacker") {
                "the attacking model".to_string()
            } else {
                unit_ref_phrase(p.get("to"), "the unit")
            };
            let fully = if p.get("fully") == Some(&Value::Bool(true)) {
                "fully "
            } else {
                ""
            };
            if let Some(blocker) = nn(p, "blocked_by") {
                let phrase = unit_ref_phrase(Some(blocker), "this unit");
                let phrase = if phrase == "the unit" {
                    "this unit".to_string()
                } else {
                    phrase
                };
                return format!(
                    "{who} is {}{fully}visible to {to} because of {phrase}",
                    if negated { "" } else { "not " }
                );
            }
            format!("{who} is {not_}{fully}visible to {to}")
        }
        "designated" => {
            if let Some(s) = p.get("subject").and_then(Value::as_object) {
                if truthy(s.get("objective")) {
                    return format!(
                        "{neg}{} {} tagged {}",
                        count_phrase(p.get("count")),
                        objective_phrase(obj(s.get("objective")), true, "objective"),
                        dekebab(&st(p.get("tag")))
                    );
                }
            }
            if nn(p, "count").is_some() {
                let subject = pluralize_first_noun(&strip_article(&unit_ref_phrase(
                    p.get("subject"),
                    "the unit",
                )));
                let by = nn(p, "by")
                    .map(|by| format!(" by {}", unit_ref_phrase(Some(by), "the unit")))
                    .unwrap_or_default();
                return format!(
                    "{neg}{} {subject} {}{by}",
                    count_phrase(p.get("count")),
                    designation_phrase(&st(p.get("tag")), false)
                );
            }
            let by = match nn(p, "by") {
                Some(b) => {
                    let phrase = unit_ref_phrase(Some(b), "this unit");
                    let phrase = if phrase == "the unit" {
                        "this unit".to_string()
                    } else {
                        phrase
                    };
                    format!(" by {phrase}")
                }
                None => String::new(),
            };
            format!(
                "{} is {not_}{}{by}",
                subject_of(p, "the unit"),
                designation_phrase(&st(p.get("tag")), false)
            )
        }
        "resource" => {
            if p.get("below_max") == Some(&Value::Bool(true)) {
                let source = obj(p.get("source_ability")).get("ability_id");
                return format!(
                    "{neg}the {} ability had unused selection capacity at the end of the opponent's previous turn",
                    dekebab(&st(source))
                );
            }
            format!(
                "{neg}the unit has {} {}",
                count_phrase(p.get("count")),
                dekebab(&st(p.get("pool")))
            )
        }
        // ── Mission-card predicates ───────────────────────────────────────────
        "operation-markers" => {
            let side = nn(p, "side")
                .map(|v| format!("{} ", st(Some(v))))
                .unwrap_or_default();
            let count = obj(p.get("count"));
            let num = |k: &str| match count.get(k) {
                Some(Value::Number(n)) => Some((n.as_f64().unwrap_or(0.0), js_num(n))),
                _ => None,
            };
            let min = num("min");
            let max = num("max");
            let exact = match (&min, &max) {
                (Some(mn), Some(mx)) if mn.0 == mx.0 => Some(mn.clone()),
                _ => None,
            };
            let mut s = if max.as_ref().is_some_and(|m| m.0 == 0.0) {
                format!("no {side}operation markers on the battlefield")
            } else if let Some(mn) = exact {
                format!(
                    "exactly {} {side}operation marker{} on the battlefield",
                    mn.1,
                    if mn.0 == 1.0 { "" } else { "s" }
                )
            } else {
                format!(
                    "{} {side}operation markers on the battlefield",
                    count_phrase(p.get("count"))
                )
            };
            if let Some(w) = nn(p, "within") {
                let w = obj(Some(w));
                s.push_str(&format!(
                    " within {} of {}",
                    range_phrase(w.get("range")),
                    place_ref_phrase(w.get("of"))
                ));
            }
            if truthy(p.get("friendly_unit_in_same_terrain_area")) {
                s.push_str(" with a friendly unit in the same terrain area");
            }
            if truthy(p.get("no_enemy_in_terrain_area")) {
                s.push_str(" and no enemy units in that terrain area");
            }
            format!("{neg}{s}")
        }
        "engagement-fronts" => format!(
            "{neg}you are engaged on {} fronts",
            count_phrase(p.get("count"))
        ),
        "destroyed-while-on-objective" => {
            let objective = if truthy(p.get("objective_role")) {
                format!("a {} objective", dekebab(&st(p.get("objective_role"))))
            } else {
                "an objective".to_string()
            };
            let mut s = format!(
                "{neg}{} enemy units destroyed",
                count_phrase(p.get("count"))
            );
            if truthy(p.get("destroyer_on_objective")) {
                s.push_str(&format!(" by a unit on {objective}"));
            }
            if truthy(p.get("victim_on_objective")) {
                s.push_str(&format!(" while on {objective}"));
            }
            if truthy(p.get("victim_started_turn_on_objective")) {
                s.push_str(&format!(" that started the turn on {objective}"));
            }
            s
        }
        "destroyed-in-tagged-terrain" => {
            let where_ = if truthy(p.get("at_start_of_turn")) {
                "that started the turn in"
            } else {
                "while in"
            };
            let terrain = match nn(p, "tag") {
                Some(t) => format!("{} terrain", dekebab(&st(Some(t)))),
                None => "a terrain area".to_string(),
            };
            format!(
                "{neg}{} enemy units destroyed {where_} {terrain}",
                count_phrase(p.get("count"))
            )
        }
        "battle-size" => format!(
            "the battle size is {not_}{}",
            title_case(&st(p.get("size")))
        ),
        "army-faction" => format!(
            "your Army Faction is {not_}{}",
            st(p.get("faction")).replace('-', " ").to_uppercase()
        ),
        "army-state" => format!(
            "{} is {not_}{}",
            if is(p, "owner", "enemy") {
                "your opponent's army"
            } else {
                "your army"
            },
            dekebab(&st(p.get("state")))
        ),
        "oath-state" => format!(
            "the {} oath is {not_}{}",
            id_label(p.get("ability")),
            dekebab(&st(p.get("state")))
        ),
        "army-includes" => army_includes(p, negated),
        "moved-over" => {
            let window = if nn(p, "window").is_none() || is(p, "window", "event") {
                "during that move".to_string()
            } else {
                window_phrase(p.get("window"))
            };
            format!(
                "{} {} moved over by {} {window}",
                subject_of(p, "the unit"),
                if negated { "was not" } else { "was" },
                unit_ref_phrase(p.get("by"), "this model")
            )
        }
        "guided" => format!(
            "{} is {not_}{}",
            subject_of(p, "the unit"),
            designation_phrase("guided", false)
        ),
        other => format!(
            "{neg}{}",
            dekebab(if ctype(c).is_some() { other } else { "unknown" })
        ),
    }
}

/// "your army includes a CHARACTER unit", "your army includes 2 or more X units", "every model in
/// your army has the IMPERIUM keyword". The army is yours, so the filter's owner is not repeated.
fn army_includes(p: &P, negated: bool) -> String {
    let mut f = p
        .get("filter")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    f.remove("owner");
    let noun = if is(&f, "level", "model") {
        "model"
    } else {
        "unit"
    };
    let words = |k: &str| -> Vec<String> {
        f.get(k)
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|x| st(Some(x))).collect())
            .unwrap_or_default()
    };
    if p.get("every").and_then(Value::as_bool) == Some(true) {
        if f.iter().any(|(key, value)| {
            !value.is_null() && !["all_of", "any_of", "level"].contains(&key.as_str())
        }) || (nn(&f, "all_of").is_some() && nn(&f, "any_of").is_some())
        {
            return format!(
                "{}every {noun} in your army is {}",
                if negated { "not " } else { "" },
                unit_filter_phrase(&f)
            );
        }
        let all = words("all_of");
        let any = words("any_of");
        let list = if any.is_empty() {
            and_list(&all)
        } else {
            or_list(&any)
        };
        let plural = if all.len() > 1 && any.is_empty() {
            "s"
        } else {
            ""
        };
        return format!(
            "{}every {noun} in your army has the {list} keyword{plural}",
            if negated { "not " } else { "" }
        );
    }
    let one = unit_filter_phrase(&f);
    let min = p.get("min").and_then(Value::as_f64).unwrap_or(1.0);
    let what = if min > 1.0 {
        let bare = one
            .strip_prefix("an ")
            .or_else(|| one.strip_prefix("a "))
            .unwrap_or(&one);
        format!("{} or more {}", min as i64, pluralize_first_noun(bare))
    } else {
        one
    };
    format!(
        "your army {} {what}",
        if negated {
            "does not include"
        } else {
            "includes"
        }
    )
}

/// JS `s.replace(/\b(unit|model)\b/, "$1s")`: the first whole word "unit" or "model", made plural.
pub(super) fn pluralize_first_noun(s: &str) -> String {
    let word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let bytes = s.as_bytes();
    for (at, _) in s.char_indices() {
        for noun in ["unit", "model"] {
            if s[at..].starts_with(noun)
                && (at == 0 || !word(bytes[at - 1]))
                && bytes.get(at + noun.len()).is_none_or(|b| !word(*b))
            {
                return format!("{}{noun}s{}", &s[..at], &s[at + noun.len()..]);
            }
        }
    }
    s.to_string()
}
