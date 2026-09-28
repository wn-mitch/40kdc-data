//! The three-valued condition evaluator (`Some(true)`, `Some(false)`, `None` for unknown) and
//! the aura keyword-filter check. Mirrors the "Condition evaluator" section and
//! `evaluateKeywordFilter` of `tools/src/cruncher/from-dsl.ts`.

use serde_json::Value;

use super::js::*;
use crate::cruncher::buffs::EngineContext;

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

/// The one keyword a `has-keyword` names, else `None`.
pub(super) fn single_keyword(params: Option<&Obj>) -> Option<&str> {
    let params = params?;
    if present(params, "any_of").is_some() {
        return None;
    }
    match list(params.get("all_of")) {
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
pub(super) fn evaluate_condition(condition: &Obj, ctx: &EngineContext) -> Option<bool> {
    if let (Some(op), Some(operands)) = (
        condition.get("operator").and_then(Value::as_str),
        condition.get("operands").and_then(Value::as_array),
    ) {
        return evaluate_compound(op, operands, ctx);
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
                && !p.contains_key("count_min")
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
        Some("has-keyword") => {
            // A keyword the player picked is not in the context.
            if present(p, "chosen_by").is_some() {
                return None;
            }
            let subject = p.get("subject");
            let defender = subject.and_then(Value::as_str) == Some("defender");
            let pool = if defender {
                ctx.target_keywords.as_ref()
            } else if is_buffed_unit(subject) {
                ctx.attacker_keywords.as_ref()
            } else {
                return None;
            };
            let have: Vec<String> = pool
                .map(|k| k.iter().map(|x| x.to_lowercase()).collect())
                .unwrap_or_default();
            let all = list(p.get("all_of"));
            let any = list(p.get("any_of"));
            if !all.iter().chain(any).all(Value::is_string) {
                return None;
            }
            let has = |k: &Value| have.contains(&js_string(Some(k)).to_lowercase());
            Some(all.iter().all(has) && (any.is_empty() || any.iter().any(has)))
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
        Some("attachment") => {
            // True whenever the buffed unit is a combined unit; a Leader filter is not checked.
            if is_str(p, "role", "led") || present(p, "with").is_some() {
                return None;
            }
            ctx.attacker_attached
        }
        _ => None,
    }
}

/// Kleene three-valued `and` / `or` / `not`.
fn evaluate_compound(op: &str, operands: &[Value], ctx: &EngineContext) -> Option<bool> {
    if op == "not" {
        let first = object(operands.first())?;
        return evaluate_condition(first, ctx).map(|v| !v);
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
        match evaluate_condition(o, ctx) {
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

/// A recipient keyword filter against `keywords`; `None` when the filter is malformed or the
/// keywords are unavailable. Emitter identity is not part of the context.
pub(super) fn evaluate_keyword_filter(filter: &Value, keywords: Option<&[String]>) -> Option<bool> {
    let f = filter.as_object()?;
    let required = keyword_list(f.get("required_keywords")).filter(|r| !r.is_empty())?;
    let excluded = match f.get("excluded_keywords") {
        None => None,
        Some(v) => Some(keyword_list(Some(v)).filter(|e| !e.is_empty())?),
    };
    let keywords = keywords?;
    if keywords.iter().any(String::is_empty) {
        return None;
    }
    if f.keys()
        .any(|k| k != "required_keywords" && k != "excluded_keywords")
    {
        return None;
    }
    let includes = |k: &str| keywords.iter().any(|c| c.eq_ignore_ascii_case(k));
    if !required.iter().all(|k| includes(k)) {
        return Some(false);
    }
    if excluded.is_some_and(|e| e.iter().any(|k| includes(k))) {
        return Some(false);
    }
    Some(true)
}
