//! A `select-weapon` step that names the weapon it binds (`weapons.name`) is resolved before
//! translation: every later `weapons.ref` naming its `bind_as` variable, in the same sequence or
//! nested under it, takes the selection's weapon scope, and the selection step is dropped. A model
//! holds one weapon of a name in nearly every loadout, so the named scope is the selected weapon.
//! A selection that does not name its weapon is the player's choice among several and stays bound.

use std::collections::HashMap;

use serde_json::{Map, Value};

/// The weapon scope a selection binds by name, or `None` when it does not name its weapon.
fn named_binding(step: &Value) -> Option<(String, Map<String, Value>)> {
    let step = step.as_object()?;
    if step.get("type").and_then(Value::as_str) != Some("select-weapon") {
        return None;
    }
    let modifier = step.get("modifier")?.as_object()?;
    let variable = modifier.get("bind_as")?.as_str()?;
    let scope = modifier.get("weapons")?.as_object()?;
    if !scope.get("name").is_some_and(Value::is_string) || scope.contains_key("ref") {
        return None;
    }
    Some((variable.to_string(), scope.clone()))
}

/// A `weapons.ref` naming a bound variable, replaced by the bound scope; other scope fields are kept.
fn substituted(
    scope: &Map<String, Value>,
    bindings: &HashMap<String, Map<String, Value>>,
) -> Option<Value> {
    let reference = scope.get("ref")?.as_object()?;
    if reference.len() != 1 {
        return None;
    }
    let bound = bindings.get(reference.get("weapon_var")?.as_str()?)?;
    let mut out = scope.clone();
    out.remove("ref");
    for (key, value) in bound {
        out.insert(key.clone(), value.clone());
    }
    Some(Value::Object(out))
}

fn resolve(node: &Value, bindings: &HashMap<String, Map<String, Value>>) -> Value {
    match node {
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| resolve(item, bindings)).collect())
        }
        Value::Object(object) => {
            let is_sequence = object.get("type").and_then(Value::as_str) == Some("sequence");
            let mut out = Map::new();
            for (key, value) in object {
                let next = match (key.as_str(), value) {
                    ("steps", Value::Array(steps)) if is_sequence => {
                        let mut local = bindings.clone();
                        let mut kept = Vec::with_capacity(steps.len());
                        for step in steps {
                            match named_binding(step) {
                                Some((variable, scope)) => {
                                    local.insert(variable, scope);
                                }
                                None => kept.push(resolve(step, &local)),
                            }
                        }
                        Value::Array(kept)
                    }
                    ("weapons", Value::Object(scope)) => {
                        substituted(scope, bindings).unwrap_or_else(|| resolve(value, bindings))
                    }
                    _ => resolve(value, bindings),
                };
                out.insert(key.clone(), next);
            }
            Value::Object(out)
        }
        _ => node.clone(),
    }
}

/// The effect with each weapon a selection binds by name written into the scopes that refer to it.
pub(crate) fn resolve_named_weapon_bindings(effect: &Value) -> Value {
    resolve(effect, &HashMap::new())
}
