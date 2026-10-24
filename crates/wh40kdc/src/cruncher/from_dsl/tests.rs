use serde_json::json;

use super::*;
use crate::Phase;

fn src() -> BuffSource {
    BuffSource::Ability {
        ability_id: "x".into(),
        ability_kind: AbilityKind::Unit,
        source_unit_id: None,
    }
}

fn run(effect: Value) -> EffectTranslation {
    effect_to_buffs(
        &effect,
        &src(),
        &EngineContext::new(Phase::Shooting),
        TranslationPerspective::Attacker,
    )
}

#[test]
fn structured_keyword_grants_preserve_catalog_parameters() {
    let reference = json!({ "keyword_id": "anti", "parameters": { "required_target_keywords_any": ["MONSTER", "VEHICLE"], "threshold": 4 } });
    let result = run(
        json!({ "type": "weapon-ability-grant", "target": "this-unit", "modifier": { "keywords": [reference] } }),
    );
    assert_eq!(
        serde_json::to_value(&result.applied[0]).unwrap()["contribution"]["keywordRef"],
        reference
    );
    let old = run(
        json!({ "type": "weapon-ability-grant", "target": "this-unit", "modifier": { "keywords": ["Lethal Hits"] } }),
    );
    assert!(old.applied.is_empty());
    assert_eq!(old.unsupported.len(), 1);
}

#[test]
fn a_scaled_or_bound_value_is_never_applied_flat() {
    let scaled = run(json!({
        "type": "roll-modifier", "target": "this-unit",
        "modifier": { "roll": "hit", "operation": "add", "value": 1 },
        "scaling": { "of": "models-in-bearer-unit", "per": 5 },
    }));
    assert!(scaled.applied.is_empty());
    assert_eq!(
        scaled.unsupported[0].reason,
        "roll-modifier: the value scales with models-in-bearer-unit; not resolved by the buff engine"
    );
    let sized = run(json!({
        "type": "stat-modifier", "target": "this-unit",
        "modifier": { "stat": "A", "operation": "add", "value": { "incursion": 1, "strike-force": 2, "onslaught": 3 } },
    }));
    assert!(sized.applied.is_empty());
    assert_eq!(
        sized.unsupported[0].reason,
        "stat-modifier: its value is set by the battle size; not resolved by the buff engine"
    );
}

#[test]
fn a_roll_allocation_emits_the_dice_pool_levers() {
    let option = |name: &str, kw: &str| {
        json!({ "name": name, "requirement": { "type": "pair", "min_value": 4 },
                "effect": { "type": "weapon-ability-grant", "target": "this-unit", "modifier": { "keywords": [{"keyword_id": kw}] } } })
    };
    let pool = run(json!({
        "type": "dice-pool-allocation", "max_activations": 2,
        "options": [option("Warp Blades", "lethal-hits"), option("Rage", "sustained-hits")],
    }));
    let part = |name: &str, kw: &str| {
        json!({ "type": "ability-part", "name": name, "effect": {
            "type": "dice-gated", "from": { "roll_var": "r" }, "requirement": { "type": "pair", "min_value": 4 },
            "on_success": { "type": "weapon-ability-grant", "target": "this-unit", "modifier": { "keywords": [{"keyword_id": kw}] } } } })
    };
    let roll = run(json!({
        "type": "roll", "dice": "8D6", "roll_var": "r",
        "effect": { "type": "choice", "max_choices": 2, "options": [part("Warp Blades", "lethal-hits"), part("Rage", "sustained-hits")] },
    }));
    assert_eq!(roll.activatable, pool.activatable);
    assert_eq!(roll.activatable.len(), 2);
    // A gate on another roll's dice is not an allocation: the choice is walked as a choice.
    let other = run(json!({
        "type": "roll", "dice": "8D6", "roll_var": "q",
        "effect": { "type": "choice", "options": [part("Warp Blades", "lethal-hits")] },
    }));
    assert!(other.activatable.iter().all(|l| l.id != "x#Warp Blades"));
}

