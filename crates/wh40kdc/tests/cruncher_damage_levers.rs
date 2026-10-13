//! The damage levers' gates the conformance goldens do not project, and the DSL → engine path end
//! to end. Mirrors `tools/test/cruncher-damage-levers.test.ts`. Fabricated rules only.

use serde_json::{json, Value};
use wh40kdc::cruncher::{
    crunch, effect_to_buffs, resolve_buffs, AbilityKind, AttackProfileRef, Buff, BuffApplicability,
    BuffContribution, BuffSource, EffectTranslation, EngineContext, EngineInput, StageName,
    TargetProfileRef, TranslationPerspective, WeaponKeywordRef,
};
use wh40kdc::data::Dataset;
use wh40kdc::Phase;

fn source() -> BuffSource {
    BuffSource::Ability {
        ability_id: "fabricated".into(),
        ability_kind: AbilityKind::Unit,
        source_unit_id: None,
    }
}

fn translate(effect: Value, perspective: TranslationPerspective) -> EffectTranslation {
    effect_to_buffs(
        &effect,
        &source(),
        &EngineContext::new(Phase::Shooting),
        perspective,
    )
}

fn gates(result: &EffectTranslation) -> Vec<Option<BuffApplicability>> {
    result
        .applied
        .iter()
        .map(|b| b.applicable_when.clone())
        .collect()
}

/// Bolt rifles x5 against intercessors in the shooting phase: the expected value of `stage`.
fn stage(buffs: Vec<Buff>, stage: StageName) -> f64 {
    let ds = Dataset::embedded();
    let input = EngineInput {
        attacker: AttackProfileRef {
            weapon: ds.find_weapon("bolt-rifle").expect("bolt-rifle is bundled"),
            profile_index: 0,
        },
        target: TargetProfileRef {
            unit: ds
                .find_unit("intercessor-squad")
                .expect("intercessor-squad is bundled"),
            profile_index: 0,
            model_count: None,
        },
        models_firing: 5,
        buffs,
        context: EngineContext::new(Phase::Shooting),
    };
    let out = crunch(&input, None).expect("crunch succeeds");
    out.stages
        .iter()
        .find(|s| s.name == stage)
        .expect("stage present")
        .expected
}

fn phases(p: Phase) -> Option<BuffApplicability> {
    Some(BuffApplicability {
        phases: Some(vec![p]),
        ..Default::default()
    })
}

#[test]
fn an_attackers_ws_penalty_gates_on_fight_and_its_bs_penalty_on_shooting() {
    let result = translate(
        json!({ "type": "sequence", "steps": [
            { "type": "stat-modifier", "target": "attacker", "modifier": { "stat": "WS", "operation": "worsen", "value": 1 } },
            { "type": "stat-modifier", "target": "attacker", "modifier": { "stat": "BS", "operation": "worsen", "value": 1 } },
        ] }),
        TranslationPerspective::Target,
    );
    assert_eq!(
        gates(&result),
        vec![phases(Phase::Fight), phases(Phase::Shooting)]
    );
}

#[test]
fn a_crit_threshold_and_a_reroll_gate_by_weapon_type_and_weapon_name() {
    let result = translate(
        json!({ "type": "sequence", "steps": [
            { "type": "roll-result", "target": "this-unit", "modifier": { "roll": "wound", "critical_on": 5, "weapon_type": "melee" } },
            { "type": "re-roll", "target": "this-unit", "modifier": { "roll": "hit", "subset": "ones", "weapon_name": "Fabricated Gun" } },
        ] }),
        TranslationPerspective::Attacker,
    );
    let named = BuffApplicability {
        weapon_name: Some("fabricated gun".into()),
        ..Default::default()
    };
    assert_eq!(gates(&result), vec![phases(Phase::Fight), Some(named)]);
}

#[test]
fn a_modifier_with_a_weapon_type_and_a_weapon_name_keeps_both_gates() {
    let result = translate(
        json!({ "type": "stat-modifier", "target": "this-unit", "modifier": { "stat": "A", "operation": "improve", "value": 1, "weapon_type": "melee", "weapon_name": "Fabricated Blade" } }),
        TranslationPerspective::Attacker,
    );
    let both = BuffApplicability {
        phases: Some(vec![Phase::Fight]),
        weapon_name: Some("fabricated blade".into()),
        ..Default::default()
    };
    assert_eq!(gates(&result), vec![Some(both)]);
}

#[test]
fn a_crit_threshold_narrowed_by_a_weapon_keyword_is_refused() {
    let result = translate(
        json!({ "type": "roll-result", "target": "this-unit", "modifier": { "roll": "hit", "critical_on": 5, "weapon_keyword": "Pistol" } }),
        TranslationPerspective::Attacker,
    );
    assert!(result.applied.is_empty());
    let reasons: Vec<&str> = result
        .unsupported
        .iter()
        .map(|u| u.reason.as_str())
        .collect();
    assert_eq!(
        reasons,
        vec!["roll-result: narrows by \"weapon_keyword\" which the cruncher can't resolve here"]
    );
}

