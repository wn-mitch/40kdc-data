//! Declared scenario state for the cruncher's condition evaluator: unit strength, wounds,
//! states and the objectives a unit is within range of. Mirrors the scenario types of
//! `tools/src/cruncher/buffs.ts` and `withinObjective` in `tools/src/cruncher/unit-filter.ts`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::from_dsl::TranslationPerspective;

/// A unit against its Starting Strength; below half implies below starting.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnitStrength {
    Full,
    BelowStarting,
    BelowHalf,
}

/// The wounds of a unit's damaged (or only) model.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ModelWounds {
    pub remaining: f64,
    pub starting: f64,
}

/// A unit state the context lists per unit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnitState {
    Engaged,
    BattleShocked,
    Hidden,
}

impl UnitState {
    /// The `state` filter value naming this state.
    pub fn as_str(self) -> &'static str {
        match self {
            UnitState::Engaged => "engaged",
            UnitState::BattleShocked => "battle-shocked",
            UnitState::Hidden => "hidden",
        }
    }
}

/// One side of the attack, read from the attacking unit's player.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScenarioSide {
    Attacker,
    Target,
}

/// Who controls an objective.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ObjectiveController {
    Attacker,
    Target,
    None,
}

/// Whose territory an objective is in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ObjectiveTerritory {
    Attacker,
    Target,
    NoMansLand,
}

/// An objective a unit is within control range of. `controller` and the sides are read from the
/// attacking unit's player: `attacker` is that player's, `target` the opponent's. A field left
/// out cannot satisfy a filter that names it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioObjective {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller: Option<ObjectiveController>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub designations: Option<Vec<String>>,
    /// `central`, `expansion`, `home` or `non-home`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home_of: Option<ScenarioSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub territory: Option<ObjectiveTerritory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

fn scenario_side(side: TranslationPerspective) -> ScenarioSide {
    match side {
        TranslationPerspective::Attacker => ScenarioSide::Attacker,
        TranslationPerspective::Target => ScenarioSide::Target,
    }
}

/// Case-insensitive membership of `wanted` in a designation list.
pub(crate) fn has_designation(designations: &[String], wanted: &str) -> bool {
    let wanted = wanted.to_lowercase();
    designations.iter().any(|d| d.to_lowercase() == wanted)
}

/// Whether one of the unit's objectives meets every property of an objective filter; `None` is
/// unknown. Ownership and territory are read from the ability's side.
pub(crate) fn within_objective(
    filter: &Map<String, Value>,
    objectives: Option<&[ScenarioObjective]>,
    ability_side: TranslationPerspective,
) -> Option<bool> {
    let objectives = objectives?;
    let mine = scenario_side(ability_side);
    let other = match mine {
        ScenarioSide::Attacker => ScenarioSide::Target,
        ScenarioSide::Target => ScenarioSide::Attacker,
    };
    let side_of = |relative: &Value| match relative.as_str() {
        Some("friendly") => Some(mine),
        Some("enemy") => Some(other),
        _ => None,
    };
    let controller_of = |side: ScenarioSide| match side {
        ScenarioSide::Attacker => ObjectiveController::Attacker,
        ScenarioSide::Target => ObjectiveController::Target,
    };
    let territory_of = |side: ScenarioSide| match side {
        ScenarioSide::Attacker => ObjectiveTerritory::Attacker,
        ScenarioSide::Target => ObjectiveTerritory::Target,
    };
    let mut unknown = false;
    for objective in objectives {
        let mut verdict = Some(true);
        for (key, wanted) in filter {
            let holds = match key.as_str() {
                "controlled_by" => objective.controller.and_then(|controller| {
                    if wanted.as_str() == Some("any") {
                        Some(controller != ObjectiveController::None)
                    } else {
                        side_of(wanted).map(|side| controller == controller_of(side))
                    }
                }),
                "designated" if wanted.is_string() => objective
                    .designations
                    .as_deref()
                    .map(|list| has_designation(list, wanted.as_str().unwrap_or_default())),
                "role" => objective
                    .role
                    .as_deref()
                    .map(|role| wanted.as_str() == Some(role)),
                "home_of" => match (objective.home_of, side_of(wanted)) {
                    (Some(home), Some(side)) => Some(home == side),
                    _ => None,
                },
                "territory" => {
                    let territory = match wanted.as_str() {
                        Some("your-territory") => Some(territory_of(mine)),
                        Some("enemy-territory") => Some(territory_of(other)),
                        Some("no-mans-land") => Some(ObjectiveTerritory::NoMansLand),
                        _ => None,
                    };
                    match (objective.territory, territory) {
                        (Some(have), Some(want)) => Some(have == want),
                        _ => None,
                    }
                }
                "name" => objective
                    .name
                    .as_deref()
                    .map(|name| wanted.as_str() == Some(name)),
                _ => None,
            };
            match holds {
                Some(false) => {
                    verdict = Some(false);
                    break;
                }
                None => verdict = None,
                Some(true) => {}
            }
        }
        match verdict {
            Some(true) => return Some(true),
            None => unknown = true,
            Some(false) => {}
        }
    }
    (!unknown).then_some(false)
}

/// Whose a neighbouring unit is, relative to the unit it is near.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NeighbourOwner {
    Friendly,
    Enemy,
}

/// Another unit near one unit of the attack: its keywords, whose it is relative to that unit,
/// and how far away it is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioNeighbour {
    pub keywords: Vec<String>,
    pub owner: NeighbourOwner,
    pub distance_inches: f64,
}

/// A rule an army has active: its id, or one of its options or named definitions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ActiveRule {
    Id(String),
    Part {
        ability_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        option_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        definition_id: Option<String>,
    },
}

/// A region a unit is in: an army rule's region (by id), a terrain area, a side's territory or
/// deployment zone. `wholly` says every model of the unit is in it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioRegion {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terrain_area: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub territory: Option<ObjectiveTerritory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deployment_zone: Option<ScenarioSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wholly: Option<bool>,
}

/// Objectives each side controls, and how many there are.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ObjectivesControlled {
    pub attacker: f64,
    pub target: f64,
    pub total: f64,
}

/// A unit's role in a combined unit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MemberRole {
    Leader,
    Bodyguard,
    Support,
}

/// One unit of a combined unit: its id, its role and its keywords.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedMember {
    pub unit_id: String,
    pub role: MemberRole,
    pub keywords: Vec<String>,
}
