//! The `happened` predicate: what the subject did, or what happened to it, in
//! a history window.

use serde_json::Value;

use super::js::*;
use super::refs::*;
use crate::translate::dekebab;
use crate::translate::effect::title_case;

/// Past tense of the verbs history predicates use.
pub(crate) fn past_of(verb: &str) -> String {
    match verb {
        "charge" => "charged".to_string(),
        "advance" => "advanced".to_string(),
        "fall back" => "fell back".to_string(),
        "remain stationary" => "remained stationary".to_string(),
        "make an ingress move" => "made an ingress move".to_string(),
        "move" => "moved".to_string(),
        "disembark" => "disembarked".to_string(),
        other => match other.strip_prefix("make ") {
            Some(rest) => format!("made {rest}"),
            None => other.to_string(),
        },
    }
}

/// `/^[a-z0-9]+(-[a-z0-9]+)+$/.test(s)`: an id slug rather than a printed name.
fn is_kebab_slug(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() > 1
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
}

pub(crate) fn describe_happened(p: &P, negated: bool) -> String {
    let mut phrase = happened_phrase(p, negated);
    let event = st(p.get("event"));
    if nn(p, "count").is_some()
        && matches!(event.as_str(), "destroyed" | "model-destroyed")
        && (is(p, "object", "this-model")
            || (is(p, "object", "event-object") && is(p, "window", "event")))
    {
        phrase.push_str(&format!(" ({} times)", count_phrase(p.get("count"))));
    }
    phrase.push_str(&event_relation_phrase(obj(p.get("filter"))));
    if let Some(proximity) = nn(p, "proximity") {
        let proximity = obj(Some(proximity));
        phrase.push_str(&format!(
            " within {} of {}",
            range_phrase(proximity.get("range")),
            place_ref_phrase(proximity.get("of"))
        ));
    }
    if nn(p, "count").is_some()
        && ![
            "after-roll",
            "destroyed",
            "model-destroyed",
            "objective-gained",
            "designation-changed",
        ]
        .contains(&event.as_str())
        && !(event == "used" && is(obj(p.get("filter")), "kind", "action"))
    {
        phrase.push_str(&format!(" ({} times)", count_phrase(p.get("count"))));
    }
    phrase
}

