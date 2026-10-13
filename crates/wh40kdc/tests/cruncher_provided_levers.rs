//! Unit selections, provided abilities, capped scalings and weapon-keyword gates as the
//! translator and resolver read them. Mirrors `tools/test/cruncher-provided-levers.test.ts`.
//! Fabricated rules only; no GW rule prose.

use serde_json::{json, Value};
use wh40kdc::cruncher::{
    effect_to_buffs, resolve_buffs, AbilityKind, ActivatableBuff, Buff, BuffApplicability,
    BuffContribution, BuffSource, CapRaise, EffectTranslation, EngineContext,
    TranslationPerspective, WeaponKeywordRef,
};
use wh40kdc::Phase;

fn own() -> BuffSource {
    BuffSource::Ability {
        ability_id: "fabricated".into(),
        ability_kind: AbilityKind::Unit,
        source_unit_id: None,
    }
}

fn provided() -> BuffSource {
    BuffSource::Ability {
        ability_id: "fabricated".into(),
        ability_kind: AbilityKind::Support,
        source_unit_id: Some("fabricated-lord".into()),
    }
}

fn context(phase: Phase, attacker: Option<&[&str]>) -> EngineContext {
    let mut ctx = EngineContext::new(phase);
    ctx.attacker_keywords = attacker.map(|k| k.iter().map(|s| s.to_string()).collect());
    ctx
}

fn fight() -> EngineContext {
    context(Phase::Fight, Some(&["infantry", "destroyer cult"]))
}

fn shooting() -> EngineContext {
    context(Phase::Shooting, Some(&["infantry"]))
}

fn translate(effect: &Value, source: &BuffSource, ctx: &EngineContext) -> EffectTranslation {
    effect_to_buffs(effect, source, ctx, TranslationPerspective::Attacker)
}

fn reasons(result: &EffectTranslation) -> Vec<&str> {
    result
        .unsupported
        .iter()
        .map(|u| u.reason.as_str())
        .collect()
}

fn friendly_selection(keywords: &[&str]) -> Value {
    json!({
        "type": "select-units",
        "selector": {
            "owner": "friendly", "count": 1, "keywords": keywords,
            "eligibility": { "operator": "and", "operands": [
                { "operator": "not", "operands": [{ "type": "same-unit", "parameters": { "as": "ability-unit" } }] },
                { "type": "within", "parameters": { "subject": "selected-unit", "of": "this-model", "range": { "inches": 9 } } },
            ] },
        },
        "effect": { "type": "re-roll", "target": "selected-unit", "modifier": { "roll": "wound", "subset": "ones" } },
    })
}

fn contributions(lever: &ActivatableBuff) -> Vec<Value> {
    lever
        .buffs
        .iter()
        .map(|b| serde_json::to_value(&b.contribution).unwrap())
        .collect()
}

#[test]
fn a_friendly_selection_another_unit_provides_is_one_lever_requiring_the_selection() {
    let effect = friendly_selection(&["DESTROYER CULT"]);
    let result = translate(&effect, &provided(), &fight());
    assert!(result.applied.is_empty());
    assert!(result.unsupported.is_empty());
    assert_eq!(result.activatable.len(), 1);
    let lever = &result.activatable[0];
    assert_eq!(lever.id, "fabricated#selected");
    assert_eq!(
        contributions(lever),
        vec![json!({ "type": "reroll", "roll": "wound", "subset": "ones" })]
    );
    let mut selection = effect.as_object().unwrap().clone();
    selection.remove("effect");
    assert_eq!(lever.requires, Some(vec![Value::Object(selection)]));
}

#[test]
fn the_unit_holding_the_ability_gets_nothing_when_the_selection_excludes_its_own_unit() {
    let result = translate(&friendly_selection(&["DESTROYER CULT"]), &own(), &fight());
    assert_eq!(result, EffectTranslation::default());
}

#[test]
fn a_unit_without_the_selector_keywords_gets_nothing_and_unknown_keywords_are_refused() {
    let other = translate(&friendly_selection(&["NOBZ"]), &provided(), &fight());
    assert!(other.activatable.is_empty());
    let unknown = translate(
        &friendly_selection(&["DESTROYER CULT"]),
        &provided(),
        &EngineContext::new(Phase::Fight),
    );
    assert!(unknown.activatable.is_empty());
    assert_eq!(
        reasons(&unknown),
        vec!["select-units: the crunched unit's keywords are unavailable for the selector"]
    );
}

