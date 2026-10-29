//! The mortal wounds a unit's abilities inflict on an enemy unit outside its attacks, as
//! [`Dataset::mortal_wound_sources_for`] answers them. Mirrors
//! `tools/src/data/dataset-mortals.ts`.

use std::collections::HashSet;

use serde_json::Value;

use super::abilities::{EligibilityInput, EligibleAbilitySource};
use super::dataset::Dataset;
use crate::cruncher::from_dsl::strip_nulls;
use crate::cruncher::{
    combined_toughness, mortal_wound_sources, EngineContext, MortalWoundSource, UnsupportedFragment,
};
use crate::{Phase, Unit};

const PHASES: [Phase; 5] = [
    Phase::Command,
    Phase::Movement,
    Phase::Shooting,
    Phase::Charge,
    Phase::Fight,
];

/// One [`MortalWoundSource`] with the ability that inflicts it.
#[derive(Clone, Debug, PartialEq)]
pub struct AbilityMortalWounds {
    pub source: MortalWoundSource,
    pub ability_id: String,
    /// The ability's name.
    pub label: String,
    /// The Stratagem's CP cost, for a Stratagem.
    pub cp: Option<i64>,
}

/// A fragment of an ability the translation could not model.
#[derive(Clone, Debug, PartialEq)]
pub struct AbilityUnsupported {
    pub ability_id: String,
    pub fragment: UnsupportedFragment,
}

/// The result of [`Dataset::mortal_wound_sources_for`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MortalWoundSources {
    pub sources: Vec<AbilityMortalWounds>,
    pub unsupported: Vec<AbilityUnsupported>,
}

/// Lower-cased union of the units' keywords and faction keywords.
fn combined_keywords_lower(units: &[&Unit]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for unit in units {
        for keyword in unit
            .keywords
            .iter()
            .chain(unit.faction_keywords.iter())
            .flat_map(|list| list.iter())
        {
            let lower = keyword.to_lowercase();
            if seen.insert(lower.clone()) {
                out.push(lower);
            }
        }
    }
    out
}

/// Lower-cased keywords and faction keywords every one of the units carries.
fn shared_keywords_lower(units: &[&Unit]) -> Vec<String> {
    let sets: Vec<Vec<String>> = units
        .iter()
        .map(|unit| combined_keywords_lower(&[unit]))
        .collect();
    let Some((first, rest)) = sets.split_first() else {
        return Vec::new();
    };
    first
        .iter()
        .filter(|keyword| rest.iter().all(|set| set.contains(keyword)))
        .cloned()
        .collect()
}

impl Dataset {
    /// The engine context the attacker-side collectors translate under: `context` with the input
    /// unit's attachment, keywords, army faction and Toughness filled in where `context` leaves
    /// them unset. Mirrors TS `buffContext` for the attacker perspective; roles come from
    /// `context.attachment_roles`.
    fn attacker_buff_context(
        &self,
        input: &EligibilityInput,
        context: &EngineContext,
    ) -> EngineContext {
        let unit = self.resolve_unit(&input.unit_id, input.faction_id.as_deref());
        let faction_id = input
            .faction_id
            .clone()
            .or_else(|| unit.map(|unit| unit.faction_id.to_string()));
        let mut combined: Vec<&Unit> = unit.into_iter().collect();
        for id in &input.attached_unit_ids {
            let member = faction_id
                .as_deref()
                .and_then(|faction| self.units.get_in_faction(id, faction))
                .or_else(|| self.units.get_any(id));
            combined.extend(member);
        }
        let mut ctx = context.clone();
        ctx.attacker_attached
            .get_or_insert(!input.attached_unit_ids.is_empty());
        ctx.attacker_unit_id
            .get_or_insert_with(|| input.unit_id.clone());
        if ctx.army_faction.is_none() {
            ctx.army_faction = faction_id;
        }
        if ctx.attacker_attachment_role.is_none() {
            ctx.attacker_attachment_role = context
                .attachment_roles
                .as_ref()
                .and_then(|roles| roles.get(&input.unit_id))
                .copied();
        }
        if !combined.is_empty() {
            if ctx.attacker_keywords.is_none() {
                ctx.attacker_keywords = Some(combined_keywords_lower(&combined));
            }
            if ctx.attacker_model_keywords.is_none() {
                ctx.attacker_model_keywords = Some(shared_keywords_lower(&combined));
            }
        }
        if ctx.attacker_toughness.is_none() {
            ctx.attacker_toughness =
                combined_toughness(&combined, context.attachment_roles.as_ref());
        }
        ctx
    }

    /// The mortal wounds a unit's abilities inflict on an enemy unit outside its attacks: after a
    /// Charge move, at the start of a phase, when it is selected to shoot. Each source gives the
    /// expected mortal wounds per occurrence of its moment, before Feel No Pain, assuming each of
    /// its `needs` holds (answer one false in `context.condition_facts` to remove it). `phase-is`
    /// conditions never gate a source, so the context's phase does not filter them. Mortal wounds
    /// an attack's own rolls inflict are buffs, not sources; mortal wounds the unit inflicts on
    /// itself are not reported.
    pub fn mortal_wound_sources_for(
        &self,
        input: &EligibilityInput,
        context: &EngineContext,
    ) -> MortalWoundSources {
        let ctx = self.attacker_buff_context(input, context);
        let mut out = MortalWoundSources::default();
        let mut seen = HashSet::new();
        // A source happens at its own moment, whatever phase the attack is made in: walk every phase.
        for phase in PHASES {
            for entry in self.eligible_abilities(input, phase) {
                let ability = entry.ability;
                let ability_id = ability.ability_id.to_string();
                if !seen.insert(ability_id.clone()) {
                    continue;
                }
                let raw =
                    strip_nulls(&serde_json::to_value(ability).expect("an ability serializes"));
                let null = Value::Null;
                let translation = mortal_wound_sources(
                    &ability_id,
                    raw.get("effect").unwrap_or(&null),
                    raw.get("trigger").unwrap_or(&null),
                    &ctx,
                    entry.rating.as_ref(),
                );
                let cp = match &entry.source {
                    EligibleAbilitySource::DetachmentStratagem { cp_cost, .. } => Some(*cp_cost),
                    _ => None,
                };
                for source in translation.sources {
                    out.sources.push(AbilityMortalWounds {
                        source,
                        ability_id: ability_id.clone(),
                        label: ability.name.clone(),
                        cp,
                    });
                }
                for fragment in translation.unsupported {
                    out.unsupported.push(AbilityUnsupported {
                        ability_id: ability_id.clone(),
                        fragment,
                    });
                }
            }
        }
        out
    }
}
