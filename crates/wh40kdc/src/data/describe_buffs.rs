//! The buff translation of one ability record: rules-bundle expansion, trigger and usage gates,
//! and aura range. Mirrors TS `AbilityView.describeBuffs`
//! and canonical trigger and activation handling.

use serde_json::{json, Value};

use super::ability_refs::with_rating;
use super::dataset::Dataset;
use crate::cruncher::buffs::{Buff, BuffSource, EngineContext};
use crate::cruncher::from_dsl::{
    effect_to_buffs_with_duration, moment_gate, strip_nulls, EffectTranslation,
    TranslationPerspective,
};
use crate::{Ability, Phase};

impl Dataset {
    /// Expand rules bundles and resolve triggers before attaching parent usage requirements.
    /// Independent child groups and costs survive; an aura's inch range remains a gate. A rated
    /// rule (`{rating: true}`) reads `rating`, the rating the owning unit prints
    /// ([`super::EligibleAbility::rating`]). Mirrors TS `AbilityView.describeBuffs`; `context`
    /// defaults to the shooting phase.
    pub fn describe_buffs(
        &self,
        ability: &Ability,
        source: &BuffSource,
        context: Option<&EngineContext>,
        perspective: TranslationPerspective,
        rating: Option<&Value>,
    ) -> EffectTranslation {
        let default_ctx;
        let ctx = match context {
            Some(c) => c,
            None => {
                default_ctx = EngineContext::new(Phase::Shooting);
                &default_ctx
            }
        };
        let raw = strip_nulls(&serde_json::to_value(ability).expect("an ability serializes"));
        let effect = raw.get("effect").cloned().unwrap_or(Value::Null);
        let mut seen = vec![ability.ability_id.to_string()];
        let resolved = with_rating(&self.resolve_rules_bundles(&effect, &mut seen), rating);
        let mut scoped = Vec::new();
        let triggered = if crate::cruncher::from_dsl::recipient_snapshot_reason(
            raw.get("trigger"),
            &resolved,
        )
        .is_some()
        {
            let result = if !matches!(source, BuffSource::Ability { ability_id, .. } if ability_id == ability.ability_id.as_str())
            {
                Err("recipient snapshot source does not own this ability")
            } else {
                crate::cruncher::recipient_snapshots::resolve_recipient_snapshots(
                    raw.get("trigger"),
                    &resolved,
                    source,
                    ctx,
                    perspective,
                )
            };
            match result {
                Ok((effect, refused)) => {
                    scoped = refused;
                    effect
                }
                Err(reason) => {
                    return EffectTranslation {
                        unsupported: vec![crate::cruncher::from_dsl::UnsupportedFragment {
                            reason: reason.into(),
                            effect_fragment: resolved,
                            needs: None,
                            scope: None,
                        }],
                        ..Default::default()
                    }
                }
            }
        } else {
            let bound = crate::cruncher::from_dsl::bind_event_subject(
                raw.get("trigger"),
                &resolved,
                ctx,
                perspective,
            )
            .unwrap_or_else(|| resolved.clone());
            trigger_gated(raw.get("behavior"), raw.get("trigger"), &bound).unwrap_or(bound)
        };
        let mut translated = effect_to_buffs_with_duration(
            &triggered,
            source,
            ctx,
            perspective,
            raw.pointer("/scope/duration"),
            raw.get("usage"),
            raw.get("trigger"),
        );
        // A menu option whose pool the snapshots cannot resolve is refused alone, ahead of the rest.
        if !scoped.is_empty() {
            let refused = scoped.into_iter().map(|(reason, effect_fragment)| {
                crate::cruncher::from_dsl::UnsupportedFragment {
                    reason: reason.into(),
                    effect_fragment,
                    needs: None,
                    scope: None,
                }
            });
            translated.unsupported.splice(0..0, refused);
        }
        if let Some(usage) = raw.get("usage") {
            crate::cruncher::from_dsl::apply_activation(
                &mut translated,
                ability.ability_id.as_str(),
                json!({"usage": usage}),
            );
        }
        // An aura gates on distance to the target; only a single inch range gates.
        if let Some(range) = aura_inches_for_round(&resolved, ctx.battle_round) {
            let gate = |b: &mut Buff| {
                b.applicable_when
                    .get_or_insert_with(Default::default)
                    .max_range_inches = Some(range);
            };
            translated.applied.iter_mut().for_each(gate);
            for lever in &mut translated.activatable {
                lever.buffs.iter_mut().for_each(gate);
            }
        }
        translated
    }

    /// Only the buffs of [`Dataset::describe_buffs`] (its diagnostics dropped).
    pub fn ability_buffs(
        &self,
        ability: &Ability,
        source: &BuffSource,
        context: Option<&EngineContext>,
        perspective: TranslationPerspective,
        rating: Option<&Value>,
    ) -> Vec<Buff> {
        self.describe_buffs(ability, source, context, perspective, rating)
            .applied
    }

