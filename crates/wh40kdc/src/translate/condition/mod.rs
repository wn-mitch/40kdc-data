//! Humanize an Ability-DSL / scoring `condition` into plain English — the Rust
//! mirror of `tools/src/translate/condition.ts`.
//!
//! Works on the condition's JSON form (`serde_json::Value`): a predicate
//! (`type` + `parameters`) or an and/or/not over predicates. Typed callers
//! serialize first (`serde_json::to_value`), so both ports read the same
//! structure. Output is **ASCII-only** with a fixed clause and parameter order,
//! pinned byte-for-byte against the TS oracle by the conformance corpus; any
//! phrasing change here is a semantic corpus change (bump `SPEC_VERSION`).
//!
//! Ordinary predicates use `matches` and the shared unit filter. Attachment roles identify
//! actual model membership, and spatial predicates retain their explicit observers and origins.
//! Specialized historical/count predicates remain separate; snapshot observation is not activation.

mod board;
mod equipment;
mod filter_predicate;
mod history;
mod js;
mod leadin;
mod predicate;
pub(crate) use predicate::step_window;
mod refs;

use serde_json::Value;

pub(crate) use js::*;
pub use leadin::{condition_lead_in_for, condition_lead_in_value, is_defensive_effect};
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
            // not(not(X)) reads as X, never "not (… is not …)".
            if ops.len() == 1 && operator(&ops[0]) == Some("not") {
                if let Some([inner]) = operands(&ops[0]).map(Vec::as_slice) {
                    return describe_condition_value(inner);
                }
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
    if ctype(inner) == Some("matches")
        && is(obj(ip.get("filter")), "state", "battle-shocked")
        && key_count(obj(ip.get("filter"))) == 1
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
        let mut parts = Vec::new();
        for op in nodes {
            if operator(op) == Some("or") {
                if let Some(or_ops) = operands(op) {
                    let or_parts: Vec<Option<String>> =
                        or_ops.iter().map(candidate_clause).collect();
                    if or_parts.iter().all(Option::is_some) {
                        let unwrapped: Vec<String> = or_parts.into_iter().flatten().collect();
                        parts.push(format!("that ({})", join_relative(&unwrapped, "or")));
                        continue;
                    }
                    return format!("if {}", describe_condition_value(c));
                }
            }
            match candidate_clause(op) {
                Some(clause) => parts.push(clause),
                None => return format!("if {}", describe_condition_value(c)),
            }
        }
        return join_relative(&parts, "and");
    }
    if operator(c) == Some("or") {
        if let Some(ops) = operands(c) {
            let parts: Vec<Option<String>> = ops.iter().map(candidate_clause).collect();
            if parts.iter().all(Option::is_some) {
                let unwrapped: Vec<String> = parts.into_iter().flatten().collect();
                return join_relative(&unwrapped, "or");
            }
        }
    }
    candidate_clause(c).unwrap_or_else(|| format!("if {}", describe_condition_value(c)))
}

fn without_keyword(s: &str) -> Option<&str> {
    let mid = s.strip_prefix("without the ")?.strip_suffix(" keyword")?;
    if !mid.is_empty()
        && mid
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b' ' || b == b'-')
    {
        Some(mid)
    } else {
        None
    }
}

/// Join relative clauses cleanly, collapsing repeated "that is " / "without the X keyword" runs.
fn join_relative(parts: &[String], conj: &str) -> String {
    if parts.len() <= 1 {
        return parts.first().cloned().unwrap_or_default();
    }
    let mut merged: Vec<String> = Vec::new();
    if conj == "and" {
        let mut i = 0;
        while i < parts.len() {
            if let Some(kw) = without_keyword(&parts[i]) {
                let mut kws = vec![kw.to_string()];
                let mut j = i + 1;
                while j < parts.len() {
                    if let Some(next) = without_keyword(&parts[j]) {
                        kws.push(next.to_string());
                        j += 1;
                    } else {
                        break;
                    }
                }
                if kws.len() > 1 {
                    merged.push(format!("without the {} keyword", or_list(&kws)));
                } else {
                    merged.push(parts[i].clone());
                }
                i = j;
                continue;
            }
            merged.push(parts[i].clone());
            i += 1;
        }
    } else {
        merged.extend(parts.iter().cloned());
    }
    if merged.iter().all(|p| p.starts_with("that is ")) {
        let rest: Vec<String> = merged
            .iter()
            .map(|p| p["that is ".len()..].to_string())
            .collect();
        return format!(
            "that is {}",
            if conj == "and" {
                and_list(&rest)
            } else {
                or_list(&rest)
            }
        );
    }
    let deduped: Vec<String> = merged
        .iter()
        .enumerate()
        .map(|(idx, p)| {
            if idx > 0 {
                if let (Some(rest), true) = (
                    p.strip_prefix("that is "),
                    merged[idx - 1].starts_with("that is "),
                ) {
                    return rest.to_string();
                }
                if let (Some(rest), true) = (
                    p.strip_prefix("that "),
                    merged[idx - 1].starts_with("that "),
                ) {
                    return rest.to_string();
                }
            }
            p.clone()
        })
        .collect();
    deduped.join(&format!(" {conj} "))
}

/// A condition on the candidate as a relative clause ("that was hit…", "without the MONSTER keyword"), else None.
fn candidate_clause(c: &Value) -> Option<String> {
    if matches!(operator(c), Some("and" | "or")) {
        return None;
    }
    let phrase = describe_condition_value(c);
    for subj in [
        "this unit",
        "the unit",
        "the selected unit",
        "the selected model",
    ] {
        for (from, to) in [
            (format!("{subj} is not the same unit as "), "other than "),
            (format!("{subj} does not have "), "without "),
            (format!("{subj} has not "), "that has not "),
            (format!("{subj} has "), "with "),
            (format!("not {subj} is "), "that is not "),
            (format!("{subj} "), "that "),
        ] {
            if let Some(rest) = phrase.strip_prefix(&from) {
                return Some(format!("{to}{rest}"));
            }
        }
    }
    None
}
