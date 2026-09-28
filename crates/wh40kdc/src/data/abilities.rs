//! Abilities as buffs: which abilities could apply to a chosen unit in a phase (the
//! abilities resolver) and the buff translation of one ability record (rules-bundle
//! expansion, trigger and usage gates, aura range). Mirrors
//! `tools/src/abilities-resolver/resolver.ts` and `AbilityView.describeBuffs` /
//! `triggerGated` / `usageGated` / `auraInches` in `tools/src/data/entities.ts`; the
//! `conformance/abilities-resolver` corpus pins both.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::dataset::Dataset;
use crate::cruncher::buffs::{Buff, BuffSource, EngineContext};
use crate::cruncher::from_dsl::{
    effect_to_buffs, is_attack_step, moment_gate, strip_nulls, EffectTranslation,
    TranslationPerspective,
};
use crate::{Ability, Phase, Unit};

/// Where an eligible ability comes from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum EligibleAbilitySource {
    Army,
    Detachment { detachment_id: String },
    DetachmentStratagem { stratagem_id: String, cp_cost: i64 },
    Unit { unit_id: String },
    Attached { unit_id: String },
    Support { source_unit_id: String },
}

impl EligibleAbilitySource {
    /// The source kind as the corpus spells it (`army`, `detachment-stratagem`, …).
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Army => "army",
            Self::Detachment { .. } => "detachment",
            Self::DetachmentStratagem { .. } => "detachment-stratagem",
            Self::Unit { .. } => "unit",
            Self::Attached { .. } => "attached",
            Self::Support { .. } => "support",
        }
    }
}

/// The unit whose eligible abilities are resolved, and the units around it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EligibilityInput {
    pub unit_id: String,
    /// Overrides the unit's own `faction_id` when given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub faction_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detachment_id: Option<String>,
    /// Other members of the combined unit; their abilities are pooled onto it, in order.
    #[serde(default)]
    pub attached_unit_ids: Vec<String>,
    /// Friendly units whose aura-ranged abilities could apply.
    #[serde(default)]
    pub supporting_unit_ids: Vec<String>,
}

/// One eligible ability with its source and the requested phase it acts in.
#[derive(Clone, Debug)]
pub struct EligibleAbility<'a> {
    pub ability: &'a Ability,
    pub source: EligibleAbilitySource,
    /// The subset of the ability's phases that intersect the requested phase.
    pub phases: Vec<Phase>,
}

/// A serde enum or newtype as its JSON string ("" when it is not one).
fn json_str<T: Serialize>(v: &T) -> String {
    match serde_json::to_value(v) {
        Ok(Value::String(s)) => s,
        _ => String::new(),
    }
}

/// Collects eligible abilities, keeping the first entry per (source kind, ability id).
struct Collector<'a> {
    ds: &'a Dataset,
    phase: Phase,
    seen: HashSet<String>,
    out: Vec<EligibleAbility<'a>>,
}

impl<'a> Collector<'a> {
    /// An ability with no phase-mapping is permissive: it surfaces in every phase.
    fn phase_matches(&self, ability: &Ability) -> bool {
        let phases = self.ds.phases_of(ability);
        phases.is_empty() || phases.contains(&self.phase)
    }

    fn intersect(&self, ability: &Ability) -> Vec<Phase> {
        let phases = self.ds.phases_of(ability);
        if phases.contains(&self.phase) {
            vec![self.phase]
        } else {
            phases.to_vec()
        }
    }

    /// Push a phase-matched ability with its intersected phases.
    fn push_phased(&mut self, ability: &'a Ability, source: EligibleAbilitySource) {
        if self.phase_matches(ability) {
            let phases = self.intersect(ability);
            self.push(ability, source, phases);
        }
    }

    fn push(&mut self, ability: &'a Ability, source: EligibleAbilitySource, phases: Vec<Phase>) {
        let key = format!("{}::{}", source.kind(), ability.ability_id.as_str());
        if self.seen.insert(key) {
            self.out.push(EligibleAbility {
                ability,
                source,
                phases,
            });
        }
    }
}

/// A scope range an aura reaches a supporting unit's neighbours with.
fn is_aura_scope(range: &str) -> bool {
    range.starts_with("aura-") || range == "any-on-battlefield" || range == "any-visible"
}

impl Dataset {
    /// A unit resolved within `faction` when one is known (unit ids are shared across
    /// factions), else the first registered copy.
    fn resolve_unit(&self, id: &str, faction: Option<&str>) -> Option<&Unit> {
        faction
            .and_then(|f| self.units.get_in_faction(id, f))
            .or_else(|| self.units.get_any(id))
    }

