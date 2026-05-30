//! Integration tests for the Rosterizer importer + exporter over the real
//! embedded data. Reuses the same fixture the TypeScript suite uses
//! (`tools/test/fixtures/import/gk-banishers.rosterizer.payload.json`).
//!
//! Rust mirror of `tools/test/import/rosterizer.test.ts` +
//! `tools/test/export/rosterizer.test.ts`.

#![cfg(all(feature = "import", feature = "export"))]

use std::path::PathBuf;

use serde_json::Value;
use wh40kdc::export::{export_roster, ExportFormat, RosterSerializer, RosterizerSerializer};
use wh40kdc::import::{import_roster, BattleSize, FormatAdapter, Roster, RosterizerAdapter};
use wh40kdc::Dataset;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tools/test/fixtures/import")
        .join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    serde_json::from_str(&raw).expect("fixture is valid JSON")
}

fn payload() -> Value {
    fixture("gk-banishers.rosterizer.payload.json")
}

fn import_payload() -> Roster {
    import_roster(&payload(), Dataset::embedded()).expect("import succeeds")
}

fn unit_by_id<'a>(r: &'a Roster, id: &str) -> Option<&'a wh40kdc::import::RosterUnit> {
    r.units.iter().find(|u| u.ref_.id.as_deref() == Some(id))
}

// --- adapter (parse only) --------------------------------------------------

#[test]
fn detects_a_rosterizer_envelope() {
    let adapter = RosterizerAdapter;
    assert!(adapter.detect(&payload()));
    assert!(!adapter.detect(&serde_json::json!({ "not": "a roster" })));
    assert!(!adapter.detect(&serde_json::json!({ "rulebook": {} })));
    assert!(!adapter.detect(&serde_json::json!({ "snapshot": { "item": "Roster\u{00a7}Roster" } })));
}

#[test]
fn accepts_history_only_envelope() {
    let adapter = RosterizerAdapter;
    let payload = serde_json::json!({
        "rulebook": { "name": "x" },
        "history": { "present": { "roster": { "item": "Roster\u{00a7}Roster" } } }
    });
    assert!(adapter.detect(&payload));
}

#[test]
fn parse_extracts_faction_detachment_and_battle_size() {
    let parsed = RosterizerAdapter.parse(&payload()).unwrap();
    assert_eq!(parsed.faction_raw_name.as_deref(), Some("Grey Knights"));
    assert_eq!(parsed.detachment_raw_name.as_deref(), Some("Banishers"));
    assert!(parsed
        .battle_size_raw
        .as_deref()
        .unwrap()
        .contains("Strike Force"));
    assert_eq!(parsed.declared_limit, Some(2000));
}

#[test]
fn parse_reads_points_from_stats_and_sums_total() {
    let parsed = RosterizerAdapter.parse(&payload()).unwrap();
    assert_eq!(parsed.total_reported, Some(585));
    // 90 + 225 + 20 + 250
    assert_eq!(parsed.total_computed, 585);
}

#[test]
fn parse_extracts_units_with_quantity_as_model_count() {
    let parsed = RosterizerAdapter.parse(&payload()).unwrap();
    let names: Vec<&str> = parsed.units.iter().map(|u| u.raw_name.as_str()).collect();
    assert!(names.contains(&"Castellan Crowe"));
    assert!(names.contains(&"Grand Master in Nemesis Dreadknight"));
    assert!(names.contains(&"Purifier Squad"));

    let squad = parsed
        .units
        .iter()
        .find(|u| u.raw_name == "Purifier Squad")
        .unwrap();
    assert_eq!(squad.model_count, 10);
    assert_eq!(squad.points, Some(250));
}

#[test]
fn parse_flags_warlord_and_enhancement() {
    let parsed = RosterizerAdapter.parse(&payload()).unwrap();
    let gm = parsed
        .units
        .iter()
        .find(|u| u.raw_name.starts_with("Grand Master"))
        .unwrap();
    assert!(gm.is_warlord);
    assert_eq!(
        gm.enhancement_raw_name.as_deref(),
        Some("Pyresoul (Psychic)")
    );
    assert_eq!(gm.enhancement_points, Some(20));
    assert!(gm.is_character);
}

#[test]
fn parse_collects_wargear_with_counts() {
    let parsed = RosterizerAdapter.parse(&payload()).unwrap();
    let squad = parsed
        .units
        .iter()
        .find(|u| u.raw_name == "Purifier Squad")
        .unwrap();
    assert_eq!(squad.wargear.len(), 1);
    assert_eq!(squad.wargear[0].raw_name, "Nemesis force halberd");
    assert_eq!(squad.wargear[0].count, 10);

    let gm = parsed
        .units
        .iter()
        .find(|u| u.raw_name.starts_with("Grand Master"))
        .unwrap();
    let weapons: Vec<&str> = gm.wargear.iter().map(|w| w.raw_name.as_str()).collect();
    assert!(weapons.contains(&"Heavy psycannon"));
    assert!(weapons.contains(&"Nemesis daemon greathammer"));
    assert!(!weapons.contains(&"Pyresoul (Psychic)"));
}

