//! Single effects on the board axes: protection, models, moves, placement, tests,
//! resources, designation and army construction. One lowercase-initial clause, no period.
//! Mirrors `tools/src/translate/effect-leaf-board.ts`.

use serde_json::{Map, Value};

use super::leaf_move::*;
use super::leaf_rules::*;
use super::placement::{placement_limits, placement_phrase};
use super::words::*;
use crate::translate::condition::{and_list, condition_lead_in_value, nn, obj, range_phrase, P};

fn wounds(n: &str, noun: &str) -> String {
    if n == "1" {
        noun.to_string()
    } else {
        format!("{noun}s")
    }
}

fn mortal_wounds(m: &P, subj: &str) -> String {
    let count = dice_case(m.get("count"));
    let suffered = if is_literal(m.get("count")) {
        format!("{count} {}", wounds(&count, "mortal wound"))
    } else {
        amount_of(m.get("count"), "mortal wound", "mortal wounds")
    };
    let psychic = if is_true(m, "psychic") {
        " (Psychic Attack)"
    } else {
        ""
    };
    // A range the target filter already states is not repeated ("enemy units within 9\" within 9\"").
    let range = match nn(m, "range") {
        Some(r) => {
            let within = format!(" within {}", range_phrase(Some(r)));
            if subj.contains(&within) {
                String::new()
            } else {
                within
            }
        }
        None => String::new(),
    };
    let who = format!("{subj}{range}");
    if let Some(roll) = nn(m, "roll") {
        let roll = obj(Some(roll));
        let each = match sv(roll, "per_model") {
            Some("target") => " for each model in the target unit",
            Some("this") => " for each model in this unit",
            _ => "",
        };
        let dice = if each.is_empty() {
            dice_case(roll.get("dice"))
        } else {
            format!("one {}", dice_case(roll.get("dice")))
        };
        return format!(
            "roll {dice}{each}: for each {}+, {who} {} {suffered}{psychic}",
            jstr(roll.get("threshold")),
            v(&who, "suffers")
        );
    }
    let per = if sv(m, "per") == Some("model") {
        format!(
            " for each model in {}",
            if pronoun(&who) == "their" {
                "them"
            } else {
                "it"
            }
        )
    } else {
        String::new()
    };
    format!("{who} {} {suffered}{per}{psychic}", v(&who, "suffers"))
}

fn return_models(target: Option<&Value>, m: &P, subj: &str, ctx: &Ctx) -> String {
    let wr = m.get("wounds_remaining");
    let w = match wr {
        None | Some(Value::Null) => "its full wounds".to_string(),
        Some(x) if x.as_str() == Some("full") => "its full wounds".to_string(),
        Some(x) if is_literal(Some(x)) => {
            let n = dice_case(Some(x));
            format!("{n} {}", wounds(&n, "wound"))
        }
        Some(x) => amount_of(Some(x), "wound", "wounds"),
    };
    let place = format!("{}{}", placement_phrase(m), placement_limits(m, ctx));
    let detach = if is_true(m, "detach") {
        let strength = nn(m, "starting_strength")
            .map(|s| format!(" with a Starting Strength of {}", jv(s)))
            .unwrap_or_default();
        format!(", as a separate unit{strength} (it is no longer part of its attached unit)")
    } else {
        String::new()
    };
    if target.and_then(Value::as_str) == Some("this-model") {
        return format!("{subj} is set up again{place} with {w} remaining{detach}");
    }
    let kw = match nn(m, "model_keyword") {
        Some(k) => format!("{} ", jv(k)),
        None if is_true(m, "bodyguard_only") => "Bodyguard ".to_string(),
        None => String::new(),
    };
    let kind = format!("destroyed {kw}model");
    let what = if sv(m, "count") == Some("all") {
        format!("all {kind}s")
    } else {
        amount_of(m.get("count"), &kind, &format!("{kind}s"))
    };
    let excl = map_arr(m, "exclude_model_keyword", jv)
        .map(|k| format!(" (excluding {} models)", and_list(&k)))
        .unwrap_or_default();
    format!("return {what}{excl} to {subj}{place}, each with {w} remaining{detach}")
}

