//! Leaf translators for critical thresholds (`roll-result`), ignored modifiers
//! (`ignore-modifiers`) and the core abilities the buff layer models on an attacked unit
//! (`ability-grant`), plus shared canonical `weapons` applicability. Mirrors
//! `translateRollResult`, `translateIgnoreModifiers`, `translateAbilityGrant`,
//! `weaponApplicability` and `combineOptional` in `tools/src/cruncher/from-dsl.ts`.

use serde_json::{json, Value};

use super::applicability::combine;
use super::js::*;
use super::leaves::{
    attack_type_applicability, emit, roll_label, signed_value, unhonorable_narrowing,
};
use super::TranslationPerspective::{Attacker, Target};
use super::{applies_to_buffed_unit, buff, classify_target, walk, Out, Side, WalkOpts};

/// Normalize a catalog-backed keyword selector without parsing printed text.
fn keyword_selection(value: &Value) -> Option<Value> {
    let refs = match value {
        Value::Array(values) => values.clone(),
        Value::Object(_) => vec![value.clone()],
        _ => return None,
    };
    if refs.is_empty()
        || refs.iter().any(|v| {
            serde_json::from_value::<crate::cruncher::buffs::WeaponKeywordRef>(v.clone()).is_err()
        })
    {
        return None;
    }
    Some(Value::Array(refs))
}

/// Shared canonical weapon scopes become buff gates, preserving selector parameters.
pub(super) fn weapon_applicability(m: &Obj) -> Option<Value> {
    let weapons = object(m.get("weapons"))?;
    let mut out = Obj::new();
    if let Some(kind) = weapons.get("type").and_then(Value::as_str) {
        if let Some(phase) = match kind {
            "melee" => Some("fight"),
            "ranged" => Some("shooting"),
            _ => None,
        } {
            out.insert("phases".into(), json!([phase]));
        }
    }
    for (field, gate) in [
        ("name", "weaponName"),
        ("exclude_name", "excludedWeaponName"),
    ] {
        if let Some(name) = weapons.get(field).and_then(Value::as_str) {
            out.insert(gate.into(), Value::from(name.to_lowercase()));
        }
    }
    for (field, gate) in [
        ("keyword", "weaponKeywords"),
        ("exclude_keyword", "excludedWeaponKeywords"),
    ] {
        if let Some(value) = weapons.get(field).and_then(keyword_selection) {
            out.insert(gate.into(), value);
        }
    }
    (!out.is_empty()).then_some(Value::Object(out))
}

pub(super) fn unresolved_weapon_scope(m: &Obj) -> Option<&'static str> {
    let value = m.get("weapons")?;
    let Some(scope) = value.as_object() else {
        return Some("weapons");
    };
    if scope.contains_key("ref") {
        return Some("weapons.ref");
    }
    for field in ["keyword", "exclude_keyword"] {
        if scope
            .get(field)
            .is_some_and(|value| keyword_selection(value).is_none())
        {
            return Some(match field {
                "keyword" => "weapons.keyword",
                _ => "weapons.exclude_keyword",
            });
        }
    }
    None
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
    let only_critical = m
        .keys()
        .all(|k| ["roll", "critical_on", "attack_type", "weapons"].contains(&k.as_str()));
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
    let gate = combine_optional(attack_type_applicability(m), weapon_applicability(m));
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

/// A printed grant (`definition`) translates its body for the holders. Otherwise, the core
/// abilities the buff layer models on the unit being attacked: Stealth and the benefit of cover
/// (Stealth gives the benefit of cover) and Feel No Pain. Like the other defender-side leaves,
/// they contribute nothing to the buffed unit's own attacks.
pub(super) fn ability_grant(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let empty = Obj::new();
    let m = object(node.get("modifier")).unwrap_or(&empty);
    if m.get("ability").is_some_and(Value::is_object) {
        out.unsupported(
            "ability-grant: named ability ownership is not resolved by the buff engine",
            node,
        );
        return;
    }
    // A printed grant carries the granted ability's body: it is the holders' own ability, so it
    // reaches the buffed unit exactly when the grant does, and its "this unit" is the holder.
    if let Some(definition) = m.get("definition").filter(|d| d.is_object()) {
        match classify_target(node) {
            Side::Buffed => {
                if matches!(
                    node.get("target").and_then(Value::as_str),
                    Some("this-model" | "model-in-this-unit")
                ) || node.get("target").is_some_and(|target| {
                    target.get("level").and_then(Value::as_str) == Some("model")
                }) {
                    out.unsupported(
                        "ability-grant: model-only definition cannot be applied to the entire unit",
                        node,
                    );
                } else {
                    walk(
                        definition,
                        &WalkOpts {
                            granted_holder: true,
                            ..opts.clone()
                        },
                        out,
                    );
                }
            }
            Side::Unknown => out.unsupported(
                "ability-grant: the units holding the granted ability are not resolved",
                node,
            ),
            Side::Attacker | Side::Defender => {}
        }
        return;
    }
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

/// A `stat-modifier` with `operation: "set"`. Setting the Save characteristic is defender-side. A
/// set A, S or D on the buffed unit replaces its weapons' characteristic before modifiers; other
/// set stats are off the damage path. Always handles the node.
pub(super) fn set_modifier(
    node: &Obj,
    m: &Obj,
    on_buffed: bool,
    gate: &Option<Value>,
    opts: &WalkOpts,
    out: &mut Out,
) {
    let stat = m.get("stat");
    match stat.and_then(Value::as_str) {
        Some("Sv") => {
            if opts.perspective != Target {
                out.unsupported(
                    "stat-modifier Sv: defender-side stat; applies when the buffed unit is the target",
                    node,
                );
                return;
            }
            let save = m.get("value").and_then(Value::as_f64).unwrap_or(f64::NAN);
            if !on_buffed {
                return;
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
        }
        Some("T") => {
            out.unsupported(
                "stat-modifier T: setting the Toughness characteristic is not modelled",
                node,
            );
        }
        Some("D") if classify_target(node) == Side::Attacker => {
            if opts.perspective == Target {
                out.unsupported(
                    "stat-modifier D: setting the Damage of incoming attacks is not modelled",
                    node,
                );
            }
        }
        Some(set_stat @ ("A" | "S" | "D")) => {
            if opts.perspective != Attacker || !on_buffed {
                return;
            }
            match m.get("value").and_then(Value::as_f64) {
                Some(v) if v.fract() == 0.0 && v >= 0.0 => emit(
                    opts,
                    out,
                    gate,
                    json!({ "type": "stat-set", "stat": set_stat, "value": v }),
                ),
                _ => out.unsupported(
                    format!(
                        "stat-modifier {set_stat}: set value \"{}\" is not a characteristic",
                        js_string(m.get("value"))
                    ),
                    node,
                ),
            }
        }
        _ => {
            out.unsupported(
                format!(
                    "stat-modifier on \"{}\" is outside the damage path",
                    js_string(stat)
                ),
                node,
            );
        }
    }
}
