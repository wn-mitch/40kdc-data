//! Describer wording for a condition on each unit an effect reaches (subject `recipient`).
//! Pinned to the TypeScript reference (`tools/test/translate-shapes.test.ts`, "a condition on each
//! unit an effect reaches"). Hunts a recipient condition read as "the unit" (this unit) and its
//! effect as "all enemy units".

use serde_json::{json, Value};
use wh40kdc::describe_ability_value_with_optional;

fn render(effect: Value) -> String {
    let scope = json!({"duration": "permanent"});
    describe_ability_value_with_optional(&effect, Some(&scope), None, None, None, false)
}

fn within(of: &str) -> Value {
    json!({"type": "matches", "parameters": {"subject": "recipient",
        "filter": {"within": {"of": of, "range": {"inches": 3}}}}})
}

fn oc(target: Value) -> Value {
    json!({"type": "stat-modifier", "target": target,
        "modifier": {"stat": "OC", "operation": "worsen", "value": 1}})
}

#[test]
fn names_the_unit_with_the_effects_filter_and_refers_back_to_it_as_that_unit() {
    let e = json!({"type": "conditional", "condition": within("this-unit"),
        "effect": oc(json!({"owner": "enemy"}))});
    assert_eq!(
        render(e),
        "While an enemy unit is within 3\" of the unit, worsen that unit's Objective Control characteristic by 1."
    );
}

#[test]
fn says_model_for_a_model_level_filter_and_keeps_later_mentions_as_that_model() {
    let both = json!({"operator": "and", "operands": [within("this-unit"),
        {"type": "matches", "parameters": {"subject": "recipient", "filter": {"state": "battle-shocked"}}}]});
    let e = json!({"type": "conditional", "condition": both,
        "effect": oc(json!({"owner": "enemy", "level": "model"}))});
    assert_eq!(
        render(e),
        "While an enemy model is within 3\" of the unit, while that model is Battle-shocked, worsen that model's Objective Control characteristic by 1."
    );
}

#[test]
fn reads_the_same_inside_a_sequence() {
    let gated = json!({"type": "conditional", "condition": within("this-unit"),
        "effect": oc(json!({"owner": "enemy", "all_of": ["VEHICLE"]}))});
    let e = json!({"type": "sequence", "steps": [gated, {"type": "stat-modifier",
        "target": "this-unit", "modifier": {"stat": "OC", "operation": "improve", "value": 1}}]});
    assert!(render(e).contains(
        "While an enemy VEHICLE unit is within 3\" of the unit, worsen that unit's Objective Control characteristic by 1."
    ));
}

#[test]
fn leaves_a_condition_on_the_abilitys_own_unit_as_it_was() {
    let own = json!({"type": "matches", "parameters": {"subject": "this-unit",
        "filter": {"within": {"of": "this-model", "range": {"inches": 3}}}}});
    let e = json!({"type": "conditional", "condition": own,
        "effect": oc(json!({"owner": "enemy"}))});
    assert_eq!(
        render(e),
        "While the unit is within 3\" of this model, worsen all enemy units' Objective Control characteristic by 1."
    );
}
