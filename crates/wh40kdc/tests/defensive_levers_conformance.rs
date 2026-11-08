//! `Dataset::defensive_levers_for` against `conformance/abilities-resolver/defensive-levers.json`:
//! every lever (id, label, default, source, pools, requirements, buff contributions) and every
//! pool, in order.

use std::path::PathBuf;

use serde_json::{json, Value};
use wh40kdc::cruncher::EngineContext;
use wh40kdc::data::EligibilityInput;
use wh40kdc::Dataset;

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
fn defensive_levers_match_the_goldens() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../conformance/abilities-resolver/defensive-levers.json");
    let raw =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let corpus: Value = serde_json::from_str(&raw).expect("parse corpus");
    let cases = corpus["cases"].as_array().expect("cases");
    assert!(!cases.is_empty(), "the defensive-levers corpus is empty");
    let ds = Dataset::embedded();
    let mut failures = Vec::new();
    for case in cases {
        let id = case["caseId"].as_str().expect("caseId");
        let input: EligibilityInput = serde_json::from_value(case["input"].clone()).expect("input");
        let opted_in: Vec<String> = case["input"]
            .get("optedInStratagemIds")
            .map(|ids| serde_json::from_value(ids.clone()).expect("optedInStratagemIds"))
            .unwrap_or_default();
        let context: EngineContext =
            serde_json::from_value(case["context"].clone()).expect("context");
        let got = ds.defensive_levers_for(&input, &opted_in, &context);
        let levers: Vec<Value> = got
            .levers
            .iter()
            .map(|lever| {
                json!({
                    "id": lever.id,
                    "label": lever.label,
                    "enabled": lever.enabled,
                    "source": lever.source,
                    "group": lever.group,
                    "groups": lever.groups,
                    "requires": lever.requires,
                    "buffs": lever.buffs.iter().map(|buff| serde_json::to_value(buff).unwrap()["contribution"].clone()).collect::<Vec<_>>(),
                })
            })
            .collect();
        let got = json!({ "levers": levers, "groups": got.groups });
        if norm(&got) != norm(&case["expected"]) {
            failures.push(format!("{id}:\n  got  {got}\n  want {}", case["expected"]));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
