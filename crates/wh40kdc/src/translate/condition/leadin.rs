//! Conditions as natural lead-in clauses ("while the unit is below its
//! starting strength", "against a unit that is not a MONSTER or VEHICLE").

use serde_json::Value;

use super::history::describe_happened;
use super::js::*;
use super::predicate::describe_predicate;
use super::refs::*;
use crate::translate::effect::title_case;

// ── Lead-ins ────────────────────────────────────────────────────────────────

/// "against a unit that is not a X or Y": the attack's target lacks every listed keyword.
pub(crate) fn negated_target_keywords(keywords: &[String]) -> String {
    format!("against a unit that is not a {}", keywords.join(" or "))
}

pub(crate) fn keyword_names(p: &P) -> String {
    if let Some(any) = strs(p.get("any_of")) {
        return or_list(&any);
    }
    and_list(&strs(p.get("all_of")).unwrap_or_default())
}

/// `^during the (\w+) battle round onward$` → `from the $1 battle round onward`.
pub(crate) fn onward_to_from(s: String) -> String {
    if let Some(mid) = s
        .strip_prefix("during the ")
        .and_then(|r| r.strip_suffix(" battle round onward"))
    {
        if !mid.is_empty() && mid.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return format!("from the {mid} battle round onward");
        }
    }
    s
}

/// A condition as a natural lead-in clause (lowercase-initial; the caller capitalizes at the
/// sentence boundary). Falls back to `if <condition>` for shapes without a dedicated framing.
pub fn condition_lead_in_value(c: &Value) -> String {
    match (operator(c), operands(c)) {
        (Some("and"), Some(ops)) => return join_lead_ins(ops),
        (Some("or"), Some(ops)) => {
            return ops
                .iter()
                .map(condition_lead_in_value)
                .collect::<Vec<_>>()
                .join(" or ")
        }
        (Some("not"), Some(ops)) => {
            if ops.len() == 1 && ops[0].is_object() && !has_operator(&ops[0]) {
                return negated_lead_in(&ops[0]);
            }
            return format!(
                "unless {}",
                ops.iter()
                    .map(|o| {
                        let l = condition_lead_in_value(o);
                        l.strip_prefix("if ").map(str::to_string).unwrap_or(l)
                    })
                    .collect::<Vec<_>>()
                    .join(" or ")
            );
        }
        _ => {}
    }
    let p = params(c);
    let pred = || describe_predicate(c, false);
    match ctype(c).unwrap_or("") {
        "phase-is" => {
            if st(p.get("phase")) == "command" {
                "during the Command phase".to_string()
            } else {
                format!("during the {} phase", title_case(&st(p.get("phase"))))
            }
        }
        "player-turn-is" | "battle-round" => onward_to_from(pred()),
        "rule-active" => format!("while the {} is active", id_label(p.get("rule"))),
        "has-keyword" => {
            if nn(p, "chosen_by").is_some() {
                return format!("if {}", pred());
            }
            if is(p, "subject", "defender") {
                return format!("against {} targets", keyword_names(p));
            }
            if nn(p, "subject").is_none() {
                let plural = p.get("any_of").is_some_and(Value::is_array)
                    || p.get("all_of")
                        .and_then(Value::as_array)
                        .is_some_and(|a| a.len() > 1);
                return format!(
                    "if the unit has the {} keyword{}",
                    keyword_names(p),
                    if plural { "s" } else { "" }
                );
            }
            format!("if {}", pred())
        }
        "attachment" => {
            if is(p, "role", "leading")
                && (is(p, "subject", "this-model") || nn(p, "subject").is_none())
            {
                let w = obj(p.get("with"));
                let kw = strs(w.get("all_of"))
                    .map(|k| format!("{} ", k.join(" ")))
                    .unwrap_or_default();
                return format!("while this model is leading a {kw}unit");
            }
            format!("while {}", pred())
        }
        "happened" => {
            let f = obj(p.get("filter"));
            let types: Vec<String> = strs(f.get("move_types")).unwrap_or_default();
            if is(p, "event", "move-ended")
                && is(p, "window", "turn")
                && types.len() == 1
                && nn(p, "subject").is_none()
            {
                match types[0].as_str() {
                    "charge" => return "if the unit charged this turn".to_string(),
                    "advance" => return "if the unit Advanced this turn".to_string(),
                    "remain-stationary" => {
                        return "if the unit Remained Stationary this turn".to_string()
                    }
                    _ => {}
                }
            }
            if is(p, "event", "disembarked") && nn(p, "subject").is_none() {
                return format!(
                    "if the unit disembarked from a Transport {}",
                    window_phrase(p.get("window"))
                )
                .trim_end()
                .to_string();
            }
            if (is(p, "event", "destroyed") || is(p, "event", "model-destroyed"))
                && is(p, "object", "event-object")
                && is(p, "window", "event")
            {
                return format!("when {}", describe_happened(p, false));
            }
            format!("if {}", describe_happened(p, false))
        }
        "resource" => {
            if p.get("below_max") == Some(&Value::Bool(true)) {
                format!("if {}", pred())
            } else {
                format!("while {}", pred())
            }
        }
        "strength" => {
            let s = pred();
            let s = match s.strip_suffix(" is below starting strength") {
                Some(head) => format!("{head} is below its starting strength"),
                None => s,
            };
            format!("while {s}")
        }
        "designated" => {
            let tag = st(p.get("tag"));
            if is(p, "subject", "defender") && tag == tag.to_uppercase() {
                return format!("against {tag} targets");
            }
            format!("while {}", pred())
        }
        "unit-state" | "wounds" | "owned-by" => format!("while {}", pred()),
        "attack-is" => {
            if p.get("all_target_same_unit") == Some(&Value::Bool(true)) {
                return format!("when {}", pred());
            }
            let s = pred();
            match s.strip_prefix("for ") {
                Some(rest) => format!("while making {rest}"),
                None => s,
            }
        }
        "attack-compare" => format!("when {}", pred()),
        "model-count" | "loadout" => format!("if {}", pred()),
        "within" | "in-region" => format!("while {}", pred()),
        _ => format!("if {}", pred()),
    }
}

