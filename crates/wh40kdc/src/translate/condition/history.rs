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
    let (n_val, n) = count_or_one(p);
    let window = p.get("window");
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
        "set-up" => with_window(
            &format!("{who} {} set up", if negated { "was not" } else { "was" }),
            window,
        ),
        "targets-selected" => {
            let what = match nn(p, "object") {
                Some(o) => format!("{} as a target", unit_ref_phrase(Some(o), "the unit")),
                None => "targets".to_string(),
            };
            with_window(
                &format!(
                    "{who} {} selected {what}",
                    if negated { "has not" } else { "has" }
                ),
                window,
            )
        }
        "disembarked" => with_window(
            &format!("{who} {} from a Transport", did_not("disembark")),
            window,
        ),
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
            let keyword = if truthy(f.get("weapon_keyword")) {
                format!("[{}]", dekebab(&st(f.get("weapon_keyword"))).to_uppercase())
            } else {
                String::new()
            };
            let weapon = if truthy(f.get("weapon_name")) {
                let with = if keyword.is_empty() {
                    String::new()
                } else {
                    format!(" (with {keyword})")
                };
                let name = st(f.get("weapon_name"));
                let name = if is_kebab_slug(&name) {
                    title_case(&name)
                } else {
                    name
                };
                format!(" by {name}{with}")
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
                let hits = if n_val > 1.0 {
                    format!("{n}+ {atk}attacks")
                } else if atk.is_empty() {
                    "an attack".to_string()
                } else {
                    format!("a {atk}attack")
                };
                return format!("{neg}{target} was hit by {hits}{attacker}{weapon}{by}{when}");
            }
            let result = if truthy(f.get("result")) {
                format!("was a {} ", st(f.get("result")))
            } else {
                "was made ".to_string()
            };
            format!(
                "{neg}a {} roll {result}{}",
                roll_word(f.get("roll")),
                window_phrase(window)
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
                if truthy(f.get("attack_type")) {
                    let with = if truthy(f.get("weapon_name")) {
                        format!(" made with {}", st(f.get("weapon_name")))
                    } else {
                        String::new()
                    };
                    return format!(
                        "{neg}destroyed by a {} attack{with}",
                        st(f.get("attack_type"))
                    );
                }
                return format!("{neg}destroyed by any attack");
            }
            let o = obj(p.get("object"));
            let kws = strs(o.get("all_of"))
                .map(|k| format!("{} ", k.join(" ")))
                .unwrap_or_default();
            let owner = nn(o, "owner")
                .map(|v| format!("{} ", st(Some(v))))
                .unwrap_or_default();
            if let Some(by) = nn(f, "by") {
                let when = if window.and_then(Value::as_str) == Some("event") {
                    "with its just-resolved attacks".to_string()
                } else {
                    window_phrase(window)
                };
                return format!(
                    "{neg}{} has destroyed {n}+ {owner}{kws}{noun}s {when}",
                    unit_ref_phrase(Some(by), "the unit")
                )
                .trim_end()
                .to_string();
            }
            let tagged = nn(o, "designated")
                .map(|d| format!(" {}", designation_phrase(&st(Some(d)), false)))
                .unwrap_or_default();
            format!(
                "{neg}{}",
                with_window(
                    &format!("{n}+ {owner}{kws}{noun}s{tagged} destroyed"),
                    window
                )
            )
        }
        "used" => {
            if is(f, "kind", "action") {
                let mut s = format!("{neg}{n}+ actions completed");
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
                Some(id) => format!("the {} ", title_case(&st(Some(id)))),
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
            "{neg}you newly control {n}+ objectives {}",
            window_phrase(window)
        )
        .trim_end()
        .to_string(),
        "designation-changed" => format!(
            "{neg}{}",
            with_window(
                &format!(
                    "{n}+ {} became {}",
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
    let o = obj(side.get("object"));
    format!(
        "{} units {}",
        st(o.get("owner")),
        window_phrase(side.get("window"))
    )
    .trim_end()
    .to_string()
}
