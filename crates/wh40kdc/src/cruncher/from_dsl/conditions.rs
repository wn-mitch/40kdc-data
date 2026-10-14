//! The three-valued condition evaluator (`Some(true)`, `Some(false)`, `None` for unknown) and
//! the aura keyword-filter check. Mirrors the "Condition evaluator" section and
//! `evaluateKeywordFilter` of `tools/src/cruncher/from-dsl.ts`.

use serde_json::Value;

use super::js::*;
use super::TranslationPerspective;
use crate::cruncher::buffs::{AbilityKind, BuffSource, EngineContext};

/// The buffed unit: the ability's own unit (or model), or the unit an aura is applied to.
pub(super) fn is_buffed_unit(subject: Option<&Value>) -> bool {
    match subject {
        None | Some(Value::Null) => true,
        Some(s) => matches!(
            s.as_str(),
            Some("this-unit" | "ability-unit" | "this-model" | "recipient")
        ),
    }
}

/// The single, unrestricted keyword predicate a `matches` filter names.
pub(super) fn single_keyword(params: Option<&Obj>) -> Option<&str> {
    let filter = object(params?.get("filter"))?;
    if filter.len() != 1 {
        return None;
    }
    match list(filter.get("all_of")) {
        [only] => only.as_str(),
        _ => None,
    }
}

fn phase_name(ctx: &EngineContext) -> String {
    js_string(Some(
        &serde_json::to_value(ctx.phase).unwrap_or(Value::Null),
    ))
}

/// Evaluate a condition against the context; `None` is "unknown".
pub(crate) fn evaluate_condition(
    condition: &Obj,
    ctx: &EngineContext,
    perspective: TranslationPerspective,
) -> Option<bool> {
    evaluate_condition_for_source(condition, ctx, perspective, None)
}

pub(super) fn evaluate_condition_for_source(
    condition: &Obj,
    ctx: &EngineContext,
    perspective: TranslationPerspective,
    source: Option<&BuffSource>,
) -> Option<bool> {
    if let (Some(op), Some(operands)) = (
        condition.get("operator").and_then(Value::as_str),
        condition.get("operands").and_then(Value::as_array),
    ) {
        return evaluate_compound(op, operands, ctx, perspective, source);
    }
    let params = object(condition.get("parameters"));
    let empty = Obj::new();
    let p = params.unwrap_or(&empty);
    match condition.get("type").and_then(Value::as_str) {
        Some("phase-is") => {
            let wanted = p.get("phase").and_then(Value::as_str)?;
            Some(phase_name(ctx) == wanted)
        }
        Some("attack-is") => {
            if p.keys().any(|k| k != "attack_type") {
                return None;
            }
            match p.get("attack_type").and_then(Value::as_str) {
                Some("melee") => Some(phase_name(ctx) == "fight"),
                Some("ranged") => Some(phase_name(ctx) == "shooting"),
                _ => None,
            }
        }
        Some("timing-is") => {
            let wanted = p.get("timing").and_then(Value::as_str)?;
            Some(ctx.timing.as_deref()? == wanted)
        }
        Some("happened") => {
            let filter = object(p.get("filter"));
            let types = list(filter.and_then(|f| f.get("move_types")));
            let own = !p.contains_key("subject")
                && !p.contains_key("object")
                && !p.contains_key("count")
                && is_str(p, "window", "turn");
            if !own
                || !is_str(p, "event", "move-ended")
                || types.len() != 1
                || filter.map_or(0, |f| f.len()) != 1
            {
                return None;
            }
            // The buffed unit's own move this turn, as the context records it.
            match types[0].as_str() {
                Some("remain-stationary") => Some(ctx.attacker_stationary == Some(true)),
                Some("charge") => ctx.attacker_charged,
                _ => None,
            }
        }
        Some("attachment") => {
            let subject = p.get("subject");
            if p.get("with").is_some_and(|value| !value.is_null()) {
                return None;
            }
            let explicit_side = match subject.and_then(Value::as_str) {
                Some("attacker") => Some(TranslationPerspective::Attacker),
                Some("defender") => Some(TranslationPerspective::Target),
                None | Some("this-model" | "this-unit" | "ability-unit") => None,
                _ => return None,
            };
            let side = explicit_side.unwrap_or(perspective);
            let mut attached = if side == TranslationPerspective::Attacker {
                ctx.attacker_attached
            } else {
                ctx.target_attached
            };
            let mut role = if side == TranslationPerspective::Attacker {
                ctx.attacker_attachment_role
            } else {
                ctx.target_attachment_role
            };
            if explicit_side.is_none() {
                if let Some(BuffSource::Ability {
                    ability_kind,
                    source_unit_id,
                    ..
                }) = source
                {
                    if matches!(ability_kind, AbilityKind::Attached | AbilityKind::Support) {
                        role = source_unit_id
                            .as_ref()
                            .and_then(|id| ctx.attachment_roles.as_ref()?.get(id))
                            .copied();
                        attached = match ability_kind {
                            AbilityKind::Attached => Some(true),
                            AbilityKind::Support => role.map(|_| true),
                            _ => unreachable!(),
                        };
                    }
                }
            }
            if attached == Some(false) {
                return Some(false);
            }
            match p.get("role").and_then(Value::as_str) {
                Some("attached") => attached,
                Some("leading") => {
                    role.map(|role| role == crate::cruncher::buffs::AttachmentRole::Leader)
                }
                Some("led") if role == Some(crate::cruncher::buffs::AttachmentRole::Bodyguard) => {
                    Some(true)
                }
                _ => None,
            }
        }
        Some("matches") => {
            let subject = p.get("subject");
            let side = if subject.and_then(Value::as_str) == Some("defender") {
                TranslationPerspective::Target
            } else if subject.and_then(Value::as_str) == Some("attacker") {
                TranslationPerspective::Attacker
            } else if is_buffed_unit(subject) {
                perspective
            } else {
                return None;
            };
            matches_unit_filter(
                p.get("filter")?,
                ctx,
                side,
                if subject.and_then(Value::as_str) == Some("defender") {
                    "enemy"
                } else {
                    "friendly"
                },
            )
        }
        Some("army-faction") => {
            let faction = p.get("faction").and_then(Value::as_str)?;
            Some(ctx.army_faction.as_deref()? == faction)
        }
        Some("battle-size") => {
            let size = p.get("size").and_then(Value::as_str)?;
            Some(ctx.battle_size.as_deref()? == size)
        }
        Some("guided") => {
            // Guided is read for the attacking unit.
            let subject = p.get("subject");
            if subject.is_some() && !is_buffed_unit(subject) {
                return None;
            }
            ctx.attacker_guided
        }
        _ => None,
    }
}

