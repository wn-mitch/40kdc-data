//! Canonical effect forms preserve structured selectors, option identity, and supplied prose.
use serde_json::json;
use wh40kdc::translate::{describe_effect, describe_effect_inline};
use wh40kdc::EffectNode;

fn effect(value: serde_json::Value) -> EffectNode {
    serde_json::from_value(value).expect("canonical effect fixture must deserialize")
}

#[test]
fn canonical_select_units_keeps_filter_count_limit_and_binding() {
    let value = effect(json!({
        "type": "select-units",
        "selector": {
            "filter": {"owner": "enemy", "all_of": ["INFANTRY"]},
            "count": {"min": 1, "max": 2},
            "limit": {"count": 2, "period": "battle"},
            "bind_as": "marked"
        },
        "effect": {"type": "stat-modifier", "target": "selected-unit", "modifier": {"stat": "T", "operation": "add", "value": 1}}
    }));
    let rendered = describe_effect(&value);
    assert!(rendered.contains("enemy INFANTRY units"), "{rendered}");
    assert!(rendered.contains("from one through 2"), "{rendered}");
    assert!(rendered.contains("marked"));
    assert!(
        rendered.contains("at most 2 times per battle across your army"),
        "{rendered}"
    );
}

#[test]
fn canonical_stance_capacity_uses_explicit_option_refs() {
    let value = effect(json!({
        "type": "stance-selection-capacity",
        "modifier": {
            "ability_id": "battle-stance",
            "additional_selections": 1,
            "allocation": "choose-one-option",
            "options": [
                {"ability_id": "battle-stance", "option_id": "aggressive"},
                {"ability_id": "battle-stance", "option_id": "defensive"}
            ]
        }
    }));
    assert_eq!(
        describe_effect_inline(&value),
        "you can select Aggressive or Defensive one additional time per battle, shared between them"
    );
}

#[test]
fn named_region_renders_supplied_region_fraction_and_trigger() {
    let region = json!({"region_id":"test-region","owner_faction":"test-faction"});
    let value = effect(json!({
        "type":"named-region-state",
        "modifier":{
            "region_ref":region,
            "producer":{
                "region_ref":region,"mode":"complete","parent_ref":null,
                "baseline":[{"region":{"territory":"your-territory"},"duration":"battle"}],
                "phase_extensions":[{
                    "region":{"territory":"enemy-territory"},
                    "condition":{"type":"controls","parameters":{"proportion":{"comparison":"gte","fraction":0.75}}},
                    "trigger":{"event":"turn-started"},"duration":"turn","evaluation":"snapshot-once"
                }],
                "additive_extensions":[]
            },
            "consumer":{
                "state_ref":region,"beneficiary_filter":{"owner":"friendly","all_of":["INFANTRY"]},
                "membership":{"unit_scope":"model","relation":"within"},
                "qualified_condition":{"type":"matches","parameters":{"filter":{"state":"battle-shocked"}}},
                "default_branch":{"effect":{"type":"ability-part","effect":{"type":"stat-modifier","target":"this-model","modifier":{"stat":"T","operation":"add","value":1}}}},
                "qualified_branch":{"effect":{"type":"ability-part","optional":true,"effect":{"type":"stat-modifier","target":"this-model","modifier":{"stat":"T","operation":"add","value":2}}}}
            },
            "branch_precedence":"qualified-replaces-default"
        }
    }));
    let rendered = describe_effect(&value);
    assert!(rendered.contains("enemy territory"), "{rendered}");
    assert!(rendered.contains("75%"), "{rendered}");
    assert!(rendered.contains("start of"), "{rendered}");
    assert!(rendered.contains("turn"), "{rendered}");
    assert!(!rendered.contains("half of"), "{rendered}");
    assert!(!rendered.contains("Command phase"), "{rendered}");
    assert!(
        rendered.contains("If the unit is Battle-shocked"),
        "{rendered}"
    );
    assert!(rendered.contains("you can"), "{rendered}");
}