pub(crate) fn negated_lead_in(c: &Value) -> String {
    let p = params(c);
    let t = ctype(c).unwrap_or("");
    if t == "same-unit" {
        return format!("if {}", describe_predicate(c, true));
    }
    if t == "has-keyword" && nn(p, "chosen_by").is_none() && is(p, "subject", "defender") {
        let kws =
            strs(p.get("any_of")).unwrap_or_else(|| strs(p.get("all_of")).unwrap_or_default());
        return negated_target_keywords(&kws);
    }
    if t == "has-keyword"
        && nn(p, "chosen_by").is_none()
        && (nn(p, "subject").is_none() || is(p, "subject", "recipient"))
    {
        return format!("unless the unit has the {} keyword", keyword_names(p));
    }
    if t == "unit-state" || t == "designated" || t == "owned-by" {
        return format!("while {}", describe_predicate(c, true));
    }
    let lead = condition_lead_in_value(c);
    for word in ["if ", "while ", "when "] {
        if let Some(rest) = lead.strip_prefix(word) {
            return format!("unless {rest}");
        }
    }
    format!("unless {lead}")
}

/// The keyword of `not(has-keyword <subject> X)` with a single keyword, else None.
pub(crate) fn not_keyword(op: &Value, subject: &str) -> Option<String> {
    if operator(op) != Some("not") {
        return None;
    }
    let ops = operands(op)?;
    if ops.len() != 1 {
        return None;
    }
    let inner = &ops[0];
    let p = params(inner);
    if ctype(inner) != Some("has-keyword") || !is(p, "subject", subject) {
        return None;
    }
    let all = p.get("all_of").and_then(Value::as_array)?;
    if all.len() != 1 {
        return None;
    }
    Some(st(Some(&all[0])))
}

/// A bare single-keyword `has-keyword` on the ability's own unit, else None.
pub(crate) fn own_keyword(op: &Value) -> Option<String> {
    let p = params(op);
    if ctype(op) != Some("has-keyword") || nn(p, "subject").is_some() {
        return None;
    }
    let all = p.get("all_of").and_then(Value::as_array)?;
    if all.len() != 1 {
        return None;
    }
    Some(st(Some(&all[0])))
}

/// Join the operands of an `and` lead-in. Runs of keyword exclusions collapse into one clause:
/// on the attack's target, "against a unit that is not a X or Y"; on the unit an aura or effect
/// is applied to, "(excluding X or Y units)". Either attaches to the preceding clause with a
/// space; a run of the unit's own keywords reads "if the unit is a X Y unit"; all other operands
/// join with ", ".
pub(crate) fn join_lead_ins(ops: &[Value]) -> String {
    let run = |mut i: usize, pick: &dyn Fn(&Value) -> Option<String>| -> (Vec<String>, usize) {
        let mut kws = Vec::new();
        while i < ops.len() {
            match pick(&ops[i]) {
                Some(kw) => {
                    kws.push(kw);
                    i += 1;
                }
                None => break,
            }
        }
        (kws, i)
    };
    let mut parts: Vec<String> = Vec::new();
    let mut i = 0;
    while i < ops.len() {
        let op = &ops[i];
        if not_keyword(op, "defender").is_some() {
            let (kws, next) = run(i, &|o| not_keyword(o, "defender"));
            parts.push(negated_target_keywords(&kws));
            i = next;
            continue;
        }
        if not_keyword(op, "recipient").is_some() {
            let (kws, next) = run(i, &|o| not_keyword(o, "recipient"));
            parts.push(format!(
                "(excluding {} units)",
                kws.iter()
                    .map(|k| cap_word(k))
                    .collect::<Vec<_>>()
                    .join(" or ")
            ));
            i = next;
            continue;
        }
        if own_keyword(op).is_some() {
            let (kws, next) = run(i, &own_keyword);
            parts.push(if kws.len() >= 2 {
                format!("if the unit is {} {} unit", article(&kws[0]), kws.join(" "))
            } else {
                format!("if the unit has the {} keyword", kws[0])
            });
            i = next;
            continue;
        }
        parts.push(condition_lead_in_value(op));
        i += 1;
    }
    let mut acc = String::new();
    for part in parts {
        // A second keyword gate on the same target narrows it: "against ORKS targets that are also VEHICLE".
        let target = part
            .strip_prefix("against ")
            .and_then(|r| r.strip_suffix(" targets"))
            .filter(|t| !t.is_empty());
        if acc.is_empty() {
            acc = part;
        } else if let Some(target) = target.filter(|_| {
            acc.ends_with(" targets") && (acc.starts_with("against ") || acc.contains(", against "))
        }) {
            acc = format!("{acc} that are also {target}");
        } else if part.starts_with("against ") || part.starts_with("(excluding ") {
            acc = format!("{acc} {part}");
        } else {
            acc = format!("{acc}, {part}");
        }
    }
    acc
}
