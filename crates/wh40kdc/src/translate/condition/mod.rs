//! Humanize an Ability-DSL / scoring `condition` into plain English — the Rust
//! mirror of `tools/src/translate/condition.ts`.
//!
//! Works on the condition's JSON form (`serde_json::Value`): a predicate
//! (`type` + `parameters`) or an and/or/not over predicates. Typed callers
//! serialize first (`serde_json::to_value`), so both ports read the same
//! structure. Output is **ASCII-only** with a fixed clause and parameter order,
//! pinned byte-for-byte against the TS oracle by the conformance corpus; any
//! phrasing change here is a semantic corpus change (bump `SPEC_VERSION`).

mod board;
mod history;
mod js;
mod leadin;
mod predicate;
mod refs;

use serde_json::Value;

pub(crate) use js::*;
pub use leadin::condition_lead_in_value;
use predicate::describe_predicate;
pub(crate) use refs::*;

/// A condition as a predicate phrase ("the unit is below starting strength and during your turn").
pub fn describe_condition_value(c: &Value) -> String {
    let ops = operands(c);
    match (operator(c), ops) {
        (Some("and"), Some(ops)) => ops
            .iter()
            .map(|o| {
                if operator(o) == Some("or") {
                    format!("({})", describe_condition_value(o))
                } else {
                    describe_condition_value(o)
                }
            })
            .collect::<Vec<_>>()
            .join(" and "),
        (Some("or"), Some(ops)) => ops
            .iter()
            .map(|o| {
                if operator(o) == Some("and") {
                    format!("({})", describe_condition_value(o))
                } else {
                    describe_condition_value(o)
                }
            })
            .collect::<Vec<_>>()
            .join(" or "),
        (Some("not"), Some(ops)) => {
            if ops.len() == 1 && ops[0].is_object() && !has_operator(&ops[0]) {
                return describe_predicate(&ops[0], true);
            }
            format!(
                "not ({})",
                ops.iter()
                    .map(describe_condition_value)
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        }
        _ => describe_predicate(c, false),
    }
}

/// Render a condition as a predicate on an already-named candidate unit, so selection
/// eligibility reads distinct from an ability's own condition ("that is not Battle-shocked").
pub fn describe_selection_eligibility_value(c: &Value) -> String {
    let single_not = operator(c) == Some("not") && operands(c).is_some_and(|o| o.len() == 1);
    let inner = if single_not {
        &operands(c).expect("checked")[0]
    } else {
        c
    };
    let ip = params(inner);
    if ctype(inner) == Some("unit-state")
        && is(ip, "state", "battle-shocked")
        && nn(ip, "subject").is_none()
    {
        return if single_not {
            "that is not Battle-shocked".to_string()
        } else {
            "that is Battle-shocked".to_string()
        };
    }
    if operator(c) == Some("and") && operands(c).is_some() {
        fn flat<'a>(n: &'a Value, out: &mut Vec<&'a Value>) {
            match (operator(n), operands(n)) {
                (Some("and"), Some(ops)) => ops.iter().for_each(|o| flat(o, out)),
                _ => out.push(n),
            }
        }
        let mut nodes = Vec::new();
        flat(c, &mut nodes);
        let parts: Vec<Option<String>> = nodes.into_iter().map(candidate_clause).collect();
        if parts.iter().all(Option::is_some) {
            return parts
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" and ");
        }
    }
    candidate_clause(c).unwrap_or_else(|| format!("if {}", describe_condition_value(c)))
}

/// A condition on the candidate as a relative clause ("that was hit…", "without \"MONSTER\""), else None.
fn candidate_clause(c: &Value) -> Option<String> {
    let phrase = describe_condition_value(c);
    for (from, to) in [
        ("the unit does not have ", "without "),
        ("the unit has not ", "that has not "),
        ("the unit has ", "with "),
        ("not the unit is ", "that is not "),
        ("the unit ", "that "),
    ] {
        if let Some(rest) = phrase.strip_prefix(from) {
            return Some(format!("{to}{rest}"));
        }
    }
    None
}