#[test]
fn a_skill_improvement_or_a_set_save_with_no_numeric_value_is_refused_not_read_as_zero() {
    let reasons = |r: &EffectTranslation| -> Vec<String> {
        r.unsupported.iter().map(|u| u.reason.clone()).collect()
    };
    let skill = translate(
        json!({ "type": "stat-modifier", "target": "this-unit", "modifier": { "stat": "BS", "operation": "improve", "value": null } }),
        TranslationPerspective::Attacker,
    );
    assert!(skill.applied.is_empty());
    assert_eq!(
        reasons(&skill),
        vec!["stat-modifier BS: operation \"improve\" not supported"]
    );
    let text = translate(
        json!({ "type": "stat-modifier", "target": "this-unit", "modifier": { "stat": "WS", "operation": "improve", "value": "1" } }),
        TranslationPerspective::Attacker,
    );
    assert!(text.applied.is_empty());
    assert_eq!(
        reasons(&text),
        vec!["stat-modifier WS: operation \"improve\" not supported"]
    );
    // A missing, null or text value has no number to print: one fixed reason for all three.
    let set_save = |value: Option<Value>| {
        let mut modifier = json!({ "stat": "Sv", "operation": "set" });
        if let Some(v) = value {
            modifier["value"] = v;
        }
        translate(
            json!({ "type": "stat-modifier", "target": "this-unit", "modifier": modifier }),
            TranslationPerspective::Target,
        )
    };
    for value in [None, Some(Value::Null), Some(json!("3"))] {
        let save = set_save(value);
        assert!(save.applied.is_empty());
        assert_eq!(
            reasons(&save),
            vec!["stat-modifier Sv: set has no numeric value"]
        );
    }
    // A number outside 2..6 is printed as JS prints it: no decimals for an integer.
    let out_of_range = set_save(Some(json!(7)));
    assert!(out_of_range.applied.is_empty());
    assert_eq!(
        reasons(&out_of_range),
        vec!["stat-modifier Sv: set value \"7\" is not a save characteristic"]
    );
}

#[test]
fn a_crit_hit_threshold_of_five_with_lethal_hits_raises_wounds() {
    let lethal = Buff {
        source: BuffSource::Manual {
            label: "lethal".into(),
        },
        applicable_when: None,
        contribution: BuffContribution::ExtraKeyword {
            keyword_ref: WeaponKeywordRef {
                keyword_id: "lethal-hits".into(),
                parameters: None,
            },
        },
    };
    let crit = translate(
        json!({ "type": "roll-result", "target": "this-unit", "modifier": { "roll": "hit", "critical_on": 5 } }),
        TranslationPerspective::Attacker,
    )
    .applied;
    assert_eq!(crit.len(), 1);
    // Crits on a 6 auto-wound; the other hits (3+ to 5) wound on a 5+ against T5.
    let base = stage(vec![lethal.clone()], StageName::Wounds);
    assert!((base - (10.0 / 6.0 + 10.0 * (3.0 / 6.0) / 3.0)).abs() < 1e-6);
    let mut buffs = vec![lethal];
    buffs.extend(crit);
    let lifted = stage(buffs, StageName::Wounds);
    assert!((lifted - (10.0 * 2.0 / 6.0 + 10.0 * (2.0 / 6.0) / 3.0)).abs() < 1e-6);
}

#[test]
fn a_weapon_named_attacks_lift_reaches_only_that_weapons_attacks() {
    let lift = |name: &str| {
        translate(
            json!({ "type": "stat-modifier", "target": "this-unit", "modifier": { "stat": "A", "operation": "improve", "value": 1, "weapon_name": name } }),
            TranslationPerspective::Attacker,
        )
        .applied
    };
    assert_eq!(stage(lift("Bolt Rifles"), StageName::Attacks), 15.0);
    assert_eq!(stage(lift("Fabricated Gun"), StageName::Attacks), 10.0);
}

#[test]
fn a_weapon_name_gate_is_permissive_until_the_context_names_the_weapon() {
    let named = Buff {
        source: source(),
        applicable_when: Some(BuffApplicability {
            weapon_name: Some("power fist".into()),
            ..Default::default()
        }),
        contribution: BuffContribution::AttacksMod { value: 1.0 },
    };
    let mut ctx = EngineContext::new(Phase::Fight);
    assert_eq!(resolve_buffs(&[named.clone()], &ctx).attacks_mod.value, 1.0);
    ctx.weapon_names = Some(vec!["bolt rifle".into(), "bolt rifles".into()]);
    assert_eq!(resolve_buffs(&[named.clone()], &ctx).attacks_mod.value, 0.0);
    ctx.weapon_names = Some(vec!["power fist".into()]);
    assert_eq!(resolve_buffs(&[named], &ctx).attacks_mod.value, 1.0);
}

#[test]
fn an_any_result_reroll_is_all_failures_unless_its_value_is_one() {
    let subset = |modifier: Value| -> Vec<Value> {
        translate(
            json!({ "type": "re-roll", "target": "this-unit", "modifier": modifier }),
            TranslationPerspective::Attacker,
        )
        .applied
        .iter()
        .map(|b| serde_json::to_value(&b.contribution).unwrap()["subset"].clone())
        .collect()
    };
    assert_eq!(
        subset(json!({ "roll": "wound", "result_scope": "any-result" })),
        vec![json!("all-failures")]
    );
    assert_eq!(
        subset(json!({ "roll": "wound", "result_scope": "any-result", "value": 1 })),
        vec![json!("ones")]
    );
    // An explicit subset wins over the result scope.
    assert_eq!(
        subset(json!({ "roll": "wound", "result_scope": "any-result", "subset": "ones" })),
        vec![json!("ones")]
    );
    // Without the result scope, a missing subset is still outside the damage path.
    assert_eq!(subset(json!({ "roll": "wound" })), Vec::<Value>::new());
}