#[test]
fn an_enemy_selection_incoming_grant_is_the_attackers_behind_its_roll_gated_on_exclusions() {
    let selector = json!({ "owner": "enemy", "count": 1, "excluded_keywords": ["MONSTER", "VEHICLE"], "visibility_required": true });
    let roll = json!({ "type": "dice-gated", "dice": "D6", "threshold": 2, "comparison": "gte" });
    let mut gate = roll.as_object().unwrap().clone();
    gate.insert(
        "on_success".into(),
        json!({ "type": "sequence", "steps": [
            { "type": "designate", "target": "selected-unit", "modifier": { "tag": "fabricated" } },
            { "type": "weapon-ability-grant", "target": "selected-unit", "modifier": { "abilities": ["Ignores Cover"], "weapon_type": "ranged", "incoming": true } },
        ] }),
    );
    gate.insert("on_fail".into(), Value::Null);
    let effect = json!({ "type": "select-units", "selector": selector, "effect": gate });
    let result = translate(&effect, &provided(), &shooting());
    assert_eq!(result.activatable.len(), 1);
    let lever = &result.activatable[0];
    assert_eq!(
        lever.requires,
        Some(vec![
            json!({ "type": "select-units", "selector": selector }),
            roll
        ])
    );
    assert_eq!(
        lever.buffs,
        vec![Buff {
            source: provided(),
            contribution: BuffContribution::ExtraKeyword {
                keyword_ref: WeaponKeywordRef {
                    keyword_id: "ignores-cover".into(),
                    parameters: None,
                },
            },
            applicable_when: Some(BuffApplicability {
                phases: Some(vec![Phase::Shooting]),
                excluded_target_keywords: Some(vec!["MONSTER".into(), "VEHICLE".into()]),
                ..Default::default()
            }),
        }]
    );
    let against = |keyword: &str| {
        let mut ctx = EngineContext::new(Phase::Shooting);
        ctx.target_keywords = Some(vec![keyword.to_string()]);
        resolve_buffs(&lever.buffs, &ctx).extra_keywords.len()
    };
    assert_eq!(against("infantry"), 1);
    assert_eq!(against("vehicle"), 0);
    // The enemy unit is never the attacked unit's own side: nothing under the target perspective.
    let target = effect_to_buffs(
        &effect,
        &provided(),
        &shooting(),
        TranslationPerspective::Target,
    );
    assert!(target.activatable.is_empty());
}

#[test]
fn an_enemy_selection_behind_a_roll_with_a_failure_branch_is_refused() {
    let effect = json!({
        "type": "select-units",
        "selector": { "owner": "enemy", "count": 1 },
        "effect": { "type": "dice-gated", "dice": "D6", "threshold": 4, "comparison": "gte",
            "on_success": { "type": "stat-modifier", "target": "selected-unit", "modifier": { "stat": "T", "operation": "worsen", "value": 1 } },
            "on_fail": { "type": "mortal-wounds", "target": "this-unit", "modifier": { "count": 1 } } },
    });
    let result = translate(&effect, &own(), &shooting());
    assert!(result.activatable.is_empty());
    assert_eq!(
        reasons(&result),
        vec!["select-units: a dice gate with a failure branch is not a single lever"]
    );
}

fn contribution_types(result: &EffectTranslation) -> Vec<String> {
    result
        .applied
        .iter()
        .map(|b| serde_json::to_value(&b.contribution).unwrap()["type"].to_string())
        .collect()
}

#[test]
fn a_provided_ability_never_applies_the_providers_own_unit_effects() {
    let effect = json!({ "type": "sequence", "steps": [
        { "type": "stat-modifier", "target": "this-unit", "modifier": { "stat": "A", "operation": "add", "value": 1 } },
        { "type": "roll-modifier", "target": { "owner": "friendly", "all_of": ["INFANTRY"] }, "modifier": { "roll": "hit", "operation": "add", "value": 1 } },
    ] });
    assert_eq!(
        contribution_types(&translate(&effect, &own(), &shooting())),
        vec!["\"attacks-mod\"", "\"hit-mod\""]
    );
    assert_eq!(
        contribution_types(&translate(&effect, &provided(), &shooting())),
        vec!["\"hit-mod\""]
    );
}

#[test]
fn a_friendly_filter_applies_only_to_a_unit_with_its_keywords_and_is_permissive_without_them() {
    let effect = json!({ "type": "roll-modifier", "target": { "owner": "friendly", "all_of": ["BLOOD LEGIONS"] }, "modifier": { "roll": "hit", "operation": "add", "value": 1 } });
    assert!(translate(&effect, &provided(), &shooting())
        .applied
        .is_empty());
    let with = context(Phase::Shooting, Some(&["blood legions"]));
    assert_eq!(translate(&effect, &provided(), &with).applied.len(), 1);
    let unknown = EngineContext::new(Phase::Shooting);
    assert_eq!(translate(&effect, &provided(), &unknown).applied.len(), 1);
}

