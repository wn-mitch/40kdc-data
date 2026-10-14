//! The `named-region-state` container: a named region's producers (baseline zones, phase
//! extensions, unit-proximity additions) and its consumer's default and qualified branches.
//! Mirrors the `namedRegion*` helpers in `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::inline;
use super::words::*;
use crate::translate::condition::{describe_condition_value, key_count, nn, obj, operands, P};
use crate::translate::dekebab;

fn title(v: Option<&Value>) -> String {
    title_case(&jstr(v))
}

fn relation(v: Option<&Value>) -> String {
    let r = jstr(v);
    if r == "wholly-within" {
        "wholly within".to_string()
    } else {
        dekebab(&r)
    }
}

fn keywords(v: Option<&Value>) -> String {
    match v.and_then(Value::as_array) {
        Some(a) => a.iter().map(jv).collect::<Vec<_>>().join(" or "),
        None => "?".to_string(),
    }
}

fn entries<'a>(p: &'a P, k: &str) -> &'a [Value] {
    arr(p, k).map(Vec::as_slice).unwrap_or(&[])
}

fn prefix(m: &P) -> String {
    let region = title(obj(m.get("region_ref")).get("region_id"));
    let producer = obj(m.get("producer"));
    let mut sentences: Vec<String> = Vec::new();
    for entry in entries(producer, "baseline") {
        let zone = jstr(obj(Some(entry)).get("zone"));
        if zone == "own-deployment-zone" {
            sentences.push(format!("Your deployment zone is always within {region}."));
        } else if zone != "?" {
            sentences.push(format!("{} is always within {region}.", title_case(&zone)));
        }
    }
    let mut has_phase_extension = false;
    for entry in entries(producer, "phase_extensions") {
        let zone = jstr(obj(Some(entry)).get("zone"));
        if zone == "no-mans-land" {
            sentences.push(format!("At the start of each phase, No Man's Land is within {region} until the end of that phase if you control at least half of its objective markers."));
            has_phase_extension = true;
        } else if zone == "opponent-deployment-zone" {
            sentences.push(if has_phase_extension {
                "The same applies separately to your opponent's deployment zone.".to_string()
            } else {
                format!("At the start of each phase, your opponent's deployment zone is within {region} until the end of that phase if you control at least half of its objective markers.")
            });
            has_phase_extension = true;
        } else if zone != "?" {
            sentences.push(format!("At the start of each phase, {} is within {region} until the end of that phase if you control at least half of its objective markers.", title_case(&zone)));
            has_phase_extension = true;
        }
    }
    let additions = entries(producer, "additive_extensions");
    for entry in additions {
        let addition = obj(Some(entry));
        if sv(addition, "kind") != Some("unit-proximity") {
            continue;
        }
        let predicate = obj(obj(addition.get("source_gate")).get("unit_predicate"));
        let kws = match arr(predicate, "keywords") {
            Some(a) => a.iter().map(jv).collect::<Vec<_>>().join(" and "),
            None => "?".to_string(),
        };
        sentences.push(format!(
            "The area within {}\" of one or more friendly {kws} units is within {region}, continuously as those units move.",
            jstr(addition.get("radius_inches"))
        ));
    }
    let mut sources: Vec<String> = Vec::new();
    for entry in additions {
        let addition = obj(Some(entry));
        if sv(addition, "kind") == Some("unit-proximity") {
            continue;
        }
        let predicate = obj(obj(addition.get("source_gate")).get("unit_predicate"));
        if key_count(predicate) == 0 {
            continue;
        }
        let radius = nn(addition, "radius_inches")
            .map(|r| format!(" within {}\"", jv(r)))
            .unwrap_or_default();
        let part = format!(
            "{} units with {}{radius}",
            title(predicate.get("faction")),
            keywords(predicate.get("keywords"))
        );
        if !sources.contains(&part) {
            sources.push(part);
        }
    }
    if !sources.is_empty() {
        sentences.push(format!(
            "Selected objective markers extend {region} around {}.",
            sources.join(" or ")
        ));
    }
    sentences.join(" ")
}

fn subject(m: &P) -> String {
    let gate = obj(obj(m.get("consumer")).get("beneficiary_gate"));
    let faction = match nn(gate, "faction") {
        Some(f) => title(Some(f)),
        None => String::new(),
    };
    let faction_part = if faction.is_empty() {
        " from your army".to_string()
    } else {
        format!(" from your {faction} army")
    };
    format!(
        "Models in {} units{faction_part}",
        keywords(gate.get("keywords"))
    )
}

