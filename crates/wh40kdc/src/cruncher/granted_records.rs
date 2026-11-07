//! Grants of ability records ("friendly BLOOD LEGIONS units gain Blessings of
//! Khorne"), resolved to the record itself so the translator reads them as
//! printed definitions: the holders run the granted rule as their own ability,
//! and its "this unit" is the holder.
//!
//! Mirrors `tools/src/cruncher/granted-records.ts`.

use std::collections::HashSet;

use serde_json::{Map, Value};

/// Rewrites each `ability-grant` that names an ability record by id into a
/// printed grant: its `definition` is an ability part carrying the record's
/// effect (itself resolved), trigger, usage and optionality. `lookup` returns
/// the record (an object with `effect` and optionally `trigger`, `usage` and
/// `optional`) or `None`.
///
/// A grant already carrying a definition, a rules bundle, an id `lookup` does
/// not resolve (a core ability), and a record in `seen` (the granting ability
/// itself, or a cycle) stay as they are, so the translator reports them as
/// before. Returns `None` when nothing changed.
pub fn resolve_granted_records(
    effect: &Value,
    lookup: &dyn Fn(&str) -> Option<Value>,
    seen: &HashSet<String>,
) -> Option<Value> {
    match effect {
        Value::Array(items) => {
            let mut copy: Option<Vec<Value>> = None;
            for (index, child) in items.iter().enumerate() {
                if let Some(resolved) = resolve_granted_records(child, lookup, seen) {
                    copy.get_or_insert_with(|| items.clone())[index] = resolved;
                }
            }
            copy.map(Value::Array)
        }
        Value::Object(node) => {
            if let Some(granted) = resolve_grant(node, lookup, seen) {
                return Some(granted);
            }
            let mut copy: Option<Map<String, Value>> = None;
            for (key, child) in node {
                if let Some(resolved) = resolve_granted_records(child, lookup, seen) {
                    copy.get_or_insert_with(|| node.clone())
                        .insert(key.clone(), resolved);
                }
            }
            copy.map(Value::Object)
        }
        _ => None,
    }
}

fn resolve_grant(
    node: &Map<String, Value>,
    lookup: &dyn Fn(&str) -> Option<Value>,
    seen: &HashSet<String>,
) -> Option<Value> {
    if node.get("type").and_then(Value::as_str) != Some("ability-grant") {
        return None;
    }
    let modifier = node.get("modifier")?.as_object()?;
    let ability = modifier.get("ability")?.as_str()?;
    if !matches!(modifier.get("definition"), None | Some(Value::Null))
        || modifier.get("rules_bundle") == Some(&Value::Bool(true))
        || seen.contains(ability)
    {
        return None;
    }
    let record = lookup(ability)?;
    let record_effect = record.get("effect").filter(|effect| effect.is_object())?;
    let mut inner = seen.clone();
    inner.insert(ability.to_string());
    let mut definition = Map::new();
    definition.insert("type".into(), Value::String("ability-part".into()));
    definition.insert(
        "effect".into(),
        resolve_granted_records(record_effect, lookup, &inner)
            .unwrap_or_else(|| record_effect.clone()),
    );
    for key in ["trigger", "usage"] {
        if let Some(value) = record.get(key).filter(|value| !value.is_null()) {
            definition.insert(key.into(), value.clone());
        }
    }
    if record.get("optional") == Some(&Value::Bool(true)) {
        definition.insert("optional".into(), Value::Bool(true));
    }
    let mut modifier = modifier.clone();
    modifier.insert("definition".into(), Value::Object(definition));
    let mut granted = node.clone();
    granted.insert("modifier".into(), Value::Object(modifier));
    Some(Value::Object(granted))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn grant(target: &str, ability: &str) -> Value {
        json!({ "type": "ability-grant", "target": target, "modifier": { "ability": ability } })
    }

    #[test]
    fn prints_a_granted_record_and_leaves_itself_and_core_abilities_alone() {
        let record = json!({
            "effect": { "type": "roll-modifier", "target": "this-unit", "modifier": { "roll": "hit", "operation": "add", "value": 1 } },
            "usage": { "frequency": "once-per-turn", "per": "unit" },
        });
        let lookup = |id: &str| (id == "fabricated-rite").then(|| record.clone());
        let seen: HashSet<String> = ["fabricated-banner".to_string()].into();
        let resolved = resolve_granted_records(
            &json!({ "type": "sequence", "steps": [grant("this-unit", "fabricated-rite")] }),
            &lookup,
            &seen,
        )
        .expect("the grant resolves");
        assert_eq!(
            resolved["steps"][0]["modifier"]["definition"],
            json!({ "type": "ability-part", "effect": record["effect"], "usage": record["usage"] })
        );
        assert!(resolve_granted_records(&grant("this-unit", "stealth"), &lookup, &seen).is_none());
        assert!(
            resolve_granted_records(&grant("this-unit", "fabricated-banner"), &lookup, &seen)
                .is_none()
        );
    }
}
