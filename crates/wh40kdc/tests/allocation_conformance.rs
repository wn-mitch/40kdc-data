//! Cross-implementation conformance for the cruncher's discrete allocation
//! stage.
//!
//! Each case in `conformance/allocation/cases.json` references a cruncher
//! input file (the same `EngineInput` already pinned by the cruncher corpus)
//! and pins the expected wounds removed, the expected models destroyed, and
//! the models-destroyed distribution. Floats compare within `5e-4` (matching
//! the cruncher tolerance); the distribution's length is exact.

#![cfg(feature = "cruncher")]

use std::fs;
use std::path::PathBuf;

use serde::Deserialize;
use wh40kdc::cruncher::{
    allocate_with, AllocationDefences, AttackProfileRef, Buff, DamageZeroing, EngineContext,
    EngineInput, TargetProfileRef,
};
use wh40kdc::Dataset;

const TOLERANCE: f64 = 5e-4;

fn conformance_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance")
}

#[derive(Debug, Deserialize)]
struct CruncherCase {
    attacker: AttackerSpec,
    #[serde(rename = "modelsFiring")]
    models_firing: u64,
    target: TargetSpec,
    context: EngineContext,
    buffs: Vec<Buff>,
}

#[derive(Debug, Deserialize)]
struct AttackerSpec {
    #[serde(rename = "weaponId")]
    weapon_id: String,
    #[serde(rename = "profileIndex")]
    profile_index: usize,
}

#[derive(Debug, Deserialize)]
struct TargetSpec {
    #[serde(rename = "unitId")]
    unit_id: String,
    #[serde(rename = "profileIndex")]
    profile_index: usize,
    #[serde(rename = "modelCount", default)]
    model_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct AllocationCase {
    name: String,
    cruncher_case: String,
    #[serde(default)]
    zeroing: Option<serde_json::Value>,
    /// Appended to the cruncher case's own buffs.
    #[serde(default)]
    buffs: Vec<Buff>,
    expected: ExpectedAllocation,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedAllocation {
    damage_dealt: f64,
    models_destroyed: f64,
    models_destroyed_distribution: Vec<f64>,
}

fn assert_close(case: &str, field: &str, got: f64, want: f64) {
    assert!(
        (got - want).abs() < TOLERANCE,
        "allocation/{case}: {field} {got} vs {want} (\u{0394} {})",
        (got - want).abs()
    );
}

#[test]
fn allocation_corpus_matches_reference() {
    let path = conformance_dir().join("allocation").join("cases.json");
    let raw =
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    let cases: Vec<AllocationCase> =
        serde_json::from_str(&raw).expect("allocation/cases.json is a valid JSON array");
    assert!(!cases.is_empty(), "allocation corpus is empty");

    let ds = Dataset::embedded();

    for case in &cases {
        let crunch_path = conformance_dir().join("cruncher").join(&case.cruncher_case);
        let crunch_raw = fs::read_to_string(&crunch_path)
            .unwrap_or_else(|e| panic!("reading {}: {e}", crunch_path.display()));
        let crunch_case: CruncherCase = serde_json::from_str(&crunch_raw)
            .unwrap_or_else(|e| panic!("parsing {}: {e}", crunch_path.display()));

        let weapon = ds
            .weapons
            .get_any(&crunch_case.attacker.weapon_id)
            .unwrap_or_else(|| panic!("unknown weapon {}", crunch_case.attacker.weapon_id));
        let unit = ds
            .units
            .get_any(&crunch_case.target.unit_id)
            .unwrap_or_else(|| panic!("unknown unit {}", crunch_case.target.unit_id));

        let input = EngineInput {
            attacker: AttackProfileRef {
                weapon,
                profile_index: crunch_case.attacker.profile_index,
            },
            target: TargetProfileRef {
                unit,
                profile_index: crunch_case.target.profile_index,
                model_count: crunch_case.target.model_count,
            },
            models_firing: crunch_case.models_firing,
            buffs: crunch_case
                .buffs
                .into_iter()
                .chain(case.buffs.iter().cloned())
                .collect(),
            context: crunch_case.context,
        };

        let zeroing = case.zeroing.as_ref().map(|value| {
            DamageZeroing::from_json(value)
                .unwrap_or_else(|e| panic!("zeroing for {}: {e}", case.name))
        });
        let actual = allocate_with(&input, Some(ds), &AllocationDefences { zeroing })
            .unwrap_or_else(|e| panic!("allocate for {}: {e}", case.name));
        let id = &case.name;
        let want = &case.expected;
        assert_close(id, "damageDealt", actual.damage_dealt, want.damage_dealt);
        assert_close(
            id,
            "modelsDestroyed",
            actual.models_destroyed,
            want.models_destroyed,
        );
        assert_eq!(
            actual.models_destroyed_distribution.len(),
            want.models_destroyed_distribution.len(),
            "allocation/{id}: distribution length diverged"
        );
        for (i, (got, want)) in actual
            .models_destroyed_distribution
            .iter()
            .zip(want.models_destroyed_distribution.iter())
            .enumerate()
        {
            assert_close(
                id,
                &format!("modelsDestroyedDistribution[{i}]"),
                *got,
                *want,
            );
        }
    }
}
