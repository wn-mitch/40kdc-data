//! The leaf translators: re-rolls, roll and characteristic modifiers, feel-no-pain, weapon
//! keyword grants, damage reduction, invulnerable saves and a named region's default branch.
//! Mirrors the "Leaf translators" section of `tools/src/cruncher/from-dsl.ts`.

use serde_json::{json, Value};

use super::js::*;
use super::TranslationPerspective::{Attacker, Target};
use super::{applies_to_buffed_unit, buff, classify_target, walk, Out, Side, WalkOpts};
use crate::cruncher::buffs::WeaponKeywordRef;

/// Narrowing keys that scope a buff to a named weapon or a model subset the cruncher cannot
/// resolve here; applying the buff unfiltered would over-apply it.
const UNHONORABLE_NARROWING: &[&str] = &[
    "weapon_name",
    "weapon_profile",
    "weapon_keyword",
    "weapon_ref",
    "weapon_filter",
    "model_filter",
    "model_scope",
];

fn unhonorable_narrowing(m: &Obj) -> Option<&'static str> {
    UNHONORABLE_NARROWING
        .iter()
        .copied()
        .find(|k| present(m, k).is_some())
}

/// A roll kind for a diagnostic: "hit", or the ability whose dice it is.
fn roll_label(roll: Option<&Value>) -> String {
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
    // A `value: 1` on a re-roll unambiguously means "re-roll rolls of 1".
    let one = Value::from("ones");
    let subset = if m.get("value").and_then(Value::as_f64) == Some(1.0) {
        Some(&one)
    } else {
        m.get("subset")
    };
    if opts.perspective == Target && roll.and_then(Value::as_str) != Some("save") {
        return;
    }
    // A finite permission is non-linear over a roll pool; an uncapped reroll would overstate it.
    if m.contains_key("count") {
        out.unsupported(
            "re-roll: count-capped permissions are not modelled by the expected-value engine",
            node,
        );
        return;
    }
    let r = roll.and_then(Value::as_str);
    let s = subset.and_then(Value::as_str);
    if matches!(r, Some("hit" | "wound" | "save" | "damage"))
        && matches!(s, Some("ones" | "all-failures"))
    {
        out.applied.push(buff(
            opts,
            json!({ "type": "reroll", "roll": r, "subset": s }),
        ));
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
    if opts.perspective == Attacker {
        if !applies_to_buffed_unit(node, Attacker) || r == Some("save") {
            return;
        }
    } else {
        // The buffed unit's own saves, or a penalty to the incoming attacker's hit/wound rolls.
        match classify_target(node) {
            Side::Attacker if matches!(r, Some("hit" | "wound")) => {}
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
    out.applied
        .push(buff(opts, json!({ "type": ty, "value": value })));
}

/// `attack_type` (or `weapon_type`) melee/ranged as the phase that attack happens in.
fn attack_type_applicability(m: &Obj) -> Option<Value> {
    let kind = present(m, "attack_type").or_else(|| m.get("weapon_type"));
    phase_gate(kind.and_then(Value::as_str))
}

fn phase_gate(kind: Option<&str>) -> Option<Value> {
    match kind {
        Some("melee") => Some(json!({ "phases": ["fight"] })),
        Some("ranged") => Some(json!({ "phases": ["shooting"] })),
        _ => None,
    }
}

fn emit(opts: &WalkOpts, out: &mut Out, gate: &Option<Value>, contribution: Value) {
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
    let gate = attack_type_applicability(m);
    match stat.and_then(Value::as_str) {
        // AP is stored negative and has offensive/defensive variants.
        Some("AP") => {
            if classify_target(node) == Side::Attacker {
                out.unsupported(
                    "stat-modifier AP on the attacker: defender-side AP reduction is not modelled by the buff layer",
                    node,
                );
                return;
            }
            if opts.perspective != Attacker || !applies_to_buffed_unit(node, Attacker) {
                return;
            }
            match ap_delta(m) {
                Some(d) => emit(opts, out, &gate, json!({ "type": "ap-mod", "value": d })),
                None => out.unsupported(
                    format!(
                        "stat-modifier AP: operation \"{}\" not supported",
                        js_string(m.get("operation"))
                    ),
                    node,
                ),
            }
            return;
        }
        // Ballistic Skill on the attacker penalises incoming hit rolls: a hit-mod when targeted.
        Some("BS") => {
            if opts.perspective != Target || classify_target(node) != Side::Attacker {
                return;
            }
            if let Some(bs) = signed_value(m) {
                out.applied
                    .push(buff(opts, json!({ "type": "hit-mod", "value": bs })));
            }
            return;
        }
        _ => {}
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
        // "+1 Sv" improves the save: a save-mod of -value on the needed roll.
        Some("Sv") => {
            if opts.perspective != Target {
                out.unsupported(
                    "stat-modifier Sv: defender-side stat; applies when the buffed unit is the target",
                    node,
                );
            } else if on_buffed {
                emit(
                    opts,
                    out,
                    &gate,
                    json!({ "type": "save-mod", "value": -value }),
                );
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
    if opts.perspective != Target {
        return;
    }
    let Some(m) = object(node.get("modifier")) else {
        out.unsupported("feel-no-pain: missing modifier object", node);
        return;
    };
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
    out.applied.push(buff(opts, contribution));
}

pub(super) fn keyword_grant(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    // Weapon-keyword grants ride with the attacker's profile.
    if opts.perspective != Attacker || !applies_to_buffed_unit(node, Attacker) {
        return;
    }
    let Some(m) = object(node.get("modifier")) else {
        return;
    };
    let raws: Vec<&str> = list(m.get("abilities"))
        .iter()
        .filter_map(Value::as_str)
        .collect();
    let gate = phase_gate(m.get("weapon_type").and_then(Value::as_str));
    for raw in raws {
        let Some(r) = parse_keyword_grant(raw) else {
            out.unsupported.push((
                format!("keyword-grant: cannot parse \"{raw}\" to a catalog keyword"),
                json!({ "keyword": raw }),
            ));
            continue;
        };
        let ref_json = serde_json::to_value(&r).expect("a keyword ref serializes");
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
    let reduction = m.get("reduction");
    if let Some(r) = reduction
        .and_then(Value::as_f64)
        .filter(|r| r.is_finite() && *r > 0.0)
    {
        out.applied.push(buff(
            opts,
            json!({ "type": "damage-reduction", "value": r }),
        ));
        return;
    }
    if let Some(r @ ("half" | "to-zero")) = reduction.and_then(Value::as_str) {
        out.unsupported(
            format!("damage-reduction: \"{r}\" is a one-use ablation effect, not modelled by the expected-value engine"),
            node,
        );
        return;
    }
    out.unsupported(
        format!(
            "damage-reduction: unrecognised reduction \"{}\"",
            js_string(reduction)
        ),
        node,
    );
}

pub(super) fn invulnerable_save(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    if opts.perspective != Target || !applies_to_buffed_unit(node, Target) {
        return;
    }
    let Some(m) = object(node.get("modifier")) else {
        out.unsupported("invulnerable-save: missing modifier object", node);
        return;
    };
    match finite(m.get("invuln_sv")).filter(|t| (2.0..=7.0).contains(t)) {
        Some(t) => out.applied.push(buff(
            opts,
            json!({ "type": "invulnerable-save", "threshold": t }),
        )),
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
    let consumer = object(modifier.get("consumer")).unwrap_or(&empty);
    let gate = object(consumer.get("beneficiary_gate"));
    let keywords: Vec<&str> = gate
        .map(|g| {
            list(g.get("keywords"))
                .iter()
                .filter_map(Value::as_str)
                .collect()
        })
        .unwrap_or_default();
    let operator = gate.and_then(|g| g.get("operator")).and_then(Value::as_str);
    let attacker = opts.context.attacker_keywords.as_ref();
    let (Some(op @ ("and" | "or")), Some(attacker)) = (operator, attacker) else {
        out.unsupported(
            "named-region-state beneficiary gate cannot be evaluated against current attacker keywords",
            node,
        );
        return;
    };
    if keywords.is_empty() {
        out.unsupported(
            "named-region-state beneficiary gate cannot be evaluated against current attacker keywords",
            node,
        );
        return;
    }
    let current: Vec<String> = attacker.iter().map(|k| k.to_lowercase()).collect();
    let has = |k: &&str| current.contains(&k.to_lowercase());
    let eligible = if op == "and" {
        keywords.iter().all(has)
    } else {
        keywords.iter().any(has)
    };
    if !eligible {
        return;
    }
    let Some(default_branch) = object(consumer.get("default_branch")) else {
        out.unsupported("named-region-state default branch is missing", node);
        return;
    };
    walk(
        default_branch.get("effect").unwrap_or(&Value::Null),
        opts,
        out,
    );
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

/// Parse a printed weapon keyword (`"Sustained Hits 1"`, `"Anti-INFANTRY 4+"`, `"Lethal Hits"`)
/// into a catalog reference, or `None` for an empty string. Mirrors TS `parseKeywordGrant`.
pub fn parse_keyword_grant(raw: &str) -> Option<WeaponKeywordRef> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some((target, threshold)) = anti_parts(trimmed) {
        return Some(WeaponKeywordRef {
            keyword_id: "anti".to_string(),
            parameters: Some(json!({
                "target_keyword": target.trim(),
                "threshold": threshold,
            })),
        });
    }
    if let Some((name, n)) = value_parts(trimmed) {
        return Some(WeaponKeywordRef {
            keyword_id: to_kebab_case(name),
            parameters: Some(json!({ "value": n })),
        });
    }
    Some(WeaponKeywordRef {
        keyword_id: to_kebab_case(trimmed),
        parameters: None,
    })
}

/// `/^anti-([A-Z][A-Z\s-]*)\s+(\d+)\+?$/i`.
fn anti_parts(s: &str) -> Option<(&str, u64)> {
    if !s.get(..5)?.eq_ignore_ascii_case("anti-") {
        return None;
    }
    let rest = &s[5..];
    let body = rest.strip_suffix('+').unwrap_or(rest);
    let digits_start = body.rfind(|c: char| !c.is_ascii_digit())? + 1;
    let digits = &body[digits_start..];
    if digits.is_empty() {
        return None;
    }
    let head = &body[..digits_start];
    let target = head.trim_end_matches(char::is_whitespace);
    if target.len() == head.len() || target.is_empty() {
        return None;
    }
    let mut chars = target.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_alphabetic());
    let rest_ok = chars.all(|c| c.is_ascii_alphabetic() || c.is_whitespace() || c == '-');
    if !first_ok || !rest_ok {
        return None;
    }
    Some((target, digits.parse().ok()?))
}

/// `/^(.+?)\s+(\d+)$/`: the shortest name before whitespace and a trailing number.
fn value_parts(s: &str) -> Option<(&str, u64)> {
    let digits_start = s.rfind(|c: char| !c.is_ascii_digit())? + 1;
    let digits = &s[digits_start..];
    if digits.is_empty() {
        return None;
    }
    let head = &s[..digits_start];
    let name = head.trim_end_matches(char::is_whitespace);
    if name.len() == head.len() || name.is_empty() {
        return None;
    }
    Some((name, digits.parse().ok()?))
}

fn to_kebab_case(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut dashed = String::new();
    let mut in_run = false;
    for c in lower.chars() {
        if c.is_whitespace() || c == '_' {
            if !in_run {
                dashed.push('-');
            }
            in_run = true;
        } else {
            dashed.push(c);
            in_run = false;
        }
    }
    dashed
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-')
        .collect()
}
