//! Single effects on the board axes: protection, models, moves, placement, tests,
//! resources, designation and army construction. One lowercase-initial clause, no period.
//! Mirrors `tools/src/translate/effect-leaf-board.ts`.

use serde_json::{Map, Value};

use super::leaf_move::*;
use super::leaf_rules::*;
use super::words::*;
use crate::translate::condition::{and_list, condition_lead_in_value, nn, obj, range_phrase, P};
use crate::translate::dekebab;

fn wounds(n: &str, noun: &str) -> String {
    if n == "1" {
        noun.to_string()
    } else {
        format!("{noun}s")
    }
}

fn mortal_wounds(m: &P, subj: &str) -> String {
    let count = dice_case(m.get("count"));
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
            "roll {dice}{each}: for each {}+, {who} {} {count} {}{psychic}",
            jstr(roll.get("threshold")),
            v(&who, "suffers"),
            wounds(&count, "mortal wound")
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
    format!(
        "{who} {} {count} {}{per}{psychic}",
        v(&who, "suffers"),
        wounds(&count, "mortal wound")
    )
}

fn placement(m: &P) -> String {
    if sv(m, "placement") == Some("wholly-within") {
        return format!(
            " wholly within {} of this model",
            range_phrase(m.get("range"))
        );
    }
    let Some(p) = nn(m, "placement") else {
        return String::new();
    };
    let p = jv(p);
    match p.as_str() {
        "closest-to-destruction" => " as close as possible to where it was destroyed".to_string(),
        "coherency" => " in Unit Coherency".to_string(),
        "unengaged" => " not within Engagement Range of any enemy units".to_string(),
        "strategic-reserves" => " in Strategic Reserves".to_string(),
        "anywhere" => " anywhere on the battlefield".to_string(),
        other => format!(" {}", dekebab(other)),
    }
}

fn return_models(target: Option<&Value>, m: &P, subj: &str) -> String {
    let w = match m.get("wounds_remaining") {
        None | Some(Value::Null) => "its full wounds".to_string(),
        Some(x) if x.as_str() == Some("full") => "its full wounds".to_string(),
        Some(x) => {
            let n = dice_case(Some(x));
            format!("{n} {}", wounds(&n, "wound"))
        }
    };
    if target.and_then(Value::as_str) == Some("this-model") {
        return format!("{subj} is set up again{} with {w} remaining", placement(m));
    }
    let count = if sv(m, "count") == Some("all") {
        "all".to_string()
    } else {
        dice_case(m.get("count"))
    };
    let kind = match nn(m, "model_keyword") {
        Some(k) => format!("destroyed {} model", jv(k)),
        None => "destroyed model".to_string(),
    };
    let noun = if count == "1" {
        kind
    } else {
        format!("{kind}s")
    };
    format!(
        "return {count} {noun} to {subj}{}, each with {w} remaining",
        placement(m)
    )
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
    let n = num(Some(nn(m, "count").unwrap_or(&Value::from(1))));
    let one = n == 1.0;
    let what = match nn(m, "copy_of") {
        Some(copy) => format!(
            "{} identical to {}",
            if one {
                "a new unit".to_string()
            } else {
                format!("{} new units", fnum(n))
            },
            effect_subject(Some(copy), ctx)
        ),
        None => format!(
            "{} {} unit{}",
            if one { "a".to_string() } else { fnum(n) },
            title_case(&jstr(m.get("datasheet"))),
            if one { "" } else { "s" }
        ),
    };
    format!("add {what} to your army{}", placement(m))
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
            let amount = dice_case(m.get("amount"));
            format!(
                "{who} {} up to {amount} lost {}",
                v(&who, "regains"),
                if amount == "1" { "wound" } else { "wounds" }
            )
        }
        Some("return-models") => return_models(target, m, subj),
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
            format!(
                "spend {amount} {}",
                resource_noun(m.get("pool"), m.get("label"), count)
            )
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
