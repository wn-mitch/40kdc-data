//! The phase-4 DSL shapes pinned against the TypeScript reference.
//!
//! `fixtures/phase4-shapes.json` records every describer call
//! `tools/test/translate-phase4-shapes.test.ts` makes (`describeAbility`,
//! `describeCondition`, `describeTrigger`) with the exact string TS returned.
//! Each input must also survive the generated types unchanged: typify drops a
//! property it cannot express instead of failing, so a lossy round trip here is
//! a codegen regression (the describer would silently lose the field).

use serde_json::Value;
use wh40kdc::{
    describe_ability_parts, describe_condition_value, describe_trigger_value, AbilityUsage,
    ConditionNode, EffectNode, Scope, Trigger,
};

fn fixture() -> Vec<Value> {
    serde_json::from_str::<Value>(include_str!("fixtures/phase4-shapes.json"))
        .expect("fixture is JSON")
        .as_array()
        .expect("fixture is an array")
        .clone()
}

/// Whether `back` keeps everything `input` says: every non-null key with a covering value
/// (a typed round trip may add schema defaults and writes absent optionals as null), and
/// numbers compared as floats (a `number` field reads `6` back as `6.0`).
fn covers(back: &Value, input: &Value) -> bool {
    match (back, input) {
        (Value::Object(b), Value::Object(i)) => i
            .iter()
            .filter(|(_, x)| !x.is_null())
            .all(|(k, x)| b.get(k).is_some_and(|y| covers(y, x))),
        (Value::Array(b), Value::Array(i)) => {
            b.len() == i.len() && b.iter().zip(i).all(|(y, x)| covers(y, x))
        }
        (Value::Number(b), Value::Number(i)) => b.as_f64() == i.as_f64(),
        (b, i) => b == i,
    }
}

/// Deserialize into `T`, and require the round trip to keep every field.
fn typed<T: serde::de::DeserializeOwned + serde::Serialize>(v: &Value) -> T {
    let t: T = serde_json::from_value(v.clone())
        .unwrap_or_else(|e| panic!("{v} does not deserialize: {e}"));
    let back = serde_json::to_value(&t).expect("serializes");
    assert!(
        covers(&back, v),
        "the generated type does not round-trip {v}\n  got back {back}"
    );
    t
}

#[test]
fn phase4_shapes_render_like_ts() {
    let mut failures = Vec::new();
    for (i, case) in fixture().iter().enumerate() {
        let input = &case["input"];
        let want = case["output"].as_str().expect("output string");
        let got = match case["fn"].as_str() {
            Some("ability") => {
                let effect: EffectNode = typed(&input["effect"]);
                let scope: Option<Scope> = input.get("scope").filter(|v| !v.is_null()).map(typed);
                let usage: Option<AbilityUsage> =
                    input.get("usage").filter(|v| !v.is_null()).map(typed);
                describe_ability_parts(&effect, scope.as_ref(), None, usage.as_ref(), None)
            }
            Some("condition") => {
                let _: ConditionNode = typed(input);
                describe_condition_value(input)
            }
            Some("trigger") => {
                let _: Trigger = typed(input);
                describe_trigger_value(input)
            }
            other => panic!("case {i}: unknown fn {other:?}"),
        };
        if got != want {
            failures.push(format!("case {i}\n  want: {want}\n  got:  {got}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of the phase-4 renders differ from TS:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
