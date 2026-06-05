//! Integration tests for the `try_import_roster` auto-detect entry point.
//!
//! Mirrors `tools/test/import/try-import-roster.test.ts`: positive auto-detect
//! per format using the conformance corpus, negative failure paths, and a
//! matcher-disjointness invariant guarding the greedy-first-match contract.

#![cfg(feature = "import")]

use std::io::Write;
use std::path::PathBuf;

use flate2::write::GzEncoder;
use flate2::Compression;
use serde_json::Value;
use wh40kdc::import::{
    try_import_roster, GwAdapter, GwHeaderlessAdapter, ImportFailureReason, ImportResult,
    ListForgeTextAdapter, NewRecruitJsonAdapter, NewRecruitSimpleAdapter,
    NewRecruitWtcCompactAdapter, NewRecruitWtcFullAdapter, RosterFormat, RosterizerAdapter,
};
use wh40kdc::import::{FormatAdapter, ListForgeAdapter};
use wh40kdc::Dataset;

fn conformance(path: &str) -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../conformance/roster")
        .join(path);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

struct Fixture {
    label: &'static str,
    input: String,
    format: RosterFormat,
}

fn fixtures() -> Vec<Fixture> {
    vec![
        Fixture {
            label: "ListForge JSON (gk-banishers)",
            input: conformance("gk-banishers/input.json"),
            format: RosterFormat::Listforge,
        },
        Fixture {
            label: "ListForge JSON (gk-allied-multiforce)",
            input: conformance("gk-allied-multiforce/input.json"),
            format: RosterFormat::Listforge,
        },
        Fixture {
            label: "NewRecruit JSON (chaos-knights-houndpack)",
            input: conformance("chaos-knights-houndpack/input.newrecruit-json.json"),
            format: RosterFormat::NewrecruitJson,
        },
        Fixture {
            label: "NewRecruit wtc-compact",
            input: conformance("chaos-knights-houndpack/input.newrecruit-wtc-compact.txt"),
            format: RosterFormat::NewrecruitWtcCompact,
        },
        Fixture {
            label: "NewRecruit wtc-full",
            input: conformance("chaos-knights-houndpack/input.newrecruit-wtc-full.txt"),
            format: RosterFormat::NewrecruitWtcFull,
        },
        Fixture {
            label: "NewRecruit simple",
            input: conformance("chaos-knights-houndpack/input.newrecruit-simple.txt"),
            format: RosterFormat::NewrecruitSimple,
        },
        Fixture {
            label: "Rosterizer JSON (chaos-knights-houndpack)",
            input: conformance("chaos-knights-houndpack/input.rosterizer.json"),
            format: RosterFormat::Rosterizer,
        },
        Fixture {
            label: "GW app text (gw-chaos-knights)",
            input: conformance("gw-chaos-knights/input.gw.txt"),
            format: RosterFormat::Gw,
        },
        Fixture {
            label: "ListForge text (cd-daemonic-incursion)",
            input: conformance("cd-daemonic-incursion/input.listforge-text.txt"),
            format: RosterFormat::ListforgeText,
        },
    ]
}

#[test]
fn positive_auto_detect_per_format() {
    let ds = Dataset::embedded();
    for f in fixtures() {
        match try_import_roster(&f.input, ds) {
            ImportResult::Ok { roster, format } => {
                assert_eq!(format, f.format, "wrong format for {}", f.label);
                assert!(!roster.units.is_empty(), "empty units for {}", f.label);
                assert_eq!(roster.source.format, f.format);
            }
            ImportResult::Err {
                reason,
                message,
                trials,
            } => panic!(
                "expected Ok for {}, got {:?}: {} (trials: {:?})",
                f.label, reason, message, trials
            ),
        }
    }
}

#[test]
fn decodes_a_gzipped_listforge_url() {
    let ds = Dataset::embedded();
    let json = conformance("gk-banishers/input.json");

    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    enc.write_all(json.as_bytes()).unwrap();
    let gz = enc.finish().unwrap();
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&gz);
    let url = format!("https://yourapp.example/#/listforge/{b64}");

    match try_import_roster(&url, ds) {
        ImportResult::Ok { format, .. } => assert_eq!(format, RosterFormat::Listforge),
        ImportResult::Err {
            reason, message, ..
        } => panic!("expected Ok: {:?} {}", reason, message),
    }
}

