//! NewRecruit JSON exporter — emits a BattleScribe-shaped roster skeleton
//! that round-trips through
//! [`NewRecruitJsonAdapter`](crate::import::NewRecruitJsonAdapter).
//!
//! The shape carries only fields the importer reads: `name`, `type`,
//! `number`, `costs[]`, `categories[].name`, `group`, and `catalogueName`.
//! No `rules`/`profiles`/`description` ever appear — we don't store them
//! and emitting them would be an IP violation.
//!
//! Faction and detachment display names come from
//! [`title_case_id`](super::helpers::title_case_id)`(faction_id)` — the
//! Roster doesn't carry the source's raw faction name, so we reconstruct
//! it from the kebab-case id. This is the only lossy hop in the JSON
//! round-trip (e.g. `tau-empire` → `"Tau Empire"` rather than the
//! canonical `"T'au Empire"`).
//!
//! Rust mirror of `tools/src/export/newrecruit-json.ts`.

use serde::Serialize;

use crate::import::{BattleSize, Roster, RosterUnit, RosterWargear};

use super::helpers::{pretty_json, title_case_id, total_army_points};
use super::{ExportFormat, RosterSerializer};

const PTS_TYPE_ID: &str = "pts-type";
const NEWRECRUIT_XMLNS: &str = "http://www.battlescribe.net/schema/rosterSchema";
const NEWRECRUIT_GENERATED_BY: &str = "https://newrecruit.eu";

#[derive(Serialize)]
struct Category {
    name: String,
    primary: bool,
}

#[derive(Serialize)]
struct Cost {
    name: &'static str,
    #[serde(rename = "typeId")]
    type_id: &'static str,
    value: u64,
}

#[derive(Serialize)]
struct Selection {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: &'static str,
    number: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    categories: Option<Vec<Category>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    costs: Option<Vec<Cost>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selections: Option<Vec<Selection>>,
}

#[derive(Serialize)]
struct Force {
    id: &'static str,
    name: &'static str,
    #[serde(rename = "catalogueName")]
    catalogue_name: String,
    selections: Vec<Selection>,
}

#[derive(Serialize)]
struct RosterPayload {
    name: String,
    xmlns: &'static str,
    #[serde(rename = "generatedBy")]
    generated_by: &'static str,
    costs: Vec<Cost>,
    forces: Vec<Force>,
}

#[derive(Serialize)]
struct Payload {
    name: String,
    #[serde(rename = "generatedBy")]
    generated_by: &'static str,
    roster: RosterPayload,
}

fn faction_category(roster: &Roster) -> Option<Category> {
    let display = title_case_id(roster.faction_id.as_deref())?;
    Some(Category {
        name: format!("Faction: {display}"),
        primary: false,
    })
}

fn wargear_selection(idx: usize, w: &RosterWargear) -> Selection {
    Selection {
        id: format!("w-{idx}"),
        name: w.ref_.raw_name.clone(),
        kind: "upgrade",
        number: w.count,
        group: None,
        // The NewRecruit importer recognises a wargear selection by a
        // category ending in " Weapon" — emit a generic "Ranged Weapon" so
        // we don't have to track ranged-vs-melee separation the Roster
        // doesn't model.
        categories: Some(vec![Category {
            name: "Ranged Weapon".to_string(),
            primary: false,
        }]),
        costs: None,
        selections: None,
    }
}

