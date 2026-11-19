//! A unit filter as the predicate of a `matches` subject. Mirror of `filterPredicate` in
//! `tools/src/translate/condition.ts`.

use super::js::P;
use super::refs::unit_filter_phrase;

/// A one-clause filter as the predicate of a subject that is already a unit or model: "the
/// triggering unit is within Engagement Range of ..." and "the unit is enfeebled by this model",
/// not "is a unit within ...". A noun the filter qualifies ("a friendly INFANTRY unit", "a unit
/// with the X keyword") stays, as does one with several clauses (each keeps qualifying the noun),
/// one whose clause is a noun phrase of its own ("a unit that is a PSYKER unit or ..."), or one
/// whose clause is itself negative when the predicate is negated.
pub(super) fn filter_predicate(f: &P, noun: &str, negated: bool) -> String {
    let phrase = unit_filter_phrase(f);
    let clauses = f
        .iter()
        .filter(|(k, v)| {
            !v.is_null() && !matches!(k.as_str(), "level" | "designated_by" | "has_ability_models")
        })
        .count();
    let bare = format!("a {noun} ");
    let rest = match phrase.strip_prefix(bare.as_str()) {
        Some(rest) if clauses == 1 => rest,
        _ => return phrase,
    };
    let clause = if let Some(state) = rest.strip_prefix("that is ") {
        Some(state)
    } else if [
        "wholly within ",
        "within ",
        "not within ",
        "embarked within ",
        "in ",
    ]
    .iter()
    .any(|lead| rest.starts_with(lead))
    {
        Some(rest)
    } else {
        None
    };
    match clause {
        Some(clause)
            if !(clause.starts_with("a ")
                || clause.starts_with("an ")
                || (negated && clause.starts_with("not "))) =>
        {
            clause.to_string()
        }
        _ => phrase,
    }
}
