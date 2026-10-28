//! Rediscover valid source-owned persistent effects after an attachment has ended.

use super::{dataset::unit_keyword_set, Dataset, EligibilityInput};
use crate::cruncher::{AbilityKind, BuffSource, EngineContext, TranslationPerspective};
use crate::{Ability, Enhancement, Unit, UnitRole};

/// A historical source still backed by a current intrinsic ability or eligible enhancement.
pub struct HistoricalSnapshotAbility<'a> {
    pub ability: &'a Ability,
    pub source: &'a BuffSource,
}

impl Dataset {
    /// Enumerate attested sources independently of current attachment membership.
    /// `describe_buffs` still checks exact trigger, selector and recipient fingerprints.
    pub fn historical_snapshot_abilities<'a>(
        &'a self,
        input: &EligibilityInput,
        context: &'a EngineContext,
        perspective: TranslationPerspective,
    ) -> Vec<HistoricalSnapshotAbility<'a>> {
        let faction = input.faction_id.as_deref().or_else(|| {
            self.units
                .get_any(&input.unit_id)
                .map(|unit| unit.faction_id.as_str())
        });
        let Some(faction) = faction else {
            return Vec::new();
        };
        let mut result: Vec<HistoricalSnapshotAbility<'a>> = Vec::new();
        for snapshot in &context.recipient_snapshots {
            if snapshot.perspective != perspective || snapshot.recipient_unit_id != input.unit_id {
                continue;
            }
            let BuffSource::Ability {
                ability_id,
                ability_kind,
                source_unit_id,
                ..
            } = &snapshot.source
            else {
                continue;
            };
            match ability_kind {
                AbilityKind::Unit if snapshot.source_unit_id == input.unit_id => {}
                AbilityKind::Attached | AbilityKind::Support
                    if source_unit_id.as_deref() == Some(snapshot.source_unit_id.as_str()) => {}
                _ => continue,
            }
            let Some(owner) = self.units.get_in_faction(&snapshot.source_unit_id, faction) else {
                continue;
            };
            let Some(ability) = self
                .abilities
                .get_in_faction(ability_id, faction)
                .or_else(|| self.abilities.get_in_faction(ability_id, "core"))
            else {
                continue;
            };
            let intrinsic = owner.ability_ids.iter().any(|held| held.id() == ability_id);
            let enhancement = self.enhancements.iter().any(|item| {
                item.ability_id
                    .as_ref()
                    .is_some_and(|id| id.as_str() == ability_id)
                    && input.detachment_id.as_deref() == Some(item.detachment_id.as_str())
                    && self.snapshot_enhancement_eligible(item, owner)
            });
            if !intrinsic && !enhancement {
                continue;
            }
            if !result.iter().any(|entry| {
                entry.ability.ability_id == ability.ability_id && entry.source == &snapshot.source
            }) {
                result.push(HistoricalSnapshotAbility {
                    ability,
                    source: &snapshot.source,
                });
            }
        }
        result
    }

    fn snapshot_enhancement_eligible(&self, enhancement: &Enhancement, bearer: &Unit) -> bool {
        let keywords = unit_keyword_set(bearer);
        let has = |keyword: &str| keywords.contains(&keyword.to_lowercase());
        if (!has("character") && !enhancement.upgrade_tag)
            || matches!(bearer.role, Some(UnitRole::EpicHero))
            || has("epic hero")
        {
            return false;
        }
        if let Some(composition) = self
            .unit_compositions
            .iter()
            .find(|entry| entry.unit_id == bearer.id && entry.faction_id == bearer.faction_id)
        {
            if !composition.models.is_empty()
                && composition
                    .models
                    .iter()
                    .all(|model| model.excluded_from_enhancements)
            {
                return false;
            }
        }
        // Keyword groups or datasheet groups (mirror of TS `meetsEnhancementGroups`).
        let keyword_eligible = if let Some(groups) = &enhancement.keyword_restriction_groups {
            Some(
                groups
                    .iter()
                    .any(|group| group.iter().all(|keyword| has(keyword.as_str()))),
            )
        } else {
            enhancement
                .keyword_restrictions
                .as_ref()
                .map(|keywords| keywords.0.iter().all(|keyword| has(keyword.as_str())))
        };
        let datasheet_eligible = enhancement
            .datasheet_restriction_groups
            .iter()
            .any(|group| {
                group.unit_id.as_str() == bearer.id.as_str()
                    && group
                        .keywords
                        .as_ref()
                        .is_none_or(|keywords| keywords.iter().all(|keyword| has(keyword.as_str())))
            });
        let eligible = match keyword_eligible {
            Some(ok) => ok || datasheet_eligible,
            None => enhancement.datasheet_restriction_groups.is_empty() || datasheet_eligible,
        };
        eligible
            && enhancement
                .exclusion_keywords
                .as_ref()
                .is_none_or(|keywords| !keywords.0.iter().any(|keyword| has(keyword.as_str())))
    }
}
