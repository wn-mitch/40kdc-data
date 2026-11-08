//! The defending unit's opt-in levers, as [`Dataset::defensive_levers_for`] answers them. Mirrors
//! TS `Dataset.defensiveLeversFor` (the `levers` sink of `collectBuffs` in
//! `tools/src/data/dataset-buffs.ts`).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::abilities::{stratagem_target_names, EligibilityInput, EligibleAbilitySource};
use super::dataset::Dataset;
use super::mortals::{combined_keywords_lower, shared_keywords_lower};
use crate::cruncher::{
    AbilityKind, ActivatableBuff, Buff, BuffSource, EngineContext, TranslationPerspective,
};
use crate::{Ability, Unit};

/// One opt-in lever: the buffs it adds when the player turns it on. Same shape as a TS
/// `StackableBuff` from `defensiveLeversFor`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefensiveLever {
    /// Stable toggle id.
    pub id: String,
    /// `"<ability name> — <activatable label>"`.
    pub label: String,
    /// Contributions this lever adds when enabled.
    pub buffs: Vec<Buff>,
    /// Default selection state: always `false`.
    pub enabled: bool,
    /// The ability the lever came from.
    pub source: BuffSource,
    /// Id of the [`LeverGroup`] pool this lever belongs to, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// Additional enclosing pools; every listed cap applies alongside `group`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<String>>,
    /// DSL fragments the player vouches for when turning the lever on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires: Option<Vec<Value>>,
}

/// A pool of [`DefensiveLever`]s limited to `max_activations` at once.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeverGroup {
    pub id: String,
    /// The ability whose activatable named the pool.
    pub ability_id: String,
    /// That ability's name.
    pub label: String,
    pub max_activations: i64,
}

/// The result of [`Dataset::defensive_levers_for`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DefensiveLevers {
    pub levers: Vec<DefensiveLever>,
    pub groups: Vec<LeverGroup>,
}

impl DefensiveLevers {
    /// Append each of an ability's activatables as an opt-in lever (first id wins) with the
    /// pools it names. An activatable that raises a pool's cap or is gated on a stance option is
    /// left out: nothing here resolves it against another lever.
    fn push(&mut self, ability: &Ability, source: &BuffSource, activatable: Vec<ActivatableBuff>) {
        for act in activatable {
            if act.cap_raise.is_some()
                || act.requires_option.is_some()
                || act.excludes_option.is_some()
            {
                continue;
            }
            if self.levers.iter().any(|lever| lever.id == act.id) {
                continue;
            }
            let pools: Vec<_> = act
                .group
                .iter()
                .chain(act.groups.iter().flatten())
                .cloned()
                .collect();
            self.levers.push(DefensiveLever {
                label: format!("{} — {}", ability.name, act.label),
                id: act.id,
                buffs: act.buffs,
                enabled: false,
                source: source.clone(),
                group: act.group.as_ref().map(|group| group.id.clone()),
                groups: act
                    .groups
                    .filter(|groups| !groups.is_empty())
                    .map(|groups| groups.into_iter().map(|group| group.id).collect()),
                requires: act.requires,
            });
            for group in pools {
                if self.groups.iter().any(|existing| existing.id == group.id) {
                    continue;
                }
                self.groups.push(LeverGroup {
                    id: group.id,
                    ability_id: ability.ability_id.to_string(),
                    label: ability.name.clone(),
                    max_activations: group.max_activations,
                });
            }
        }
    }
}

impl Dataset {
    /// The defending unit's player decisions: the activatable levers of its eligible abilities
    /// under target perspective (an optional ability, a usage-limited activation, a `choice`
    /// branch), each off by default, with the pools that cap them. Stratagems contribute only
    /// when named in `opted_in_stratagem_ids`. The defensive buff stack never applies these; a
    /// lever behind an undecided condition appears once that condition is answered true in
    /// `context.condition_facts`. Append each chosen lever's `buffs` to the defensive stack to
    /// crunch it. A lever that raises another pool's cap or applies only under a stance option is
    /// not listed. Mirrors TS `Dataset.defensiveLeversFor`.
    pub fn defensive_levers_for(
        &self,
        input: &EligibilityInput,
        opted_in_stratagem_ids: &[String],
        context: &EngineContext,
    ) -> DefensiveLevers {
        let ctx = self.target_buff_context(input, context);
        let mut out = DefensiveLevers::default();
        let opted_in: HashSet<&str> = opted_in_stratagem_ids.iter().map(String::as_str).collect();
        let mut visited: Vec<(String, BuffSource)> = Vec::new();
        for entry in self.eligible_abilities(input, ctx.phase) {
            if let EligibleAbilitySource::DetachmentStratagem { stratagem_id, .. } = &entry.source {
                if !opted_in.contains(stratagem_id.as_str()) {
                    continue;
                }
            }
            let source = self.buff_source_from_eligible(entry.ability, &entry.source);
            visited.push((entry.ability.ability_id.to_string(), source.clone()));
            let at = match &entry.source {
                EligibleAbilitySource::DetachmentStratagem { stratagem_id, .. } => {
                    self.stratagem_context(input, entry.ability, stratagem_id, &ctx)
                }
                _ => ctx.clone(),
            };
            let translation = self.describe_buffs(
                entry.ability,
                &source,
                Some(&at),
                TranslationPerspective::Target,
                entry.rating.as_ref(),
            );
            out.push(entry.ability, &source, translation.activatable);
        }
        for entry in self.historical_snapshot_abilities(input, &ctx, TranslationPerspective::Target)
        {
            let id = entry.ability.ability_id.to_string();
            if visited
                .iter()
                .any(|(seen, source)| *seen == id && source == entry.source)
            {
                continue;
            }
            let translation = self.describe_buffs(
                entry.ability,
                entry.source,
                Some(&ctx),
                TranslationPerspective::Target,
                None,
            );
            out.push(entry.ability, entry.source, translation.activatable);
        }
        out
    }