/// Kleene three-valued `and` / `or` / `not`.
fn evaluate_compound(
    op: &str,
    operands: &[Value],
    ctx: &EngineContext,
    perspective: TranslationPerspective,
    source: Option<&BuffSource>,
) -> Option<bool> {
    if op == "not" {
        let first = object(operands.first())?;
        return evaluate_condition_for_source(first, ctx, perspective, source).map(|v| !v);
    }
    if op != "and" && op != "or" {
        return None;
    }
    let mut saw_unknown = false;
    for operand in operands {
        let Some(o) = operand.as_object() else {
            saw_unknown = true;
            continue;
        };
        match evaluate_condition_for_source(o, ctx, perspective, source) {
            None => saw_unknown = true,
            Some(false) if op == "and" => return Some(false),
            Some(true) if op == "or" => return Some(true),
            Some(_) => {}
        }
    }
    if saw_unknown {
        None
    } else {
        Some(op == "and")
    }
}

fn keyword_list(v: Option<&Value>) -> Option<Vec<&str>> {
    let a = v?.as_array()?;
    a.iter()
        .map(|k| k.as_str().filter(|s| !s.is_empty()))
        .collect()
}

/// Evaluate common keyword predicates without inventing board or model facts.
/// A false known conjunct wins; otherwise any spatial, state or membership
/// predicate keeps the result unknown. Model roles require actual membership,
/// never CHARACTER keywords or a unit's ability to lead.
pub(super) fn evaluate_keyword_filter(filter: &Value, keywords: Option<&[String]>) -> Option<bool> {
    evaluate_filter(filter, keywords, "friendly", None)
}

pub(crate) fn matches_unit_filter(
    filter: &Value,
    context: &EngineContext,
    side: TranslationPerspective,
    owner: &str,
) -> Option<bool> {
    let keywords = if side == TranslationPerspective::Attacker {
        context.attacker_keywords.as_deref()
    } else {
        context.target_keywords.as_deref()
    };
    evaluate_filter(filter, keywords, owner, Some((context, side)))
}