fn happened_phrase(p: &P, negated: bool) -> String {
    let did_not = |verb: &str| -> String {
        if negated {
            format!("did not {verb}")
        } else {
            past_of(verb)
        }
    };
    let neg = if negated { "not " } else { "" };
    let f = obj(p.get("filter"));
    let event = st(p.get("event"));
    let who = subject_of(p, "the unit");
    let n_val = obj(p.get("count"))
        .get("min")
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    let amount = count_phrase(p.get("count"));
    let window = p.get("window");
    // The phase the event happened in leads its window: "in the Fight phase this battle".
    let in_phase = match f.get("phase") {
        None | Some(Value::Null) => String::new(),
        phase => format!("in the {} phase", title_case(&st(phase))),
    };
    let window_phrase = |w: Option<&Value>| -> String {
        [in_phase.clone(), super::refs::window_phrase(w)]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    };
    let with_window = |text: &str, w: Option<&Value>| -> String {
        let phrase = window_phrase(w);
        if phrase.is_empty() {
            text.to_string()
        } else {
            format!("{text} {phrase}")
        }
    };
    match event.as_str() {
        "move-ended" => {
            let types: Vec<String> = strs(f.get("move_types")).unwrap_or_default();
            let verb = |t: &str| -> Option<&'static str> {
                Some(match t {
                    "charge" => "charge",
                    "advance" => "advance",
                    "fall-back" => "fall back",
                    "remain-stationary" => "remain stationary",
                    "ingress" => "make an ingress move",
                    _ => return None,
                })
            };
            let done = match (types.len(), types.first().and_then(|t| verb(t))) {
                (1, Some(v)) => did_not(v),
                _ if !types.is_empty() => {
                    did_not(&format!("make a {} move", move_kinds(f.get("move_types"))))
                }
                _ => did_not("move"),
            };
            with_window(&format!("{who} {done}"), window)
        }
        "selected" => {
            let to = st(f.get("to"));
            let has = if negated { "has not" } else { "has" };
            if to == "fight" {
                return with_window(&format!("{who} {has} fought"), window);
            }
            let what = if to == "attack" {
                "shoot or fight".to_string()
            } else {
                dekebab(&to)
            };
            with_window(&format!("{who} {has} been selected to {what}"), window)
        }
        "set-up" => {
            let from = match st(f.get("from")).as_str() {
                "deep-strike" => " using Deep Strike",
                "strategic-reserves" => " from Strategic Reserves",
                "cult-ambush" => " from Cult Ambush",
                "transport" => " from a Transport",
                _ => "",
            };
            with_window(
                &format!(
                    "{who} {} set up{from}",
                    if negated { "was not" } else { "was" }
                ),
                window,
            )
        }
        "targets-selected" => {
            // A named Stratagem's targeting (compile-opponent-stratagem.ts): the unit targeted, by name.
            if st(f.get("kind")) == "stratagem" && f.get("id").is_some() {
                let target = unit_ref_phrase(nn(p, "object"), "the unit");
                let has = if negated { "has not" } else { "has" };
                return with_window(
                    &format!(
                        "{target} {has} been targeted with the {} Stratagem",
                        id_label(f.get("id"))
                    ),
                    window,
                );
            }
            // Only ranged (or melee, psychic) attacks: "as a target of its ranged attacks".
            let atk = if truthy(f.get("attack_type")) {
                st(f.get("attack_type"))
            } else {
                String::new()
            };
            let what = match nn(p, "object") {
                Some(o) if atk.is_empty() => {
                    format!("{} as a target", unit_ref_phrase(Some(o), "the unit"))
                }
                Some(o) => format!(
                    "{} as a target of its {atk} attacks",
                    unit_ref_phrase(Some(o), "the unit")
                ),
                None if atk.is_empty() => "targets".to_string(),
                None => format!("targets for its {atk} attacks"),
            };
            with_window(
                &format!(
                    "{who} {} selected {what}",
                    if negated { "has not" } else { "has" }
                ),
                window,
            )
        }
        "disembarked" => {
            let from = match f.get("transport") {
                None | Some(Value::Null) => "a Transport".to_string(),
                Some(Value::String(s)) if s == "this-unit" || s == "this-model" => {
                    "this Transport".to_string()
                }
                other => unit_ref_phrase(other, "the unit"),
            };
            with_window(
                &format!("{who} {} from {from}", did_not("disembark")),
                window,
            )
        }
        "after-roll" => {
            let obj_phrase = unit_ref_phrase(p.get("object"), "the unit");
            let target = if obj_phrase == "the target unit" {
                "the target".to_string()
            } else {
                obj_phrase
            };
            let atk = if truthy(f.get("attack_type")) {
                format!("{} ", st(f.get("attack_type")))
            } else {
                String::new()
            };
            let weapons = obj(f.get("weapons"));
            let keyword = nn(weapons, "keyword")
                .filter(|keyword| !keyword.is_array())
                .map(crate::translate::effect::bracket_keyword)
                .unwrap_or_default();
            let simple = weapons
                .iter()
                .all(|(key, value)| value.is_null() || key == "name" || key == "keyword")
                && !weapons.get("keyword").is_some_and(Value::is_array);
            let weapon = if !simple {
                format!(" made with {}", crate::translate::effect::weapon_noun(f))
            } else if let Some(name) = nn(weapons, "name") {
                let name = st(Some(name));
                let name = if is_kebab_slug(&name) {
                    title_case(&name)
                } else {
                    name
                };
                format!(
                    " by {name}{}",
                    if keyword.is_empty() {
                        String::new()
                    } else {
                        format!(" (with {keyword})")
                    }
                )
            } else if !keyword.is_empty() {
                format!(" made with a {keyword} weapon")
            } else {
                String::new()
            };
            let by = match f.get("by") {
                Some(Value::Object(b)) if b.contains_key("event_var") => {
                    " from the triggering unit".to_string()
                }
                Some(v) if !v.is_null() => {
                    format!(" from {}", unit_ref_phrase(Some(v), "the unit"))
                }
                _ => String::new(),
            };
            let when = if window.and_then(Value::as_str) == Some("event") {
                " during its just-finished shooting sequence".to_string()
            } else {
                format!(" {}", window_phrase(window))
            };
            // Who made the attacks, when it is not the unit being checked.
            let attacker = match nn(p, "subject") {
                Some(sub) if sub.as_str() != Some("this-unit") => {
                    format!(" made by {}", unit_ref_phrase(Some(sub), "the unit"))
                }
                _ => String::new(),
            };
            if is(f, "roll", "hit") && is(f, "result", "success") {
                let hits = if n_val > 1.0
                    || nn(obj(p.get("count")), "min").is_some_and(|min| !min.is_number())
                    || nn(obj(p.get("count")), "max").is_some()
                {
                    format!("{amount} {atk}attacks")
                } else if atk.is_empty() {
                    "an attack".to_string()
                } else {
                    format!("a {atk}attack")
                };
                return format!("{neg}{target} was hit by {hits}{attacker}{weapon}{by}{when}");
            }
            // Whose roll it was, when the subject names one: "the unit made a battle-shock roll
            // and failed it".
            if nn(p, "subject").is_some() {
                let outcome = if is(f, "result", "failure") {
                    " and failed it"
                } else if is(f, "result", "success") {
                    " and passed it"
                } else {
                    ""
                };
                return format!(
                    "{neg}{who} made a {} roll{outcome} {}{}",
                    roll_word(f.get("roll")),
                    window_phrase(window),
                    if nn(p, "count").is_some() {
                        format!(" ({amount} times)")
                    } else {
                        String::new()
                    }
                )
                .trim_end()
                .to_string();
            }
            let result = if truthy(f.get("result")) {
                format!("was a {} ", st(f.get("result")))
            } else {
                "was made ".to_string()
            };
            format!(
                "{neg}a {} roll {result}{}{}",
                roll_word(f.get("roll")),
                window_phrase(window),
                if nn(p, "count").is_some() {
                    format!(" ({amount} times)")
                } else {
                    String::new()
                }
            )
            .trim_end()
            .to_string()
        }
        "damage-allocated" => {
            let obj_phrase = unit_ref_phrase(p.get("object"), "the unit");
            let atk = if truthy(f.get("attack_type")) {
                format!("{} ", st(f.get("attack_type")))
            } else {
                String::new()
            };
            let when = if window.and_then(Value::as_str) == Some("event") {
                " from the triggering attacks".to_string()
            } else {
                format!(" {}", window_phrase(window))
            };
            format!("{neg}{obj_phrase} lost one or more wounds from {atk}attacks{when}")
        }
        "destroyed" | "model-destroyed" => {
            let noun = if event == "model-destroyed" {
                "model"
            } else {
                "unit"
            };
            if is(p, "object", "event-object") && window.and_then(Value::as_str) == Some("event") {
                let with = if nn(f, "weapons").is_some() {
                    format!(" made with {}", crate::translate::effect::weapon_noun(f))
                } else {
                    String::new()
                };
                return if truthy(f.get("attack_type")) {
                    format!(
                        "{neg}destroyed by a {} attack{with}",
                        st(f.get("attack_type"))
                    )
                } else {
                    format!("{neg}destroyed by any attack{with}")
                };
            }
            // "this model": the destroyed model is this one, not any model of the unit.
            if is(p, "object", "this-model") {
                let s = if negated {
                    "this model was not destroyed"
                } else {
                    "this model was destroyed"
                };
                return with_window(s, window);
            }
            let o = obj(p.get("object"));
            let kws = strs(o.get("all_of"))
                .map(|k| format!("{} ", k.join(" ")))
                .unwrap_or_default();
            let owner = nn(o, "owner")
                .map(|v| format!("{} ", st(Some(v))))
                .unwrap_or_default();
            let extended = o.iter().any(|(key, value)| {
                !value.is_null()
                    && !["all_of", "owner", "level", "designated"].contains(&key.as_str())
            });
            let objects = if extended {
                let mut filter = o.clone();
                filter.insert(
                    "level".to_string(),
                    Value::String(
                        if event == "model-destroyed" {
                            "model"
                        } else {
                            "unit"
                        }
                        .to_string(),
                    ),
                );
                super::board::pluralize_first_noun(&strip_article(&unit_filter_phrase(&filter)))
            } else {
                format!("{owner}{kws}{noun}s")
            };
            // Who destroyed them: the filter's attacker, else the event's subject.
            if let Some(by) = nn(f, "by").or_else(|| nn(p, "subject")) {
                // A destruction by one attack type says it: "with its just-resolved melee attacks".
                let atk = if truthy(f.get("attack_type")) {
                    format!("{} ", st(f.get("attack_type")))
                } else {
                    String::new()
                };
                let when = if window.and_then(Value::as_str) == Some("event") {
                    format!("with its just-resolved {atk}attacks")
                } else if atk.is_empty() {
                    window_phrase(window)
                } else {
                    format!("with {atk}attacks {}", window_phrase(window))
                };
                return format!(
                    "{neg}{} has destroyed {amount} {objects} {when}",
                    unit_ref_phrase(Some(by), "the unit")
                )
                .trim_end()
                .to_string();
            }
            let tagged = nn(o, "designated")
                .filter(|_| !extended)
                .map(|d| format!(" {}", designation_phrase(&st(Some(d)), false)))
                .unwrap_or_default();
            format!(
                "{neg}{}",
                with_window(&format!("{amount} {objects}{tagged} destroyed"), window)
            )
        }
        "used" => {
            // The use being resolved now: "the unit is performing the Swift as the Wind Agile Manoeuvre".
            if window.and_then(Value::as_str) == Some("event")
                && nn(f, "ability_keyword").is_none()
                && nn(f, "same_rule_as").is_none()
            {
                let kind = nn(f, "kind").map_or("ability".to_string(), |k| st(Some(k)));
                let rule = named_use_phrase(f).unwrap_or_else(|| in_progress_phrase(&kind));
                let verb = if kind == "ability" || kind == "stratagem" {
                    "using"
                } else {
                    "performing"
                };
                let not = if negated { "not " } else { "" };
                return format!("{who} is {not}{verb} {rule}");
            }
            if is(f, "kind", "action") {
                let mut s = format!("{neg}{amount} actions completed");
                if let Some(id) = nn(f, "id") {
                    s.push_str(&format!(" ({})", dekebab(&st(Some(id)))));
                }
                if let Some(o) = p.get("object").and_then(Value::as_object) {
                    if truthy(o.get("objective")) {
                        s.push_str(&format!(
                            " on {}",
                            objective_phrase(obj(o.get("objective")), false, "objective")
                        ));
                    } else if truthy(o.get("terrain_area")) {
                        let area = obj(o.get("terrain_area"));
                        let territory = if truthy(area.get("territory")) {
                            format!(" in {}", dekebab(&st(area.get("territory"))))
                        } else {
                            String::new()
                        };
                        s.push_str(&format!(" on terrain{territory}"));
                    } else if is(o, "owner", "enemy") {
                        s.push_str(" on an enemy unit");
                    }
                }
                return with_window(&s, window);
            }
            if let Some(which) = used_ability_phrase(f) {
                return format!(
                    "{neg}{}",
                    with_window(&format!("{who} used {which}"), window)
                );
            }
            let which = match nn(f, "id") {
                Some(id) => format!("the {} ", id_label(Some(id))),
                None => "a ".to_string(),
            };
            let kind = match nn(f, "kind") {
                Some(k) => st(Some(k)),
                None => "ability".to_string(),
            };
            format!(
                "{neg}{}",
                with_window(&format!("{who} used {which}{}", dekebab(&kind)), window)
            )
        }
        "objective-gained" => format!(
            "{neg}you newly control {amount} objectives {}",
            window_phrase(window)
        )
        .trim_end()
        .to_string(),
        "designation-changed" => format!(
            "{neg}{}",
            with_window(
                &format!(
                    "{amount} {} became {}",
                    unit_ref_phrase(p.get("object"), "units"),
                    designation_phrase(&st(f.get("tag")), false)
                ),
                window
            )
        ),
        _ => format!(
            "{neg}{}",
            with_window(&format!("{} happened", dekebab(&event)), window)
        ),
    }
}

pub(crate) fn destroyed_count(side: &P) -> String {
    let objects = super::board::pluralize_first_noun(&strip_article(&unit_ref_phrase(
        side.get("object"),
        "the unit",
    )));
    format!("{objects} {}", window_phrase(side.get("window")))
        .trim_end()
        .to_string()
}
