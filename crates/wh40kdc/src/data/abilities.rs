//! The abilities resolver: which abilities could apply to a chosen unit in a phase. Mirrors
//! `tools/src/abilities-resolver/resolver.ts`; the `conformance/abilities-resolver` corpus pins
//! the shared contract. The buff translation of one ability record lives in `describe_buffs`.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ability_gates::{applies_to_unit, member_keywords, suppressed_ability_ids};
use super::ability_refs::rating_of;
use super::dataset::Dataset;
use super::stratagem_targets::{has_friendly_target, stratagem_can_target_unit};
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
                let owner = target.get("owner").and_then(Value::as_str);
                // A friendly filter bounded to the holder's own unit stays on it.
                let own_unit = owner == Some("friendly")
                    && matches!(
                        target.get("member_of").and_then(Value::as_str),
                        Some("this-unit" | "this-model")
                    );
                if (owner == Some("friendly") && !own_unit) || owner == Some("enemy") {
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
    pub(super) fn resolve_unit(&self, id: &str, faction: Option<&str>) -> Option<&Unit> {
        faction
            .and_then(|f| self.units.get_in_faction(id, f))
            .or_else(|| self.units.get_any(id))
    }

    /// Every ability that could apply to the input unit in `phase`, in a stable source order:
    /// army, detachment, detachment stratagems, the unit's own, attached members', then
    /// supporting units' auras. Mirrors TS `resolveEligibleAbilities`.
    ///
    /// Abilities the unit's standing rules suppress ([`Dataset::suppressed_abilities`]) are
    /// dropped.
    pub fn eligible_abilities(
        &self,
        input: &EligibilityInput,
        phase: Phase,
    ) -> Vec<EligibleAbility<'_>> {
        let (mut entries, suppressed) = self.resolve_with_suppressions(input, phase);
        if !suppressed.is_empty() {
            entries.retain(|entry| !suppressed.contains(entry.ability.ability_id.as_str()));
        }
        entries
    }

    /// The ability ids the unit's standing rules suppress for `input` (see
    /// [`Dataset::eligible_abilities`], which already drops them). A caller that pools several
    /// detachments' passes drops each pass's suppressions from all of them. Mirrors TS
    /// `suppressedAbilities`.
    pub fn suppressed_abilities(&self, input: &EligibilityInput, phase: Phase) -> HashSet<String> {
        self.resolve_with_suppressions(input, phase).1
    }

    /// The eligible abilities before suppression, and the ids standing rules suppress.
    fn resolve_with_suppressions(
        &self,
        input: &EligibilityInput,
        phase: Phase,
    ) -> (Vec<EligibleAbility<'_>>, HashSet<String>) {
        let Some(unit) = self.resolve_unit(&input.unit_id, input.faction_id.as_deref()) else {
            return (Vec::new(), HashSet::new());
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
        // Each member's keywords; a unit target and `applies_to` read them as one combined unit.
        let members: Vec<HashSet<String>> = std::iter::once(Some(unit))
            .chain(
                input
                    .attached_unit_ids
                    .iter()
                    .map(|id| self.resolve_unit(id, Some(&faction_id))),
            )
            .map(|member| member_keywords(member, input.detachment_id.as_deref()))
            .collect();
        let printed = self.printed_keyword();
        let applies = |ability: &Ability| {
            let filter = ability
                .applies_to
                .as_ref()
                .and_then(|f| serde_json::to_value(f).ok());
            applies_to_unit(filter.as_ref(), &members, &printed)
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
            if !replaced.contains(ability.ability_id.as_str()) && applies(ability) {
                c.push_phased(ability, EligibleAbilitySource::Army, None);
            }
        }
        if let Some(detachment_id) = input.detachment_id.as_deref() {
            // 2. Detachment abilities.
            for ability in self.abilities.all() {
                let own = ability.detachment_id.as_ref().map(|d| d.as_str()) == Some(detachment_id);
                if json_str(&ability.ability_type) == "detachment" && own && applies(ability) {
                    let source = EligibleAbilitySource::Detachment {
                        detachment_id: detachment_id.to_string(),
                    };
                    c.push_phased(ability, source, None);
                }
            }
            // 3. Detachment stratagems, each yielding the ability it references, when the unit can
            // be the stratagem's friendly target.
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
                // A Stratagem with no friendly target keeps its unit requirement in its rule's
                // `applies_to`.
                if !has_friendly_target(stratagem) && !applies(ability) {
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
        // 4. The unit's own abilities. A unit lists the army rules its datasheet prints, but an army
        // rule is the army's (step 1, which also applies a Combat Patrol's replacements).
        for ability in self.abilities_of(unit) {
            if json_str(&ability.ability_type) == "faction" {
                continue;
            }
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
                if json_str(&ability.ability_type) == "faction" {
                    continue;
                }
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
                if json_str(&ability.ability_type) == "faction" {
                    continue;
                }
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
        let suppressed = suppressed_ability_ids(&c.out, &members, &printed);
        (c.out, suppressed)
    }
}

#[cfg(test)]
#[path = "abilities_tests.rs"]
mod tests;
