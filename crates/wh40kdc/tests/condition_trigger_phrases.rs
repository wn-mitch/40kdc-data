//! Condition and trigger phrasing pinned against the TypeScript reference.
//!
//! `fixtures/condition-trigger-phrases.json` holds inputs with the strings
//! `tools/src/translate/{condition,trigger}.ts` renders for them
//! (`describeCondition`, `conditionLeadIn`, `describeSelectionEligibility`,
//! `describeTrigger`). The inputs target branches the shared effect-translation
//! corpus barely reaches: `not` over each predicate family (verb-turned
//! negation, "did not", "no ..."), keyword-exclusion runs in `and` lead-ins,
//! and phase/turn boundaries on triggers. Every input also has to deserialize
//! into the generated types, so a codegen regression that drops a predicate's
//! parameters fails here too.

use serde_json::Value;
use wh40kdc::{
    condition_lead_in_value, describe_condition_value, describe_selection_eligibility_value,
    describe_trigger_value, ConditionNode, Trigger,
};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/condition-trigger-phrases.json"))
        .expect("fixture is JSON")
}

/// The typed round trip the describers see in the dataset.
fn typed<T: serde::de::DeserializeOwned + serde::Serialize>(v: &Value) -> Value {
    let t: T = serde_json::from_value(v.clone())
        .unwrap_or_else(|e| panic!("{v} does not deserialize: {e}"));
    serde_json::to_value(t).expect("serializes")
}

#[test]
fn conditions_render_like_the_ts_reference() {
    let f = fixture();
    let cases = f["conditions"].as_array().expect("conditions");
    assert!(!cases.is_empty());
    for case in cases {
        let input = typed::<ConditionNode>(&case["input"]);
        assert_eq!(
            describe_condition_value(&input),
            case["describe"].as_str().unwrap(),
            "describe {input}"
        );
        assert_eq!(
            condition_lead_in_value(&input),
            case["lead_in"].as_str().unwrap(),
            "lead-in {input}"
        );
        assert_eq!(
            describe_selection_eligibility_value(&input),
            case["eligibility"].as_str().unwrap(),
            "eligibility {input}"
        );
    }
}

#[test]
fn triggers_render_like_the_ts_reference() {
    let f = fixture();
    let cases = f["triggers"].as_array().expect("triggers");
    assert!(!cases.is_empty());
    for case in cases {
        let input = typed::<Trigger>(&case["input"]);
        assert_eq!(
            describe_trigger_value(&input),
            case["text"].as_str().unwrap(),
            "trigger {input}"
        );
    }
}
