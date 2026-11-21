//! Conditions inside an enemy selection lever that only restate the selection. Mirrors
//! `designatedTags`, `selectionHolds` and their helpers in
//! `tools/src/cruncher/from-dsl-selection.ts`.
//!
//! The lever vouches that the other side of the attack is the selected unit, so a condition that
//! it is that unit (`same-unit` as the selection), or that it carries a tag the selection itself
//! designates, holds.

use std::collections::BTreeSet;

use serde_json::Value;

use super::js::*;

const SELECTED_UNIT: &str = "selected-unit";

/// Whether a unit-ref names the selection's unit: `selected-unit`, or the selection's own binding.
fn names_selection(value: Option<&Value>, binding: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    value.as_str() == Some(SELECTED_UNIT)
        || binding.is_some_and(|binding| {
            value.is_object() && value.get("selection_var").and_then(Value::as_str) == Some(binding)
        })
}

/// The tags the selection's own `designate` steps put on the selected unit, outside a nested
/// selection.
pub(super) fn designated_tags(node: &Value, binding: Option<&str>) -> BTreeSet<String> {
    fn visit(value: &Value, binding: Option<&str>, tags: &mut BTreeSet<String>) {
        match value {
            Value::Array(items) => {
                for item in items {
                    visit(item, binding, tags);
                }
            }
            Value::Object(node) if !is_str(node, "type", "select-units") => {
                if is_str(node, "type", "designate") && names_selection(node.get("target"), binding)
                {
                    if let Some(modifier) = object(node.get("modifier")) {
                        if let Some(tag) = modifier.get("tag").and_then(Value::as_str) {
                            if modifier.get("clear") != Some(&Value::Bool(true)) {
                                tags.insert(tag.to_string());
                            }
                        }
                    }
                }
                for child in node.values() {
                    visit(child, binding, tags);
                }
            }
            _ => {}
        }
    }
    let mut tags = BTreeSet::new();
    visit(node, binding, &mut tags);
    tags
}

/// Whether a condition holds once the player vouches that `other` is the selected enemy unit.
fn held_by_selection(
    condition: &Obj,
    other: &str,
    tags: &BTreeSet<String>,
    binding: Option<&str>,
) -> bool {
    let Some(params) = object(condition.get("parameters")) else {
        return false;
    };
    if params.get("subject").and_then(Value::as_str) != Some(other) {
        return false;
    }
    if is_str(condition, "type", "same-unit") {
        return names_selection(params.get("as"), binding);
    }
    if !is_str(condition, "type", "matches") {
        return false;
    }
    let Some(filter) = object(params.get("filter")) else {
        return false;
    };
    filter.len() == 1
        && filter
            .get("designated")
            .and_then(Value::as_str)
            .is_some_and(|tag| tags.contains(tag))
}

/// The condition left once the selection's back-references hold: `None` when nothing is left. An
/// `and` keeps its other operands; any other operator is left whole.
fn without_held(
    condition: &Value,
    other: &str,
    tags: &BTreeSet<String>,
    binding: Option<&str>,
) -> Option<Value> {
    let Some(node) = condition.as_object() else {
        return Some(condition.clone());
    };
    if is_str(node, "operator", "and") {
        if let Some(operands) = node.get("operands").and_then(Value::as_array) {
            let rest: Vec<Value> = operands
                .iter()
                .filter(|operand| {
                    !operand
                        .as_object()
                        .is_some_and(|operand| held_by_selection(operand, other, tags, binding))
                })
                .cloned()
                .collect();
            if rest.len() == operands.len() {
                return Some(condition.clone());
            }
            return match rest.len() {
                0 => None,
                1 => rest.into_iter().next(),
                _ => {
                    let mut kept = node.clone();
                    kept.insert("operands".into(), Value::Array(rest));
                    Some(Value::Object(kept))
                }
            };
        }
    }
    if held_by_selection(node, other, tags, binding) {
        None
    } else {
        Some(condition.clone())
    }
}

/// The lever's effect with every condition that only restates the selection settled: a
/// conditional whose condition holds becomes its effect. Nested selections keep their own scope.
pub(super) fn selection_holds(
    node: &Value,
    other: &str,
    tags: &BTreeSet<String>,
    binding: Option<&str>,
) -> Value {
    match node {
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| selection_holds(item, other, tags, binding))
                .collect(),
        ),
        Value::Object(obj) if !is_str(obj, "type", "select-units") => {
            if is_str(obj, "type", "conditional") {
                if let Some(effect) = obj.get("effect") {
                    let condition = obj.get("condition").cloned().unwrap_or(Value::Null);
                    match without_held(&condition, other, tags, binding) {
                        None => return selection_holds(effect, other, tags, binding),
                        Some(left) if left != condition => {
                            let mut next = obj.clone();
                            next.insert("condition".into(), left);
                            return selection_holds(&Value::Object(next), other, tags, binding);
                        }
                        Some(_) => {}
                    }
                }
            }
            Value::Object(
                obj.iter()
                    .map(|(key, value)| (key.clone(), selection_holds(value, other, tags, binding)))
                    .collect(),
            )
        }
        other_value => other_value.clone(),
    }
}
