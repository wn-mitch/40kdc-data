//! Leaf translators for critical thresholds (`roll-result`), ignored modifiers
//! (`ignore-modifiers`) and the core abilities the buff layer models on an attacked unit
//! (`ability-grant`), plus the `weapon_name` applicability gate. Mirrors `translateRollResult`,
//! `translateIgnoreModifiers`, `translateAbilityGrant`, `weaponNameApplicability` and
//! `combineOptional` in `tools/src/cruncher/from-dsl.ts`.

use serde_json::{json, Value};

use super::applicability::combine;
use super::js::*;
use super::leaves::{
    attack_type_applicability, emit, roll_label, signed_value, unhonorable_narrowing,
};
use super::TranslationPerspective::{Attacker, Target};
use super::{applies_to_buffed_unit, buff, classify_target, Out, Side, WalkOpts};

/// `weapon_name` as a gate on the attacking weapon's (lower-cased) name.
pub(super) fn weapon_name_applicability(m: &Obj) -> Option<Value> {
    m.get("weapon_name")
        .and_then(Value::as_str)
        .map(|name| json!({ "weaponName": name.to_lowercase() }))
}

/// Both gates merged, or whichever one is present.
pub(super) fn combine_optional(a: Option<Value>, b: Option<Value>) -> Option<Value> {
    match (a, b) {
        (Some(Value::Object(a)), Some(Value::Object(b))) => Some(Value::Object(combine(&a, &b))),
        (a, b) => a.or(b),
    }
}

/// A whole number in `2..=6`: a valid threshold for a D6 characteristic.
fn d6_threshold(n: f64) -> bool {
    n.fract() == 0.0 && (2.0..=6.0).contains(&n)
}

/// A changed roll result. Only a critical threshold on the buffed unit's own hit or wound roll is
/// in the damage math; a fixed result for any other roll (advance, battle-shock, ...) is outside it.
pub(super) fn roll_result(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let empty = Obj::new();
    let m = object(node.get("modifier")).unwrap_or(&empty);
    let roll = m.get("roll");
    let Some(r @ ("hit" | "wound" | "save" | "damage")) = roll.and_then(Value::as_str) else {
        out.unsupported(
            format!(
                "roll-result on \"{}\" is outside the damage path",
                roll_label(roll)
            ),
            node,
        );
        return;
    };
    if let Some(k) = unhonorable_narrowing(m) {
        out.unsupported(
            format!("roll-result: narrows by \"{k}\" which the cruncher can't resolve here"),
            node,
        );
        return;
    }
    let critical = js_number(m.get("critical_on"));
    let only_critical = m.keys().all(|k| {
        [
            "roll",
            "critical_on",
            "attack_type",
            "weapon_type",
            "weapon_name",
        ]
        .contains(&k.as_str())
    });
    if !matches!(r, "hit" | "wound") || !only_critical || !d6_threshold(critical) {
        out.unsupported(
            format!("roll-result on \"{r}\": only a critical threshold on hit or wound rolls is modelled"),
            node,
        );
        return;
    }
    if opts.perspective != Attacker || !applies_to_buffed_unit(node, Attacker) {
        return;
    }
    let gate = combine_optional(attack_type_applicability(m), weapon_name_applicability(m));
    emit(
        opts,
        out,
        &gate,
        json!({ "type": "crit-threshold", "roll": r, "value": critical }),
    );
}

/// Ignoring modifiers to the buffed unit's own hit or wound rolls. Ignoring WS/BS modifiers is the
/// same lever here: the buff layer changes WS/BS for incoming attacks only through hit modifiers.
pub(super) fn ignore_modifiers(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let empty = Obj::new();
    let m = object(node.get("modifier")).unwrap_or(&empty);
    let listed = match m.get("what").and_then(Value::as_str) {
        Some("rolls") => m.get("rolls"),
        Some("characteristics") => m.get("stats"),
        _ => None,
    };
    let rolls: Vec<Option<&str>> = list(listed)
        .iter()
        .map(|item| match item.as_str() {
            Some("WS" | "BS") => Some("hit"),
            other => other,
        })
        .collect();
    if rolls.is_empty() || rolls.iter().any(|r| !matches!(r, Some("hit" | "wound"))) {
        out.unsupported(
            "ignore-modifiers: only hit and wound rolls and WS/BS are modelled",
            node,
        );
        return;
    }
    if opts.perspective != Attacker || !applies_to_buffed_unit(node, Attacker) {
        return;
    }
    let mut seen: Vec<&str> = Vec::new();
    for roll in rolls.into_iter().flatten() {
        if !seen.contains(&roll) {
            seen.push(roll);
            out.applied.push(buff(
                opts,
                json!({ "type": "ignore-modifiers", "roll": roll }),
            ));
        }
    }
}