#[test]
fn the_ability_unit_is_the_buffed_unit_and_attached_models_stay_on_their_model() {
    let reroll = |target: &str| json!({ "type": "re-roll", "target": target, "modifier": { "roll": "hit", "subset": "ones" } });
    assert_eq!(run(reroll("ability-unit")).applied.len(), 1);
    let attached = effect_to_buffs(
        &reroll("this-model"),
        &BuffSource::Ability {
            ability_id: "x".into(),
            ability_kind: AbilityKind::Attached,
            source_unit_id: None,
        },
        &EngineContext::new(Phase::Shooting),
        TranslationPerspective::Target,
    );
    assert_eq!(attached.unsupported[0].reason, MODEL_SCOPED_REASON);
}

#[test]
fn army_faction_battle_size_and_guided_read_the_context() {
    let gated = |condition: Value| {
        json!({ "type": "conditional", "condition": condition,
                "effect": { "type": "roll-modifier", "target": "this-unit", "modifier": { "roll": "hit", "operation": "add", "value": 1 } } })
    };
    let mut ctx = EngineContext::new(Phase::Shooting);
    let faction = gated(json!({ "type": "army-faction", "parameters": { "faction": "necrons" } }));
    let unknown = effect_to_buffs(&faction, &src(), &ctx, TranslationPerspective::Attacker);
    assert_eq!(unknown.unsupported.len(), 1, "an unset faction is unknown");
    ctx.army_faction = Some("necrons".into());
    ctx.battle_size = Some("incursion".into());
    ctx.attacker_guided = Some(false);
    let t = |c: Value| {
        effect_to_buffs(&gated(c), &src(), &ctx, TranslationPerspective::Attacker)
            .applied
            .len()
    };
    assert_eq!(
        t(json!({ "type": "army-faction", "parameters": { "faction": "necrons" } })),
        1
    );
    assert_eq!(
        t(json!({ "type": "battle-size", "parameters": { "size": "onslaught" } })),
        0
    );
    assert_eq!(t(json!({ "type": "guided", "parameters": {} })), 0);
}

#[test]
fn an_unlisted_ability_kind_round_trips_as_written() {
    let source: BuffSource = serde_json::from_value(
        json!({ "kind": "ability", "abilityId": "x", "abilityKind": "enhancement" }),
    )
    .expect("an unlisted kind deserializes");
    assert_eq!(
        serde_json::to_value(&source).unwrap()["abilityKind"],
        json!("enhancement")
    );
    let listed: BuffSource = serde_json::from_value(
        json!({ "kind": "ability", "abilityId": "x", "abilityKind": "unit" }),
    )
    .unwrap();
    assert!(matches!(
        listed,
        BuffSource::Ability {
            ability_kind: AbilityKind::Unit,
            ..
        }
    ));
}

#[test]
fn matches_preserves_keyword_predicates_and_unknown_model_membership() {
    let effect = |filter: Value| {
        json!({
            "type": "conditional", "condition": {"type": "matches", "parameters": {"subject": "this-unit", "filter": filter}},
            "effect": {"type": "roll-modifier", "target": "this-unit", "modifier": {"roll": "hit", "operation": "add", "value": 1}}
        })
    };
    let mut ctx = EngineContext::new(Phase::Shooting);
    ctx.attacker_keywords = Some(vec!["INFANTRY".into(), "CHARACTER".into()]);
    ctx.attacker_attached = Some(true);
    let translate = |filter| {
        effect_to_buffs(
            &effect(filter),
            &src(),
            &ctx,
            TranslationPerspective::Attacker,
        )
    };
    assert_eq!(
        translate(json!({"all_of": ["infantry"], "not_all_of": ["MONSTER", "CHARACTER"]}))
            .applied
            .len(),
        1
    );
    assert!(translate(json!({"not_all_of": ["INFANTRY", "CHARACTER"]}))
        .applied
        .is_empty());
    for filter in [
        json!({"level": "model", "attachment_role": "bodyguard", "member_of": "this-unit"}),
        json!({"within": {"range": {"per_battle_round": [{"inches": 3}, {"inches": 6}]}, "of": "this-unit"}}),
        json!({"visible": {"to": "this-model"}}),
    ] {
        let result = translate(filter);
        assert!(result.applied.is_empty());
        assert_eq!(result.unsupported.len(), 1);
    }
}