#[test]
fn parsed_output_leaks_no_prose_field_canaries() {
    let parsed = RosterizerAdapter.parse(&payload()).unwrap();
    for unit in &parsed.units {
        for w in &unit.wargear {
            assert!(!w.raw_name.contains("CANARY"));
            assert!(!w.raw_name.contains("description"));
            assert!(!w.raw_name.contains("\u{00a7}text"));
        }
    }
}

// --- resolve (against embedded grey-knights data) --------------------------

#[test]
fn resolves_faction_detachment_and_battle_size() {
    let roster = import_payload();
    assert_eq!(
        roster.source.format,
        wh40kdc::import::RosterFormat::Rosterizer
    );
    assert_eq!(roster.faction_id.as_deref(), Some("grey-knights"));
    assert_eq!(roster.detachment_id.as_deref(), Some("banishers"));
    assert_eq!(roster.battle_size, Some(BattleSize::StrikeForce));
    assert_eq!(roster.points.declared_limit, Some(2000));
    assert_eq!(roster.points.total_reported, Some(585));
    assert_eq!(roster.points.total_computed, 585);
}

#[test]
fn resolves_units_to_entity_ids() {
    let roster = import_payload();
    assert!(unit_by_id(&roster, "castellan-crowe").is_some());
    assert!(unit_by_id(&roster, "grand-master-in-nemesis-dreadknight").is_some());
    assert!(unit_by_id(&roster, "purifier-squad").is_some());
}

#[test]
fn resolves_enhancement_scoped_to_detachment() {
    let roster = import_payload();
    let gm = unit_by_id(&roster, "grand-master-in-nemesis-dreadknight").unwrap();
    assert!(gm.is_warlord);
    let enh = gm.enhancement.as_ref().unwrap();
    assert_eq!(enh.id.as_deref(), Some("pyresoul-psychic"));
    assert_eq!(gm.enhancement_points, Some(20));
}

#[test]
fn resolves_wargear_counts_after_resolution() {
    let roster = import_payload();
    let squad = unit_by_id(&roster, "purifier-squad").unwrap();
    assert_eq!(squad.wargear.len(), 1);
    assert_eq!(squad.wargear[0].count, 10);
}

// --- export ----------------------------------------------------------------

#[test]
fn exports_a_rosterizer_envelope_with_faction_and_detachment() {
    let roster = import_payload();
    let out = RosterizerSerializer.serialize(&roster);
    let parsed: Value = serde_json::from_str(&out).expect("export is valid JSON");
    assert!(parsed["rulebook"].is_object());
    assert_eq!(
        parsed["snapshot"]["item"].as_str(),
        Some("Roster\u{00a7}Roster")
    );
    let included = parsed["snapshot"]["assets"]["included"]
        .as_array()
        .expect("snapshot.assets.included is an array");
    let items: Vec<&str> = included.iter().filter_map(|a| a["item"].as_str()).collect();
    assert!(items.contains(&"Faction\u{00a7}Grey Knights"));
    assert!(items.contains(&"Detachment\u{00a7}Banishers"));
}

#[test]
fn export_dispatch_matches_direct_serializer() {
    let roster = import_payload();
    let direct = RosterizerSerializer.serialize(&roster);
    let dispatched = export_roster(&roster, ExportFormat::Rosterizer);
    assert_eq!(direct, dispatched);
}

#[test]
fn export_never_emits_prose_fields() {
    let roster = import_payload();
    let out = RosterizerSerializer.serialize(&roster);
    assert!(!out.contains("\"text\""));
    assert!(!out.contains("\"description\""));
    assert!(!out.contains("\"rules\""));
    assert!(!out.contains("CANARY"));
}

#[test]
fn round_trip_export_then_import_preserves_resolved_ids() {
    let seed = import_payload();
    let json = RosterizerSerializer.serialize(&seed);
    let decoded: Value = serde_json::from_str(&json).unwrap();
    let reparsed = import_roster(&decoded, Dataset::embedded()).expect("re-import succeeds");
    assert_eq!(
        reparsed.source.format,
        wh40kdc::import::RosterFormat::Rosterizer
    );
    assert_eq!(reparsed.faction_id, seed.faction_id);
    assert_eq!(reparsed.detachment_id, seed.detachment_id);
    assert_eq!(reparsed.battle_size, seed.battle_size);

    let seed_ids: Vec<&str> = seed
        .units
        .iter()
        .filter_map(|u| u.ref_.id.as_deref())
        .collect();
    let reparsed_ids: Vec<&str> = reparsed
        .units
        .iter()
        .filter_map(|u| u.ref_.id.as_deref())
        .collect();
    assert_eq!(seed_ids, reparsed_ids);

    for (a, b) in seed.units.iter().zip(reparsed.units.iter()) {
        assert_eq!(a.model_count, b.model_count);
        assert_eq!(a.is_warlord, b.is_warlord);
        assert_eq!(a.points, b.points);
        assert_eq!(
            a.enhancement.as_ref().and_then(|e| e.id.as_deref()),
            b.enhancement.as_ref().and_then(|e| e.id.as_deref())
        );
        let a_w: Vec<(Option<&str>, u64)> = a
            .wargear
            .iter()
            .map(|w| (w.ref_.id.as_deref(), w.count))
            .collect();
        let b_w: Vec<(Option<&str>, u64)> = b
            .wargear
            .iter()
            .map(|w| (w.ref_.id.as_deref(), w.count))
            .collect();
        assert_eq!(a_w, b_w);
    }
}
