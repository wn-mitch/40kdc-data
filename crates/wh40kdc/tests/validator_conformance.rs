//! Verifies the Rust schema validator against the shared `conformance/validator`
//! corpus — the closed-enum `(path, code)` contract. Comparison is set-based
//! and deduplicated (the runner already dedups), matching the differ.

#![cfg(feature = "validate")]

use std::collections::BTreeSet;
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;
use wh40kdc::validate_target;

#[derive(Deserialize)]
struct ExpectedError {
    path: String,
    code: String,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    target: String,
    input: Value,
    expected_errors: Vec<ExpectedError>,
}

fn corpus_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance/validator/cases.json")
}

#[test]
fn validator_conformance() {
    let raw = std::fs::read_to_string(corpus_path()).expect("read validator corpus");
    let cases: Vec<Case> = serde_json::from_str(&raw).expect("parse validator corpus");
    assert!(!cases.is_empty(), "corpus is empty");

    for case in &cases {
        let got: BTreeSet<(String, String)> = validate_target(&case.target, &case.input)
            .into_iter()
            .map(|e| {
                (
                    e["path"].as_str().unwrap_or_default().to_string(),
                    e["code"].as_str().unwrap_or_default().to_string(),
                )
            })
            .collect();
        let want: BTreeSet<(String, String)> = case
            .expected_errors
            .iter()
            .map(|e| (e.path.clone(), e.code.clone()))
            .collect();
        assert_eq!(got, want, "case {}", case.name);
    }
}
