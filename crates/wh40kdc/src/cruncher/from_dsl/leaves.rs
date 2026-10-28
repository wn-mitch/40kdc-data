//! The leaf translators: re-rolls, roll and characteristic modifiers, feel-no-pain, weapon
//! keyword grants, damage reduction, invulnerable saves and a named region's default branch.
//! Mirrors the "Leaf translators" section of `tools/src/cruncher/from-dsl.ts`.

use serde_json::{json, Value};

use super::damage_leaves::{
    combine_optional, set_modifier, skill_modifier, unresolved_weapon_scope, weapon_applicability,
};
use super::js::*;
use super::TranslationPerspective::{Attacker, Target};
use super::{applies_to_buffed_unit, buff, classify_target, walk, Out, Side, WalkOpts};

/// Model subsets and bound weapon references need state the damage context does not carry.
const UNHONORABLE_NARROWING: &[&str] = &["model_filter", "model_scope"];

pub(super) fn unhonorable_narrowing(m: &Obj) -> Option<&'static str> {
    UNHONORABLE_NARROWING
        .iter()
        .copied()
        .find(|k| present(m, k).is_some())
        .or_else(|| unresolved_weapon_scope(m))
}

/// A roll kind for a diagnostic: "hit", or the ability whose dice it is.
pub(super) fn roll_label(roll: Option<&Value>) -> String {
    match object(roll)
        .and_then(|r| r.get("of_ability"))
        .and_then(Value::as_str)
    {
        Some(a) => format!("{a} roll"),
        None => js_string(roll),
    }
}

pub(super) fn reroll(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    // Rerolls are the rolling side's: apply only under the matching perspective.
    if opts.perspective == Attacker && !applies_to_buffed_unit(node, Attacker) {
        return;
    }
    let Some(m) = object(node.get("modifier")) else {
        out.unsupported("re-roll: missing modifier object", node);
        return;
    };
    if let Some(k) = unhonorable_narrowing(m) {
        out.unsupported(
            format!("re-roll: narrows by \"{k}\" which the cruncher can't resolve here"),
            node,
        );
        return;
    }
    let roll = m.get("roll");
    // A `value: 1` on a re-roll unambiguously means "re-roll rolls of 1". An unrestricted optional
    // re-roll (`result_scope: "any-result"`, no `subset`) is "all-failures" to the expected-value
    // engine: a rational player re-rolls only failures.
    let one = Value::from("ones");
    let all_failures = Value::from("all-failures");
    let subset = if m.get("value").and_then(Value::as_f64) == Some(1.0) {
        Some(&one)
    } else if m.get("subset").is_none() && is_str(m, "result_scope", "any-result") {
        Some(&all_failures)
    } else {
        m.get("subset")
    };
    if opts.perspective == Target && roll.and_then(Value::as_str) != Some("save") {
        return;
    }
    let r = roll.and_then(Value::as_str);
    let s = subset.and_then(Value::as_str);
    let damage_path = matches!(r, Some("hit" | "wound" | "save" | "damage"));
    // "Re-roll one Hit roll": one die across the pool, which the engine prices (`one_reroll_dice`).
    // A larger finite permission is non-linear in a way the engine does not model; applying it as
    // an uncapped reroll would silently overstate the effect.
    if m.contains_key("count") && damage_path {
        if m.get("count").and_then(Value::as_f64) == Some(1.0) && s == Some("all-failures") {
            emit(
                opts,
                out,
                &weapon_applicability(m),
                json!({ "type": "reroll-one", "roll": r }),
            );
            return;
        }
        out.unsupported(
            "re-roll: a count-capped permission other than one die of any result is not modelled by the expected-value engine",
            node,
        );
        return;
    }
    if damage_path && matches!(s, Some("ones" | "all-failures")) {
        emit(
            opts,
            out,
            &weapon_applicability(m),
            json!({ "type": "reroll", "roll": r, "subset": s }),
        );
        return;
    }
    out.unsupported(
        format!(
            "re-roll on \"{}\" (subset \"{}\") is outside the damage path",
            roll_label(roll),
            js_string(subset)
        ),
        node,
    );
}