#[test]
fn stance_ids_capacity_and_parent_activation_metadata_survive() {
    let result = run(json!({
        "type": "ability-part", "name": "Activation", "usage": {"frequency": "n-per-battle", "count": 1}, "cost": {"cp": 1},
        "effect": {"type": "stance-select", "mode": "re-selectable", "max_choices": 2, "min_choices": 1, "options": [
            {"id": "stable-option", "name": "Renamed option", "effect": {"type": "roll-modifier", "target": "this-unit", "modifier": {"roll": "hit", "operation": "add", "value": 1}}}
        ]}
    }));
    assert_eq!(result.activatable[0].id, "x#stable-option");
    assert_eq!(
        result.activatable[0]
            .group
            .as_ref()
            .unwrap()
            .max_activations,
        2
    );
    assert_eq!(
        result.activatable[0].requires.as_ref().unwrap()[0]["cost"],
        json!({"cp": 1})
    );
    let capacity = run(json!({"type": "stance-selection-capacity", "modifier": {
        "ability_id": "stances", "additional_selections": 1, "allocation": "fixed-option",
        "option": {"ability_id": "stances", "option_id": "stable-option"}
    }}));
    assert_eq!(
        capacity.activatable[0]
            .cap_raise
            .as_ref()
            .unwrap()
            .option
            .as_ref()
            .unwrap()
            .option_id,
        "stable-option"
    );
}

#[test]
fn bound_selectors_keep_common_predicates_and_selection_requirements() {
    let effect = json!({"type": "select-units", "selector": {
        "filter": {"owner": "friendly", "any_of": ["INFANTRY", "VEHICLE"]},
        "count": {"min": 1, "max": 2}, "bind_as": "chosen"
    }, "effect": {"type": "roll-modifier", "target": {"selection_var": "chosen"},
        "modifier": {"roll": "hit", "operation": "add", "value": 1}}});
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_keywords = Some(vec!["infantry".into()]);
    let result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert!(result.applied.is_empty());
    assert_eq!(result.activatable.len(), 1);
    assert_eq!(
        result.activatable[0].requires.as_ref().unwrap()[0]["selector"]["bind_as"],
        "chosen"
    );
}

#[test]
fn menu_levers_keep_canonical_filters_costs_and_shared_capacity() {
    let effect = json!({"type": "resource-action-menu", "menu_id": "menu", "pool_id": "pool",
        "shared_usage": {"unit_max_manoeuvres_per_phase": 1},
        "capacity": {"amount": 3, "refresh": "battle-round", "resource_label": "point", "ability_noun": "Action"},
        "actions": [{"id": "stable-action", "label": "Renamed action", "cost": {"pool_id": "pool", "amount": 2},
            "when": {"event": "selected", "filter": {"to": "shoot"}},
            "eligibility": {"filter": {"all_of": ["INFANTRY"]}},
            "effect": {"type": "roll-modifier", "target": "this-unit", "modifier": {"roll": "hit", "operation": "add", "value": 1}}}]
    });
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_keywords = Some(vec!["infantry".into()]);
    let result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    let lever = &result.activatable[0];
    assert_eq!(lever.id, "x#stable-action");
    assert_eq!(lever.group.as_ref().unwrap().id, "x?menu");
    assert_eq!(
        lever.requires.as_ref().unwrap()[0]["action"]["cost"]["amount"],
        2
    );
    assert_eq!(lever.requires.as_ref().unwrap()[0]["capacity"]["amount"], 3);
    context.attacker_keywords = None;
    assert!(
        effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker)
            .activatable
            .is_empty()
    );
}

#[test]
fn named_region_default_branch_preserves_local_activation_and_common_filter() {
    let effect = json!({"type": "named-region-state", "modifier": {"consumer": {
        "beneficiary_filter": {"any_of": ["INFANTRY", "VEHICLE"]},
        "default_branch": {"effect": {"type": "ability-part", "name": "Default", "optional": true,
            "effect": {"type": "roll-modifier", "target": "this-unit", "modifier": {"roll": "hit", "operation": "add", "value": 1}}}},
        "qualified_branch": {"effect": {"type": "ability-part", "name": "Qualified", "effect": {"type": "no-effect"}}}
    }}});
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_keywords = Some(vec!["infantry".into()]);
    let result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert!(result.applied.is_empty());
    assert_eq!(result.activatable.len(), 1);
    assert!(result.unsupported[0].reason.contains("region membership"));
}

