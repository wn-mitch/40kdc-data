//! Keywords a bearer's own abilities change once it is attached at list building.
//!
//! Mirror of TS `tools/src/data/list-building-keywords.ts`.

use std::collections::HashSet;

use serde_json::{Map, Value};

use crate::generated::Ability;
use crate::scope::keyword_key;

/// One keyword a bearer gains (`add`) or loses, compared by [`keyword_key`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KeywordChange {
    pub add: bool,
    pub key: String,
}

const PREDICATE_KEYS: [&str; 4] = ["all_of", "any_of", "none_of", "not_all_of"];

/// A present, non-null field.
fn field<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    object.get(key).filter(|value| !value.is_null())
}

fn is_bearer(reference: Option<&Value>) -> bool {
    match reference {
        None => true,
        Some(value) => matches!(value.as_str(), Some("this-model" | "this-unit")),
    }
}

/// The `with` filter's keyword predicate: `Some(None)` for no filter, `None` when the filter
/// needs more than the attached unit's keywords.
fn with_predicate(filter: Option<&Value>) -> Option<Option<Vec<(String, Vec<String>)>>> {
    let Some(filter) = filter else {
        return Some(None);
    };
    let object = filter.as_object()?;
    let mut predicate = Vec::new();
    for (key, value) in object {
        if value.is_null()
            || (key == "owner" && value.as_str() == Some("friendly"))
            || (key == "level" && value.as_str() == Some("unit"))
        {
            continue;
        }
        if !PREDICATE_KEYS.contains(&key.as_str()) {
            return None;
        }
        let items = value.as_array()?;
        let keywords = items
            .iter()
            .map(|item| item.as_str().map(str::to_string))
            .collect::<Option<Vec<_>>>()?;
        predicate.push((key.clone(), keywords));
    }
    Some(Some(predicate))
}

/// Whether `keywords` meet every clause of `predicate`; empty `any_of`/`not_all_of` clauses
/// are false (mirror of TS `keywordMatchesPredicate`).
fn matches_predicate(predicate: &[(String, Vec<String>)], keywords: &HashSet<String>) -> bool {
    let owned: HashSet<String> = keywords.iter().map(|k| keyword_key(k)).collect();
    let has = |keyword: &String| owned.contains(&keyword_key(keyword));
    predicate
        .iter()
        .all(|(clause, list)| match clause.as_str() {
            "all_of" => list.iter().all(has),
            "any_of" => list.iter().any(has),
            "none_of" => !list.iter().any(has),
            _ => !list.iter().all(has),
        })
}

fn leaf_changes(leaf: &Map<String, Value>) -> Vec<KeywordChange> {
    let Some(modifier) = field(leaf, "modifier").and_then(Value::as_object) else {
        return Vec::new();
    };
    if !is_bearer(field(leaf, "target")) {
        return Vec::new();
    }
    let kind = field(leaf, "type").and_then(Value::as_str);
    if kind == Some("keyword-grant") {
        if let Some(keywords) = field(modifier, "keywords").and_then(Value::as_array) {
            return keywords
                .iter()
                .filter_map(Value::as_str)
                .map(|k| KeywordChange {
                    add: true,
                    key: keyword_key(k),
                })
                .collect();
        }
    }
    if kind == Some("rule-state")
        && field(modifier, "rule_kind").and_then(Value::as_str) == Some("keyword")
    {
        if let Some(rule) = field(modifier, "rule").and_then(Value::as_str) {
            let add = match field(modifier, "direction").and_then(Value::as_str) {
                Some("suppressed") => false,
                Some("granted") => true,
                _ => return Vec::new(),
            };
            return vec![KeywordChange {
                add,
                key: keyword_key(rule),
            }];
        }
    }
    Vec::new()
}

/// The keyword changes an ability makes to its bearer once attached, when attachment alone
/// gates them: an untriggered `conditional` on a single `attachment` predicate (role
/// `attached`, the bearer as subject) over a leaf or a `sequence` of leaves. Returns the
/// predicate the attached unit's keywords must meet (`None` for none) and the changes, or
/// `None` for any other shape (a compound condition is not list building).
#[allow(clippy::type_complexity)]
pub(crate) fn attachment_keyword_changes(
    ability: &Ability,
) -> Option<(Option<Vec<(String, Vec<String>)>>, Vec<KeywordChange>)> {
    if ability.trigger.is_some() {
        return None;
    }
    let effect = serde_json::to_value(&ability.effect).ok()?;
    let effect = effect.as_object()?;
    if field(effect, "type").and_then(Value::as_str) != Some("conditional") {
        return None;
    }
    let condition = field(effect, "condition")?.as_object()?;
    let body = field(effect, "effect")?.as_object()?;
    if field(condition, "type").and_then(Value::as_str) != Some("attachment")
        || field(condition, "operator").is_some()
    {
        return None;
    }
    let empty = Map::new();
    let params = field(condition, "parameters")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    if field(params, "role").and_then(Value::as_str) != Some("attached")
        || !is_bearer(field(params, "subject"))
    {
        return None;
    }
    let predicate = with_predicate(field(params, "with"))?;
    let steps = field(body, "steps").and_then(Value::as_array);
    let changes: Vec<KeywordChange> = match (field(body, "type").and_then(Value::as_str), steps) {
        (Some("sequence"), Some(steps)) => steps
            .iter()
            .filter_map(Value::as_object)
            .flat_map(leaf_changes)
            .collect(),
        _ => leaf_changes(body),
    };
    (!changes.is_empty()).then_some((predicate, changes))
}

/// The bearer's keyword changes while attached to a unit with `attached_to_keywords` (leader
/// or support attachment), in ability then effect order; none when unattached.
pub(crate) fn list_building_keyword_changes(
    bearer_abilities: &[&Ability],
    attached_to_keywords: Option<&HashSet<String>>,
) -> Vec<KeywordChange> {
    let Some(attached) = attached_to_keywords else {
        return Vec::new();
    };
    bearer_abilities
        .iter()
        .filter_map(|ability| attachment_keyword_changes(ability))
        .filter(|(predicate, _)| {
            predicate
                .as_ref()
                .is_none_or(|predicate| matches_predicate(predicate, attached))
        })
        .flat_map(|(_, changes)| changes)
        .collect()
}

/// Keyword membership over a roster keyword set with list-building changes applied in order.
/// A keyword the set holds keeps its exact spelling test; a change matches any spelling.
pub(crate) struct ListKeywords<'a> {
    owned: &'a HashSet<String>,
    granted: HashSet<String>,
    removed: HashSet<String>,
}

impl<'a> ListKeywords<'a> {
    pub(crate) fn new(owned: &'a HashSet<String>, changes: &[KeywordChange]) -> Self {
        let mut granted = HashSet::new();
        let mut removed = HashSet::new();
        for change in changes {
            if change.add {
                granted.insert(change.key.clone());
                removed.remove(&change.key);
            } else {
                removed.insert(change.key.clone());
                granted.remove(&change.key);
            }
        }
        Self {
            owned,
            granted,
            removed,
        }
    }

    pub(crate) fn has(&self, keyword: &str) -> bool {
        if self.granted.is_empty() && self.removed.is_empty() {
            return self.owned.contains(keyword);
        }
        let key = keyword_key(keyword);
        self.granted.contains(&key)
            || (self.owned.contains(keyword) && !self.removed.contains(&key))
    }
}
