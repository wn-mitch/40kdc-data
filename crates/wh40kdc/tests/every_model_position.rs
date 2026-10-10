//! Describer wording for a within check with `models: every` (every model of the subject).
//! Pinned to the TypeScript reference (`tools/test/round5c-every-model-position.test.ts`).

use serde_json::json;
use wh40kdc::describe_condition_value;

#[test]
fn objective_check_names_every_model_of_the_subject() {
    let every = json!({"type": "within", "parameters": {
        "of": {"objective": {}}, "range": "objective-control", "models": "every"}});
    assert_eq!(
        describe_condition_value(&every),
        "every model in the unit is within range of an objective marker"
    );
    let plain = json!({"type": "within", "parameters": {
        "of": {"objective": {}}, "range": "objective-control"}});
    assert_eq!(
        describe_condition_value(&plain),
        "the unit is within range of an objective marker"
    );
}

#[test]
fn selected_objective_check_names_every_model_of_the_subject() {
    let selected = json!({"type": "within", "parameters": {
        "of": {"objective": {"selection_var": "marker"}}, "range": "objective-control",
        "models": "every"}});
    assert_eq!(
        describe_condition_value(&selected),
        "every model in the unit is within range of that objective marker"
    );
}