pub(super) fn roll_modifier(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let Some(m) = object(node.get("modifier")) else {
        out.unsupported("roll-modifier: missing modifier object", node);
        return;
    };
    if let Some(k) = unhonorable_narrowing(m) {
        out.unsupported(
            format!("roll-modifier: narrows by \"{k}\" which the cruncher can't resolve here"),
            node,
        );
        return;
    }
    let Some(value) = signed_value(m) else {
        out.unsupported(
            format!(
                "roll-modifier: operation \"{}\" not supported",
                js_string(m.get("operation"))
            ),
            node,
        );
        return;
    };
    let roll = m.get("roll");
    let r = roll.and_then(Value::as_str);
    // A change to the attacker's roll belongs to the side it favours: one that helps the attacker is
    // the attacking side's own rule, one that hinders it defends the unit being attacked.
    let side = classify_target(node);
    let attacker_change = side == Side::Attacker;
    if opts.perspective == Attacker {
        if attacker_change && value < 0.0 {
            return;
        }
        if !applies_to_buffed_unit(node, Attacker) || r == Some("save") {
            return;
        }
    } else {
        // The buffed unit's own saves, or a penalty to the incoming attacker's hit/wound rolls.
        match side {
            Side::Attacker if matches!(r, Some("hit" | "wound")) && value <= 0.0 => {}
            Side::Buffed if r == Some("save") => {}
            _ => return,
        }
    }
    let ty = match r {
        Some("hit") => "hit-mod",
        Some("wound") => "wound-mod",
        Some("save") => "save-mod",
        Some("damage") => "damage-mod",
        _ => {
            out.unsupported(
                format!(
                    "roll-modifier on \"{}\" is outside the damage path",
                    roll_label(roll)
                ),
                node,
            );
            return;
        }
    };
    emit(
        opts,
        out,
        &weapon_applicability(m),
        json!({ "type": ty, "value": value }),
    );
}

/// Attack type and canonical weapon type both narrow the attack phase.
pub(super) fn attack_type_applicability(m: &Obj) -> Option<Value> {
    let kind =
        present(m, "attack_type").or_else(|| object(m.get("weapons")).and_then(|w| w.get("type")));
    phase_gate(kind.and_then(Value::as_str))
}

fn phase_gate(kind: Option<&str>) -> Option<Value> {
    match kind {
        Some("melee") => Some(json!({ "phases": ["fight"] })),
        Some("ranged") => Some(json!({ "phases": ["shooting"] })),
        _ => None,
    }
}

pub(super) fn emit(opts: &WalkOpts, out: &mut Out, gate: &Option<Value>, contribution: Value) {
    let mut b = buff(opts, contribution);
    if let Some(g) = gate {
        b["applicableWhen"] = g.clone();
    }
    out.applied.push(b);
}