fn unit_selection(idx: usize, u: &RosterUnit, faction: Option<&Category>) -> Selection {
    let mut inner: Vec<Selection> = Vec::new();
    if u.is_warlord {
        inner.push(Selection {
            id: format!("u{idx}-warlord"),
            name: "Warlord".to_string(),
            kind: "upgrade",
            number: 1,
            group: None,
            categories: None,
            costs: None,
            selections: None,
        });
    }
    if let Some(enh) = &u.enhancement {
        let costs = u.enhancement_points.map(|p| {
            vec![Cost {
                name: "pts",
                type_id: PTS_TYPE_ID,
                value: p,
            }]
        });
        inner.push(Selection {
            id: format!("u{idx}-enh"),
            name: enh.raw_name.clone(),
            kind: "upgrade",
            number: 1,
            group: Some("Enhancements"),
            categories: None,
            costs,
            selections: None,
        });
    }

    let wargear_selections: Vec<Selection> = u
        .wargear
        .iter()
        .enumerate()
        .map(|(wi, w)| wargear_selection(wi, w))
        .collect();

    let own_categories = faction.map(|f| {
        vec![Category {
            name: f.name.clone(),
            primary: f.primary,
        }]
    });
    let unit_costs = u.points.map(|p| {
        vec![Cost {
            name: "pts",
            type_id: PTS_TYPE_ID,
            value: p,
        }]
    });

    if u.model_count <= 1 {
        let mut selections = inner;
        selections.extend(wargear_selections);
        Selection {
            id: format!("u-{idx}"),
            name: u.ref_.raw_name.clone(),
            kind: "model",
            number: 1,
            group: None,
            categories: own_categories,
            costs: unit_costs,
            selections: Some(selections),
        }
    } else {
        let model_child = Selection {
            id: format!("u{idx}-model"),
            name: u.ref_.raw_name.clone(),
            kind: "model",
            number: u.model_count,
            group: None,
            categories: None,
            costs: None,
            selections: Some(wargear_selections),
        };
        let mut selections = inner;
        selections.push(model_child);
        Selection {
            id: format!("u-{idx}"),
            name: u.ref_.raw_name.clone(),
            kind: "unit",
            number: 1,
            group: None,
            categories: own_categories,
            costs: unit_costs,
            selections: Some(selections),
        }
    }
}

fn config_selection(name: &'static str, value: String, idx: &'static str) -> Selection {
    Selection {
        id: format!("cfg-{idx}"),
        name: name.to_string(),
        kind: "upgrade",
        number: 1,
        group: None,
        categories: Some(vec![Category {
            name: "Configuration".to_string(),
            primary: true,
        }]),
        costs: None,
        selections: Some(vec![Selection {
            id: format!("cfg-{idx}-val"),
            name: value,
            kind: "upgrade",
            number: 1,
            group: None,
            categories: None,
            costs: None,
            selections: None,
        }]),
    }
}

fn battle_size_label(roster: &Roster) -> Option<String> {
    match roster.battle_size? {
        BattleSize::StrikeForce => Some(format!(
            "Strike Force ({} Point limit)",
            roster.points.declared_limit.unwrap_or(2000)
        )),
        BattleSize::Incursion => Some(format!(
            "Incursion ({} Point limit)",
            roster.points.declared_limit.unwrap_or(1000)
        )),
    }
}

pub struct NewRecruitJsonSerializer;

impl RosterSerializer for NewRecruitJsonSerializer {
    fn id(&self) -> ExportFormat {
        ExportFormat::NewrecruitJson
    }

    fn serialize(&self, roster: &Roster) -> String {
        let faction = faction_category(roster);
        let faction_display =
            title_case_id(roster.faction_id.as_deref()).unwrap_or_else(|| "Unknown".to_string());
        let detachment_display = title_case_id(roster.detachment_id.as_deref());
        let battle_size = battle_size_label(roster);

        let mut config: Vec<Selection> = Vec::new();
        if let Some(b) = battle_size {
            config.push(config_selection("Battle Size", b, "battle-size"));
        }
        if let Some(d) = detachment_display {
            config.push(config_selection("Detachment", d, "detachment"));
        }

        let mut force_selections: Vec<Selection> = config;
        for (i, u) in roster.units.iter().enumerate() {
            force_selections.push(unit_selection(i, u, faction.as_ref()));
        }

        let force = Force {
            id: "force-1",
            name: "Army Roster",
            catalogue_name: faction_display,
            selections: force_selections,
        };

        let total = total_army_points(roster);

        let payload = Payload {
            name: roster.name.clone(),
            generated_by: NEWRECRUIT_GENERATED_BY,
            roster: RosterPayload {
                name: roster.name.clone(),
                xmlns: NEWRECRUIT_XMLNS,
                generated_by: NEWRECRUIT_GENERATED_BY,
                costs: vec![Cost {
                    name: "pts",
                    type_id: PTS_TYPE_ID,
                    value: total,
                }],
                forces: vec![force],
            },
        };

        pretty_json(&payload)
    }
}