#[test]
fn bodyguard_target_requires_actual_membership_not_character_keywords() {
    let effect = json!({"type": "roll-modifier",
        "target": {"level": "model", "member_of": "this-unit", "attachment_role": "bodyguard"},
        "modifier": {"roll": "hit", "operation": "add", "value": 1}});
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_keywords = Some(vec!["CHARACTER".into()]);
    context.attacker_attached = Some(true);
    let result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert!(result.applied.is_empty());
    assert_eq!(result.unsupported.len(), 1);
    context.attacker_attachment_role = Some(crate::cruncher::AttachmentRole::Bodyguard);
    assert_eq!(
        effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker)
            .applied
            .len(),
        1
    );
    context.attacker_attachment_role = Some(crate::cruncher::AttachmentRole::Leader);
    assert!(
        effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker)
            .applied
            .is_empty()
    );
}

#[test]
fn range_tiers_use_explicit_battle_round_and_keep_the_last_tier() {
    let filter = json!({"within": {"of": "defender", "range": {
        "per_battle_round": [{"inches": 3}, {"inches": 6}]
    }}});
    let mut context = EngineContext::new(Phase::Shooting);
    context.distance_inches = Some(5.0);
    let matches = |context: &EngineContext| {
        conditions::matches_unit_filter(
            &filter,
            context,
            TranslationPerspective::Attacker,
            "friendly",
        )
    };
    assert_eq!(matches(&context), None);
    context.battle_round = Some(1);
    assert_eq!(matches(&context), Some(false));
    context.battle_round = Some(2);
    assert_eq!(matches(&context), Some(true));
    context.battle_round = Some(6);
    assert_eq!(matches(&context), Some(true));
    context.distance_inches = None;
    assert_eq!(matches(&context), None);
    assert_eq!(
        conditions::matches_unit_filter(
            &json!({"within": {"of": "defender", "range": {"per_battle_round": []}}}),
            &context,
            TranslationPerspective::Attacker,
            "friendly"
        ),
        None
    );
}

#[test]
fn cover_state_reads_only_the_matching_sides_explicit_fact() {
    let filter = json!({"state": "benefit-of-cover"});
    let mut context = EngineContext::new(Phase::Shooting);
    context.target_in_cover = Some(true);
    assert_eq!(
        conditions::matches_unit_filter(
            &filter,
            &context,
            TranslationPerspective::Attacker,
            "friendly"
        ),
        None
    );
    assert_eq!(
        conditions::matches_unit_filter(&filter, &context, TranslationPerspective::Target, "enemy"),
        Some(true)
    );
    context.target_in_cover = Some(false);
    assert_eq!(
        conditions::matches_unit_filter(&filter, &context, TranslationPerspective::Target, "enemy"),
        Some(false)
    );
}

#[test]
fn local_reactions_keep_trigger_eligibility_and_parent_shared_usage() {
    let trigger = json!({"event": "selected", "filter": {"to": "shoot"},
        "condition": {"type": "matches", "parameters": {"filter": {"state": "benefit-of-cover"}}}});
    let effect = json!({"type": "ability-part", "name": "Reaction", "optional": true,
        "trigger": trigger, "effect": {"type": "roll-modifier", "target": "this-unit",
            "modifier": {"roll": "hit", "operation": "add", "value": 1}}});
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_in_cover = Some(false);
    assert!(
        effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker)
            .activatable
            .is_empty()
    );
    context.attacker_in_cover = Some(true);
    let mut result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert!(result.applied.is_empty());
    assert_eq!(result.activatable.len(), 1);
    assert_eq!(
        result.activatable[0].requires.as_ref().unwrap()[0]["trigger"],
        trigger
    );
    let activation = json!({"usage": {"frequency": "once-per-turn", "per": "model"}});
    apply_activation(&mut result, "x", activation.clone());
    assert_eq!(
        result.activatable[0].requires.as_ref().unwrap()[0],
        activation
    );
    assert!(result.activatable[0].group.is_none());
}

