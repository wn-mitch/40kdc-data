//! The shared [`EngineContext`] the keyword translator, the DSL translator and the
//! resolver read. Mirrors the `EngineContext` type in `tools/src/cruncher/buffs.ts`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::Phase;

use super::buffs::WeaponKeywordRef;
use super::scenario::{
    ActiveRule, AttachedMember, ModelWounds, ObjectivesControlled, ScenarioNeighbour,
    ScenarioObjective, ScenarioRegion, UnitState, UnitStrength,
};

/// Actual membership in an attached unit, supplied by the caller's roster state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttachmentRole {
    Leader,
    Bodyguard,
}

/// Shared engine context. Carries the phase plus a few attacker/target flags
/// the keyword translator and the resolver both need.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineContext {
    pub phase: Phase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_unit_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_unit_id: Option<String>,
    /// Caller-attested event recipients, independent of current attachment state.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recipient_snapshots: Vec<super::recipient_snapshots::RecipientSnapshot>,
    /// The battle round. Drives `battle-round` and per-round range tables; `None` leaves them unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub battle_round: Option<u32>,
    /// It is the attacking unit's player's turn. Drives `player-turn-is`, read for the side whose
    /// ability it is: "your turn" for a defensive ability is the opponent of the attacker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_turn: Option<bool>,
    /// Each unit against its Starting Strength. Drives `strength`; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_strength: Option<UnitStrength>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_strength: Option<UnitStrength>,
    /// The wounds of each unit's damaged (or only) model. Drives `wounds`; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_wounds: Option<ModelWounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_wounds: Option<ModelWounds>,
    /// Every designation each unit carries, matched case-insensitively. A supplied list is
    /// complete; `None` leaves `designated` filters unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_designations: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_designations: Option<Vec<String>>,
    /// Every listed state each unit is in. A supplied list is complete; `None` leaves those
    /// `state` filters unknown. Both units of an attack are on the battlefield.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_states: Option<Vec<UnitState>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_states: Option<Vec<UnitState>>,
    /// The target is the closest eligible target to the attacker. Drives `closest`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_closest: Option<bool>,
    /// Every objective each unit is within control range of. A supplied list is complete;
    /// `None` leaves objective `within` filters unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_objectives: Option<Vec<ScenarioObjective>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_objectives: Option<Vec<ScenarioObjective>>,
    /// The other units near each unit of the attack. A supplied list is complete: a unit it
    /// omits is beyond every range a filter names. `None` leaves proximity filters on other units
    /// unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_neighbours: Option<Vec<ScenarioNeighbour>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_neighbours: Option<Vec<ScenarioNeighbour>>,
    /// Every rule active for the attack: a rule id, or one option or named definition of it. A
    /// supplied list is complete; `None` leaves `rule-active` unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_rules: Option<Vec<ActiveRule>>,
    /// Every region each unit is in. A supplied list is complete; `None` leaves `in-region`
    /// unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_regions: Option<Vec<ScenarioRegion>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_regions: Option<Vec<ScenarioRegion>>,
    /// Objectives each side controls, and how many there are. Drives `controls`; `None` leaves
    /// it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objectives_controlled: Option<ObjectivesControlled>,
    /// Every unit of each combined unit, the unit itself included. Settles `attachment` roles
    /// and `with` filters; `None` leaves those to the attachment flags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_members: Option<Vec<AttachedMember>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_members: Option<Vec<AttachedMember>>,
    /// The attack's modified Strength. The engine supplies it; `None` fails `attack_comparisons`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attack_strength: Option<f64>,
    /// The target's modified Toughness: the attacked profile's, and the highest and lowest over
    /// the target's profiles for a `reduce` comparison. The engine supplies them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_toughness: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_toughness_max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_toughness_min: Option<f64>,
    /// The attacking unit's Toughness (its highest model's). Caller-supplied; `None` fails the
    /// comparisons that read it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_toughness: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_attachment_role: Option<AttachmentRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_attachment_role: Option<AttachmentRole>,
    /// Actual roles in the combined unit, keyed by source unit id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_roles: Option<BTreeMap<String, AttachmentRole>>,
    /// Attacker has not moved this turn — Heavy fires its +1 to hit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_stationary: Option<bool>,
    /// Attacker made a charge move this turn — drives a `happened` Charge-move condition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_charged: Option<bool>,
    /// Within half the weapon's range — Melta / Rapid Fire fire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within_half_range: Option<bool>,
    /// Distance to the target in inches; drives `applicable_when.max_range_inches`.
    /// Unset leaves range gates unsatisfied.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distance_inches: Option<f64>,
    /// Attacker benefits from cover (mostly informational).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_in_cover: Option<bool>,
    /// Target is in cover.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_in_cover: Option<bool>,
    /// Attacker keywords (union of `unit.keywords + faction_keywords`), lower-cased.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_keywords: Option<Vec<String>>,
    /// Target keywords (union of `unit.keywords + faction_keywords`), lower-cased.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_keywords: Option<Vec<String>>,
    /// Keywords every model making the attack carries, lower-cased: the keywords and faction
    /// keywords shared by the attacking datasheets. Resolves model-level keyword filters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_model_keywords: Option<Vec<String>>,
    /// Keywords every model of the target carries, lower-cased.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_model_keywords: Option<Vec<String>>,
    /// Sub-phase timing flag consumed by the `timing-is` condition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<String>,
    /// The buffed unit is part of a combined ("attached") unit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_attached: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_attached: Option<bool>,
    /// The army's Army Faction id. Drives the `army-faction` condition; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub army_faction: Option<String>,
    /// The defending army's Army Faction id, for the `army-faction` condition of the target's own rules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_army_faction: Option<String>,
    /// The battle size being played (`incursion` / `strike-force` / `onslaught`). Drives the
    /// `battle-size` condition; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub battle_size: Option<String>,
    /// The attacking unit is Guided (For the Greater Good: not an Observer, targeting a Spotted
    /// unit). Drives the `guided` condition; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_guided: Option<bool>,
    /// Models in the attacking unit. Drives `model-count` on the attacker; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_model_count: Option<u32>,
    /// Models in the target unit. Drives `model-count` on the defender; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_model_count: Option<u32>,
    /// The wargear the attacking models' chosen loadout includes: by wargear id, how many of
    /// those models carry it. A supplied map is complete, so an id it omits is carried by no
    /// model. Drives `unit-wargear` on the attacker; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_wargear: Option<BTreeMap<String, u32>>,
    /// The target's counterpart of `attacker_wargear`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_wargear: Option<BTreeMap<String, u32>>,
    /// Lower-cased names of the attacking weapon and its profile. Drives
    /// `applicable_when.weapon_name`; unknown names cannot satisfy a constraint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_names: Option<Vec<String>>,
    /// Catalog ids for unrated keyword matching. Rated selectors require
    /// `weapon_keyword_refs`; live grants retain their full references.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_keywords: Option<Vec<String>>,
    /// Printed keyword references, preserving ratings for canonical weapon selectors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_keyword_refs: Option<Vec<WeaponKeywordRef>>,
}