    /// The engine context the defensive walk translates under: `context` with the defending
    /// unit's attachment, unit id, army faction, attachment role and keywords filled in where
    /// `context` leaves them unset. Mirrors TS `buffContext` for the target perspective; roles
    /// come from `context.attachment_roles`.
    fn target_buff_context(
        &self,
        input: &EligibilityInput,
        context: &EngineContext,
    ) -> EngineContext {
        let combined = self.combined_units(input);
        let faction_id = input
            .faction_id
            .clone()
            .or_else(|| combined.first().map(|unit| unit.faction_id.to_string()));
        let mut ctx = context.clone();
        ctx.target_attached
            .get_or_insert(!input.attached_unit_ids.is_empty());
        ctx.target_unit_id
            .get_or_insert_with(|| input.unit_id.clone());
        if ctx.target_army_faction.is_none() {
            ctx.target_army_faction = faction_id;
        }
        if ctx.target_attachment_role.is_none() {
            ctx.target_attachment_role = context
                .attachment_roles
                .as_ref()
                .and_then(|roles| roles.get(&input.unit_id))
                .copied();
        }
        if !combined.is_empty() {
            if ctx.target_keywords.is_none() {
                ctx.target_keywords = Some(combined_keywords_lower(&combined));
            }
            if ctx.target_model_keywords.is_none() {
                ctx.target_model_keywords = Some(shared_keywords_lower(&combined));
            }
        }
        ctx
    }

    /// The input unit (faction-scoped when the input names a faction) followed by its attached
    /// units, resolved within the same faction.
    fn combined_units(&self, input: &EligibilityInput) -> Vec<&Unit> {
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
        combined
    }

    /// `ctx` with `stratagem_targets` filled in for an opted-in Stratagem: which of its named
    /// friendly targets the input unit (with the units attached to it) can be. Mirrors TS
    /// `stratagemContext`.
    fn stratagem_context(
        &self,
        input: &EligibilityInput,
        ability: &Ability,
        stratagem_id: &str,
        ctx: &EngineContext,
    ) -> EngineContext {
        let combined = self.combined_units(input);
        let (Some(stratagem), false) = (self.stratagems.get(stratagem_id), combined.is_empty())
        else {
            return ctx.clone();
        };
        if ctx.stratagem_targets.is_some() {
            return ctx.clone();
        }
        let members: Vec<HashSet<String>> = combined
            .iter()
            .map(|unit| combined_keywords_lower(&[unit]).into_iter().collect())
            .collect();
        let trigger = serde_json::to_value(&ability.trigger).unwrap_or(Value::Null);
        let printed = self.printed_keyword();
        let targets = stratagem_target_names(stratagem, &members, trigger.get("subject"), &printed);
        if targets.is_empty() {
            return ctx.clone();
        }
        let mut out = ctx.clone();
        out.stratagem_targets = Some(targets);
        out
    }

    /// The buff source the translator reads an eligible ability under. Mirrors TS
    /// `bufferSourceFromEligible`; a Stratagem that targets one model of the unit
    /// (`target_restrictions.selects: "model"` on a friendly target) sets `selects_model`.
    fn buff_source_from_eligible(
        &self,
        ability: &Ability,
        source: &EligibleAbilitySource,
    ) -> BuffSource {
        let (ability_kind, source_unit_id, selects_model) = match source {
            EligibleAbilitySource::Army => (AbilityKind::Army, None, None),
            EligibleAbilitySource::Detachment { .. } => (AbilityKind::Detachment, None, None),
            EligibleAbilitySource::DetachmentStratagem { stratagem_id, .. } => (
                AbilityKind::DetachmentStratagem,
                None,
                self.stratagem_selects_model(stratagem_id).then_some(true),
            ),
            EligibleAbilitySource::Unit { .. } => (AbilityKind::Unit, None, None),
            EligibleAbilitySource::Attached { unit_id } => {
                (AbilityKind::Attached, Some(unit_id.clone()), None)
            }
            EligibleAbilitySource::Support { source_unit_id } => {
                (AbilityKind::Support, Some(source_unit_id.clone()), None)
            }
        };
        BuffSource::Ability {
            ability_id: ability.ability_id.to_string(),
            ability_kind,
            source_unit_id,
            selects_model,
        }
    }

    /// Whether a friendly target of the Stratagem selects one model. Mirrors TS
    /// `stratagemSelectsModel`.
    fn stratagem_selects_model(&self, stratagem_id: &str) -> bool {
        let raw = self
            .stratagems
            .get(stratagem_id)
            .and_then(|stratagem| serde_json::to_value(&stratagem.target_restrictions).ok())
            .unwrap_or(Value::Null);
        let targets = match raw {
            Value::Array(items) => items,
            Value::Object(_) => vec![raw],
            _ => Vec::new(),
        };
        targets.iter().any(|target| {
            target.get("side").and_then(Value::as_str) != Some("enemy")
                && target.get("selects").and_then(Value::as_str) == Some("model")
        })
    }
}