#[test]
fn shared_usage_preserves_the_independent_stance_cap() {
    let mut result = run(json!({"type": "stance-select", "mode": "re-selectable",
        "max_choices": 2, "options": [{"id": "fixed", "name": "Display name",
            "effect": {"type": "roll-modifier", "target": "this-unit",
                "modifier": {"roll": "hit", "operation": "add", "value": 1}}}]}));
    apply_activation(
        &mut result,
        "x",
        json!({"usage": {"frequency": "once-per-turn", "per": "unit"}}),
    );
    let lever = &result.activatable[0];
    assert_eq!(lever.id, "x#fixed");
    assert_eq!(lever.group.as_ref().unwrap().id, "x?stance");
    assert_eq!(lever.group.as_ref().unwrap().max_activations, 2);
    assert_eq!(lever.groups.as_ref().unwrap()[0].id, "x?usage");
    assert_eq!(lever.groups.as_ref().unwrap()[0].max_activations, 1);
}

#[test]
fn counted_history_is_not_a_single_stationary_fact() {
    let effect = json!({"type": "conditional", "condition": {"type": "happened",
        "parameters": {"event": "move-ended", "window": "turn", "count": {"min": 2},
            "filter": {"move_types": ["remain-stationary"]}}},
        "effect": {"type": "roll-modifier", "target": "this-unit",
            "modifier": {"roll": "hit", "operation": "add", "value": 1}}});
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_stationary = Some(true);
    let result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert!(result.applied.is_empty());
    assert_eq!(result.unsupported.len(), 1);
}

#[test]
fn selected_bodyguard_pool_keeps_membership_and_named_binding() {
    for member in [json!("selected-unit"), json!({"selection_var": "chosen"})] {
        let effect = json!({"type": "select-units", "selector": {
            "filter": {"owner": "friendly"}, "count": {"min": 0, "max": 1}, "bind_as": "chosen"},
            "effect": {"type": "roll-modifier",
                "target": {"level": "model", "member_of": member, "attachment_role": "bodyguard"},
                "modifier": {"roll": "hit", "operation": "add", "value": 1}}});
        let mut context = EngineContext::new(Phase::Shooting);
        context.attacker_keywords = Some(vec!["CHARACTER".into()]);
        context.attacker_attachment_role = Some(crate::cruncher::AttachmentRole::Bodyguard);
        let result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
        assert!(result.applied.is_empty());
        assert_eq!(result.activatable.len(), 1);
        assert_eq!(result.activatable[0].buffs.len(), 1);
        context.attacker_attachment_role = Some(crate::cruncher::AttachmentRole::Leader);
        assert!(
            effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker)
                .activatable
                .is_empty()
        );
    }
}

#[test]
fn quantified_bodyguards_receive_separate_melee_strength_and_model_toughness() {
    let effect = json!({"type":"for-each-unit",
    "selector":{"filter":{"level":"model","member_of":"this-unit","attachment_role":"bodyguard"}},
    "effect":{"type":"sequence","steps":[
        {"type":"stat-modifier","target":"recipient","modifier":{"stat":"S","operation":"add","value":1,"weapons":{"type":"melee"}}},
        {"type":"stat-modifier","target":"recipient","modifier":{"stat":"T","operation":"add","value":1}}
    ]}});
    let mut context = EngineContext::new(Phase::Fight);
    context.attacker_keywords = Some(vec!["CHARACTER".into()]);
    context.attacker_attachment_role = Some(crate::cruncher::AttachmentRole::Bodyguard);
    context.target_attachment_role = Some(crate::cruncher::AttachmentRole::Bodyguard);
    let attack = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert_eq!(attack.applied.len(), 1);
    let strength = serde_json::to_value(&attack.applied[0]).unwrap();
    assert_eq!(strength["contribution"]["type"], "strength-mod");
    assert_eq!(strength["applicableWhen"]["phases"], json!(["fight"]));
    assert_eq!(
        crate::cruncher::resolve_buffs(&attack.applied, &context)
            .strength_mod
            .value,
        1.0
    );
    context.phase = Phase::Shooting;
    assert_eq!(
        crate::cruncher::resolve_buffs(&attack.applied, &context)
            .strength_mod
            .value,
        0.0
    );
    let defense = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Target);
    assert_eq!(defense.applied.len(), 1);
    assert_eq!(
        serde_json::to_value(&defense.applied[0]).unwrap()["contribution"]["type"],
        "toughness-mod"
    );
    context.attacker_attachment_role = Some(crate::cruncher::AttachmentRole::Leader);
    context.target_attachment_role = Some(crate::cruncher::AttachmentRole::Leader);
    for side in [
        TranslationPerspective::Attacker,
        TranslationPerspective::Target,
    ] {
        assert!(effect_to_buffs(&effect, &src(), &context, side)
            .applied
            .is_empty());
    }
}

