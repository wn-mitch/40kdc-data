//! Caller-attested historical recipients, bound to an exact source and canonical selection.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::buffs::{AbilityKind, BuffSource, EngineContext};
use super::from_dsl::{is_attack_step, moment_gate, TranslationPerspective};
use crate::{Trigger, UnitSelector};

pub const RECIPIENT_SNAPSHOT_UNAVAILABLE: &str = "trigger-time recipient snapshot is unavailable; current membership cannot establish historical recipients";

/// Evidence of one activation's recipient membership, not a present-day unit filter.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipientSnapshot {
    #[serde(deserialize_with = "ability_source")]
    pub source: BuffSource,
    pub source_unit_id: String,
    pub trigger: Trigger,
    /// JSON pointer rooted at the owning ability's effect (empty for its root).
    pub selection_path: String,
    pub selector: UnitSelector,
    pub perspective: TranslationPerspective,
    pub recipient_unit_id: String,
    pub selected: bool,
}

fn ability_source<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BuffSource, D::Error> {
    let source = BuffSource::deserialize(deserializer)?;
    if matches!(source, BuffSource::Ability { .. }) {
        Ok(source)
    } else {
        Err(serde::de::Error::custom(
            "recipient snapshot source must be an ability",
        ))
    }
}

pub(crate) fn recipient_snapshot_reason(
    trigger: Option<&Value>,
    effect: &Value,
) -> Option<&'static str> {
    fn check(value: &Value, trigger: Option<&Value>) -> bool {
        match value {
            Value::Array(values) => values.iter().any(|value| check(value, trigger)),
            Value::Object(node) => {
                let active = if node.get("type").and_then(Value::as_str) == Some("ability-part") {
                    node.get("trigger").or(trigger)
                } else {
                    trigger
                };
                let historical = match active {
                    Some(Value::Array(events)) => events.iter().any(is_historical),
                    Some(event) => is_historical(event),
                    None => false,
                };
                (node.get("type").and_then(Value::as_str) == Some("for-each-unit") && historical)
                    || node
                        .iter()
                        .any(|(key, value)| key != "trigger" && check(value, active))
            }
            _ => false,
        }
    }
    check(effect, trigger).then_some(RECIPIENT_SNAPSHOT_UNAVAILABLE)
}

fn is_historical(event: &Value) -> bool {
    event.get("event").is_some_and(Value::is_string) && !is_attack_step(event)
}

pub(crate) fn resolve_recipient_snapshots(
    trigger: Option<&Value>,
    effect: &Value,
    source: &BuffSource,
    context: &EngineContext,
    perspective: TranslationPerspective,
) -> Result<Value, &'static str> {
    let side_id = match perspective {
        TranslationPerspective::Attacker => context.attacker_unit_id.as_deref(),
        TranslationPerspective::Target => context.target_unit_id.as_deref(),
    };
    let source_id = match source {
        BuffSource::Ability {
            source_unit_id,
            ability_kind,
            ..
        } => source_unit_id.as_deref().or_else(|| {
            (*ability_kind == AbilityKind::Unit)
                .then_some(side_id)
                .flatten()
        }),
        _ => None,
    };
    let resolver = Resolver {
        source,
        source_id,
        side_id,
        context,
        perspective,
    };
    resolver.visit(effect, "", trigger)
}

struct Resolver<'a> {
    source: &'a BuffSource,
    source_id: Option<&'a str>,
    side_id: Option<&'a str>,
    context: &'a EngineContext,
    perspective: TranslationPerspective,
}

impl Resolver<'_> {
    fn visit(
        &self,
        value: &Value,
        path: &str,
        trigger: Option<&Value>,
    ) -> Result<Value, &'static str> {
        let Some(node) = value.as_object() else {
            return Ok(value.clone());
        };
        let events = match trigger {
            Some(Value::Array(events)) => events.as_slice(),
            Some(event) => std::slice::from_ref(event),
            None => &[],
        };
        let kind = node.get("type").and_then(Value::as_str);
        if kind == Some("for-each-unit") && events.iter().any(is_historical) {
            let selector: UnitSelector =
                serde_json::from_value(node.get("selector").cloned().unwrap_or(Value::Null))
                    .map_err(|_| RECIPIENT_SNAPSHOT_UNAVAILABLE)?;
            let triggers: Vec<Trigger> = events
                .iter()
                .filter(|event| is_historical(event))
                .filter_map(|event| serde_json::from_value(event.clone()).ok())
                .collect();
            let mut selected = None;
            for snapshot in &self.context.recipient_snapshots {
                if snapshot.source != *self.source
                    || Some(snapshot.source_unit_id.as_str()) != self.source_id
                    || self.source_id.is_none()
                    || self.side_id.is_none()
                    || snapshot.perspective != self.perspective
                    || Some(snapshot.recipient_unit_id.as_str()) != self.side_id
                    || snapshot.selection_path != path
                    || snapshot.selector != selector
                    || !triggers.contains(&snapshot.trigger)
                {
                    continue;
                }
                if selected.is_some_and(|prior| prior != snapshot.selected) {
                    return Err("conflicting trigger-time recipient snapshots");
                }
                selected = Some(snapshot.selected);
            }
            return match selected {
                None => Err(RECIPIENT_SNAPSHOT_UNAVAILABLE),
                Some(false) => Ok(json!({"type":"sequence","steps":[]})),
                Some(true) => {
                    super::from_dsl::bind_snapshot_recipient(node, &Value::from("recipient")).ok_or(
                        "recipient snapshot cannot bind mixed or unresolved recipient effects",
                    )
                }
            };
        }
        let mut transformed = node.clone();
        match kind {
            Some("sequence" | "rules-bundle") => {
                if let Some(steps) = node.get("steps").and_then(Value::as_array) {
                    let steps = steps
                        .iter()
                        .enumerate()
                        .map(|(i, step)| self.visit(step, &format!("{path}/steps/{i}"), trigger))
                        .collect::<Result<Vec<_>, _>>()?;
                    transformed.insert("steps".into(), Value::Array(steps));
                }
            }
            Some("for-each-unit") => {
                return Ok(moment_gate(trigger, value).unwrap_or_else(|| value.clone()))
            }
            Some("conditional" | "ability-part") => {
                let active = if kind == Some("ability-part") {
                    node.get("trigger").or(trigger)
                } else {
                    trigger
                };
                if kind == Some("ability-part") {
                    transformed.remove("trigger");
                }
                let effect = self.visit(
                    node.get("effect").unwrap_or(&Value::Null),
                    &format!("{path}/effect"),
                    active,
                )?;
                transformed.insert("effect".into(), effect);
            }
            _ => {
                fn contains_pool(value: &Value) -> bool {
                    match value {
                        Value::Array(values) => values.iter().any(contains_pool),
                        Value::Object(node) => {
                            node.get("type").and_then(Value::as_str) == Some("for-each-unit")
                                || node.values().any(contains_pool)
                        }
                        _ => false,
                    }
                }
                if contains_pool(value) {
                    return Err(
                        "recipient snapshot is nested in an unsupported activation composition",
                    );
                }
                return Ok(moment_gate(trigger, value).unwrap_or_else(|| value.clone()));
            }
        }
        Ok(Value::Object(transformed))
    }
}
