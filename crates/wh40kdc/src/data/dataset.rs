//! [`Dataset`] ties the embedded records together: it owns every
//! [`Collection`], builds the cross-entity indexes once, and is the value the
//! link-resolution methods borrow against.
//!
//! Where the TypeScript package exposes lazy view getters
//! (`unit.abilities`, `ability.phases`), Rust expresses the same join graph as
//! `&Dataset` methods returning borrows (`dataset.abilities_of(&unit)`,
//! `dataset.phases_of(&ability)`) — a borrowing view object would be
//! self-referential. The join graph is identical.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::generated::{
    Ability, DeploymentPattern, Detachment, Enhancement, Faction, ForceDisposition, GameVersion,
    InteractionFlag, LeaderAttachment, Mission, MissionMatchup, Phase, PhaseMapping, ResourcePool,
    SecondaryCard, Stratagem, TerrainLayout, TerrainTemplate, TimingFlag, Unit, UnitComposition,
    WargearOption, Weapon, WeaponKeyword,
};

use super::collection::Collection;

/// The shape of the embedded data bundle: one array per entity collection.
///
/// This is the boundary between the generated JSON-Schema types and the linked
/// API. The committed `bundle.generated.json` (written by
/// `cargo run -p xtask -- bundle-data`) deserializes into this; [`Dataset`]
/// wraps it with linked accessors. Every field is `#[serde(default)]` so a
/// collection with no authored data yet stays an empty array and the API
/// surface is stable.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct RawData {
    #[serde(default)]
    pub units: Vec<Unit>,
    #[serde(default)]
    pub weapons: Vec<Weapon>,
    /// Catalog of weapon keywords (Lethal Hits, Sustained Hits N, Anti-X N+, ...).
    #[serde(default)]
    pub weapon_keywords: Vec<WeaponKeyword>,
    #[serde(default)]
    pub factions: Vec<Faction>,
    /// Community-authored ability mechanics (keyed on `ability_id`, not `id`).
    #[serde(default)]
    pub abilities: Vec<Ability>,
    /// Phase assignments, joined to abilities/stratagems/etc. via `source_id`.
    #[serde(default)]
    pub phase_mappings: Vec<PhaseMapping>,
    #[serde(default)]
    pub detachments: Vec<Detachment>,
    #[serde(default)]
    pub stratagems: Vec<Stratagem>,
    #[serde(default)]
    pub enhancements: Vec<Enhancement>,
    #[serde(default)]
    pub leader_attachments: Vec<LeaderAttachment>,
    #[serde(default)]
    pub unit_compositions: Vec<UnitComposition>,
    #[serde(default)]
    pub wargear_options: Vec<WargearOption>,
    #[serde(default)]
    pub game_versions: Vec<GameVersion>,
    #[serde(default)]
    pub missions: Vec<Mission>,
    #[serde(default)]
    pub mission_matchups: Vec<MissionMatchup>,
    #[serde(default)]
    pub secondary_cards: Vec<SecondaryCard>,
    #[serde(default)]
    pub deployment_patterns: Vec<DeploymentPattern>,
    #[serde(default)]
    pub force_dispositions: Vec<ForceDisposition>,
    /// Reusable terrain catalog: standard areas and scenery features.
    #[serde(default)]
    pub terrain_templates: Vec<TerrainTemplate>,
    /// Terrain layouts: arrangements of catalog/inline pieces on the board.
    #[serde(default)]
    pub terrain_layouts: Vec<TerrainLayout>,
    #[serde(default)]
    pub resource_pools: Vec<ResourcePool>,
    #[serde(default)]
    pub timing_flags: Vec<TimingFlag>,
    #[serde(default)]
    pub interaction_flags: Vec<InteractionFlag>,
}

