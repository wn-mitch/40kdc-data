//! Abilities as buffs: which abilities could apply to a chosen unit in a phase (the
//! abilities resolver) and the buff translation of one ability record (rules-bundle
//! expansion, trigger and usage gates, aura range). Mirrors
//! `tools/src/abilities-resolver/resolver.ts` and `AbilityView.describeBuffs` /
//! canonical trigger and activation handling; the
//! `conformance/abilities-resolver` corpus pins the shared contract.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::ability_refs::{rating_of, with_rating};
use super::dataset::Dataset;
use super::normalize::normalize_name;
use crate::cruncher::buffs::{Buff, BuffSource, EngineContext};
use crate::cruncher::from_dsl::{
    effect_to_buffs_with_duration, moment_gate, strip_nulls, EffectTranslation,
    TranslationPerspective,
};
use crate::{Ability, GameModeId, Phase, Unit};

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
    /// The rating the owning unit prints for a rated rule (Feel No Pain 5+ → `5`).
    pub rating: Option<Value>,
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
    fn push_phased(
        &mut self,
        ability: &'a Ability,
        source: EligibleAbilitySource,
        rating: Option<Value>,
    ) {
        if self.phase_matches(ability) {
            let phases = self.intersect(ability);
            self.push(ability, source, phases, rating);
        }
    }

    fn push(
        &mut self,
        ability: &'a Ability,
        source: EligibleAbilitySource,
        phases: Vec<Phase>,
        rating: Option<Value>,
    ) {
        let key = format!("{}::{}", source.kind(), ability.ability_id.as_str());
        if self.seen.insert(key) {
            self.out.push(EligibleAbility {
                ability,
                source,
                phases,
                rating,
            });
        }
    }
}