impl EngineContext {
    /// A context for `phase` with every optional flag unset (each gate it drives stays unknown).
    pub fn new(phase: Phase) -> Self {
        EngineContext {
            phase,
            attacker_unit_id: None,
            target_unit_id: None,
            recipient_snapshots: Vec::new(),
            battle_round: None,
            attacker_turn: None,
            attacker_strength: None,
            target_strength: None,
            attacker_wounds: None,
            target_wounds: None,
            attacker_designations: None,
            target_designations: None,
            attacker_states: None,
            target_states: None,
            target_closest: None,
            attacker_objectives: None,
            target_objectives: None,
            attacker_neighbours: None,
            target_neighbours: None,
            active_rules: None,
            attacker_regions: None,
            target_regions: None,
            objectives_controlled: None,
            attacker_members: None,
            target_members: None,
            attack_strength: None,
            target_toughness: None,
            target_toughness_max: None,
            target_toughness_min: None,
            attacker_toughness: None,
            attacker_attachment_role: None,
            target_attachment_role: None,
            attachment_roles: None,
            attacker_stationary: None,
            attacker_charged: None,
            within_half_range: None,
            distance_inches: None,
            attacker_in_cover: None,
            target_in_cover: None,
            attacker_keywords: None,
            target_keywords: None,
            attacker_model_keywords: None,
            target_model_keywords: None,
            timing: None,
            attacker_attached: None,
            target_attached: None,
            army_faction: None,
            target_army_faction: None,
            battle_size: None,
            attacker_guided: None,
            attacker_model_count: None,
            target_model_count: None,
            attacker_wargear: None,
            target_wargear: None,
            weapon_names: None,
            weapon_keywords: None,
            weapon_keyword_refs: None,
        }
    }
}
