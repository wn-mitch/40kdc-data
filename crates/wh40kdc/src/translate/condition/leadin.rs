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

/// Whether an effect protects the unit being attacked (a save, Feel No Pain, damage
/// reduction, its Save or Toughness): an attack condition on it is the incoming attack.
pub fn is_defensive_effect(e: &Value) -> bool {
    match e.get("type").and_then(Value::as_str) {
        Some("invulnerable-save" | "feel-no-pain" | "damage-reduction") => true,
        Some("stat-modifier") => matches!(
            e.get("modifier")
                .and_then(|m| m.get("stat"))
                .and_then(Value::as_str),
            Some("Sv" | "T")
        ),
        _ => false,
    }
}

/// A condition as a natural lead-in clause (lowercase-initial; the caller capitalizes at the
/// sentence boundary). Falls back to `if <condition>` for shapes without a dedicated framing.
pub fn condition_lead_in_value(c: &Value) -> String {
    condition_lead_in_for(c, false)
}

/// [`condition_lead_in_value`], with `defending` framing attack conditions from the attacked
/// unit's side ("against ranged attacks"), for a condition gating a defensive effect.
pub fn condition_lead_in_for(c: &Value, defending: bool) -> String {
    match (operator(c), operands(c)) {
        (Some("and"), Some(ops)) => return join_lead_ins(ops, defending),
        (Some("or"), Some(ops)) => {
            return ops
                .iter()
                .map(|o| condition_lead_in_for(o, defending))
                .collect::<Vec<_>>()
                .join(" or ")
        }
        (Some("not"), Some(ops)) => {
            if ops.len() == 1 && ops[0].is_object() && !has_operator(&ops[0]) {
                return negated_lead_in(&ops[0], defending);
            }
            return format!(
                "unless {}",
                ops.iter()
                    .map(|o| {
                        let l = condition_lead_in_for(o, defending);
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
        "rule-active" => format!("while the {} is active", rule_ref_phrase(p.get("rule"))),
        "matches" => matches_lead_in(c, false),
        "has-keyword" => format!("if {}", pred()),
        "attachment" => {
            if is(p, "role", "leading")
                && (is(p, "subject", "this-model") || nn(p, "subject").is_none())
            {
                let predicate = pred();
                return format!(
                    "while {}",
                    predicate
                        .strip_prefix("the model")
                        .map(|rest| format!("this model{rest}"))
                        .unwrap_or(predicate)
                );
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
            if is(p, "event", "disembarked")
                && nn(p, "subject").is_none()
                && nn(f, "transport").is_none()
            {
                return format!(
                    "if the unit disembarked from a Transport {}",
                    window_phrase(p.get("window"))
                )
                .trim_end()
                .to_string();
            }
            // "while the unit is performing an Agile Manoeuvre": the use is being resolved now.
            if is(p, "event", "used")
                && is(p, "window", "event")
                && nn(f, "ability_keyword").is_none()
                && nn(f, "same_rule_as").is_none()
            {
                return format!("while {}", describe_happened(p, false));
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
        "unit-state" | "wounds" => format!("while {}", pred()),
        "attack-is" => {
            if p.get("all_target_same_unit") == Some(&Value::Bool(true)) {
                return format!("when {}", pred());
            }
            let s = pred();
            match s.strip_prefix("for ") {
                Some(rest) if defending => format!("against {rest}"),
                Some(rest) => format!("while making {rest}"),
                None => s,
            }
        }
        "attack-compare" => format!("when {}", pred()),
        "model-count" | "loadout" | "equipped-weapon-count" | "named-weapon" | "unit-wargear" => {
            format!("if {}", pred())
        }
        "within" | "in-region" => format!("while {}", pred()),
        _ => format!("if {}", pred()),
    }
}

pub(crate) fn negated_lead_in(c: &Value, defending: bool) -> String {
    let t = ctype(c).unwrap_or("");
    if t == "same-unit" {
        return format!("if {}", describe_predicate(c, true));
    }
    if t == "matches" {
        return matches_lead_in(c, true);
    }
    if t == "unit-state" || t == "designated" {
        return format!("while {}", describe_predicate(c, true));
    }
    let lead = condition_lead_in_for(c, defending);
    for word in ["if ", "while ", "when "] {
        if let Some(rest) = lead.strip_prefix(word) {
            return format!("unless {rest}");
        }
    }
    format!("unless {lead}")
}

/// A single canonical keyword filter used for compact lead-in grouping.
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
    let f = obj(p.get("filter"));
    if ctype(inner) != Some("matches") || !is(p, "subject", subject) || key_count(f) != 1 {
        return None;
    }
    let all = f.get("all_of").and_then(Value::as_array)?;
    if all.len() != 1 {
        return None;
    }
    Some(st(Some(&all[0])))
}

/// A bare single-keyword filter on the ability's own unit, else None.
pub(crate) fn own_keyword(op: &Value) -> Option<String> {
    let p = params(op);
    let f = obj(p.get("filter"));
    if ctype(op) != Some("matches") || nn(p, "subject").is_some() || key_count(f) != 1 {
        return None;
    }
    let all = f.get("all_of").and_then(Value::as_array)?;
    if all.len() != 1 {
        return None;
    }
    Some(st(Some(&all[0])))
}

fn matches_lead_in(c: &Value, negated: bool) -> String {
    let p = params(c);
    let f = obj(p.get("filter"));
    let keys = f
        .iter()
        .filter(|(key, value)| key.as_str() != "level" && !value.is_null())
        .count();
    if keys == 1 && (nn(f, "all_of").is_some() || nn(f, "any_of").is_some()) {
        if is(p, "subject", "defender") {
            if negated
                && nn(f, "any_of").is_none()
                && f.get("all_of")
                    .and_then(Value::as_array)
                    .is_some_and(|words| words.len() > 1)
            {
                return format!(
                    "against a unit that does not have all of {}",
                    keyword_names(f)
                );
            }
            return if negated {
                negated_target_keywords(
                    &strs(f.get("any_of"))
                        .unwrap_or_else(|| strs(f.get("all_of")).unwrap_or_default()),
                )
            } else {
                format!("against {} targets", keyword_names(f))
            };
        }
        if nn(p, "subject").is_none() || (negated && is(p, "subject", "recipient")) {
            let plural = !negated
                && (f.get("any_of").is_some_and(Value::is_array)
                    || f.get("all_of")
                        .and_then(Value::as_array)
                        .is_some_and(|words| words.len() > 1));
            return format!(
                "{} the unit has the {} keyword{}",
                if negated { "unless" } else { "if" },
                keyword_names(f),
                if plural { "s" } else { "" }
            );
        }
        return format!(
            "{} {}",
            if negated { "unless" } else { "if" },
            describe_predicate(c, false)
        );
    }
    if keys == 1 && nn(f, "designated").is_some() && is(p, "subject", "defender") && !negated {
        let tag = st(f.get("designated"));
        if tag == tag.to_uppercase() {
            return format!("against {tag} targets");
        }
    }
    format!("while {}", describe_predicate(c, negated))
}

/// Join the operands of an `and` lead-in. Runs of keyword exclusions collapse into one clause:
/// on the attack's target, "against a unit that is not a X or Y"; on the unit an aura or effect
/// is applied to, "(excluding X or Y units)". Either attaches to the preceding clause with a
/// space; a run of the unit's own keywords reads "if the unit is a X Y unit"; all other operands
/// join with ", ".
pub(crate) fn join_lead_ins(ops: &[Value], defending: bool) -> String {
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
        parts.push(condition_lead_in_for(op, defending));
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
        } else if (part.starts_with("against ") && !is_incoming_attack(&part))
            || part.starts_with("(excluding ")
        {
            // A target narrowing attaches to the clause before it; an incoming attack is its own clause.
            acc = format!("{acc} {part}");
        } else {
            acc = format!("{acc}, {part}");
        }
    }
    acc
}

/// `^against [a-z -]*attacks( |$)`: an incoming-attack lead-in ("against ranged attacks").
fn is_incoming_attack(part: &str) -> bool {
    let Some(rest) = part.strip_prefix("against ") else {
        return false;
    };
    rest.match_indices("attacks").any(|(i, _)| {
        let after = &rest[i + "attacks".len()..];
        rest[..i]
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b == b' ' || b == b'-')
            && (after.is_empty() || after.starts_with(' '))
    })
}
