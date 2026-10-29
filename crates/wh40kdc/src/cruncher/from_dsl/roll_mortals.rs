//! Mortal wounds an attack's own hit or wound roll inflicts on the target ("each time an attack
//! scores a wound, the target suffers 1 mortal wound"). Mirrors `attackRollOf` and
//! `translateMortalWounds` in `tools/src/cruncher/from-dsl.ts`. Mortal wounds outside an attack
//! are not a buff: [`crate::cruncher::mortal_sources`] reports them.

use serde_json::{json, Value};

use super::js::*;
use super::TranslationPerspective::Attacker;
use super::{buff, classify_target, Out, Side, WalkOpts};
use crate::cruncher::damage_roll::quantity_distribution;

/// A hit or wound roll and its stated outcome (`success` or `critical`; `None` when unstated).
pub(super) type AttackRollRef = (&'static str, Option<&'static str>);

/// The hit or wound roll a single after-roll trigger fires on, with its outcome; `None` for any
/// other trigger. A result of "failure" is not a scoring roll, so it gives no attack roll.
pub(super) fn attack_roll_of(trigger: Option<&Value>) -> Option<AttackRollRef> {
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
    let Some((roll, outcome)) = opts.attack_roll else {
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