/// The whole dataset, with linked accessors over every entity collection.
///
/// Build it from the embedded bundle with [`Dataset::embedded`], or from custom
/// data with [`Dataset::from_raw`].
///
/// # Examples
///
/// The headline lookup — note `find_unit("Kharn")` resolves "Khârn the
/// Betrayer" through diacritic folding, and an ability's phases come from the
/// phase-mappings, not the ability record:
///
/// ```
/// use wh40kdc::{Dataset, Phase};
///
/// let ds = Dataset::embedded();
/// let kharn = ds.find_unit("Kharn").expect("Khârn is in the dataset");
///
/// let shooting_abilities: Vec<&str> = ds
///     .abilities_of(kharn)
///     .into_iter()
///     .filter(|a| ds.phases_of(a).contains(&Phase::Shooting))
///     .map(|a| a.ability_id.as_str())
///     .collect();
///
/// assert_eq!(shooting_abilities, ["berzerker-frenzy"]);
/// assert_eq!(ds.faction_of(kharn).unwrap().id.as_str(), "world-eaters");
/// ```
pub struct Dataset {
    // Richly-linked collections.
    pub units: Collection<Unit>,
    pub weapons: Collection<Weapon>,
    pub weapon_keywords: Collection<WeaponKeyword>,
    pub factions: Collection<Faction>,
    pub abilities: Collection<Ability>,

    // Id-bearing passthrough collections.
    pub detachments: Collection<Detachment>,
    pub enhancements: Collection<Enhancement>,
    pub stratagems: Collection<Stratagem>,
    pub wargear_options: Collection<WargearOption>,
    pub missions: Collection<Mission>,
    pub mission_matchups: Collection<MissionMatchup>,
    pub secondary_cards: Collection<SecondaryCard>,
    pub deployment_patterns: Collection<DeploymentPattern>,
    pub force_dispositions: Collection<ForceDisposition>,
    pub terrain_templates: Collection<TerrainTemplate>,
    pub terrain_layouts: Collection<TerrainLayout>,
    pub resource_pools: Collection<ResourcePool>,

    // Id-less collections, exposed as plain slices.
    pub leader_attachments: Vec<LeaderAttachment>,
    pub unit_compositions: Vec<UnitComposition>,
    pub game_versions: Vec<GameVersion>,
    pub timing_flags: Vec<TimingFlag>,
    pub interaction_flags: Vec<InteractionFlag>,
    pub phase_mappings: Vec<PhaseMapping>,

    /// `source_type:source_id` → unioned phases.
    phase_index: HashMap<String, Vec<Phase>>,
    /// ability id → indices of units that list it (into `units`).
    units_by_ability: HashMap<String, Vec<usize>>,
    /// weapon id → indices of units that list it (into `units`).
    units_by_weapon: HashMap<String, Vec<usize>>,
}

/// The embedded dataset bundle, inlined at build time and parsed once.
#[cfg(feature = "bundled-data")]
const BUNDLE_JSON: &str = include_str!("bundle.generated.json");

