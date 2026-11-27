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
    allocate_attached, allocate_with, AllocationDefences, AttackProfileRef, Buff, DamageZeroing,
    EngineContext, EngineInput, TargetGroup, TargetProfileRef,
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

/// The cruncher cases whose single re-rolled dice the expected stages price: exact allocation
/// refuses them rather than returning a result without them.
#[test]
fn allocation_refuses_what_it_does_not_model() {
    let ds = Dataset::embedded();
    for (file, what) in [(
        "36-reroll-one-hit-and-wound-bolter-vs-intercessor.json",
        "re-roll one Hit roll, re-roll one Wound roll",
    )] {
        let path = conformance_dir().join("cruncher").join(file);
        let case: CruncherCase =
            serde_json::from_str(&fs::read_to_string(&path).expect("cruncher case")).expect(file);
        let input = EngineInput {
            attacker: AttackProfileRef {
                weapon: ds
                    .weapons
                    .get_any(&case.attacker.weapon_id)
                    .expect("weapon"),
                profile_index: case.attacker.profile_index,
            },
            target: TargetProfileRef {
                unit: ds.units.get_any(&case.target.unit_id).expect("unit"),
                profile_index: case.target.profile_index,
                model_count: case.target.model_count,
            },
            models_firing: case.models_firing,
            buffs: case.buffs,
            context: case.context,
        };
        let error = allocate_with(&input, Some(ds), &AllocationDefences::default())
            .expect_err(file)
            .to_string();
        assert_eq!(
            error,
            format!("allocate: {what} not modelled by exact allocation"),
            "{file}"
        );
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachedGroupSpec {
    character: bool,
    unit_id: String,
    profile_index: usize,
    model_count: u64,
    buffs: Vec<Buff>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachedLineSpec {
    attacker: AttackerSpec,
    models_firing: u64,
    context: EngineContext,
    buffs: Vec<Buff>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedGroup {
    models_destroyed_distribution: Vec<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedAttached {
    damage_dealt: f64,
    models_destroyed: f64,
    models_destroyed_distribution: Vec<f64>,
    wounds_dealt_distribution: Vec<f64>,
    groups: Vec<ExpectedGroup>,
}

#[derive(Debug, Deserialize)]
struct AttachedCase {
    name: String,
    groups: Vec<AttachedGroupSpec>,
    lines: Vec<AttachedLineSpec>,
    expected: ExpectedAttached,
}

fn assert_distribution(case: &str, field: &str, got: &[f64], want: &[f64]) {
    assert_eq!(
        got.len(),
        want.len(),
        "allocation/{case}: {field} length diverged"
    );
    for (i, (got, want)) in got.iter().zip(want).enumerate() {
        assert_close(case, &format!("{field}[{i}]"), *got, *want);
    }
}

/// `conformance/allocation/attached.json`: attack lines in turn into an attached unit's groups.
#[test]
fn attached_allocation_corpus_matches_reference() {
    let path = conformance_dir().join("allocation").join("attached.json");
    let raw =
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    let cases: Vec<AttachedCase> =
        serde_json::from_str(&raw).expect("allocation/attached.json is a valid JSON array");
    assert!(!cases.is_empty(), "attached allocation corpus is empty");

    let ds = Dataset::embedded();

    for case in &cases {
        let lines: Vec<Vec<EngineInput>> = case
            .lines
            .iter()
            .map(|line| {
                let weapon = ds
                    .weapons
                    .get_any(&line.attacker.weapon_id)
                    .unwrap_or_else(|| panic!("unknown weapon {}", line.attacker.weapon_id));
                case.groups
                    .iter()
                    .map(|group| EngineInput {
                        attacker: AttackProfileRef {
                            weapon,
                            profile_index: line.attacker.profile_index,
                        },
                        target: TargetProfileRef {
                            unit: ds
                                .units
                                .get_any(&group.unit_id)
                                .unwrap_or_else(|| panic!("unknown unit {}", group.unit_id)),
                            profile_index: group.profile_index,
                            model_count: Some(group.model_count),
                        },
                        models_firing: line.models_firing,
                        buffs: line.buffs.iter().chain(&group.buffs).cloned().collect(),
                        context: line.context.clone(),
                    })
                    .collect()
            })
            .collect();
        let groups: Vec<TargetGroup> = case
            .groups
            .iter()
            .map(|group| TargetGroup {
                character: group.character,
            })
            .collect();
        let actual = allocate_attached(&lines, &groups, Some(ds), &AllocationDefences::default())
            .unwrap_or_else(|e| panic!("allocate_attached for {}: {e}", case.name));
        let id = &case.name;
        let want = &case.expected;
        assert_close(id, "damageDealt", actual.damage_dealt, want.damage_dealt);
        assert_close(
            id,
            "modelsDestroyed",
            actual.models_destroyed,
            want.models_destroyed,
        );
        assert_distribution(
            id,
            "modelsDestroyedDistribution",
            &actual.models_destroyed_distribution,
            &want.models_destroyed_distribution,
        );
        assert_distribution(
            id,
            "woundsDealtDistribution",
            &actual.wounds_dealt_distribution,
            &want.wounds_dealt_distribution,
        );
        assert_eq!(
            actual.groups.len(),
            want.groups.len(),
            "allocation/{id}: group count diverged"
        );
        for (g, (got, want)) in actual.groups.iter().zip(&want.groups).enumerate() {
            assert_distribution(
                id,
                &format!("groups[{g}].modelsDestroyedDistribution"),
                &got.models_destroyed_distribution,
                &want.models_destroyed_distribution,
            );
        }
    }
}
