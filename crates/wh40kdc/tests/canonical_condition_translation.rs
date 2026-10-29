//! Canonical predicates retain recipients, spatial anchors, cardinality, and option identity.
use serde_json::json;
use wh40kdc::translate::{
    condition_lead_in_value, describe_condition_value, describe_trigger_value,
};

#[test]
fn bodyguard_filter_preserves_membership_and_character_eligibility() {
    let condition = json!({"type":"matches","parameters":{"subject":"selected-unit","filter":{
        "level":"model","member_of":"selected-unit","attachment_role":"bodyguard","all_of":["CHARACTER"]
    }}});
    assert_eq!(
        describe_condition_value(&condition),
        "the selected unit is a CHARACTER bodyguard model in the selected unit"
    );
}

#[test]
fn exact_engagement_visibility_and_objective_origins_are_named() {
    let condition = json!({"type":"matches","parameters":{"filter":{
        "engaged_with":"this-model","visible":{"to":"selected-unit"},
        "within":{"range":{"inches":6},"of":{"objective":{"home_of":"enemy"}},"wholly":true}
    }}});
    assert_eq!(describe_condition_value(&condition), "the unit is a unit within Engagement Range of this model that is visible to the selected unit wholly within 6\" of an objective marker (opponent home)");
}

#[test]
fn ordinary_keyword_and_state_negation_remain_natural() {
    let keyword = json!({"operator":"not","operands":[{"type":"matches","parameters":{"subject":"defender","filter":{"any_of":["MONSTER","VEHICLE"]}}}]});
    assert_eq!(
        condition_lead_in_value(&keyword),
        "against a unit that is not a MONSTER or VEHICLE"
    );
    let state = json!({"operator":"not","operands":[{"type":"matches","parameters":{"filter":{"state":"engaged"}}}]});
    assert_eq!(describe_condition_value(&state), "the unit is unengaged");
}

#[test]
fn supplied_control_fraction_and_count_are_not_recipe_constants() {
    let condition = json!({"type":"controls","parameters":{"objective":{"territory":"enemy-territory"},"proportion":{"comparison":"gte","fraction":0.75}}});
    assert_eq!(
        describe_condition_value(&condition),
        "you control at least 75% of the objectives in enemy territory"
    );
    let count = json!({"type":"controls","parameters":{"count":{"min":0,"max":2}}});
    assert_eq!(
        describe_condition_value(&count),
        "you control 0-2 objectives"
    );
}

#[test]
fn tiered_ranges_explain_final_round_persistence() {
    let condition = json!({"type":"matches","parameters":{"filter":{"within":{"range":{"per_battle_round":[{"inches":3},{"inches":6}]},"of":"this-model"}}}});
    assert_eq!(describe_condition_value(&condition), "the unit is within 3\", 6\" in battle rounds 1, 2 respectively (using the final range in later battle rounds) of this model");
}

#[test]
fn option_references_use_explicit_parent_and_option_ids() {
    let condition = json!({"type":"rule-active","parameters":{"rule":{"ability_id":"fabricated-menu","option_id":"steady-option"}}});
    assert_eq!(
        describe_condition_value(&condition),
        "the Steady Option option of Fabricated Menu is active"
    );
}

#[test]
fn army_selection_is_an_event_not_a_historical_guard() {
    assert_eq!(
        describe_trigger_value(&json!({"event":"army-selected"})),
        "when selecting your army"
    );
}

#[test]
fn structured_weapon_history_preserves_parameters_and_bounds() {
    let condition = json!({"type":"happened","parameters":{"event":"after-roll","window":"phase","count":{"min":2,"max":3},"filter":{"roll":"hit","result":"success","weapons":{"keyword":{"keyword_id":"anti","parameters":{"target_keyword":"INFANTRY","threshold":4}}}}}});
    assert_eq!(
        describe_condition_value(&condition),
        "the unit was hit by 2-3 attacks made with a [ANTI-INFANTRY 4+] weapon this phase"
    );
}

#[test]
fn negating_a_conjunction_does_not_exclude_each_keyword() {
    let condition = json!({"operator":"not","operands":[{"type":"matches","parameters":{"subject":"defender","filter":{"all_of":["MONSTER","CHARACTER"]}}}]});
    assert_eq!(
        describe_condition_value(&condition),
        "the target does not have all of the MONSTER and CHARACTER keywords"
    );
    assert_eq!(
        condition_lead_in_value(&condition),
        "against a unit that does not have all of MONSTER and CHARACTER"
    );
}