pub(super) fn stat_modifier(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let Some(m) = object(node.get("modifier")) else {
        out.unsupported("stat-modifier: missing modifier object", node);
        return;
    };
    if let Some(k) = unhonorable_narrowing(m) {
        out.unsupported(
            format!("stat-modifier: narrows by \"{k}\" which the cruncher can't resolve here"),
            node,
        );
        return;
    }
    let stat = m.get("stat");
    let on_buffed = applies_to_buffed_unit(node, opts.perspective);
    // Attack and canonical weapon scopes retain every applicable gate.
    let gate = combine_optional(attack_type_applicability(m), weapon_applicability(m));
    let unsupported_operation = |what: &str| {
        format!(
            "stat-modifier {what}: operation \"{}\" not supported",
            js_string(m.get("operation"))
        )
    };
    match stat.and_then(Value::as_str) {
        // AP is stored negative and has offensive/defensive variants.
        Some("AP") => {
            // Worsening the AP of attacks against the buffed unit; the engine floors AP at 0.
            if classify_target(node) == Side::Attacker {
                if opts.perspective != Target {
                    out.unsupported(
                        "stat-modifier AP on the attacker: defender-side stat; applies when the buffed unit is the target",
                        node,
                    );
                    return;
                }
                if is_str(m, "operation", "set") {
                    out.unsupported(
                        "stat-modifier AP: setting the AP of incoming attacks is not modelled",
                        node,
                    );
                    return;
                }
                match ap_delta(m) {
                    Some(d) => emit(opts, out, &gate, json!({ "type": "ap-mod", "value": d })),
                    None => out.unsupported(unsupported_operation("AP"), node),
                }
                return;
            }
            if opts.perspective != Attacker || !applies_to_buffed_unit(node, Attacker) {
                return;
            }
            if is_str(m, "operation", "set") {
                // The DSL carries the AP magnitude ("an AP of -2" is value 2); the profile stores
                // it negative.
                match m.get("value").and_then(Value::as_f64) {
                    Some(v) if v.fract() == 0.0 => emit(
                        opts,
                        out,
                        &gate,
                        json!({ "type": "stat-set", "stat": "AP", "value": -v.abs() }),
                    ),
                    _ => out.unsupported(
                        format!(
                            "stat-modifier AP: set value \"{}\" is not a characteristic",
                            js_string(m.get("value"))
                        ),
                        node,
                    ),
                }
                return;
            }
            match ap_delta(m) {
                Some(d) => emit(opts, out, &gate, json!({ "type": "ap-mod", "value": d })),
                None => out.unsupported(unsupported_operation("AP"), node),
            }
            return;
        }
        // WS/BS on the attacker penalises incoming hit rolls of that attack type: a hit-mod gated
        // to its phase when targeted. On the buffed unit it changes the characteristic its own
        // attacks hit on.
        Some(skill @ ("BS" | "WS")) => {
            skill_modifier(node, m, skill, on_buffed, &gate, opts, out);
            return;
        }
        _ => {}
    }
    if is_str(m, "operation", "set") {
        set_modifier(node, m, on_buffed, &gate, opts, out);
        return;
    }
    let Some(value) = signed_value(m) else {
        out.unsupported(
            format!(
                "stat-modifier: operation \"{}\" not supported",
                js_string(m.get("operation"))
            ),
            node,
        );
        return;
    };
    match stat.and_then(Value::as_str) {
        Some("A") if opts.perspective == Attacker && on_buffed => emit(
            opts,
            out,
            &gate,
            json!({ "type": "attacks-mod", "value": value }),
        ),
        Some("S") if opts.perspective == Attacker && on_buffed => emit(
            opts,
            out,
            &gate,
            json!({ "type": "strength-mod", "value": value }),
        ),
        Some("A" | "S") => {}
        Some("T") => {
            if opts.perspective != Target {
                out.unsupported(
                    "stat-modifier T: defender-side stat; applies when the buffed unit is the target",
                    node,
                );
            } else if on_buffed {
                emit(
                    opts,
                    out,
                    &gate,
                    json!({ "type": "toughness-mod", "value": value }),
                );
            }
        }
        // The Damage of attacks against the buffed unit is defender-side: a reduction (Necrodermis)
        // under target perspective. On the buffed unit it changes the Damage of its own attacks.
        Some("D") => {
            if classify_target(node) == Side::Attacker {
                if opts.perspective != Target {
                    return;
                }
                if value < 0.0 {
                    emit(
                        opts,
                        out,
                        &gate,
                        json!({ "type": "damage-reduction", "value": -value }),
                    );
                } else {
                    out.unsupported(
                        "stat-modifier D: raising the Damage of incoming attacks is not modelled",
                        node,
                    );
                }
            } else if opts.perspective == Attacker && on_buffed {
                emit(
                    opts,
                    out,
                    &gate,
                    json!({ "type": "damage-mod", "value": value }),
                );
            }
        }
        // Improvement is a save-roll bonus; literal characteristic addition worsens the Save.
        Some("Sv") => {
            if opts.perspective != Target {
                out.unsupported(
                    "stat-modifier Sv: defender-side stat; applies when the buffed unit is the target",
                    node,
                );
            } else if on_buffed {
                let operation = m.get("operation").and_then(Value::as_str);
                let cap = m.get("minimum").and_then(Value::as_f64);
                let contribution = match (operation, cap) {
                    // A capped improvement ("cannot improve a Save to better than N+") changes
                    // the Save characteristic itself, not the save roll.
                    (Some("improve"), Some(best)) => {
                        json!({ "type": "save-improve", "value": value, "best": best })
                    }
                    (Some("improve" | "worsen"), _) => {
                        json!({ "type": "save-mod", "value": value })
                    }
                    _ => json!({ "type": "save-mod", "value": -value }),
                };
                emit(opts, out, &gate, contribution);
            }
        }
        _ => out.unsupported(
            format!(
                "stat-modifier on \"{}\" is outside the damage path",
                js_string(stat)
            ),
            node,
        ),
    }
}

