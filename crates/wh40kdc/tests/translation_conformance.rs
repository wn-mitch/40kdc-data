//! The Rust describers against the shared translation goldens:
//! `conformance/effect-translation/cases.json` (effect + scope + applies_to +
//! usage + trigger → ability text) and `conformance/scoring-translation/cases.json`
//! (secondary card → award lines). The TS reference produces these goldens; this
//! test is the Rust half of their independent reproduction, so a describer
//! drift fails `cargo test` and not only the cross-impl differ.

use std::path::PathBuf;

use serde_json::Value;
use wh40kdc::{
    describe_ability_parts, describe_scoring_card, AbilityAppliesTo, AbilityTrigger, AbilityUsage,
    Dataset, EffectNode, Scope,
};

fn corpus(path: &str) -> Value {
    let file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../conformance")
        .join(path);
    let raw =
        std::fs::read_to_string(&file).unwrap_or_else(|e| panic!("read {}: {e}", file.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {}: {e}", file.display()))
}

/// An optional ability part: absent or null is `None`; anything else must parse.
fn part<T: serde::de::DeserializeOwned>(case: &Value, key: &str) -> Option<T> {
    let v = case.get(key).filter(|v| !v.is_null())?;
    Some(
        serde_json::from_value(v.clone())
            .unwrap_or_else(|e| panic!("{}: `{key}` does not parse: {e}", case["caseId"])),
    )
}

#[test]
fn effect_translation_matches_goldens() {
    let cases = corpus("effect-translation/cases.json");
    let cases = cases.as_array().expect("cases array");
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for case in cases {
        let id = case["caseId"].as_str().expect("caseId");
        let effect: EffectNode = serde_json::from_value(case["effect"].clone())
            .unwrap_or_else(|e| panic!("{id}: effect does not parse: {e}"));
        let text = describe_ability_parts(
            &effect,
            part::<Scope>(case, "scope").as_ref(),
            part::<AbilityAppliesTo>(case, "applies_to").as_ref(),
            part::<AbilityUsage>(case, "usage").as_ref(),
            part::<AbilityTrigger>(case, "trigger").as_ref(),
        );
        let expected = case["expected"]["text"].as_str().expect("expected.text");
        if text != expected {
            failures.push(format!("{id}\n  expected: {expected}\n  actual:   {text}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} effect-translation case(s) diverge:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn scoring_translation_matches_goldens() {
    let ds = Dataset::embedded();
    let cases = corpus("scoring-translation/cases.json");
    let cases = cases.as_array().expect("cases array");
    assert!(!cases.is_empty());
    for case in cases {
        let id = case["cardId"].as_str().expect("cardId");
        let card = ds
            .mission_cards
            .get(id)
            .unwrap_or_else(|| panic!("{id} is not a bundled mission card"));
        let expected: Vec<String> =
            serde_json::from_value(case["expected"]["awards"].clone()).expect("expected.awards");
        assert_eq!(describe_scoring_card(card), expected, "{id}");
    }
}
