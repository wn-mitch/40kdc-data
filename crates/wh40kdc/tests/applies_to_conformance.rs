//! Verifies the Rust `unit_matches_applies_to` matcher against the shared
//! `conformance/applies-to` corpus — the roster-highlighting scope contract.
//! Pinned byte-for-byte with TS and Python (the differ exercises the runner op;
//! this asserts the matcher against the oracle's expected `matchedIds`).

use std::path::PathBuf;

use serde::Deserialize;
use wh40kdc::{unit_matches_applies_to, KeywordPredicate};

#[derive(Deserialize)]
struct UnitKeywords {
    id: String,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    faction_keywords: Vec<String>,
}

#[derive(Deserialize)]
struct Expected {
    #[serde(rename = "matchedIds")]
    matched_ids: Vec<String>,
}

#[derive(Deserialize)]
struct Case {
    #[serde(rename = "caseId")]
    case_id: String,
    applies_to: Option<KeywordPredicate>,
    units: Vec<UnitKeywords>,
    expected: Expected,
}

fn corpus_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance/applies-to/cases.json")
}

#[test]
fn applies_to_conformance() {
    let raw = std::fs::read_to_string(corpus_path()).expect("read applies-to corpus");
    let cases: Vec<Case> = serde_json::from_str(&raw).expect("parse applies-to corpus");
    assert!(!cases.is_empty(), "corpus is empty");

    for case in &cases {
        let matched: Vec<String> = case
            .units
            .iter()
            .filter(|u| {
                let owned: Vec<&str> = u
                    .keywords
                    .iter()
                    .chain(&u.faction_keywords)
                    .map(String::as_str)
                    .collect();
                unit_matches_applies_to(case.applies_to.as_ref(), owned)
            })
            .map(|u| u.id.clone())
            .collect();
        assert_eq!(matched, case.expected.matched_ids, "case {}", case.case_id);
    }
}

#[test]
fn canonical_static_predicates_normalize_keywords_and_empty_constraints() {
    let filter: KeywordPredicate = serde_json::from_value(serde_json::json!({
        "all_of": ["EMPEROR’S CHILDREN"],
        "any_of": ["INFANTRY", "VEHICLE"],
        "none_of": ["MONSTER"],
        "not_all_of": ["CHARACTER", "VEHICLE"]
    }))
    .unwrap();
    assert!(unit_matches_applies_to(
        Some(&filter),
        ["emperor's children", "infantry"]
    ));
    assert!(!unit_matches_applies_to(
        Some(&filter),
        ["emperor's children", "vehicle", "character"]
    ));
    let unconstrained: KeywordPredicate = serde_json::from_value(serde_json::json!({
        "all_of": [], "none_of": []
    }))
    .unwrap();
    assert!(unit_matches_applies_to(Some(&unconstrained), []));
    // An empty any_of has nothing to match and an empty not_all_of is always complete.
    for clause in ["any_of", "not_all_of"] {
        let unsatisfiable: KeywordPredicate =
            serde_json::from_value(serde_json::json!({ clause: [] })).unwrap();
        assert!(!unit_matches_applies_to(Some(&unsatisfiable), ["INFANTRY"]));
    }
    assert!(!unit_matches_applies_to(None, ["INFANTRY"]));
}