pub(super) fn feel_no_pain(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    // FNP ablates incoming damage: irrelevant while the unit is attacking.
    if opts.perspective != Target || !applies_to_buffed_unit(node, Target) {
        return;
    }
    let Some(m) = object(node.get("modifier")) else {
        out.unsupported("feel-no-pain: missing modifier object", node);
        return;
    };
    if let Some(key) = unhonorable_narrowing(m) {
        out.unsupported(format!("feel-no-pain: unresolved {key} selector"), node);
        return;
    }
    let Some(threshold) = finite(m.get("threshold")) else {
        out.unsupported("feel-no-pain: threshold not numeric", node);
        return;
    };
    let mortal = match m.get("against") {
        None => false,
        Some(a) => match a.as_str() {
            Some("all") => false,
            Some("mortal" | "psychic-and-mortal") => true,
            Some("psychic") => {
                out.unsupported(
                    "feel-no-pain: against \"psychic\" (psychic attacks are not tracked by the buff layer)",
                    node,
                );
                return;
            }
            _ => {
                out.unsupported(
                    format!(
                        "feel-no-pain: unrecognised against \"{}\" (expected \"all\" or \"mortal\")",
                        js_string(Some(a))
                    ),
                    node,
                );
                return;
            }
        },
    };
    let contribution = if mortal {
        json!({ "type": "feel-no-pain", "threshold": threshold, "scope": "mortal" })
    } else {
        json!({ "type": "feel-no-pain", "threshold": threshold })
    };
    emit(opts, out, &weapon_applicability(m), contribution);
}

pub(super) fn keyword_grant(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    // Weapon-keyword grants ride with the attacker's profile.
    if opts.perspective != Attacker || !applies_to_buffed_unit(node, Attacker) {
        return;
    }
    let Some(m) = object(node.get("modifier")) else {
        return;
    };
    for keyword in list(m.get("removes")) {
        let label = if keyword.get("keyword_id").and_then(Value::as_str).is_some() {
            super::applicability::keyword_label(keyword)
        } else {
            "unresolved keyword".into()
        };
        out.unsupported.push((
            format!(
                "weapon-ability-removal: the cruncher does not model removing a weapon ability (\"{label}\")"
            ),
            json!({ "removes": [keyword] }),
            None,
        ));
    }
    if m.get("if_present").is_some_and(|value| !value.is_null()) {
        out.unsupported(
            "weapon-ability-grant: incrementing an existing keyword rating is not modelled",
            node,
        );
        return;
    }
    if let Some(key) = unhonorable_narrowing(m) {
        out.unsupported(format!("weapon-ability-grant: unresolved {key}"), node);
        return;
    }
    let gate = weapon_applicability(m);
    for raw in list(m.get("keywords")) {
        if raw
            .get("parameters")
            .and_then(|p| p.get("value"))
            .is_some_and(|value| !value.is_number() && !value.is_string())
        {
            out.unsupported.push((
                "weapon-ability-grant: keyword rating quantity is unresolved".into(),
                raw.clone(),
                None,
            ));
            continue;
        }
        let Ok(reference) =
            serde_json::from_value::<crate::cruncher::buffs::WeaponKeywordRef>(raw.clone())
        else {
            out.unsupported.push((
                "weapon-ability-grant: malformed catalog keyword reference".into(),
                raw.clone(),
                None,
            ));
            continue;
        };
        let ref_json = serde_json::to_value(reference).expect("a keyword ref serializes");
        emit(
            opts,
            out,
            &gate,
            json!({ "type": "extra-keyword", "keywordRef": ref_json }),
        );
    }
}

pub(super) fn damage_reduction(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    if opts.perspective != Target || !applies_to_buffed_unit(node, Target) {
        return;
    }
    let Some(m) = object(node.get("modifier")) else {
        out.unsupported("damage-reduction: missing modifier object", node);
        return;
    };
    if let Some(key) = unhonorable_narrowing(m) {
        out.unsupported(format!("damage-reduction: unresolved {key} selector"), node);
        return;
    }
    let reduction = m.get("reduction");
    if let Some(r) = reduction
        .and_then(Value::as_f64)
        .filter(|r| r.is_finite() && *r > 0.0)
    {
        emit(
            opts,
            out,
            &weapon_applicability(m),
            json!({ "type": "damage-reduction", "value": r }),
        );
        return;
    }
    match reduction.and_then(Value::as_str) {
        Some("to-zero") => {
            let (uses, per) = zeroing_uses(opts.usage.as_ref());
            emit(
                opts,
                out,
                &weapon_applicability(m),
                json!({ "type": "damage-zeroing", "uses": uses, "per": per }),
            );
            return;
        }
        Some("half") => {
            out.unsupported(
                "damage-reduction: halving Damage is not modelled by the buff layer",
                node,
            );
            return;
        }
        _ => {}
    }
    out.unsupported(
        format!(
            "damage-reduction: unrecognised reduction \"{}\"",
            js_string(reduction)
        ),
        node,
    );
}