#[test]
fn counted_model_proximity_preserves_snapshot_and_whole_model_quantifier() {
    let condition = json!({"type":"within","parameters":{"models":"every","count":{"min":2,"max":3},"range":"weapon","of":"attacker","at":"phase-start","wholly":true}});
    assert_eq!(describe_condition_value(&condition), "every model in the unit (2-3 models) was wholly within the attacking weapon's range at the start of the phase");
}

#[test]
fn negating_control_conjunction_negates_the_whole_predicate() {
    let condition = json!({"operator":"not","operands":[{"type":"controls","parameters":{"count":{"min":2},"compare":{"comparison":"gt","owner":"enemy"}}}]});
    assert_eq!(
        describe_condition_value(&condition),
        "not (you control 2+ objectives and you hold more objectives than the opponent)"
    );
}

#[test]
fn correlated_mission_history_keeps_destroyer_and_victim_positions() {
    let condition = json!({"type":"destroyed-while-on-objective","parameters":{
        "count":{"min":1},"objective_role":"central","destroyer_on_objective":true,
        "victim_on_objective":true,"victim_started_turn_on_objective":true
    }});
    assert_eq!(describe_condition_value(&condition), "1+ enemy units destroyed by a unit on a central objective while on a central objective that started the turn on a central objective");
}

#[test]
fn operation_marker_proximity_uses_supplied_filter_and_count() {
    let condition = json!({"type":"operation-markers","parameters":{
        "count":{"min":0,"max":2},"within":{"range":"objective-control","of":{"objective":{"home_of":"enemy"}}}
    }});
    assert_eq!(describe_condition_value(&condition), "0-2 operation markers on the battlefield within range of an objective marker (opponent home)");
}

#[test]
fn equipment_model_counts_preserve_all_bound_forms() {
    for (count, phrase) in [
        (json!({"min":1}), "one or more"),
        (json!({"min":2}), "at least 2"),
        (json!({"min":2,"max":3}), "2-3"),
        (json!({"max":3}), "at most 3"),
        (json!({"min":2,"max":2}), "exactly 2"),
    ] {
        let condition = json!({"type":"unit-wargear","parameters":{
            "wargear":"test-kit","models":{"count":count,"state":"carry"}}});
        assert_eq!(
            describe_condition_value(&condition),
            format!("{phrase} models in this unit are equipped with the Test Kit wargear")
        );
    }
}

#[test]
fn army_and_oath_states_keep_owner_and_negation() {
    let army = json!({"type":"army-state","parameters":{"owner":"enemy","state":"honoured"}});
    assert_eq!(
        describe_condition_value(&army),
        "your opponent's army is honoured"
    );
    let oath = json!({"operator":"not","operands":[{"type":"oath-state","parameters":{"ability":"test-oath","state":"fulfilled"}}]});
    assert_eq!(
        describe_condition_value(&oath),
        "the Test Oath oath is not fulfilled"
    );
}

#[test]
fn used_ability_trigger_keeps_source_and_usage_limit() {
    let trigger = json!({"event":"used","subject":"this-model","binds_event_variable":"used-ability",
        "filter":{"kind":"ability","source":["unit","enhancement"],"usage":{"frequency":"n-per-battle","count":1}}});
    assert_eq!(describe_trigger_value(&trigger),
        "each time this model uses an ability from its datasheet or an Enhancement that can be used once per battle");
    let named = json!({"event":"used","subject":"this-model","filter":{
        "kind":"ability","id":"example-power","source":["unit"],"usage":{"frequency":"n-per-battle","count":2}}});
    assert_eq!(describe_trigger_value(&named),
        "each time this model uses Example Power from its datasheet that can be used twice per battle");
}

#[test]
fn exact_unit_identity_filter_renders_ids_without_name_normalization() {
    let condition = json!({"type":"matches","parameters":{"filter":{
        "level":"unit","unit_ids":["example-unit","other-unit"]}}});
    let text = describe_condition_value(&condition);
    assert!(
        text.contains("with unit ID example-unit or other-unit"),
        "{text}"
    );
    assert!(!text.contains("Example Unit"), "{text}");
}