impl Dataset {
    /// The dataset built from the crate's embedded data, parsed once and cached.
    ///
    /// Requires the default `bundled-data` feature.
    #[cfg(feature = "bundled-data")]
    pub fn embedded() -> &'static Dataset {
        static EMBEDDED: OnceLock<Dataset> = OnceLock::new();
        EMBEDDED.get_or_init(|| {
            let raw: RawData =
                serde_json::from_str(BUNDLE_JSON).expect("embedded data bundle is valid JSON");
            Dataset::from_raw(raw)
        })
    }

    /// Build a dataset from arbitrary [`RawData`], wiring all collections and
    /// cross-entity indexes.
    pub fn from_raw(raw: RawData) -> Dataset {
        let units = Collection::build(
            raw.units,
            |u| u.id.to_string(),
            |u| Some(u.name.as_str()),
            |u| Some(u.faction_id.as_str()),
            // The same unit id is shared across factions (e.g. ministorum-priest);
            // keep each faction's copy, collapse only true within-faction dupes.
            |u| format!("{}::{}", u.faction_id.as_str(), u.id.as_str()),
        );
        let weapons = Collection::build(
            raw.weapons,
            |w| w.id.to_string(),
            |w| Some(w.name.as_str()),
            |_| None,
            |w| w.id.to_string(),
        );
        let weapon_keywords = id_name_collection(
            raw.weapon_keywords,
            |k| k.id.to_string(),
            |k| Some(k.name.as_str()),
        );
        let factions = Collection::build(
            raw.factions,
            |f| f.id.to_string(),
            |f| Some(f.name.as_str()),
            |_| None,
            |f| f.id.to_string(),
        );
        let abilities = Collection::build(
            raw.abilities,
            |a| a.ability_id.to_string(),
            |a| Some(a.name.as_str()),
            |a| a.faction_id.as_ref().map(|e| e.as_str()),
            |a| a.ability_id.to_string(),
        );

        let detachments = Collection::build(
            raw.detachments,
            |d| d.id.to_string(),
            |d| Some(d.name.as_str()),
            |d| Some(d.faction_id.as_str()),
            |d| d.id.to_string(),
        );
        let enhancements = id_name_collection(
            raw.enhancements,
            |e| e.id.to_string(),
            |e| Some(e.name.as_str()),
        );
        let stratagems = id_name_collection(
            raw.stratagems,
            |s| s.id.to_string(),
            |s| Some(s.name.as_str()),
        );
        let wargear_options =
            id_name_collection(raw.wargear_options, |w| w.id.to_string(), |_| None);
        let missions = id_name_collection(
            raw.missions,
            |m| m.id.to_string(),
            |m| Some(m.name.as_str()),
        );
        let mission_matchups =
            id_name_collection(raw.mission_matchups, |m| m.id.to_string(), |_| None);
        let secondary_cards = id_name_collection(
            raw.secondary_cards,
            |s| s.id.to_string(),
            |s| Some(s.name.as_str()),
        );
        let deployment_patterns = id_name_collection(
            raw.deployment_patterns,
            |d| d.id.to_string(),
            |d| Some(d.name.as_str()),
        );
        // ForceDispositionId is a Display string-enum, not a newtype.
        let force_dispositions = id_name_collection(
            raw.force_dispositions,
            |f| f.id.to_string(),
            |f| Some(f.name.as_str()),
        );
        let terrain_templates = id_name_collection(
            raw.terrain_templates,
            |t| t.id.to_string(),
            |t| Some(t.name.as_str()),
        );
        let terrain_layouts = id_name_collection(
            raw.terrain_layouts,
            |l| l.id.to_string(),
            |l| Some(l.name.as_str()),
        );
        let resource_pools = Collection::build(
            raw.resource_pools,
            |r| r.id.to_string(),
            |r| Some(r.name.as_str()),
            |r| Some(r.faction_id.as_str()),
            |r| r.id.to_string(),
        );

        let phase_index = build_phase_index(&raw.phase_mappings);
        let (units_by_ability, units_by_weapon) = build_reverse_indexes(&units);

        Dataset {
            units,
            weapons,
            weapon_keywords,
            factions,
            abilities,
            detachments,
            enhancements,
            stratagems,
            wargear_options,
            missions,
            mission_matchups,
            secondary_cards,
            deployment_patterns,
            force_dispositions,
            terrain_templates,
            terrain_layouts,
            resource_pools,
            leader_attachments: raw.leader_attachments,
            unit_compositions: raw.unit_compositions,
            game_versions: raw.game_versions,
            timing_flags: raw.timing_flags,
            interaction_flags: raw.interaction_flags,
            phase_mappings: raw.phase_mappings,
            phase_index,
            units_by_ability,
            units_by_weapon,
        }
    }

    // --- Convenience finders (delegate to the matching collection) ----------

    /// Find a unit by id or name (diacritic-insensitive). See
    /// [`Collection::find`].
    pub fn find_unit(&self, query: &str) -> Option<&Unit> {
        self.units.find(query)
    }

    /// Find a weapon by id or name.
    pub fn find_weapon(&self, query: &str) -> Option<&Weapon> {
        self.weapons.find(query)
    }

    /// Find a faction by id or name.
    pub fn find_faction(&self, query: &str) -> Option<&Faction> {
        self.factions.find(query)
    }

    /// Find an ability by id (`ability_id`) or name.
    pub fn find_ability(&self, query: &str) -> Option<&Ability> {
        self.abilities.find(query)
    }

    // --- Link resolution (the &Dataset replacement for view getters) --------

    /// The unit's faction, or `None` if its `faction_id` is unknown.
    pub fn faction_of(&self, unit: &Unit) -> Option<&Faction> {
        self.factions.get(unit.faction_id.as_str())
    }

    /// Resolve a terrain layout to absolute board-space vertices, using this
    /// dataset's embedded terrain-template catalog. This is the layout-id →
    /// renderable-geometry hop a consumer (e.g. shadowboxing) wants. Errors if
    /// the layout references a template absent from the catalog. The generated
    /// types round-trip through their canonical JSON into the resolver's input
    /// structs — the same JSON the conformance corpus pins.
    pub fn resolve_terrain(
        &self,
        layout: &TerrainLayout,
    ) -> Result<Vec<crate::terrain::ResolvedPiece>, crate::terrain::TerrainResolveError> {
        fn convert<T: serde::de::DeserializeOwned, S: serde::Serialize>(value: &S) -> T {
            serde_json::from_value(serde_json::to_value(value).expect("generated terrain serializes"))
                .expect("generated terrain type matches resolver shape")
        }
        let r_layout: crate::terrain::TerrainLayout = convert(layout);
        let templates: Vec<crate::terrain::TerrainTemplate> =
            self.terrain_templates.all().iter().map(convert).collect();
        crate::terrain::resolve_layout(&r_layout, &templates)
    }

    /// The terrain layouts a deployment pattern recommends, in declared order,
    /// skipping any ids absent from the dataset.
    pub fn recommended_terrain_layouts(&self, pattern: &DeploymentPattern) -> Vec<&TerrainLayout> {
        pattern
            .recommended_terrain_layout_ids
            .iter()
            .flatten()
            .filter_map(|id| self.terrain_layouts.get(id.as_str()))
            .collect()
    }

    /// Weapons referenced by `weapon_ids`; unresolved ids are skipped.
    pub fn weapons_of(&self, unit: &Unit) -> Vec<&Weapon> {
        unit.weapon_ids
            .iter()
            .filter_map(|id| self.weapons.get(id.as_str()))
            .collect()
    }

    /// Abilities referenced by `ability_ids`; unresolved ids are skipped.
    pub fn abilities_of(&self, unit: &Unit) -> Vec<&Ability> {
        unit.ability_ids
            .iter()
            .filter_map(|id| self.abilities.get(id.as_str()))
            .collect()
    }

    /// Game phases an ability acts in, unioned across its phase-mappings.
    ///
    /// Phases are not stored on the ability — they live in `phase_mappings`
    /// records where `source_type == "ability"` and `source_id == ability_id`.
    pub fn phases_of(&self, ability: &Ability) -> &[Phase] {
        self.phases_for("ability", ability.ability_id.as_str())
    }

    /// Phases a source acts in, unioned across its phase-mappings, keyed by the
    /// `source_type` / `source_id` pair (e.g. `("ability", "berzerker-frenzy")`).
    pub fn phases_for(&self, source_type: &str, source_id: &str) -> &[Phase] {
        self.phase_index
            .get(&format!("{source_type}:{source_id}"))
            .map_or(&[], Vec::as_slice)
    }

    /// Units that list the given ability id in their `ability_ids`.
    pub fn units_with_ability(&self, ability_id: &str) -> Vec<&Unit> {
        self.units_by_ability
            .get(ability_id)
            .map(|idxs| idxs.iter().map(|&i| self.units.at(i)).collect())
            .unwrap_or_default()
    }

    /// Units that list the given weapon id in their `weapon_ids`.
    pub fn units_with_weapon(&self, weapon_id: &str) -> Vec<&Unit> {
        self.units_by_weapon
            .get(weapon_id)
            .map(|idxs| idxs.iter().map(|&i| self.units.at(i)).collect())
            .unwrap_or_default()
    }

    /// Leaders whose leader-attachment data lists `bodyguard_unit_id` among its
    /// eligible body units, sorted by name. The attachment is stored on the
    /// leader pointing down to its bodyguards, so answering "which leaders can
    /// attach to this unit?" means scanning the attachment list. Returns an
    /// empty vec for a unit nothing attaches to (including leader units).
    pub fn leaders_attachable_to(&self, bodyguard_unit_id: &str) -> Vec<&Unit> {
        let mut out: Vec<&Unit> = self
            .leader_attachments
            .iter()
            .filter(|la| {
                la.eligible_bodyguard_ids
                    .iter()
                    .any(|id| id.as_str() == bodyguard_unit_id)
            })
            .filter_map(|la| self.units.get(la.leader_id.as_str()))
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    /// The inverse of [`leaders_attachable_to`](Self::leaders_attachable_to):
    /// the body units the given leader can attach to, sorted by name. Scans the
    /// same data from the leader's side (`leader_id` matches; resolve each
    /// `eligible_bodyguard_ids` entry), deduped by id. Empty for a non-leader
    /// unit. The two together give the bidirectional attachment graph.
    pub fn bodyguards_attachable_from(&self, leader_unit_id: &str) -> Vec<&Unit> {
        let mut seen = std::collections::HashSet::new();
        let mut out: Vec<&Unit> = Vec::new();
        for la in &self.leader_attachments {
            if la.leader_id.as_str() != leader_unit_id {
                continue;
            }
            for bodyguard_id in &la.eligible_bodyguard_ids {
                if !seen.insert(bodyguard_id.as_str()) {
                    continue;
                }
                if let Some(unit) = self.units.get(bodyguard_id.as_str()) {
                    out.push(unit);
                }
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    /// Faction-scoped abilities (abilities whose `faction_id` is this faction).
    pub fn abilities_of_faction(&self, faction_id: &str) -> Vec<&Ability> {
        self.abilities.by_faction(faction_id)
    }

    /// Distinct weapons carried by a faction's units (deduplicated by id).
    pub fn weapons_of_faction(&self, faction_id: &str) -> Vec<&Weapon> {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for unit in self.units.by_faction(faction_id) {
            for weapon in self.weapons_of(unit) {
                if seen.insert(weapon.id.as_str().to_string()) {
                    out.push(weapon);
                }
            }
        }
        out
    }
}

/// Build a passthrough collection keyed on id (no faction scoping). The id also
/// serves as the dedupe key.
fn id_name_collection<T>(
    items: Vec<T>,
    id_of: impl Fn(&T) -> String,
    name_of: impl Fn(&T) -> Option<&str>,
) -> Collection<T> {
    Collection::build(items, &id_of, name_of, |_| None, |i| id_of(i))
}

/// Union the phases of every phase-mapping, keyed `source_type:source_id`.
fn build_phase_index(phase_mappings: &[PhaseMapping]) -> HashMap<String, Vec<Phase>> {
    let mut index: HashMap<String, Vec<Phase>> = HashMap::new();
    for pm in phase_mappings {
        let key = format!("{}:{}", pm.source_type, pm.source_id.as_str());
        let entry = index.entry(key).or_default();
        for &phase in pm.phases.iter() {
            if !entry.contains(&phase) {
                entry.push(phase);
            }
        }
    }
    index
}

/// Build ability-id→units and weapon-id→units reverse indexes (values are
/// positions into the deduplicated units collection).
fn build_reverse_indexes(
    units: &Collection<Unit>,
) -> (HashMap<String, Vec<usize>>, HashMap<String, Vec<usize>>) {
    let mut by_ability: HashMap<String, Vec<usize>> = HashMap::new();
    let mut by_weapon: HashMap<String, Vec<usize>> = HashMap::new();
    for (idx, unit) in units.all().iter().enumerate() {
        for ability_id in &unit.ability_ids {
            by_ability
                .entry(ability_id.to_string())
                .or_default()
                .push(idx);
        }
        for weapon_id in &unit.weapon_ids {
            by_weapon
                .entry(weapon_id.to_string())
                .or_default()
                .push(idx);
        }
    }
    (by_ability, by_weapon)
}
