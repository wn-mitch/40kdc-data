//! Deserializes the repository's real `data/` files into the generated types.
//!
//! This is the correctness proof for the codegen: the generated structs use
//! `deny_unknown_fields`, so any schema/type/data drift surfaces here as a
//! deserialization error rather than silently.
//!
//! When `data/` is absent (the published-crate case — the crate ships types and
//! the bundled schema, but not the CC BY 4.0 data), every check short-circuits so
//! `cargo publish --dry-run` and downstream builds stay green.

use std::path::{Path, PathBuf};

use wh40kdc::{
    Ability, Detachment, Enhancement, Faction, GameVersion, LeaderAttachment, Mission,
    MissionMatchup, PhaseMapping, Stratagem, TerrainLayout, TerrainTemplate, Unit, UnitComposition,
    Weapon,
};

fn data_dir(kind: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../data")
        .join(kind)
}

/// Deserialize every `<dir>/<faction>/<file>` array into `Vec<T>`, returning the
/// total element count. Faction dirs whose file is absent are skipped (e.g. SM
/// successors that inherit units from `adeptus-astartes`).
fn load_all<T: serde::de::DeserializeOwned>(root: &Path, file: &str) -> usize {
    let mut total = 0;
    for entry in std::fs::read_dir(root).expect("data dir is readable") {
        let faction = entry.expect("dir entry").path();
        if !faction.is_dir() || faction.file_name().is_some_and(|n| n == "_example") {
            continue;
        }
        let path = faction.join(file);
        if !path.exists() {
            continue;
        }
        let raw = std::fs::read_to_string(&path).expect("file is readable");
        let items: Vec<T> = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("deserialize {}: {e}", path.display()));
        total += items.len();
    }
    total
}

#[test]
fn core_data_deserializes_into_generated_types() {
    let core = data_dir("core");
    if !core.exists() {
        eprintln!(
            "skipping: {} not present (published-crate build)",
            core.display()
        );
        return;
    }

    let factions = load_all::<Faction>(&core, "factions.json");
    let units = load_all::<Unit>(&core, "units.json");
    let weapons = load_all::<Weapon>(&core, "weapons.json");
    let detachments = load_all::<Detachment>(&core, "detachments.json");
    let enhancements = load_all::<Enhancement>(&core, "enhancements.json");
    let stratagems = load_all::<Stratagem>(&core, "stratagems.json");
    let leader_attachments = load_all::<LeaderAttachment>(&core, "leader-attachments.json");
    let unit_compositions = load_all::<UnitComposition>(&core, "unit-compositions.json");

    // The ported dataset has all 35 factions; assert we actually exercised data
    // rather than silently passing on an empty tree.
    assert!(factions >= 35, "expected >=35 factions, got {factions}");
    assert!(units > 0, "no units deserialized");
    assert!(weapons > 0, "no weapons deserialized");

    eprintln!(
        "core: {factions} factions, {units} units, {weapons} weapons, {detachments} detachments, \
         {enhancements} enhancements, {stratagems} stratagems, {leader_attachments} leader-attachments, \
         {unit_compositions} unit-compositions"
    );
}

/// Deserialize a single top-level `data/core/<file>` array into `Vec<T>`.
fn load_file<T: serde::de::DeserializeOwned>(root: &Path, file: &str) -> usize {
    let path = root.join(file);
    if !path.exists() {
        return 0;
    }
    let raw = std::fs::read_to_string(&path).expect("file is readable");
    let items: Vec<T> = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("deserialize {}: {e}", path.display()));
    items.len()
}

#[test]
fn top_level_core_data_deserializes_into_generated_types() {
    let core = data_dir("core");
    if !core.exists() {
        eprintln!("skipping: {} not present", core.display());
        return;
    }

    let game_versions = load_file::<GameVersion>(&core, "game-versions.json");
    let missions = load_file::<Mission>(&core, "missions.json");
    let matchups = load_file::<MissionMatchup>(&core, "mission-matchups.json");
    // Terrain catalog + the migrated 11e layouts. The layout pieces exercise the
    // generated `anyOf` Piece type (templated vs inline-footprint) against real
    // data — including the baked-polygon features from the migration.
    let terrain_templates = load_file::<TerrainTemplate>(&core, "terrain-templates.json");
    let terrain_layouts = load_file::<TerrainLayout>(&core, "terrain-layouts.json");

    eprintln!("top-level core: {game_versions} game-versions, {missions} missions, {matchups} mission-matchups, {terrain_templates} terrain-templates, {terrain_layouts} terrain-layouts");
}

#[test]
fn enrichment_data_deserializes_into_generated_types() {
    let enrichment = data_dir("enrichment");
    if !enrichment.exists() {
        eprintln!("skipping: {} not present", enrichment.display());
        return;
    }

    let abilities = load_all::<Ability>(&enrichment, "abilities.json");
    let phase_mappings = load_all::<PhaseMapping>(&enrichment, "phase-mappings.json");

    assert!(abilities > 0, "no abilities deserialized");
    eprintln!("enrichment: {abilities} abilities, {phase_mappings} phase-mappings");
}
