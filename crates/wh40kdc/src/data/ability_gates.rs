//! Keyword gates the abilities resolver applies to the combined unit: each member's keywords
//! (with its conditional keywords for the selected detachment), a rule's `applies_to` filter,
//! the keyword `matches` inside a Stratagem target's `eligibility`, and the abilities a unit's
//! standing rules suppress. Mirrors the keyword helpers of
//! `tools/src/abilities-resolver/resolver.ts`.

use std::collections::HashSet;

use serde_json::{Map, Value};

use super::abilities::{EligibleAbility, EligibleAbilitySource};
use super::normalize::normalize_name;
use crate::cruncher::from_dsl::strip_nulls;
use crate::Unit;

/// A member's keywords, lower-cased: its datasheet and faction keywords, plus each conditional
/// keyword with no required detachment or whose required detachment is `detachment_id`. An
/// unresolved member has none.
pub(super) fn member_keywords(
    member: Option<&Unit>,
    detachment_id: Option<&str>,
) -> HashSet<String> {
    let Some(member) = member else {
        return HashSet::new();
    };
    let printed = [&member.keywords, &member.faction_keywords]
        .into_iter()
        .flatten()
        .flat_map(|list| list.0.iter().map(|k| k.to_lowercase()));
    let conditional = member
        .conditional_keywords
        .iter()
        .filter(|entry| match &entry.required_detachment_id {
            None => true,
            Some(id) => Some(id.as_str()) == detachment_id,
        })
        .map(|entry| entry.keyword.to_lowercase());
    printed.chain(conditional).collect()
}

/// The members' keywords as one combined unit, normalized for comparison.
fn combined(members: &[HashSet<String>]) -> HashSet<String> {
    members
        .iter()
        .flatten()
        .map(|keyword| normalize_name(keyword))
        .collect()
}

/// Whether a rule's `applies_to` admits a unit of `members`, read as one combined unit. An absent
/// filter, or one that names anything but keyword lists, admits every unit. A required keyword no
/// datasheet prints is one the army gains in play, so it is not held against the unit, as for a
/// Stratagem's WHEN.
pub(super) fn applies_to_unit(
    filter: Option<&Value>,
    members: &[HashSet<String>],
    printed: &dyn Fn(&str) -> bool,
) -> bool {
    let Some(filter) = filter.and_then(Value::as_object) else {
        return true;
    };
    let combined = combined(members);
    let has = |keyword: &str| combined.contains(&normalize_name(keyword));
    let required = |keyword: &str| has(keyword) || !printed(keyword);
    keyword_predicate_holds(filter, &required, &has) != Some(false)
}

/// A static keyword predicate's verdict: `all_of`/`any_of` by `required`, `none_of`/`not_all_of`
/// by `excluded`. `None` when it names anything but keyword lists and a friendly `owner`.
pub(super) fn keyword_predicate_holds(
    filter: &Map<String, Value>,
    required: &dyn Fn(&str) -> bool,
    excluded: &dyn Fn(&str) -> bool,
) -> Option<bool> {
    const KEYS: [&str; 5] = ["all_of", "any_of", "none_of", "not_all_of", "owner"];
    if filter.keys().any(|key| !KEYS.contains(&key.as_str())) {
        return None;
    }
    if filter
        .get("owner")
        .is_some_and(|owner| owner.as_str() != Some("friendly"))
    {
        return None;
    }
    let list = |key: &str| -> Vec<&str> {
        filter
            .get(key)
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    };
    let any_of = list("any_of");
    let not_all_of = list("not_all_of");
    Some(
        list("all_of").into_iter().all(required)
            && (any_of.is_empty() || any_of.into_iter().any(required))
            && !list("none_of").into_iter().any(excluded)
            && (not_all_of.is_empty() || !not_all_of.into_iter().all(excluded)),
    )
}

