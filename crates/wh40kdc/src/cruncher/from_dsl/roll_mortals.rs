//! Mortal wounds an attack's own hit or wound roll inflicts on the target ("each time an attack
//! scores a wound, the target suffers 1 mortal wound"). Mirrors `attackRollOf` and
//! `translateMortalWounds` in `tools/src/cruncher/from-dsl.ts`. Mortal wounds outside an attack
//! are not a buff: [`crate::cruncher::mortal_sources`] reports them.

use serde_json::{json, Value};

use super::js::*;
use super::TranslationPerspective::Attacker;
use super::{buff, classify_target, Out, Side, WalkOpts};
use crate::cruncher::damage_roll::quantity_distribution;

/// A hit or wound roll, its stated outcome (`success` or `critical`; `None` when unstated), and
/// the trigger's narrowing the attack cannot carry.
#[derive(Clone, Debug)]
pub(super) struct AttackRoll {
    pub roll: &'static str,
    pub outcome: Option<&'static str>,
    pub unmodelled: Vec<String>,
}

/// A hit or wound roll and its stated outcome.
type AttackRollRef = (&'static str, Option<&'static str>);

/// Who makes a hit or wound roll the attack's own: the unit or model holding the ability.
const ROLLING_SUBJECTS: [&str; 3] = ["this-unit", "this-model", "bearer"];

fn own_subject(trigger: &Obj) -> bool {
    match trigger.get("subject") {
        None | Some(Value::Null) => true,
        Some(Value::String(subject)) => ROLLING_SUBJECTS.contains(&subject.as_str()),
        Some(_) => false,
    }
}

/// Whether a trigger fires on a hit or wound roll of the unit's own attacks, whatever its
/// outcome: mortal wounds there belong to the attack, never to a moment outside it. Mirrors
/// `isOwnAttackRollTrigger`.
pub fn is_own_attack_roll_trigger(trigger: &Value) -> bool {
    let Some(trigger) = trigger.as_object() else {
        return false;
    };
    if !is_str(trigger, "event", "after-roll") {
        return false;
    }
    let Some(filter) = object(trigger.get("filter")) else {
        return false;
    };
    matches!(
        filter.get("roll").and_then(Value::as_str),
        Some("hit" | "wound")
    ) && own_subject(trigger)
}

/// An effect under a hit or wound trigger and that roll. The trigger's attack type and weapon
/// scope narrow which attacks fire it, so they gate the effect as an `attack-is` condition; any
/// other narrowing (another filter key, another unit rolling, an object) is named in the roll's
/// `unmodelled`. `None` under any other trigger. Mirrors `onAttackRoll`.
pub(super) fn on_attack_roll(
    trigger: Option<&Value>,
    effect: &Value,
) -> Option<(Value, AttackRoll)> {
    let (roll, outcome) = attack_roll_of(trigger)?;
    let trigger = object(trigger)?;
    let filter = object(trigger.get("filter"))?;
    let mut parameters = Obj::new();
    let mut unmodelled = Vec::new();
    // Keys in sorted order, so every port names them alike.
    let mut entries: Vec<(&String, &Value)> = filter.iter().collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    for (key, value) in entries {
        match key.as_str() {
            "roll" | "result" => {}
            "attack_type" if matches!(value.as_str(), Some("ranged" | "melee")) => {
                parameters.insert(key.clone(), value.clone());
            }
            "weapons" => {
                parameters.insert(key.clone(), value.clone());
            }
            _ => unmodelled.push(format!("filter.{key}")),
        }
    }
    if !own_subject(trigger) {
        unmodelled.push("subject".into());
    }
    if trigger
        .get("object")
        .is_some_and(|object| !object.is_null())
    {
        unmodelled.push("object".into());
    }
    let gated = if parameters.is_empty() {
        effect.clone()
    } else {
        json!({ "type": "conditional", "condition": { "type": "attack-is", "parameters": parameters }, "effect": effect })
    };
    Some((
        gated,
        AttackRoll {
            roll,
            outcome,
            unmodelled,
        },
    ))
}

/// The hit or wound roll a single after-roll trigger fires on, with its outcome; `None` for any
/// other trigger. A result of "failure" is not a scoring roll, so it gives no attack roll.
fn attack_roll_of(trigger: Option<&Value>) -> Option<AttackRollRef> {
    let trigger = object(trigger)?;
    if !is_str(trigger, "event", "after-roll") {
        return None;
    }
    let filter = object(trigger.get("filter"))?;
    let roll = match filter.get("roll").and_then(Value::as_str) {
        Some("hit") => "hit",
        Some("wound") => "wound",
        _ => return None,
    };
    let outcome = match filter.get("result") {
        None => None,
        Some(Value::String(s)) if s == "success" => Some("success"),
        Some(Value::String(s)) if s == "critical" => Some("critical"),
        Some(_) => return None,
    };
    Some((roll, outcome))
}

pub(super) fn translate(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let Some(AttackRoll {
        roll,
        outcome,
        unmodelled,
    }) = &opts.attack_roll
    else {
        out.unsupported(
            "mortal-wounds: inflicted outside an attack, not a change to it",
            node,
        );
        return;
    };
    let Some(outcome) = outcome else {
        out.unsupported(
            format!("mortal-wounds: the {roll} roll's outcome is not stated"),
            node,
        );
        return;
    };
    if classify_target(node) != Side::Defender {
        out.unsupported(
            "mortal-wounds: the attack's rolls inflict them on a unit other than the target",
            node,
        );
        return;
    }
    if !unmodelled.is_empty() {
        out.unsupported(
            format!(
                "mortal-wounds: the {roll} roll's trigger {} is not modelled",
                unmodelled.join(", ")
            ),
            node,
        );
        return;
    }
    if opts.perspective != Attacker {
        return;
    }
    let empty = Obj::new();
    let modifier = object(node.get("modifier")).unwrap_or(&empty);
    let extra: Vec<&str> = modifier
        .keys()
        .map(String::as_str)
        .filter(|key| *key != "count")
        .collect();
    if !extra.is_empty() {
        out.unsupported(
            format!(
                "mortal-wounds: {} on an attack roll is not modelled",
                extra.join(", ")
            ),
            node,
        );
        return;
    }
    let count = modifier.get("count").unwrap_or(&Value::Null);
    let Ok(distribution) = quantity_distribution(count) else {
        let shown = match modifier.get("count") {
            Some(count) => count.to_string(),
            None => "undefined".to_string(),
        };
        out.unsupported(
            format!("mortal-wounds: count {shown} is not a fixed or dice quantity"),
            node,
        );
        return;
    };
    let count: f64 = distribution
        .iter()
        .map(|(value, probability)| value * probability)
        .sum();
    out.applied.push(buff(
        opts,
        json!({ "type": "mortal-wounds-on-roll", "roll": roll, "outcome": outcome, "count": count }),
    ));
}