fn evaluate_filter(
    filter: &Value,
    keywords: Option<&[String]>,
    owner: &str,
    context: Option<(&EngineContext, TranslationPerspective)>,
) -> Option<bool> {
    let f = filter.as_object()?;
    let mut unknown = false;
    let pool_member = is_str(f, "member_of", "this-unit")
        || context.is_some_and(|(_, side)| {
            is_str(
                f,
                "member_of",
                if side == TranslationPerspective::Attacker {
                    "attacker"
                } else {
                    "defender"
                },
            )
        });
    for (key, value) in f {
        match key.as_str() {
            "all_of" | "any_of" | "none_of" | "not_all_of" => {
                let list = keyword_list(Some(value))?;
                if is_str(f, "level", "model") {
                    unknown = true;
                }
                if list.is_empty() {
                    continue;
                }
                let Some(keywords) = keywords else {
                    unknown = true;
                    continue;
                };
                let has = |keyword: &&str| {
                    let key = crate::scope::keyword_key(keyword);
                    keywords
                        .iter()
                        .any(|owned| crate::scope::keyword_key(owned) == key)
                };
                let holds = match key.as_str() {
                    "all_of" => list.iter().all(has),
                    "any_of" => list.iter().any(has),
                    "none_of" => !list.iter().any(has),
                    _ => !list.iter().all(has),
                };
                if !holds {
                    return Some(false);
                }
            }
            "any_of_filters" => {
                match evaluate_alternatives(value.as_array()?, keywords, owner, context) {
                    Some(false) => return Some(false),
                    None => unknown = true,
                    Some(true) => {}
                }
            }
            "unit_ids" => {
                let ids = keyword_list(Some(value))?;
                if !is_str(f, "level", "unit") || ids.is_empty() {
                    return None;
                }
                let identity = context.and_then(|(ctx, side)| match side {
                    TranslationPerspective::Attacker => ctx.attacker_unit_id.as_deref(),
                    TranslationPerspective::Target => ctx.target_unit_id.as_deref(),
                });
                match identity {
                    Some(identity) if !ids.contains(&identity) => return Some(false),
                    None => unknown = true,
                    _ => {}
                }
            }
            "owner" => {
                if !matches!(value.as_str()?, "any") && value.as_str()? != owner {
                    return Some(false);
                }
            }
            "level" if value.as_str() == Some("unit") => {}
            "level"
                if value.as_str() == Some("model")
                    && f.contains_key("attachment_role")
                    && pool_member => {}
            "member_of"
                if pool_member
                    && f.contains_key("attachment_role")
                    && is_str(f, "level", "model") => {}
            "attachment_role" if is_str(f, "level", "model") && pool_member => {
                let role = context.and_then(|(ctx, side)| {
                    if side == TranslationPerspective::Attacker {
                        ctx.attacker_attachment_role
                    } else {
                        ctx.target_attachment_role
                    }
                });
                match role {
                    Some(role) => {
                        let role = match role {
                            crate::cruncher::buffs::AttachmentRole::Leader => "leader",
                            crate::cruncher::buffs::AttachmentRole::Bodyguard => "bodyguard",
                        };
                        if value.as_str() != Some(role) {
                            return Some(false);
                        }
                    }
                    None => unknown = true,
                }
            }
            "state" if value.as_str() == Some("benefit-of-cover") => {
                match context.and_then(|(ctx, side)| {
                    if side == TranslationPerspective::Attacker {
                        ctx.attacker_in_cover
                    } else {
                        ctx.target_in_cover
                    }
                }) {
                    Some(false) => return Some(false),
                    None => unknown = true,
                    Some(true) => {}
                }
            }
            "within" => {
                let Some((ctx, side)) = context else {
                    unknown = true;
                    continue;
                };
                let other = if side == TranslationPerspective::Attacker {
                    "defender"
                } else {
                    "attacker"
                };
                if value.get("of").and_then(Value::as_str) != Some(other)
                    || value.get("wholly").and_then(Value::as_bool) == Some(true)
                {
                    unknown = true;
                    continue;
                }
                if value.get("range").and_then(Value::as_str) == Some("half-weapon") {
                    match ctx.within_half_range {
                        Some(false) => return Some(false),
                        None => unknown = true,
                        Some(true) => {}
                    }
                    continue;
                }
                let inches = value
                    .get("range")
                    .and_then(|range| range_inches(range, ctx.battle_round));
                match (inches, ctx.distance_inches) {
                    (Some(range), Some(distance)) if distance > range => return Some(false),
                    (Some(_), Some(_)) => {}
                    _ => unknown = true,
                }
            }
            _ => unknown = true,
        }
    }
    (!unknown).then_some(true)
}

fn evaluate_alternatives(
    alternatives: &[Value],
    keywords: Option<&[String]>,
    owner: &str,
    context: Option<(&EngineContext, TranslationPerspective)>,
) -> Option<bool> {
    let mut unknown = false;
    for alternative in alternatives {
        match evaluate_filter(alternative, keywords, owner, context) {
            Some(true) => return Some(true),
            None => unknown = true,
            Some(false) => {}
        }
    }
    (!unknown).then_some(false)
}

/// A tiered range uses the final supplied tier for every later battle round.
fn range_inches(range: &Value, battle_round: Option<u32>) -> Option<f64> {
    let range = if let Some(tiers) = range.get("per_battle_round").and_then(Value::as_array) {
        if tiers.is_empty() {
            return None;
        }
        &tiers[(battle_round?.saturating_sub(1) as usize).min(tiers.len() - 1)]
    } else {
        range
    };
    range.get("inches").and_then(Value::as_f64)
}