#[test]
fn a_capped_scaling_is_a_lever_at_its_cap_and_an_uncapped_one_is_refused() {
    let scaling = json!({ "per": 1, "of": "models-embarked-in-bearer", "max_value": 22 });
    let capped = translate(
        &json!({ "type": "stat-modifier", "target": "this-unit", "modifier": { "stat": "A", "operation": "improve", "value": 2, "weapon_name": "fabricated claws" }, "scaling": scaling }),
        &own(),
        &fight(),
    );
    assert!(capped.applied.is_empty());
    assert_eq!(capped.activatable.len(), 1);
    let lever = &capped.activatable[0];
    assert_eq!(lever.id, "fabricated#at-cap");
    assert_eq!(lever.requires, Some(vec![scaling.clone()]));
    assert_eq!(
        contributions(lever),
        vec![json!({ "type": "attacks-mod", "value": 22.0 })]
    );
    assert_eq!(
        lever.buffs[0].applicable_when,
        Some(BuffApplicability {
            weapon_name: Some("fabricated claws".into()),
            ..Default::default()
        })
    );
    let mut uncapped = scaling.as_object().unwrap().clone();
    uncapped.remove("max_value");
    let refused = translate(
        &json!({ "type": "stat-modifier", "target": "this-unit", "modifier": { "stat": "A", "operation": "improve", "value": 2 }, "scaling": uncapped }),
        &own(),
        &fight(),
    );
    assert!(refused.activatable.is_empty());
    assert_eq!(
        reasons(&refused),
        vec!["stat-modifier: the value scales with models-embarked-in-bearer; not resolved by the buff engine"]
    );
}

#[test]
fn an_added_selection_to_the_units_own_ability_is_a_cap_raise_with_no_buffs() {
    let modifier = |aspect: &str| json!({ "type": "ability-modifier", "target": "this-unit", "modifier": { "ability": "fabricated-augments", "aspect": aspect, "operation": "add", "value": 1 } });
    let result = translate(&modifier("selections"), &own(), &shooting());
    assert!(result.unsupported.is_empty());
    assert_eq!(
        result.activatable,
        vec![ActivatableBuff {
            id: "fabricated#cap".into(),
            label: "One more fabricated-augments selection".into(),
            buffs: Vec::new(),
            group: None,
            cap_raise: Some(CapRaise {
                ability: "fabricated-augments".into(),
                by: 1
            }),
            requires: None,
        }]
    );
    let uses = translate(&modifier("uses"), &own(), &shooting());
    assert!(uses.activatable.is_empty());
}

fn rapid_fire() -> Buff {
    translate(
        &json!({ "type": "weapon-ability-grant", "target": "this-unit", "modifier": { "abilities": ["Rapid Fire 1"], "weapon_type": "ranged", "weapon_keyword": "Lethal Hits" } }),
        &own(),
        &shooting(),
    )
    .applied
    .remove(0)
}

fn granted(buffs: &[Buff], printed: Option<&[&str]>) -> Vec<String> {
    let mut ctx = EngineContext::new(Phase::Shooting);
    ctx.weapon_keywords = printed.map(|k| k.iter().map(|s| s.to_string()).collect());
    resolve_buffs(buffs, &ctx)
        .extra_keywords
        .iter()
        .map(|k| k.keyword_ref.keyword_id.clone())
        .collect()
}

#[test]
fn a_weapon_keyword_gate_reaches_a_weapon_with_the_keyword_printed_or_granted_and_no_other() {
    let rapid = rapid_fire();
    assert_eq!(
        rapid.applicable_when,
        Some(BuffApplicability {
            phases: Some(vec![Phase::Shooting]),
            weapon_keyword: Some("lethal-hits".into()),
            ..Default::default()
        })
    );
    let lethal = Buff {
        source: own(),
        applicable_when: None,
        contribution: BuffContribution::ExtraKeyword {
            keyword_ref: WeaponKeywordRef {
                keyword_id: "lethal-hits".into(),
                parameters: None,
            },
        },
    };
    assert_eq!(
        granted(&[rapid.clone()], Some(&["lethal-hits"])),
        vec!["rapid-fire"]
    );
    assert!(granted(&[rapid.clone()], Some(&["heavy"])).is_empty());
    assert_eq!(
        granted(&[rapid, lethal], Some(&["heavy"])),
        vec!["rapid-fire", "lethal-hits"]
    );
}

#[test]
fn a_weapon_keyword_gate_is_permissive_when_the_caller_names_no_weapon_keywords() {
    assert_eq!(granted(&[rapid_fire()], None).len(), 1);
}
