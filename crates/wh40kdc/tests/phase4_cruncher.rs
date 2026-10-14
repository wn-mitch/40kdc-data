//! The phase-4 shapes' buff translation pinned against the TypeScript reference.
//!
//! `fixtures/phase4-cruncher.json` records every `effectToBuffs` and `usageGated` call
//! `tools/test/translate-phase4-shapes.test.ts` makes, with the exact TS result. The cases
//! hunt the regressions the shapes guard against: a scaled or bound value applied flat, a
//! `roll` allocation whose levers drift from dice-pool-allocation's, the `ability-unit`
//! role not read as the buffed unit, and a usage list that loses its lever.

use serde_json::{json, Value};
use wh40kdc::cruncher::{effect_to_buffs, BuffSource, EngineContext, TranslationPerspective};
use wh40kdc::data::usage_gated;

/// Numbers as floats and null keys dropped, so typed output compares with the TS JSON.
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(n) => json!(n.as_f64()),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(_, x)| !x.is_null())
                .map(|(k, x)| (k.clone(), norm(x)))
                .collect(),
        ),
        other => other.clone(),
    }
}

#[test]
fn phase4_buff_translation_matches_ts() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/phase4-cruncher.json")).expect("fixture");
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let input = &case["input"];
        let got = match case["fn"].as_str() {
            Some("effectToBuffs") => {
                let source: BuffSource =
                    serde_json::from_value(input["source"].clone()).expect("source");
                let ctx: EngineContext =
                    serde_json::from_value(input["ctx"].clone()).expect("context");
                let perspective = match input["perspective"].as_str() {
                    Some("target") => TranslationPerspective::Target,
                    _ => TranslationPerspective::Attacker,
                };
                let r = effect_to_buffs(&input["effect"], &source, &ctx, perspective);
                json!({
                    "applied": r.applied,
                    "unsupported": r.unsupported.iter().map(|u| &u.reason).collect::<Vec<_>>(),
                    "activatable": r.activatable,
                })
            }
            Some("usageGated") => usage_gated(
                Some(&input["abilityType"]).filter(|v| !v.is_null()),
                Some(&input["usage"]).filter(|v| !v.is_null()),
                &input["effect"],
            ),
            other => panic!("case {i}: unknown fn {other:?}"),
        };
        if norm(&got) != norm(&case["output"]) {
            failures.push(format!(
                "case {i} ({})\n  want: {}\n  got:  {got}",
                case["fn"], case["output"]
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
