//! The abilities resolver and the DSL→buff translator against the shared goldens in
//! `conformance/abilities-resolver/`: `0*.json` pins the eligible ability ids per source kind
//! (as sorted sets, per CONFORMANCE.md), and `from-dsl.json` / `defensive-from-dsl.json` pin
//! each ability effect's applied buffs, unsupported reasons and opt-in levers, in order (a
//! case's `rating` stands in for the unit's printed rating of a rated rule).

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{json, Value};
use wh40kdc::cruncher::{effect_to_buffs, BuffSource, EngineContext, TranslationPerspective};
use wh40kdc::data::{with_rating, EligibilityInput};
use wh40kdc::{Dataset, Phase};

fn corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance/abilities-resolver")
}

fn read(path: &PathBuf) -> Value {
    let raw =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

/// Numbers compared as floats: the typed buffs serialize `1` as `1.0`.
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(n) => json!(n.as_f64()),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), norm(x))).collect()),
        other => other.clone(),
    }
}

#[test]
fn eligible_abilities_match_the_resolver_goldens() {
    let ds = Dataset::embedded();
    let mut files: Vec<PathBuf> = std::fs::read_dir(corpus_dir())
        .expect("corpus dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with('0') && name.ends_with(".json")
        })
        .collect();
    files.sort();
    assert!(!files.is_empty(), "the resolver corpus is empty");
    let mut failures = Vec::new();
    for file in &files {
        let case = read(file);
        let input: EligibilityInput =
            serde_json::from_value(case["input"].clone()).expect("eligibility input");
        let phase: Phase = serde_json::from_value(case["phase"].clone()).expect("phase");
        let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for entry in ds.eligible_abilities(&input, phase) {
            grouped
                .entry(entry.source.kind().to_string())
                .or_default()
                .push(entry.ability.ability_id.to_string());
        }
        grouped.values_mut().for_each(|ids| ids.sort());
        let got = serde_json::to_value(&grouped).unwrap();
        if got != case["expected"] {
            failures.push(format!(
                "{}\n  want: {}\n  got:  {got}",
                file.display(),
                case["expected"]
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn run_dsl_corpus(filename: &str) {
    let ds = Dataset::embedded();
    let corpus = read(&corpus_dir().join(filename));
    let cases = corpus["cases"].as_array().expect("cases");
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for case in cases {
        let id = case["abilityId"].as_str().expect("abilityId");
        let ability = ds
            .abilities
            .get_any(id)
            .unwrap_or_else(|| panic!("unknown ability {id}"));
        let source: BuffSource = serde_json::from_value(case["source"].clone()).expect("source");
        let context: EngineContext =
            serde_json::from_value(case["context"].clone()).expect("context");
        let perspective = match case["perspective"].as_str() {
            Some("target") => TranslationPerspective::Target,
            _ => TranslationPerspective::Attacker,
        };
        // A rated rule reads the unit's printed rating; the case supplies it.
        let effect = with_rating(
            &serde_json::to_value(&ability.effect).unwrap(),
            case.get("rating").filter(|r| !r.is_null()),
        );
        let result = effect_to_buffs(&effect, &source, &context, perspective);
        let expected = &case["expected"];
        let applied: Vec<Value> = result
            .applied
            .iter()
            .map(|b| serde_json::to_value(&b.contribution).unwrap())
            .collect();
        let reasons: Vec<&str> = result
            .unsupported
            .iter()
            .map(|u| u.reason.as_str())
            .collect();
        let label = format!("{id} ({perspective:?})");
        if norm(&json!(applied)) != norm(&expected["applied"]) {
            failures.push(format!(
                "{label} applied\n  want: {}\n  got:  {}",
                expected["applied"],
                json!(applied)
            ));
        }
        if json!(reasons) != expected["unsupportedReasons"] {
            failures.push(format!(
                "{label} unsupportedReasons\n  want: {}\n  got:  {}",
                expected["unsupportedReasons"],
                json!(reasons)
            ));
        }
        if let Some(want) = expected.get("activatable") {
            let got: Vec<Value> = result
                .activatable
                .iter()
                .map(|a| {
                    json!({
                        "id": a.id,
                        "label": a.label,
                        "group": a.group,
                        "buffs": a.buffs.iter().map(|b| serde_json::to_value(&b.contribution).unwrap()).collect::<Vec<_>>(),
                    })
                })
                .collect();
            let want: Vec<Value> = want
                .as_array()
                .unwrap()
                .iter()
                .map(|e| {
                    let mut e = e.clone();
                    e.as_object_mut()
                        .unwrap()
                        .entry("group")
                        .or_insert(Value::Null);
                    e
                })
                .collect();
            if norm(&json!(got)) != norm(&json!(want)) {
                failures.push(format!(
                    "{label} activatable\n  want: {}\n  got:  {}",
                    json!(want),
                    json!(got)
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}

#[test]
fn from_dsl_matches_the_attacker_goldens() {
    run_dsl_corpus("from-dsl.json");
}

#[test]
fn defensive_from_dsl_matches_the_target_goldens() {
    run_dsl_corpus("defensive-from-dsl.json");
}