#[test]
fn named_and_model_only_definitions_do_not_leak_unit_buffs() {
    let definition = json!({"type":"ability-part","effect":{"type":"roll-modifier","target":"this-unit",
        "modifier":{"roll":"hit","operation":"add","value":1}}});
    let named = run(
        json!({"type":"ability-grant","target":"this-unit","modifier":{
        "ability":{"ability_id":"test-owner","definition_id":"test-state"},"definition":definition}}),
    );
    assert!(named.applied.is_empty());
    assert!(named.unsupported[0]
        .reason
        .contains("named ability ownership"));
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_attachment_role = Some(crate::cruncher::AttachmentRole::Leader);
    let effect = json!({"type":"ability-grant",
        "target":{"level":"model","member_of":"this-unit","attachment_role":"leader"},
        "modifier":{"definition":definition}});
    let result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert!(result.applied.is_empty());
    assert!(result.unsupported[0]
        .reason
        .contains("model-only definition"));
}

#[test]
fn attack_weapon_conditions_remain_runtime_buff_gates() {
    let effect = json!({
        "type": "conditional",
        "condition": {
            "type": "attack-is",
            "parameters": {
                "attack_type": "ranged",
                "weapons": {"name": "Fabricated Rifle"}
            }
        },
        "effect": {
            "type": "roll-modifier",
            "target": "this-unit",
            "modifier": {"roll": "hit", "operation": "add", "value": 1}
        }
    });
    let result = effect_to_buffs(
        &effect,
        &src(),
        &EngineContext::new(Phase::Fight),
        TranslationPerspective::Attacker,
    );
    assert!(result.unsupported.is_empty());
    assert_eq!(result.applied.len(), 1);
    let buff = serde_json::to_value(&result.applied[0]).unwrap();
    assert_eq!(buff["applicableWhen"]["phases"], json!(["shooting"]));
    assert_eq!(
        buff["applicableWhen"]["weaponName"],
        json!("fabricated rifle")
    );
}

#[test]
fn attachment_conditions_use_the_exact_source_role_witness() {
    let effect = json!({
        "type": "conditional",
        "condition": {
            "type": "attachment",
            "parameters": {"subject": "this-model", "role": "leading"}
        },
        "effect": {
            "type": "roll-modifier",
            "target": "this-unit",
            "modifier": {"roll": "hit", "operation": "add", "value": 1}
        }
    });
    let source = BuffSource::Ability {
        ability_id: "x".into(),
        ability_kind: AbilityKind::Attached,
        source_unit_id: Some("source-leader".into()),
    };
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_attachment_role = Some(crate::cruncher::AttachmentRole::Bodyguard);
    context.attachment_roles = Some(
        [(
            "source-leader".into(),
            crate::cruncher::AttachmentRole::Leader,
        )]
        .into_iter()
        .collect(),
    );
    let result = effect_to_buffs(&effect, &source, &context, TranslationPerspective::Attacker);
    assert_eq!(result.applied.len(), 1);
    context.attachment_roles = None;
    let unknown = effect_to_buffs(&effect, &source, &context, TranslationPerspective::Attacker);
    assert!(unknown.applied.is_empty());
    assert_eq!(unknown.unsupported.len(), 1);
}