/// The core abilities the buff layer models on the unit being attacked: Stealth and the benefit
/// of cover (Stealth gives the benefit of cover) and Feel No Pain. Like the other defender-side
/// leaves, they contribute nothing to the buffed unit's own attacks.
pub(super) fn ability_grant(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let empty = Obj::new();
    let m = object(node.get("modifier")).unwrap_or(&empty);
    let fnp = js_number(m.get("value"));
    let contribution = match m.get("ability").and_then(Value::as_str) {
        Some("stealth" | "benefit-of-cover") => json!({ "type": "cover" }),
        Some("feel-no-pain") if d6_threshold(fnp) => {
            json!({ "type": "feel-no-pain", "threshold": fnp })
        }
        _ => {
            out.unsupported(
                "effect type \"ability-grant\" is not modelled by the buff layer",
                node,
            );
            return;
        }
    };
    if opts.perspective != Target || classify_target(node) != Side::Buffed {
        return;
    }
    out.applied.push(buff(opts, contribution));
}

/// A WS/BS `stat-modifier`. On the attacker it penalises incoming hit rolls of that attack type,
/// so it is a hit-mod gated to the attack's phase under the target perspective. On the buffed unit
/// it changes the characteristic its own attacks hit on.
pub(super) fn skill_modifier(
    node: &Obj,
    m: &Obj,
    skill: &str,
    on_buffed: bool,
    gate: &Option<Value>,
    opts: &WalkOpts,
    out: &mut Out,
) {
    let phase = if skill == "BS" { "shooting" } else { "fight" };
    if classify_target(node) == Side::Attacker {
        if opts.perspective != Target {
            return;
        }
        if let Some(value) = signed_value(m) {
            let mut b = buff(opts, json!({ "type": "hit-mod", "value": value }));
            b["applicableWhen"] = json!({ "phases": [phase] });
            out.applied.push(b);
        }
        return;
    }
    if opts.perspective != Attacker || !on_buffed {
        return;
    }
    // Only a number is an amount: a missing or non-numeric value is refused, not read as 0.
    let value = m.get("value").and_then(Value::as_f64).unwrap_or(f64::NAN);
    let improvement = match m.get("operation").and_then(Value::as_str) {
        Some("improve") => value,
        Some("worsen") => -value,
        _ => f64::NAN,
    };
    if !improvement.is_finite() {
        out.unsupported(
            format!(
                "stat-modifier {skill}: operation \"{}\" not supported",
                js_string(m.get("operation"))
            ),
            node,
        );
        return;
    }
    emit(
        opts,
        out,
        gate,
        json!({ "type": "skill-mod", "stat": skill, "value": improvement }),
    );
}

/// A `stat-modifier` with `operation: "set"`. Setting the Save characteristic is defender-side;
/// any other set stat outside A/S/T/D is off the damage path. Returns `false` for a set A/S/T/D,
/// which falls through to the delta translation (and its unsupported-operation diagnostic).
pub(super) fn set_modifier(
    node: &Obj,
    m: &Obj,
    on_buffed: bool,
    gate: &Option<Value>,
    opts: &WalkOpts,
    out: &mut Out,
) -> bool {
    let stat = m.get("stat");
    match stat.and_then(Value::as_str) {
        Some("Sv") => {
            if opts.perspective != Target {
                out.unsupported(
                    "stat-modifier Sv: defender-side stat; applies when the buffed unit is the target",
                    node,
                );
                return true;
            }
            let save = m.get("value").and_then(Value::as_f64).unwrap_or(f64::NAN);
            if !on_buffed {
                return true;
            }
            if d6_threshold(save) {
                emit(
                    opts,
                    out,
                    gate,
                    json!({ "type": "save-characteristic", "value": save }),
                );
            } else if save.is_nan() {
                out.unsupported("stat-modifier Sv: set has no numeric value", node);
            } else {
                out.unsupported(
                    format!(
                        "stat-modifier Sv: set value \"{}\" is not a save characteristic",
                        fmt_num(save)
                    ),
                    node,
                );
            }
            true
        }
        Some("A" | "S" | "T" | "D") => false,
        _ => {
            out.unsupported(
                format!(
                    "stat-modifier on \"{}\" is outside the damage path",
                    js_string(stat)
                ),
                node,
            );
            true
        }
    }
}