fn destroy_models(m: &P, subj: &str) -> String {
    let kind = match nn(m, "model_keyword") {
        Some(k) => format!("{} model", jv(k)),
        None => "model".to_string(),
    };
    let what = if sv(m, "count") == Some("all") {
        format!("every {kind} in {subj}")
    } else {
        let n = dice_case(m.get("count"));
        let noun = if n == "1" { kind } else { format!("{kind}s") };
        format!("{n} {noun} in {subj}")
    };
    let leader = if is_true(m, "exclude_leader") {
        " (excluding Leader models)"
    } else {
        ""
    };
    let remove = is_true(m, "remove_from_play");
    let verb = if remove { "remove" } else { "destroy" };
    let tail = if remove { " from play" } else { "" };
    let triggers = if is_true(m, "ignore_death_triggers") {
        ", ignoring any rules triggered by their destruction"
    } else {
        ""
    };
    format!("{verb} {what}{leader}{tail}{triggers}")
}

fn empty_condition() -> Value {
    Value::Object(Map::new())
}

fn act_on_death(target: Option<&Value>, m: &P, subj: &str, ctx: &Ctx) -> String {
    let act = if sv(m, "act") == Some("shoot") {
        "shoot"
    } else {
        "fight"
    };
    let model = if target.and_then(Value::as_str) == Some("event-object") {
        "a model in this unit".to_string()
    } else if subj == "this model" {
        "this model".to_string()
    } else {
        format!("a model in {subj}")
    };
    if let Some(gate) = nn(m, "gate") {
        let gate = obj(Some(gate));
        let before = match m.get("eligibility") {
            Some(e) if crate::translate::condition::truthy(Some(e)) => {
                format!(" {}", condition_lead_in_value(e))
            }
            _ => String::new(),
        };
        let adds: String = arr(gate, "modifiers")
            .map(|mods| {
                mods.iter()
                    .map(|g| {
                        let g = obj(Some(g));
                        let cond = nn(g, "condition").cloned().unwrap_or_else(empty_condition);
                        format!(
                            ", adding {} {}",
                            jstr(g.get("value")),
                            condition_lead_in_value(&cond)
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        let removal = if sv(m, "removal") == Some("after-destroyed-model-fights") {
            format!(
                ". Remove it after it has {}",
                if act == "shoot" { "shot" } else { "fought" }
            )
        } else {
            ". Remove it after this unit has fought or at the end of the phase, whichever comes first"
                .to_string()
        };
        let comp = nn(gate, "comparison")
            .map(jv)
            .unwrap_or_else(|| "gte".to_string());
        // Under a destroyed trigger the ability's lead-in already names the death: one lead-in only.
        let lead = if ctx.destroyed_trigger {
            if before.is_empty() {
                String::new()
            } else {
                format!("{}, ", before.trim())
            }
        } else if before.is_empty() {
            format!("each time {model} is destroyed, ")
        } else {
            format!("each time {model} is destroyed,{before}, ")
        };
        return format!(
            "{lead}roll one {}{adds}. On {}, leave that model on the battlefield; it can {act}{removal}",
            dice_case(gate.get("dice")),
            format_comparison(&comp, gate.get("threshold"))
        );
    }
    match sv(m, "resolution") {
        Some("when-unit-fights") => format!(
            "do not remove {subj} yet; when its unit is selected to fight, it can {act}; remove it after its unit has finished fighting or at the end of the phase, whichever happens first"
        ),
        Some("after-attacking-unit-finishes") => format!(
            "do not remove {subj} yet; after the attacking unit has finished making its attacks, it can {act}; then remove it"
        ),
        _ if ctx.destroyed_trigger => format!(
            "{} can {act} before being removed from play",
            if model == "this model" {
                "this model"
            } else {
                "that model"
            }
        ),
        _ => format!("each time {model} is destroyed, it can {act} before being removed from play"),
    }
}

fn add_unit(m: &P, ctx: &Ctx) -> String {
    let place = format!("{}{}", placement_phrase(m), placement_limits(m, ctx));
    let engage = nn(m, "allow_engagement_with")
        .map(|w| {
            format!(
                "; it can be set up within Engagement Range of {}",
                effect_subject(Some(w), ctx)
            )
        })
        .unwrap_or_default();
    let models = nn(m, "model_count")
        .map(|c| format!(" containing {}", amount_of(Some(c), "model", "models")))
        .unwrap_or_default();
    let strength = nn(m, "starting_strength")
        .map(|s| format!(" with a Starting Strength of {}", jv(s)))
        .unwrap_or_default();
    let name = title_case(&jstr(m.get("datasheet")));
    let one_value = Value::from(1);
    // New models that join an existing unit rather than forming their own.
    if let Some(join) = nn(m, "join") {
        let q = nn(m, "model_count")
            .or_else(|| nn(m, "count"))
            .unwrap_or(&one_value);
        return format!(
            "add {} to {}{place}{engage}",
            amount_of(Some(q), &format!("{name} model"), &format!("{name} models")),
            effect_subject(Some(join), ctx)
        );
    }
    let count = m.get("count");
    let literal = is_literal(count);
    let n = if literal {
        num(Some(nn(m, "count").unwrap_or(&one_value)))
    } else {
        f64::NAN
    };
    let one = n == 1.0;
    let what = match nn(m, "copy_of") {
        Some(copy) => format!(
            "{} identical to {}",
            if one {
                "a new unit".to_string()
            } else if literal {
                format!("{} new units", fnum(n))
            } else {
                amount_of(count, "new unit", "new units")
            },
            effect_subject(Some(copy), ctx)
        ),
        None if one => format!("a {name} unit"),
        None if literal => format!("{} {name} units", fnum(n)),
        None => amount_of(count, &format!("{name} unit"), &format!("{name} units")),
    };
    format!("add {what}{models}{strength} to your army{place}{engage}")
}

/// The board-axis leaves; anything unknown degrades to `[type]`.
pub(crate) fn describe_board_leaf(e: &P, m: &P, subj: &str, ctx: &Ctx) -> String {
    let target = e.get("target");
    match sv(e, "type") {
        Some("mortal-wounds") => mortal_wounds(m, subj),
        Some("damage-reduction") => {
            let r = jstr(m.get("reduction"));
            let how = match r.as_str() {
                "half" => "halve the Damage of that attack".to_string(),
                "to-zero" => "change the Damage of that attack to 0".to_string(),
                _ => format!("subtract {r} from the Damage characteristic of that attack"),
            };
            let attack = if has_weapon(m) {
                format!("an attack with {}", weapon_noun(m))
            } else {
                "an attack".to_string()
            };
            format!("each time {attack} is allocated to {subj}, {how}")
        }
        Some("feel-no-pain") => {
            let against = match jstr(m.get("against")).as_str() {
                "mortal" => " against mortal wounds",
                "psychic" => " against Psychic Attacks",
                "psychic-and-mortal" => " against Psychic Attacks and mortal wounds",
                _ => "",
            };
            format!(
                "{subj} {} the Feel No Pain {}+ ability{against}",
                v(subj, "has"),
                jstr(m.get("threshold"))
            )
        }
        Some("invulnerable-save") => {
            let vs = nn(m, "weapon_type")
                .map(|t| format!(" against {} attacks", jv(t)))
                .unwrap_or_default();
            format!(
                "{subj} {} a {}+ invulnerable save{vs}",
                v(subj, "has"),
                jstr(m.get("invuln_sv"))
            )
        }
        Some("heal") => {
            let who = if sv(m, "per") == Some("model") {
                format!("each model in {subj}")
            } else {
                subj.to_string()
            };
            if sv(m, "amount") == Some("full") {
                return format!(
                    "{who} {} all {} lost wounds",
                    v(&who, "regains"),
                    pronoun(&who)
                );
            }
            if !is_literal(m.get("amount")) {
                return format!(
                    "{who} {} up to {}",
                    v(&who, "regains"),
                    amount_of(m.get("amount"), "lost wound", "lost wounds")
                );
            }
            let amount = dice_case(m.get("amount"));
            format!(
                "{who} {} up to {amount} lost {}",
                v(&who, "regains"),
                if amount == "1" { "wound" } else { "wounds" }
            )
        }
        Some("return-models") => return_models(target, m, subj, ctx),
        Some("destroy-models") => destroy_models(m, subj),
        Some("act-on-death") => act_on_death(target, m, subj, ctx),
        Some("split-unit") => {
            if sv(m, "by") == Some("model") {
                return format!("split {subj} into units of one model each");
            }
            let by = m.get("by").and_then(Value::as_object);
            if let Some(kws) = by.and_then(|b| b.get("model_keyword")) {
                if crate::translate::condition::truthy(Some(kws)) {
                    let names: Vec<String> = kws
                        .as_array()
                        .map(|a| a.iter().map(jv).collect())
                        .unwrap_or_default();
                    return format!(
                        "split {subj} into one unit of each of its {} models",
                        and_list(&names)
                    );
                }
            }
            let counts = map_arr(m, "model_counts", jv).unwrap_or_default();
            format!(
                "split {subj} into {} units of {} models",
                counts.len(),
                and_list(&counts)
            )
        }
        Some("add-unit") => add_unit(m, ctx),
        Some("destruction-rule") => format!(
            "{subj} {} not destroyed until {} is also destroyed",
            v(subj, "is"),
            effect_subject(m.get("also"), ctx)
        ),
        Some("move") => movement(m, subj, ctx),
        Some("move-modifier") => move_modifier(m, subj),
        Some("set-up") => set_up(m, subj, ctx),
        Some("marker") => marker(m),
        Some("transport-capacity") => transport_capacity(m),
        Some("test") => test(m, subj),
        Some("state-change") => {
            if is_false(m, "set") {
                format!("{subj} {} no longer Battle-shocked", v(subj, "is"))
            } else {
                format!("{subj} {} Battle-shocked", v(subj, "is"))
            }
        }
        Some("cp-gain") => {
            let n = num(m.get("amount"));
            if n < 0.0 {
                format!("you lose {}CP", fnum(n.abs()))
            } else {
                format!("you gain {}CP", jstr(m.get("amount")))
            }
        }
        Some("cost-modifier") => cost_modifier(m, subj),
        Some("resource-gain") => {
            if let Some(a) = nn(m, "amount").filter(|a| a.is_object() || a.is_array()) {
                let one = Value::from(1);
                let two = Value::from(2);
                return format!(
                    "you gain {}",
                    amount_of(
                        Some(a),
                        &resource_noun(m.get("pool"), m.get("label"), Some(&one)),
                        &resource_noun(m.get("pool"), m.get("label"), Some(&two))
                    )
                );
            }
            let amount = match sv(m, "amount") {
                Some("variable") => "a number of".to_string(),
                Some("any") => "any number of".to_string(),
                _ => dice_case(m.get("amount")),
            };
            format!(
                "you gain {amount} {}",
                resource_noun(m.get("pool"), m.get("label"), m.get("amount"))
            )
        }
        Some("resource-spend") => {
            let all = sv(m, "amount") == Some("all");
            let amount = match sv(m, "amount") {
                Some("all") => "all your".to_string(),
                Some("one-or-more") => "one or more".to_string(),
                _ => dice_case(m.get("amount")),
            };
            let two = Value::from(2);
            let count = if all { Some(&two) } else { m.get("amount") };
            let showing = match (nn(m, "face"), nn(m, "requirement")) {
                (Some(f), _) => format!(" showing a {}", jv(f)),
                (None, Some(r)) => format!(" forming a {}", requirement_phrase(Some(r))),
                _ => String::new(),
            };
            let mut noun = resource_noun(m.get("pool"), m.get("label"), count);
            // A face or a pair/triple is only said of dice: "3 Blessings of Khorne dice forming …".
            let dice_noun = [" die", " dice"]
                .iter()
                .any(|d| noun.ends_with(d))
                || noun == "die"
                || noun == "dice";
            if !showing.is_empty() && !dice_noun {
                noun.push_str(if num_of_jstr(m.get("amount")) == 1.0 {
                    " die"
                } else {
                    " dice"
                });
            }
            format!("spend {amount} {noun}{showing}")
        }
        Some("resource-die") => resource_die(m),
        Some("objective-sticky") => format!(
            "objective markers {subj} {} remain under your control until your opponent's Level of Control over them is greater than yours at the end of a phase",
            v(subj, "controls")
        ),
        Some("designate") => designate(m, subj, ctx),
        Some("army-rule") => army_rule(m, subj, ctx),
        Some(t) => format!("[{t}]"),
        None => "[unknown]".to_string(),
    }
}