#[test]
fn rejects_empty_input() {
    let ds = Dataset::embedded();
    match try_import_roster("   ", ds) {
        ImportResult::Err { reason, trials, .. } => {
            assert_eq!(reason, ImportFailureReason::EmptyInput);
            assert!(trials.is_empty());
        }
        ImportResult::Ok { .. } => panic!("expected Err"),
    }
}

#[test]
fn rejects_base64_shaped_but_not_gzip() {
    let ds = Dataset::embedded();
    match try_import_roster("H4sIAAAAnotreallygzip====", ds) {
        ImportResult::Err { reason, trials, .. } => {
            assert_eq!(reason, ImportFailureReason::DecodeFailed);
            assert_eq!(trials[0].id, RosterFormat::Listforge);
        }
        ImportResult::Ok { .. } => panic!("expected Err"),
    }
}

#[test]
fn rejects_malformed_json() {
    let ds = Dataset::embedded();
    match try_import_roster("{not valid json", ds) {
        ImportResult::Err { reason, .. } => {
            assert_eq!(reason, ImportFailureReason::DecodeFailed);
        }
        ImportResult::Ok { .. } => panic!("expected Err"),
    }
}

#[test]
fn rejects_unknown_json_shape() {
    let ds = Dataset::embedded();
    match try_import_roster(r#"{"hello":"world"}"#, ds) {
        ImportResult::Err { reason, trials, .. } => {
            assert_eq!(reason, ImportFailureReason::NoAdapterMatched);
            // Every adapter should have been polled.
            assert_eq!(trials.len(), 9);
            for t in trials {
                assert!(!t.matched, "{:?} should not have matched", t.id);
            }
        }
        ImportResult::Ok { .. } => panic!("expected Err"),
    }
}

#[test]
fn rejects_freeform_text() {
    let ds = Dataset::embedded();
    match try_import_roster("just some random pasted prose, not a list at all", ds) {
        ImportResult::Err { reason, .. } => {
            assert_eq!(reason, ImportFailureReason::NoAdapterMatched);
        }
        ImportResult::Ok { .. } => panic!("expected Err"),
    }
}

#[test]
fn adapter_matchers_are_disjoint_per_fixture() {
    // Greedy first-match dispatch relies on at most one adapter accepting a
    // given decoded payload. Guard the invariant against regressions.
    // Registry order matches `try_import_roster`'s dispatch.
    let adapters: Vec<Box<dyn FormatAdapter>> = vec![
        Box::new(RosterizerAdapter),
        Box::new(NewRecruitJsonAdapter),
        Box::new(GwAdapter),
        Box::new(NewRecruitWtcFullAdapter),
        Box::new(NewRecruitWtcCompactAdapter),
        Box::new(NewRecruitSimpleAdapter),
        Box::new(ListForgeTextAdapter),
        Box::new(GwHeaderlessAdapter),
        Box::new(ListForgeAdapter),
    ];

    for f in fixtures() {
        let trimmed = f.input.trim();
        let decoded: Value = if trimmed.starts_with('{') || trimmed.starts_with('[') {
            serde_json::from_str(trimmed).unwrap()
        } else {
            Value::String(f.input.clone())
        };

        let matched: Vec<RosterFormat> = adapters
            .iter()
            .filter(|a| a.detect(&decoded))
            .map(|a| a.format())
            .collect();

        // The bullet-text fallback `GwHeaderlessAdapter` legitimately also
        // accepts a ListForge-text payload (same body grammar); the framed
        // listforge-text matcher wins only by sitting ahead of it in the
        // registry. For that fixture assert the order-decided winner rather
        // than strict disjointness; every other fixture stays disjoint.
        if f.format == RosterFormat::ListforgeText {
            assert_eq!(
                matched.first().copied(),
                Some(RosterFormat::ListforgeText),
                "listforge-text fixture: first matcher should be listforge-text, got {matched:?}"
            );
            assert!(
                matched
                    .iter()
                    .all(|m| matches!(m, RosterFormat::ListforgeText | RosterFormat::Gw)),
                "listforge-text fixture: unexpected extra matcher in {matched:?}"
            );
            continue;
        }

        assert_eq!(
            matched.len(),
            1,
            "expected exactly one matcher for {}, got {:?}",
            f.label,
            matched
        );
        assert_eq!(matched[0], f.format, "wrong matcher for {}", f.label);
    }
}