    /// Every ability that could apply to the input unit in `phase`, in a stable source order:
    /// army, detachment, detachment stratagems, the unit's own, attached members', then
    /// supporting units' auras. Mirrors TS `resolveEligibleAbilities`.
    pub fn eligible_abilities(
        &self,
        input: &EligibilityInput,
        phase: Phase,
    ) -> Vec<EligibleAbility<'_>> {
        let Some(unit) = self.resolve_unit(&input.unit_id, input.faction_id.as_deref()) else {
            return Vec::new();
        };
        let faction_id = input
            .faction_id
            .clone()
            .unwrap_or_else(|| unit.faction_id.to_string());
        let mut c = Collector {
            ds: self,
            phase,
            seen: HashSet::new(),
            out: Vec::new(),
        };
        // 1. Army: faction-typed abilities of the faction.
        for ability in self.abilities.by_faction(&faction_id) {
            if json_str(&ability.ability_type) == "faction" {
                c.push_phased(ability, EligibleAbilitySource::Army);
            }
        }
        if let Some(detachment_id) = input.detachment_id.as_deref() {
            // 2. Detachment abilities.
            for ability in self.abilities.all() {
                let own = ability.detachment_id.as_ref().map(|d| d.as_str()) == Some(detachment_id);
                if json_str(&ability.ability_type) == "detachment" && own {
                    let source = EligibleAbilitySource::Detachment {
                        detachment_id: detachment_id.to_string(),
                    };
                    c.push_phased(ability, source);
                }
            }
            // 3. Detachment stratagems, each yielding the ability it references.
            let detachment = self
                .detachments
                .get_in_faction(detachment_id, &faction_id)
                .or_else(|| self.detachments.get_any(detachment_id));
            for strat_id in detachment
                .map(|d| d.stratagem_ids.as_slice())
                .unwrap_or_default()
            {
                let Some(stratagem) = self.stratagems.get(strat_id.as_str()) else {
                    continue;
                };
                if !stratagem.phases.contains(&phase) {
                    continue;
                }
                let ability = stratagem.ability_id.as_ref().and_then(|id| {
                    self.abilities
                        .get_in_faction(id.as_str(), &faction_id)
                        .or_else(|| self.abilities.get_any(id.as_str()))
                });
                let Some(ability) = ability else {
                    continue;
                };
                let source = EligibleAbilitySource::DetachmentStratagem {
                    stratagem_id: stratagem.id.to_string(),
                    cp_cost: stratagem.cp_cost,
                };
                // The stratagem's printed phase governs eligibility.
                c.push(ability, source, vec![phase]);
            }
        }
        // 4. The unit's own abilities.
        for ability in self.abilities_of(unit) {
            let source = EligibleAbilitySource::Unit {
                unit_id: input.unit_id.clone(),
            };
            c.push_phased(ability, source);
        }
        // 5. Attached members: the combined unit pools every member's abilities in full.
        for member_id in &input.attached_unit_ids {
            let Some(member) = self.resolve_unit(member_id, Some(&faction_id)) else {
                continue;
            };
            for ability in self.abilities_of(member) {
                let source = EligibleAbilitySource::Attached {
                    unit_id: member_id.clone(),
                };
                c.push_phased(ability, source);
            }
        }
        // 6. Supporting units: only aura-scoped abilities reach the input unit.
        for support_id in &input.supporting_unit_ids {
            let Some(supporter) = self.resolve_unit(support_id, Some(&faction_id)) else {
                continue;
            };
            for ability in self.abilities_of(supporter) {
                // The schema no longer carries `scope.range`; read it from the JSON form the way
                // the TS resolver reads the raw record.
                let scope = serde_json::to_value(&ability.scope).unwrap_or(Value::Null);
                let range = scope.get("range").and_then(Value::as_str).unwrap_or("");
                if !is_aura_scope(range) {
                    continue;
                }
                let source = EligibleAbilitySource::Support {
                    source_unit_id: support_id.clone(),
                };
                c.push_phased(ability, source);
            }
        }
        c.out
    }

    /// The ability's buff translation: its rules bundles expanded, gated on its trigger (or
    /// else its usage limit), with an aura's single inch range stamped on every buff. Mirrors
    /// TS `AbilityView.describeBuffs`; `context` defaults to the shooting phase.
    pub fn describe_buffs(
        &self,
        ability: &Ability,
        source: &BuffSource,
        context: Option<&EngineContext>,
        perspective: TranslationPerspective,
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
        let resolved = self.resolve_rules_bundles(&effect, &mut seen, ability);
        let gated = trigger_gated(raw.get("behavior"), raw.get("trigger"), &resolved)
            .unwrap_or_else(|| usage_gated(raw.get("ability_type"), raw.get("usage"), &resolved));
        let mut translated = effect_to_buffs(&gated, source, ctx, perspective);
        // An aura gates on distance to the target; only a single inch range gates.
        if let Some(range) = aura_inches(&resolved) {
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
    ) -> Vec<Buff> {
        self.describe_buffs(ability, source, context, perspective)
            .applied
    }

    /// Expand entity-backed ability grants (`ability-grant` with `rules_bundle: true`) into
    /// the referenced rules bundle. Unresolved, malformed and cyclic references stay as they
    /// are so the translator reports them.
    fn resolve_rules_bundles(
        &self,
        effect: &Value,
        seen: &mut Vec<String>,
        owner: &Ability,
    ) -> Value {
        match effect {
            Value::Array(items) => Value::Array(
                items
                    .iter()
                    .map(|x| self.resolve_rules_bundles(x, seen, owner))
                    .collect(),
            ),
            Value::Object(node) => {
                if let Some(target) = self.rules_bundle_target(node, seen, owner) {
                    let id = node["modifier"]["ability"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    let mut next = seen.clone();
                    next.push(id);
                    return self.resolve_rules_bundles(&target, &mut next, owner);
                }
                Value::Object(
                    node.iter()
                        .map(|(k, v)| (k.clone(), self.resolve_rules_bundles(v, seen, owner)))
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
        owner: &Ability,
    ) -> Option<Value> {
        if node.get("type").and_then(Value::as_str) != Some("ability-grant") {
            return None;
        }
        let modifier = node.get("modifier")?.as_object()?;
        let id = modifier.get("ability")?.as_str()?;
        if modifier.get("rules_bundle") != Some(&Value::Bool(true)) || seen.iter().any(|s| s == id)
        {
            return None;
        }
        let target = owner
            .faction_id
            .as_ref()
            .and_then(|f| self.abilities.get_in_faction(id, f.as_str()))
            .or_else(|| self.abilities.get_any(id))?;
        let effect = strip_nulls(&serde_json::to_value(&target.effect).ok()?);
        (effect.get("type").and_then(Value::as_str) == Some("rules-bundle")).then_some(effect)
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
    let null = Value::Null;
    let triggers: Vec<&Value> = match trigger {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(t) => vec![t],
        None => vec![&null],
    };
    if triggers.into_iter().any(is_attack_step) {
        return None;
    }
    moment_gate(trigger, effect)
}

/// An ability's effect gated on its usage limit: using it is the player's choice, so its buffs
/// are an opt-in lever. Several limits are one use; the first names the lever. A stratagem is
/// already opt-in.
pub fn usage_gated(ability_type: Option<&Value>, usage: Option<&Value>, effect: &Value) -> Value {
    let limit = match usage {
        Some(Value::Array(a)) => a.first(),
        other => other,
    };
    let frequency = limit
        .and_then(Value::as_object)
        .and_then(|l| l.get("frequency"))
        .and_then(Value::as_str);
    match frequency {
        Some(f)
            if !effect.is_null() && ability_type.and_then(Value::as_str) != Some("stratagem") =>
        {
            json!({
                "type": "conditional",
                "condition": { "type": "timing-is", "parameters": { "timing": f } },
                "effect": effect,
            })
        }
        _ => effect.clone(),
    }
}

/// The one inch range every aura-filtered effect target in `effect` reaches, if exactly one.
pub fn aura_inches(effect: &Value) -> Option<f64> {
    fn walk(node: &Value, found: &mut Vec<f64>) {
        match node {
            Value::Array(a) => a.iter().for_each(|x| walk(x, found)),
            Value::Object(o) => {
                let inches = o
                    .get("target")
                    .and_then(|t| t.pointer("/within/range/inches"))
                    .and_then(Value::as_f64);
                if let (Some(Value::String(_)), Some(i)) = (o.get("type"), inches) {
                    if !found.contains(&i) {
                        found.push(i);
                    }
                }
                o.values().for_each(|x| walk(x, found));
            }
            _ => {}
        }
    }
    let mut found = Vec::new();
    walk(effect, &mut found);
    match found.as_slice() {
        [only] => Some(*only),
        _ => None,
    }
}

#[cfg(test)]
#[path = "abilities_tests.rs"]
mod tests;
