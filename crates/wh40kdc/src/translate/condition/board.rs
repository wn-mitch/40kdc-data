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
            let ge = is(p, "comparison", "greater-or-equal");
            if let Some(pool) = nn(right, "pool") {
                return format!(
                    "{neg}you destroyed at least as many {} as your {}",
                    destroyed_count(left),
                    dekebab(&st(Some(pool)))
                );
            }
            if let Some(value) = nn(right, "value") {
                return format!(
                    "{neg}you destroyed {} {} {}",
                    if ge { "at least" } else { "more than" },
                    st(Some(value)),
                    destroyed_count(left)
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
            let of = p.get("of");
            let range = p.get("range");
            let wholly = if p.get("wholly") == Some(&Value::Bool(true)) {
                "wholly "
            } else {
                ""
            };
            if matches!(
                range.and_then(Value::as_str),
                Some("half-weapon" | "weapon")
            ) {
                let who = if is(p, "subject", "defender") {
                    "the target".to_string()
                } else {
                    subject_of(p, "the unit")
                };
                return format!("{who} is {not_}within {}", range_phrase(range));
            }
            let of_obj = of.and_then(Value::as_object);
            if let Some(o) = of_obj.filter(|o| truthy(o.get("objective"))) {
                let phrase = objective_phrase(obj(o.get("objective")), false, "objective marker");
                return format!(
                    "{} is {not_}{wholly}within range of {} {phrase}",
                    subject_of(p, "the unit"),
                    article(&phrase)
                );
            }
            if let Some(o) = of_obj.filter(|o| is(o, "owner", "enemy")) {
                if nn(p, "subject").is_none() {
                    let phrase = unit_filter_phrase(o);
                    if negated {
                        return format!(
                            "no {} is within {}",
                            strip_article(&phrase),
                            range_phrase(range)
                        );
                    }
                    return format!("{phrase} is within {}", range_phrase(range));
                }
            }
            let target = if of.and_then(Value::as_str) == Some("battlefield-edge") {
                "a battlefield edge".to_string()
            } else if let Some(o) = of_obj.filter(|o| truthy(o.get("marker"))) {
                let marker = st(o.get("marker"));
                format!("{} {} marker", article(&marker), dekebab(&marker))
            } else {
                unit_ref_phrase(of, "the unit")
            };
            let who = if is(p, "models", "every") {
                format!("every model in {}", subject_of(p, "the unit"))
            } else {
                subject_of(p, "the unit")
            };
            let phase_start = is(p, "at", "phase-start");
            format!(
                "{who} {} {not_}{wholly}within {} of {target}{}",
                if phase_start { "was" } else { "is" },
                range_phrase(range),
                if phase_start {
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
            format!("{neg}{who} is the closest {among}{within}")
        }
        "controls" => {
            if is(p, "compare", "more-than-opponent") {
                return format!("{neg}you hold more objectives than the opponent");
            }
            let who = if is(p, "by", "enemy") {
                "your opponent controls"
            } else {
                "you control"
            };
            let mut s = format!(
                "{neg}{who} {}+ {}",
                str_or_one(p, "count_min"),
                objective_phrase(obj(p.get("objective")), true, "objective")
            );
            if let Some(mx) = nn(p, "count_max") {
                s.push_str(&format!(" (at most {})", st(Some(mx))));
            }
            s
        }
        "attack-is" => {
            let attack_type = if truthy(p.get("attack_type")) {
                Some(st(p.get("attack_type")))
            } else {
                None
            };
            if p.get("all_target_same_unit") == Some(&Value::Bool(true)) {
                return format!(
                    "{neg}all of the unit's {}attacks target the same enemy unit",
                    attack_type.map(|a| format!("{a} ")).unwrap_or_default()
                );
            }
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
            let mut parts = vec![format!(
                "for {}attacks",
                if kind.is_empty() {
                    String::new()
                } else {
                    format!("{kind} ")
                }
            )];
            if truthy(p.get("weapon_keyword")) {
                parts.push(format!(
                    "made with [{}] weapons",
                    st(p.get("weapon_keyword")).to_uppercase()
                ));
            }
            if truthy(p.get("weapon_name")) {
                parts.push(format!("made with {}", st(p.get("weapon_name"))));
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
                dekebab(&st(p.get("comparison"))),
                side(obj(p.get("right")))
            )
        }
        "roll-result" => format!(
            "{neg}the triggering {} roll {}",
            dekebab(&st(p.get("roll"))),
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
                    let mut out = format!(
                        "{neg}{}+ {} tagged {}",
                        str_or_one(p, "count_min"),
                        objective_phrase(obj(s.get("objective")), true, "objective"),
                        dekebab(&st(p.get("tag")))
                    );
                    if let Some(mx) = nn(p, "count_max") {
                        out.push_str(&format!(" (at most {})", st(Some(mx))));
                    }
                    return out;
                }
            }
            format!(
                "{} is {not_}{}",
                subject_of(p, "the unit"),
                designation_phrase(&st(p.get("tag")))
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
            let amount = match nn(p, "at_least") {
                Some(v) => format!("{}+", st(Some(v))),
                None => format!("at most {}", st(p.get("at_most"))),
            };
            format!("{neg}the unit has {amount} {}", dekebab(&st(p.get("pool"))))
        }
        // ── Mission-card predicates ───────────────────────────────────────────
        "operation-markers" => {
            let side = nn(p, "side")
                .map(|v| format!("{} ", st(Some(v))))
                .unwrap_or_default();
            let num = |k: &str| match p.get(k) {
                Some(Value::Number(n)) => Some((n.as_f64().unwrap_or(0.0), js_num(n))),
                _ => None,
            };
            let min = num("count_min");
            let max = num("count_max");
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
                let lead = min
                    .as_ref()
                    .map(|m| m.1.clone())
                    .unwrap_or_else(|| "1".to_string());
                format!("{lead}+ {side}operation markers on the battlefield")
            };
            if let Some(w) = nn(p, "within_range_of") {
                s.push_str(&format!(" within range of {}", dekebab(&st(Some(w)))));
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
            "{neg}you are engaged on {}+ fronts",
            str_or_one(p, "count_min")
        ),
        "destroyed-while-on-objective" => {
            let objective = if truthy(p.get("objective_role")) {
                format!("a {} objective", dekebab(&st(p.get("objective_role"))))
            } else {
                "an objective".to_string()
            };
            let mut s = format!("{neg}{}+ enemy units destroyed", str_or_one(p, "count_min"));
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
                "{neg}{}+ enemy units destroyed {where_} {terrain}",
                str_or_one(p, "count_min")
            )
        }
        "terrain-area-control" => format!(
            "{neg}you control a terrain area with {}+ models",
            str_or_one(p, "min_models")
        ),
        other => format!(
            "{neg}{}",
            dekebab(if ctype(c).is_some() { other } else { "unknown" })
        ),
    }
}