fn branch_effect(branch: &P, qualified: bool, ctx: &Ctx) -> String {
    let effect_v = branch.get("effect").filter(|e| e.is_object());
    let effect = obj(effect_v);
    let modifier = obj(effect.get("modifier"));
    let roll = roll_name(modifier.get("roll"));
    let mut text = match sv(effect, "type") {
        Some("re-roll") => {
            let subset = sv(modifier, "subset");
            match modifier.get("count").filter(|c| c.is_number()) {
                Some(cnt) => {
                    let one = cnt.as_f64() == Some(1.0);
                    let capped = if jstr(modifier.get("roll")) == "any" {
                        String::new()
                    } else {
                        format!("{roll} ")
                    };
                    format!(
                        "can re-roll {} {}{capped}roll{}{}",
                        if one {
                            "one".to_string()
                        } else {
                            format!("up to {}", jv(cnt))
                        },
                        if subset == Some("all-failures") {
                            "failed "
                        } else {
                            ""
                        },
                        if one { "" } else { "s" },
                        if subset == Some("ones") { " of 1" } else { "" }
                    )
                }
                None if sv(modifier, "result_scope") == Some("any-result") => {
                    format!("can re-roll the {roll} roll")
                }
                None if subset == Some("ones") => format!("can re-roll {roll} rolls of 1"),
                None => format!("can re-roll {roll} rolls"),
            }
        }
        Some("roll-modifier") if nn(modifier, "value").is_some() => format!(
            "gets {} to {roll}",
            signed(modifier.get("operation"), modifier.get("value"))
        ),
        _ => inline(&Value::Object(effect.clone()), ctx),
    };
    if is_false(branch, "optional") {
        if let Some(rest) = text.strip_prefix("can re-roll") {
            text = format!("re-roll{rest}");
        }
    }
    if let Some(k) = nn(modifier, "weapon_keyword") {
        text.push_str(&format!(
            " for {}{} attacks",
            if qualified { "those " } else { "" },
            jv(k)
        ));
    }
    text
}

fn branch_text(m: &P, whole_unit: bool, qualified: bool, conditional: bool, ctx: &Ctx) -> String {
    let consumer = obj(m.get("consumer"));
    let branch = obj(consumer.get(if qualified {
        "qualified_branch"
    } else {
        "default_branch"
    }));
    let effect = branch_effect(branch, qualified, ctx);
    if conditional {
        return format!("{} {effect}", subject(m));
    }
    if !qualified {
        return format!("{} {effect}.", subject(m));
    }
    let condition = consumer
        .get("qualified_condition")
        .filter(|c| c.is_object());
    if let Some(c) = condition.filter(|c| nn(obj(Some(c)), "operator").is_some()) {
        return format!(
            "If {}, those models {effect} instead",
            describe_condition_value(c)
        );
    }
    let membership = obj(consumer.get("membership"));
    let region = title(obj(m.get("region_ref")).get("region_id"));
    let rel = relation(membership.get("relation"));
    let who = if whole_unit {
        format!("If such a unit is {rel} {region}, those models")
    } else {
        format!("If such a model is {rel} {region}, it")
    };
    format!("{who} {effect} instead")
}

fn whole_unit(m: &P) -> bool {
    let membership = obj(obj(m.get("consumer")).get("membership"));
    sv(membership, "unit_scope") == Some("whole-unit")
}

/// A `named-region-state` on its own.
pub(crate) fn describe_named_region_state(m: &P, ctx: &Ctx) -> String {
    let consumer = obj(m.get("consumer"));
    let whole = whole_unit(m);
    let gate = match consumer.get("attack_condition") {
        Some(c) if crate::translate::condition::truthy(Some(c)) => format!(
            "For each qualifying attack ({}): ",
            describe_condition_value(c)
        ),
        _ => String::new(),
    };
    format!(
        "{} {gate}{} {}",
        prefix(m),
        branch_text(m, whole, false, false, ctx),
        branch_text(m, whole, true, false, ctx)
    )
}

/// A `conditional` wrapping a `named-region-state`: the condition picks the branch.
pub(crate) fn describe_named_region_conditional(m: &P, condition: &Value, ctx: &Ctx) -> String {
    let whole = whole_unit(m);
    let negated = condition.get("operator").and_then(Value::as_str) == Some("not")
        && operands(condition).is_some_and(|o| o.len() == 1);
    let predicate = if negated {
        describe_condition_value(&operands(condition).unwrap()[0])
    } else {
        describe_condition_value(condition)
    };
    let default_text = branch_text(m, whole, false, true, ctx);
    let qualified_text = branch_text(m, whole, true, true, ctx);
    if negated {
        return format!(
            "{} Unless {predicate}, {default_text}. If {predicate}, {qualified_text}.",
            prefix(m)
        );
    }
    format!(
        "{} When {predicate}, {qualified_text}. Otherwise, {default_text}.",
        prefix(m)
    )
}