#[test]
fn keyword_range_changes_preserve_keyword_identity_without_regranting_rating() {
    let value = effect(json!({
        "type":"weapon-ability-range","target":"this-unit",
        "modifier":{"keyword":{"keyword_id":"rapid-fire"},"range":{"inches":18}}
    }));
    let rendered = describe_effect_inline(&value);
    assert!(rendered.contains("RAPID FIRE"), "{rendered}");
    assert!(rendered.contains("18\""), "{rendered}");
    assert!(!rendered.contains("RAPID FIRE 1"), "{rendered}");
}

#[test]
fn duration_api_distinguishes_during_and_after_resolution() {
    for (duration, expected) in [
        ("resolution", "Duration: when resolving this use."),
        ("after-resolving", "Duration: after resolving this use."),
        (
            "while-leading",
            "Duration: while this model is leading a unit.",
        ),
        ("permanent", "Duration: permanent."),
    ] {
        let scope = serde_json::from_value(json!({"duration":duration})).unwrap();
        assert_eq!(wh40kdc::translate::describe_scope(&scope), expected);
    }
}

#[test]
fn mortal_wound_model_roll_uses_its_typed_subject() {
    for (subject, phrase) in [
        (json!("selected-unit"), "the selected unit"),
        (json!({"selection_var":"marked"}), "the bound marked"),
    ] {
        let value = effect(json!({"type":"mortal-wounds","target":"selected-unit",
            "modifier":{"count":1,"roll":{"dice":"D6","threshold":4,"per_model":subject}}}));
        let rendered = describe_effect_inline(&value);
        assert!(
            rendered.contains(&format!("for each model in {phrase}")),
            "{rendered}"
        );
    }
}

#[test]
fn structured_keyword_grants_render_parameters_without_string_parsing() {
    let value = effect(json!({"type":"weapon-ability-grant","target":"this-unit",
    "modifier":{"keywords":[
        {"keyword_id":"anti","parameters":{"target_keyword":"INFANTRY","threshold":4}},
        {"keyword_id":"blast","parameters":{"value":1}},
        {"keyword_id":"sustained-hits","parameters":{"value":"D3"}}
    ]}}));
    let rendered = describe_effect_inline(&value);
    for label in ["[ANTI-INFANTRY 4+]", "[BLAST 1]", "[SUSTAINED HITS D3]"] {
        assert!(rendered.contains(label), "{rendered}");
    }
}

#[test]
fn named_ability_exchange_and_suppression_keep_declaration_identity() {
    let first = json!({"ability_id":"example-host","definition_id":"first-form"});
    let second = json!({"ability_id":"example-host","definition_id":"second-form"});
    let exchange = effect(json!({"type":"rule-state","target":"this-unit","modifier":{
        "rule_kind":"ability","rule":first,"direction":"exchanged","exchange_with":second
    }}));
    let text = describe_effect_inline(&exchange);
    assert!(
        text.contains(
            "exactly one of the First Form (Example Host) and Second Form (Example Host) abilities"
        ),
        "{text}"
    );
    assert!(
        text.contains("simultaneously loses that ability and gains the other"),
        "{text}"
    );
    let suppression = effect(json!({"type":"rule-state","target":"this-unit","modifier":{
        "rule_kind":"ability","rule":first,"direction":"suppressed","except_from":"this-ability"
    }}));
    assert_eq!(describe_effect_inline(&suppression),
        "the unit loses the First Form (Example Host) ability and cannot gain it except from this ability");
    let grant = effect(
        json!({"type":"ability-grant","target":"this-unit","modifier":{
            "ability":first,"definition":{"type":"ability-part","effect":{
                "type":"roll-modifier","target":"this-unit","modifier":{"roll":"hit","operation":"add","value":1}
            }}
        }}),
    );
    assert!(describe_effect_inline(&grant).contains("First Form (Example Host)"));
}