/// How many attacks a damage-zeroing ability zeroes in one activation, from its
/// usage limit: the smallest count among its limits (a once-per limit is 1, an
/// n-per-battle limit its count), shared by the unit unless every limit counts
/// per model. Without a limit, each use zeroes one attack.
fn zeroing_uses(usage: Option<&Value>) -> (u64, &'static str) {
    let limits: Vec<&serde_json::Map<String, Value>> = match usage {
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_object).collect(),
        Some(other) => other.as_object().into_iter().collect(),
        None => Vec::new(),
    };
    if limits.is_empty() {
        return (1, "unit");
    }
    let uses = limits
        .iter()
        .map(|limit| {
            limit
                .get("count")
                .and_then(Value::as_f64)
                .filter(|count| count.fract() == 0.0 && *count > 0.0)
                .map_or(1, |count| count as u64)
        })
        .min()
        .unwrap_or(1);
    let per_model = limits
        .iter()
        .all(|limit| limit.get("per").and_then(Value::as_str) == Some("model"));
    (uses, if per_model { "model" } else { "unit" })
}

pub(super) fn invulnerable_save(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    if opts.perspective != Target || !applies_to_buffed_unit(node, Target) {
        return;
    }
    let Some(m) = object(node.get("modifier")) else {
        out.unsupported("invulnerable-save: missing modifier object", node);
        return;
    };
    if let Some(key) = unhonorable_narrowing(m) {
        out.unsupported(
            format!("invulnerable-save: unresolved {key} selector"),
            node,
        );
        return;
    }
    match finite(m.get("invuln_sv")).filter(|t| (2.0..=7.0).contains(t)) {
        Some(t) => emit(
            opts,
            out,
            &weapon_applicability(m),
            json!({ "type": "invulnerable-save", "threshold": t }),
        ),
        None => out.unsupported(
            format!(
                "invulnerable-save: invuln_sv \"{}\" is not a valid save threshold (2–7)",
                js_string(m.get("invuln_sv"))
            ),
            node,
        ),
    }
}

pub(super) fn named_region_state(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    if opts.perspective != Attacker {
        return;
    }
    let empty = Obj::new();
    let modifier = object(node.get("modifier")).unwrap_or(&empty);
    // A producer-only state (a region declaration) gives no unit anything to apply.
    let Some(consumer) = object(modifier.get("consumer")) else {
        out.unsupported(
            "named-region-state without a consumer declares a region only; it is not modelled by the buff layer",
            node,
        );
        return;
    };
    let Some(filter) = consumer.get("beneficiary_filter") else {
        out.unsupported("named-region-state beneficiary filter is missing", node);
        return;
    };
    match super::conditions::matches_unit_filter(
        filter,
        opts.context,
        super::TranslationPerspective::Attacker,
        "friendly",
    ) {
        Some(false) => return,
        None => {
            out.unsupported(
                "named-region-state beneficiary filter cannot be evaluated against current attacker facts",
                node,
            );
            return;
        }
        Some(true) => {}
    }
    let Some(default_branch) = object(consumer.get("default_branch")) else {
        out.unsupported("named-region-state default branch is missing", node);
        return;
    };
    let effect = default_branch.get("effect").unwrap_or(&Value::Null);
    if let Some(condition) = consumer.get("attack_condition") {
        walk(
            &json!({"type": "conditional", "condition": condition, "effect": effect}),
            opts,
            out,
        );
    } else {
        walk(effect, opts, out);
    }
    if let Some(qualified) = object(consumer.get("qualified_branch")) {
        out.unsupported(
            "named-region-state qualified branch: region membership is unavailable in EngineContext; qualified replacement is unsupported",
            qualified,
        );
    }
}

/// A signed delta from `{operation, value}`: add/improve keep the sign, subtract/worsen flip it.
pub(super) fn signed_value(m: &Obj) -> Option<f64> {
    let value = finite(m.get("value"))?;
    match m.get("operation").and_then(Value::as_str) {
        Some("add" | "improve") => Some(value),
        Some("subtract" | "worsen") => Some(-value),
        _ => None,
    }
}

/// The AP delta: AP is stored negative, so "improve" is more negative and "worsen" less.
fn ap_delta(m: &Obj) -> Option<f64> {
    let value = finite(m.get("value"))?;
    match m.get("operation").and_then(Value::as_str) {
        Some("improve") => Some(-value.abs()),
        Some("worsen") => Some(value.abs()),
        Some("add") => Some(value),
        Some("subtract") => Some(-value),
        _ => None,
    }
}