/// Whether an effect can reach a unit other than its own: an aura, a unit-filter target
/// (friendly or enemy), or a unit selection. The translator decides what of it reaches the input
/// unit. Mirrors TS `reachesOtherUnits`.
pub(crate) fn reaches_other_units(effect: &Value) -> bool {
    match effect {
        Value::Array(a) => a.iter().any(reaches_other_units),
        Value::Object(node) => {
            if matches!(
                node.get("type").and_then(Value::as_str),
                Some("aura" | "select-units")
            ) {
                return true;
            }
            if node.get("type").and_then(Value::as_str) == Some("ability-grant")
                && matches!(
                    node.get("target").and_then(Value::as_str),
                    Some("this-model" | "model-in-this-unit")
                )
            {
                // A model-only grant remains on that model; its nested definition
                // must not make the owning unit look like an aura source.
                return false;
            }
            if let Some(Value::Object(target)) = node.get("target") {
                if matches!(
                    target.get("owner").and_then(Value::as_str),
                    Some("friendly" | "enemy")
                ) {
                    return true;
                }
                if node.get("type").and_then(Value::as_str) == Some("ability-grant")
                    && target.get("level").and_then(Value::as_str) == Some("model")
                {
                    // A model-only grant remains on that model; its nested definition
                    // must not make the owning unit look like an aura source.
                    return false;
                }
            }
            node.values().any(reaches_other_units)
        }
        _ => false,
    }
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
        // 1. Army: faction-typed abilities of the faction. One with a `detachment_id` (a Combat
        // Patrol box's own army rule) applies only in that detachment, and there it replaces each
        // army rule it names with an `interactions` entry of type `replaces`. In a Combat Patrol
        // detachment only the army rules it lists apply.
        let detachment = input.detachment_id.as_deref();
        let army: Vec<_> = self
            .abilities
            .by_faction(&faction_id)
            .into_iter()
            .filter(|ability| json_str(&ability.ability_type) == "faction")
            .filter(|ability| match ability.detachment_id.as_ref() {
                None => true,
                Some(own) => Some(own.as_str()) == detachment,
            })
            .collect();
        let mut replaced: HashSet<String> = army
            .iter()
            .flat_map(|ability| ability.interactions.iter())
            .filter(|entry| json_str(&entry.type_) == "replaces")
            .map(|entry| entry.ability_ref.to_string())
            .collect();
        // A Combat Patrol detachment's `detachment_rule_ids` are its complete army-rule set: every
        // army rule it does not list leaves the `army` kind.
        let patrol = detachment
            .and_then(|id| {
                self.detachments
                    .get_in_faction(id, &faction_id)
                    .or_else(|| self.detachments.get_any(id))
            })
            .filter(|d| {
                d.game_modes
                    .as_ref()
                    .is_some_and(|modes| modes.contains(&GameModeId::CombatPatrol))
            });
        if let Some(patrol) = patrol {
            let listed: HashSet<&str> = patrol
                .detachment_rule_ids
                .iter()
                .flatten()
                .map(|id| id.as_str())
                .collect();
            for ability in &army {
                if !listed.contains(ability.ability_id.as_str()) {
                    replaced.insert(ability.ability_id.to_string());
                }
            }
        }
        for ability in army {
            if !replaced.contains(ability.ability_id.as_str()) {
                c.push_phased(ability, EligibleAbilitySource::Army, None);
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
                    c.push_phased(ability, source, None);
                }
            }
            // 3. Detachment stratagems, each yielding the ability it references, when the unit can
            // be the stratagem's friendly target. Each member's keywords; a unit target reads them
            // as one combined unit.
            let members: Vec<HashSet<String>> = std::iter::once(Some(unit))
                .chain(
                    input
                        .attached_unit_ids
                        .iter()
                        .map(|id| self.resolve_unit(id, Some(&faction_id))),
                )
                .map(|member| {
                    member
                        .into_iter()
                        .flat_map(|m| [&m.keywords, &m.faction_keywords])
                        .flatten()
                        .flat_map(|list| list.0.iter().map(|k| k.to_lowercase()))
                        .collect()
                })
                .collect();
            let printed = self.printed_keyword();
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
                // Ability ids are unique: one record per stratagem, wherever its detachment is
                // replicated.
                let ability = stratagem
                    .ability_id
                    .as_ref()
                    .and_then(|id| self.abilities.get(id.as_str()));
                let Some(ability) = ability else {
                    continue;
                };
                let subject = ability
                    .trigger
                    .as_ref()
                    .and_then(|t| serde_json::to_value(t).ok())
                    .and_then(|t| t.get("subject").cloned());
                if !stratagem_can_target_unit(stratagem, &members, subject.as_ref(), &printed) {
                    continue;
                }
                let source = EligibleAbilitySource::DetachmentStratagem {
                    stratagem_id: stratagem.id.to_string(),
                    cp_cost: stratagem.cp_cost,
                };
                // The stratagem's printed phase governs eligibility.
                c.push(ability, source, vec![phase], None);
            }
        }
        // 4. The unit's own abilities.
        for ability in self.abilities_of(unit) {
            let source = EligibleAbilitySource::Unit {
                unit_id: input.unit_id.clone(),
            };
            c.push_phased(
                ability,
                source,
                rating_of(unit, ability.ability_id.as_str()),
            );
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
                c.push_phased(
                    ability,
                    source,
                    rating_of(member, ability.ability_id.as_str()),
                );
            }
        }
        // 6. Supporting units: only abilities that can reach another unit (an aura, a friendly or
        // enemy unit filter, a unit selection); one that only names its own unit describes a buff
        // that never reaches the input unit.
        for support_id in &input.supporting_unit_ids {
            let Some(supporter) = self.resolve_unit(support_id, Some(&faction_id)) else {
                continue;
            };
            for ability in self.abilities_of(supporter) {
                if !reaches_other_units(
                    &serde_json::to_value(&ability.effect).unwrap_or(Value::Null),
                ) {
                    continue;
                }
                let source = EligibleAbilitySource::Support {
                    source_unit_id: support_id.clone(),
                };
                let rating = rating_of(supporter, ability.ability_id.as_str());
                c.push_phased(ability, source, rating);
            }
        }
        c.out
    }

    /// Expand rules bundles and resolve triggers before attaching parent usage requirements.
    /// Independent child groups and costs survive; an aura's inch range remains a gate. A rated
    /// rule (`{rating: true}`) reads `rating`, the rating the owning unit prints
    /// ([`EligibleAbility::rating`]). Mirrors TS `AbilityView.describeBuffs`; `context`
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
                Ok(effect) => effect,
                Err(reason) => {
                    return EffectTranslation {
                        unsupported: vec![crate::cruncher::from_dsl::UnsupportedFragment {
                            reason: reason.into(),
                            effect_fragment: resolved,
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
        );
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

fn aura_inches_for_round(effect: &Value, battle_round: Option<u32>) -> Option<f64> {
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
                let mut range = o.get("target").and_then(|t| t.pointer("/within/range"));
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

#[cfg(test)]
#[path = "abilities_tests.rs"]
mod tests;

/// Whether a unit with `keywords` (lower-cased) can be a stratagem's friendly target. A stratagem
/// with no friendly target (none printed, or only enemy targets) does not restrict its user here;
/// with several friendly targets, matching any one is enough. The resolver does not know which
/// model is the Warlord, so a Warlord target only needs a unit that could contain it: one with
/// CHARACTER, the keyword every Warlord carries. Mirrors TS `stratagemCanTarget`.
pub fn stratagem_can_target(stratagem: &crate::Stratagem, keywords: &HashSet<String>) -> bool {
    stratagem_can_target_unit(stratagem, std::slice::from_ref(keywords), None, &|_| true)
}

/// Whether a unit of `members` (each member's keywords: a unit and the units attached to it) can
/// be a stratagem's friendly target, as [`stratagem_can_target`]. A target that selects a model
/// needs one member that meets it alone; a unit target reads every member as one combined unit. A
/// target bound to the triggering unit is also held to the keyword lists of `trigger_subject` (its
/// ability's `trigger.subject`). A keyword that subject requires and no datasheet prints (`printed`
/// says which do) is gained in play, so it is not held against a unit. Keywords compare by
/// [`normalize_name`]. Mirrors TS `stratagemCanTargetUnit`.
pub fn stratagem_can_target_unit(
    stratagem: &crate::Stratagem,
    members: &[HashSet<String>],
    trigger_subject: Option<&Value>,
    printed: &dyn Fn(&str) -> bool,
) -> bool {
    let Some(raw) = stratagem
        .target_restrictions
        .as_ref()
        .and_then(|t| serde_json::to_value(t).ok())
    else {
        return true;
    };
    let targets: Vec<&Value> = match &raw {
        Value::Array(items) => items.iter().collect(),
        Value::Null => return true,
        other => vec![other],
    };
    let friendly: Vec<&Value> = targets
        .into_iter()
        .filter(|target| target.get("side").and_then(Value::as_str) != Some("enemy"))
        .collect();
    if friendly.is_empty() {
        return true;
    }
    let normalized: Vec<HashSet<String>> = members
        .iter()
        .map(|member| member.iter().map(|k| normalize_name(k)).collect())
        .collect();
    let combined: HashSet<String> = normalized.iter().flatten().cloned().collect();
    let subject = friendly_subject(trigger_subject);
    friendly.iter().any(|target| {
        let candidates: Vec<&HashSet<String>> =
            if target.get("selects").and_then(Value::as_str) == Some("model") {
                normalized.iter().collect()
            } else {
                vec![&combined]
            };
        candidates.into_iter().any(|keywords| {
            let has = |keyword: &str| keywords.contains(&normalize_name(keyword));
            let gained = |keyword: &str| has(keyword) || !printed(keyword);
            let warlord = target.get("warlord").and_then(Value::as_bool) == Some(true);
            let bound = target.get("bound_to").and_then(Value::as_str) == Some("triggering-unit");
            (!warlord || has("character"))
                && keyword_lists_hold(target, &has, &has)
                && (!bound
                    || subject
                        .as_ref()
                        .is_none_or(|subject| keyword_lists_hold(subject, &gained, &has)))
        })
    })
}

/// A trigger subject's keyword lists, as a target restriction, when it names a friendly unit.
fn friendly_subject(subject: Option<&Value>) -> Option<Value> {
    let subject = subject?.as_object()?;
    if subject
        .get("owner")
        .is_some_and(|owner| owner.as_str() != Some("friendly"))
    {
        return None;
    }
    let list = |key: &str| {
        subject
            .get(key)
            .cloned()
            .unwrap_or(Value::Array(Vec::new()))
    };
    Some(json!({
        "required_keywords": list("all_of"),
        "required_keywords_any": list("any_of"),
        "excluded_keywords": list("none_of"),
    }))
}

/// Whether a target's required lists hold by `required` and none of its excluded keywords holds
/// by `excluded`.
fn keyword_lists_hold(
    target: &Value,
    required: &dyn Fn(&str) -> bool,
    excluded: &dyn Fn(&str) -> bool,
) -> bool {
    let list = |key: &str| -> Vec<&str> {
        target
            .get(key)
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    };
    let any = list("required_keywords_any");
    list("required_keywords").into_iter().all(required)
        && (any.is_empty() || any.into_iter().any(required))
        && !list("excluded_keywords").into_iter().any(excluded)
}

impl Dataset {
    /// Whether some datasheet prints a keyword (unit or faction keyword), memoised per lookup.
    fn printed_keyword(&self) -> impl Fn(&str) -> bool + '_ {
        let seen = std::cell::RefCell::new(std::collections::HashMap::<String, bool>::new());
        move |keyword: &str| {
            let key = normalize_name(keyword);
            if let Some(found) = seen.borrow().get(&key) {
                return *found;
            }
            let found = self.units.all().iter().any(|unit| {
                [&unit.keywords, &unit.faction_keywords]
                    .into_iter()
                    .flatten()
                    .any(|list| list.0.iter().any(|own| normalize_name(own) == key))
            });
            seen.borrow_mut().insert(key, found);
            found
        }
    }
}