#[test]
fn trigger_timing_is_an_activation_even_outside_its_phase() {
    let effect = json!({
        "type": "ability-part",
        "trigger": {"event": "phase-started", "filter": {"phase": "command"}},
        "effect": {
            "type": "roll-modifier",
            "target": "this-unit",
            "modifier": {"roll": "hit", "operation": "add", "value": 1}
        }
    });
    let context = EngineContext::new(Phase::Shooting);
    let result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert!(result.applied.is_empty());
    assert_eq!(result.activatable.len(), 1);
    assert_eq!(
        result.activatable[0].requires,
        Some(vec![json!({
            "type": "ability-part",
            "trigger": {"event": "phase-started", "filter": {"phase": "command"}}
        })])
    );
}

#[test]
fn activation_clock_elision_requires_a_crossed_lifetime() {
    let effect = json!({
        "type": "ability-part",
        "trigger": {
            "event": "selected",
            "filter": {"to": "fight"},
            "condition": {"type": "phase-is", "parameters": {"phase": "fight"}}
        },
        "effect": {
            "type": "roll-modifier",
            "target": "this-unit",
            "modifier": {"roll": "hit", "operation": "add", "value": 1}
        }
    });
    let context = EngineContext::new(Phase::Shooting);
    let immediate = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert!(immediate.applied.is_empty());
    assert!(immediate.activatable.is_empty());
    assert!(immediate.unsupported.is_empty());

    let lasting = effect_to_buffs_with_duration(
        &effect,
        &src(),
        &context,
        TranslationPerspective::Attacker,
        Some(&json!("turn")),
    );
    assert!(lasting.applied.is_empty());
    assert_eq!(lasting.activatable.len(), 1);
    assert_eq!(
        lasting.activatable[0].requires,
        Some(vec![json!({
            "type": "ability-part",
            "trigger": {
                "event": "selected",
                "filter": {"to": "fight"},
                "condition": {"type": "phase-is", "parameters": {"phase": "fight"}}
            }
        })])
    );
}

#[test]
fn lasting_activation_keeps_known_false_nonclock_guards() {
    let effect = json!({
        "type": "ability-part",
        "trigger": {
            "event": "phase-started",
            "condition": {
                "operator": "and",
                "operands": [
                    {"type": "phase-is", "parameters": {"phase": "command"}},
                    {"type": "matches", "parameters": {
                        "subject": "this-unit",
                        "filter": {"all_of": ["PSYKER"]}
                    }}
                ]
            }
        },
        "effect": {
            "type": "roll-modifier",
            "target": "this-unit",
            "modifier": {"roll": "hit", "operation": "add", "value": 1}
        }
    });
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_keywords = Some(vec!["infantry".into()]);
    let result = effect_to_buffs_with_duration(
        &effect,
        &src(),
        &context,
        TranslationPerspective::Attacker,
        Some(&json!("turn")),
    );
    assert!(result.applied.is_empty());
    assert!(result.activatable.is_empty());
    assert!(result.unsupported.is_empty());
}

#[test]
fn trigger_time_recipients_are_not_reconstructed_from_current_roles() {
    let effect = json!({"type":"ability-part","trigger":{"event":"battle-started"},
        "effect":{"type":"for-each-unit","selector":{"filter":{"level":"model","member_of":"this-unit","attachment_role":"bodyguard"}},
            "effect":{"type":"roll-modifier","target":"recipient","modifier":{"roll":"hit","operation":"add","value":1}}}});
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_attachment_role = Some(crate::cruncher::AttachmentRole::Bodyguard);
    let result = effect_to_buffs(&effect, &src(), &context, TranslationPerspective::Attacker);
    assert!(result.applied.is_empty() && result.activatable.is_empty());
    assert_eq!(result.unsupported[0].reason, "trigger-time recipient snapshot is unavailable; current membership cannot establish historical recipients");
}

#[test]
fn oath_policy_changes_never_apply_nested_rewards_immediately() {
    let result = run(
        json!({"type":"oath-modifier","target":"this-unit","modifier":{
            "ability":"test-oath","aspect":"deed-reward","applies_to":"additional","operation":"replace","selection_method":"random",
            "effect":{"type":"roll-modifier","target":"this-unit","modifier":{"roll":"hit","operation":"add","value":1}}
        }}),
    );
    assert!(result.applied.is_empty() && result.activatable.is_empty());
    assert_eq!(result.unsupported.len(), 1);
}