/// The verdict of a Stratagem target's `eligibility` on the target's own keywords: each `matches`
/// on the target unit whose filter is only keyword lists is decided, and `and`/`or`/`not` combine
/// them; anything else (battlefield state, history) is `None`. `None` never refuses the target.
pub(super) fn eligibility_keywords(
    condition: Option<&Value>,
    required: &dyn Fn(&str) -> bool,
    excluded: &dyn Fn(&str) -> bool,
) -> Option<bool> {
    let node = condition?.as_object()?;
    if let (Some(operator), Some(operands)) = (
        node.get("operator").and_then(Value::as_str),
        node.get("operands").and_then(Value::as_array),
    ) {
        let values: Vec<Option<bool>> = operands
            .iter()
            .map(|operand| eligibility_keywords(Some(operand), required, excluded))
            .collect();
        return match operator {
            "and" if values.contains(&Some(false)) => Some(false),
            "and" => values.iter().all(|v| *v == Some(true)).then_some(true),
            "or" if values.contains(&Some(true)) => Some(true),
            "or" => values.iter().all(|v| *v == Some(false)).then_some(false),
            "not" if values.len() == 1 => values[0].map(|v| !v),
            _ => None,
        };
    }
    if node.get("type").and_then(Value::as_str) != Some("matches") {
        return None;
    }
    let params = node.get("parameters")?.as_object()?;
    if params
        .get("subject")
        .is_some_and(|subject| subject.as_str() != Some("this-unit"))
    {
        return None;
    }
    keyword_predicate_holds(params.get("filter")?.as_object()?, required, excluded)
}

/// Whether a source holds for the unit without a player choosing it in play.
fn standing_source(source: &EligibleAbilitySource) -> bool {
    matches!(
        source,
        EligibleAbilitySource::Army
            | EligibleAbilitySource::Detachment { .. }
            | EligibleAbilitySource::Unit { .. }
            | EligibleAbilitySource::Attached { .. }
    )
}

/// The abilities the unit's standing rules suppress: a `rule-state` that suppresses an ability
/// (named by id) for this unit, or for friendly units whose keywords the unit has, under
/// conditions that are only keyword checks on the unit that hold. A Stratagem's, a supporting
/// unit's, or a triggered or battlefield-conditioned suppression is left to play.
pub(super) fn suppressed_ability_ids(
    entries: &[EligibleAbility<'_>],
    members: &[HashSet<String>],
    printed: &dyn Fn(&str) -> bool,
) -> HashSet<String> {
    let combined = combined(members);
    let has = |keyword: &str| combined.contains(&normalize_name(keyword));
    let required = |keyword: &str| has(keyword) || !printed(keyword);
    let mut out = HashSet::new();
    for entry in entries.iter().filter(|e| standing_source(&e.source)) {
        let effect =
            strip_nulls(&serde_json::to_value(&entry.ability.effect).unwrap_or(Value::Null));
        walk_suppressions(&effect, &required, &has, &mut out);
    }
    out
}

fn walk_suppressions(
    node: &Value,
    required: &dyn Fn(&str) -> bool,
    has: &dyn Fn(&str) -> bool,
    out: &mut HashSet<String>,
) {
    let effect = match node {
        Value::Array(items) => {
            for item in items {
                walk_suppressions(item, required, has, out);
            }
            return;
        }
        Value::Object(effect) => effect,
        _ => return,
    };
    match effect.get("type").and_then(Value::as_str) {
        Some("conditional") => {
            if eligibility_keywords(effect.get("condition"), required, has) == Some(true) {
                if let Some(inner) = effect.get("effect") {
                    walk_suppressions(inner, required, has, out);
                }
            }
        }
        Some("sequence" | "rules-bundle") => {
            if let Some(steps) = effect.get("steps") {
                walk_suppressions(steps, required, has, out);
            }
        }
        Some("rule-state") => {
            let Some(modifier) = effect.get("modifier").and_then(Value::as_object) else {
                return;
            };
            let suppresses = modifier.get("direction").and_then(Value::as_str)
                == Some("suppressed")
                && modifier.get("rule_kind").and_then(Value::as_str) == Some("ability");
            let Some(rule) = modifier.get("rule").and_then(Value::as_str) else {
                return;
            };
            let reaches = match effect.get("target") {
                Some(Value::String(target)) => target == "this-unit",
                Some(Value::Object(target)) => {
                    keyword_predicate_holds(target, required, has) == Some(true)
                }
                _ => false,
            };
            if suppresses && reaches {
                out.insert(rule.to_string());
            }
        }
        _ => {}
    }
}