#[test]
fn oath_procedure_and_policies_render_supplied_domains_and_lifetime() {
    let procedure = effect(json!({"type":"ability-activate","target":"this-model",
        "modifier":{"ability":"example-rule","procedure":"oath"}}));
    assert_eq!(
        describe_effect_inline(&procedure),
        "this model resolves the Example Rule Oath procedure again"
    );
    let selection = effect(
        json!({"type":"oath-modifier","target":"this-model","modifier":{
            "ability":"example-rule","aspect":"selection","domains":["deed","quality"],
            "exclude_previously_selected":true,"duplicate_roll":"choose-unselected","stop_when":"all-domains-exhausted"
        }}),
    );
    assert_eq!(describe_effect_inline(&selection),
        "when selecting deeds and qualities for Example Rule for this model; exclude previously selected deeds and qualities; if a duplicate is rolled, choose an unselected result in that domain; stop when every domain is exhausted");
    let persistence = effect(json!({"type":"oath-modifier",
        "target":{"level":"model","member_of":"this-unit","attachment_role":"bodyguard"},
        "modifier":{"ability":"example-rule","aspect":"quality-persistence","from":"fulfilled","duration":"turn"}
    }));
    let text = describe_effect_inline(&persistence);
    assert!(text.contains("Bodyguard"), "{text}");
    assert!(
        text.contains("qualities from fulfilled Example Rule Oaths until the end of the turn"),
        "{text}"
    );
}

#[test]
fn oath_reward_replacement_waits_for_completion_and_preserves_selection_method() {
    for (method, qualifier) in [
        ("random", "randomly determined Example Rule deeds"),
        ("chosen", "chosen Example Rule deeds"),
        (
            "any",
            "Example Rule deeds, regardless of how those deeds were selected",
        ),
    ] {
        let reward = effect(
            json!({"type":"oath-modifier","target":"this-unit","modifier":{
                "ability":"example-rule","aspect":"deed-reward","applies_to":"additional",
                "operation":"replace","selection_method":method,
                "effect":{"type":"cp-gain","target":"this-unit","modifier":{"amount":7}}
            }}),
        );
        let text = describe_effect_inline(&reward);
        assert!(text.starts_with(&format!("for the unit, on completion of additional {qualifier}, replace their reward with: ")), "{text}");
        assert!(text.contains('7'), "{text}");
    }
}

#[test]
fn used_ability_selection_keeps_event_origin_and_recipient_lifetime() {
    let selection = effect(
        json!({"type":"ability-modifier","target":{"event_var":"actor"},"modifier":{
            "ability":{"event":"used","event_var":"use"},"aspect":"selection","operation":"set",
            "selection":{"filter":{"owner":"friendly","all_of":["INFANTRY"],
                "within":{"range":{"inches":8},"of":{"event_var":"actor"}}},
                "count":{"min":0,"max":2},"bind_as":"replacement"},
            "recipient_duration":"turn"
        }}),
    );
    let text = describe_effect_inline(&selection);
    assert!(
        text.contains("replace that ability's selection with up to 2 friendly INFANTRY units"),
        "{text}"
    );
    assert!(text.contains("within 8\" of that unit"), "{text}");
    assert!(text.contains("replacement"), "{text}");
    assert!(
        text.contains(
            "those recipients are affected by that same ability until the end of the turn"
        ),
        "{text}"
    );
}

#[test]
fn unlimited_advance_preserves_passthrough_and_end_restrictions() {
    let value = effect(
        json!({"type":"move-modifier","target":"this-unit","modifier":{
            "maximum":"unlimited","applies_to_moves":["advance"],
            "passthrough":[{"kind":"models"}],"no_end_in_engagement":true
        }}),
    );
    let text = describe_effect_inline(&value);
    assert!(text.contains("can move any distance"), "{text}");
    assert!(
        text.contains("can move over models as though they were not there"),
        "{text}"
    );
    assert!(
        text.contains("cannot end a move within Engagement Range of any enemy unit"),
        "{text}"
    );
    assert!(text.ends_with("during its Advance moves"), "{text}");
    assert!(!text.contains("Move characteristic"), "{text}");
}