    /// Expand entity-backed ability grants (`ability-grant` with `rules_bundle: true`) into
    /// the referenced rules bundle. Unresolved, malformed and cyclic references stay as they
    /// are so the translator reports them.
    fn resolve_rules_bundles(&self, effect: &Value, seen: &mut Vec<String>) -> Value {
        match effect {
            Value::Array(items) => Value::Array(
                items
                    .iter()
                    .map(|x| self.resolve_rules_bundles(x, seen))
                    .collect(),
            ),
            Value::Object(node) => {
                if let Some(target) = self.rules_bundle_target(node, seen) {
                    let id = node["modifier"]["ability"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    let mut next = seen.clone();
                    next.push(id);
                    return self.resolve_rules_bundles(&target, &mut next);
                }
                Value::Object(
                    node.iter()
                        .map(|(k, v)| (k.clone(), self.resolve_rules_bundles(v, seen)))
                        .collect(),
                )
            }
            other => other.clone(),
        }
    }

    /// The rules-bundle effect a bundle grant names, when it resolves and is not a cycle.
    fn rules_bundle_target(
        &self,
        node: &serde_json::Map<String, Value>,
        seen: &[String],
    ) -> Option<Value> {
        if node.get("type").and_then(Value::as_str) != Some("ability-grant") {
            return None;
        }
        let holder = node.get("target")?;
        if matches!(holder.as_str(), Some("this-model" | "model-in-this-unit"))
            || holder.get("level").and_then(Value::as_str) == Some("model")
        {
            // Keep model grants intact: expansion must not promote their
            // nested self references to the entire combined unit.
            return None;
        }
        let modifier = node.get("modifier")?.as_object()?;
        let id = modifier.get("ability")?.as_str()?;
        if modifier.get("rules_bundle") != Some(&Value::Bool(true)) || seen.iter().any(|s| s == id)
        {
            return None;
        }
        let target = self.abilities.get(id)?;
        let mut effect = strip_nulls(&serde_json::to_value(&target.effect).ok()?);
        if effect.get("type").and_then(Value::as_str) != Some("rules-bundle") {
            return None;
        }
        // Retain the holder on the expanded bundle so attached model grants
        // cannot escape the walker's model-isolation guard.
        if let Some(holder) = node.get("target") {
            effect
                .as_object_mut()?
                .insert("target".into(), holder.clone());
        }
        Some(effect)
    }
}

/// A reactive ability's effect gated on its trigger, so the moment is an opt-in lever. `None`
/// when nothing gates it: not reactive, or a trigger on an attack step (met by every attack).
pub fn trigger_gated(
    behavior: Option<&Value>,
    trigger: Option<&Value>,
    effect: &Value,
) -> Option<Value> {
    if behavior.and_then(Value::as_str) != Some("reactive") {
        return None;
    }
    moment_gate(trigger, effect)
}

/// The one inch range every aura-filtered effect target in `effect` reaches, if exactly one.
/// This compatibility wrapper keeps the helper useful to callers that do not have a battle
/// round; tiered ranges are intentionally ignored without that observation context.
pub fn aura_inches(effect: &Value) -> Option<f64> {
    aura_inches_for_round(effect, None)
}

pub(super) fn aura_inches_for_round(effect: &Value, battle_round: Option<u32>) -> Option<f64> {
    fn walk(node: &Value, found: &mut Vec<f64>, battle_round: Option<u32>) {
        match node {
            Value::Array(a) => a.iter().for_each(|x| walk(x, found, battle_round)),
            Value::Object(o) => {
                let model_grant = o.get("type").and_then(Value::as_str) == Some("ability-grant")
                    && (matches!(
                        o.get("target").and_then(Value::as_str),
                        Some("this-model" | "model-in-this-unit")
                    ) || o
                        .get("target")
                        .and_then(|t| t.get("level"))
                        .and_then(Value::as_str)
                        == Some("model"));
                if model_grant {
                    return;
                }
                // A range from a Stratagem's named target is not one from this ability's unit.
                let from_named_target = o
                    .get("target")
                    .and_then(|t| t.pointer("/within/of/stratagem_target"))
                    .is_some();
                let mut range = o
                    .get("target")
                    .and_then(|t| t.pointer("/within/range"))
                    .filter(|_| !from_named_target);
                if let Some(tiers) = range
                    .and_then(|r| r.get("per_battle_round"))
                    .and_then(Value::as_array)
                {
                    range = (battle_round.filter(|round| *round > 0))
                        .filter(|_| !tiers.is_empty())
                        .and_then(|round| tiers.get((round as usize).min(tiers.len()) - 1));
                }
                let inches = range.and_then(|r| r.get("inches")).and_then(Value::as_f64);
                if let (Some(Value::String(_)), Some(i)) = (o.get("type"), inches) {
                    if !found.contains(&i) {
                        found.push(i);
                    }
                }
                o.values().for_each(|x| walk(x, found, battle_round));
            }
            _ => {}
        }
    }
    let mut found = Vec::new();
    walk(effect, &mut found, battle_round);
    match found.as_slice() {
        [only] => Some(*only),
        _ => None,
    }
}
