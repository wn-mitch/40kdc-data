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
fn keyword_grants_parse_like_ts() {
    let anti = parse_keyword_grant("Anti-INFANTRY 4+").unwrap();
    assert_eq!(anti.keyword_id, "anti");
    assert_eq!(
        anti.parameters,
        Some(json!({ "target_keyword": "INFANTRY", "threshold": 4 }))
    );
    let sus = parse_keyword_grant(" Sustained Hits 1 ").unwrap();
    assert_eq!(
        (sus.keyword_id.as_str(), sus.parameters),
        ("sustained-hits", Some(json!({ "value": 1 })))
    );
    assert_eq!(
        parse_keyword_grant("Twin-linked").unwrap().keyword_id,
        "twin-linked"
    );
    assert_eq!(
        parse_keyword_grant("[LETHAL HITS]").unwrap().keyword_id,
        "lethal-hits"
    );
    assert!(parse_keyword_grant("  ").is_none());
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
                "effect": { "type": "weapon-ability-grant", "target": "this-unit", "modifier": { "abilities": [kw] } } })
    };
    let pool = run(json!({
        "type": "dice-pool-allocation", "max_activations": 2,
        "options": [option("Warp Blades", "Lethal Hits"), option("Rage", "Sustained Hits 1")],
    }));
    let part = |name: &str, kw: &str| {
        json!({ "type": "ability-part", "name": name, "effect": {
            "type": "dice-gated", "from": { "roll_var": "r" }, "requirement": { "type": "pair", "min_value": 4 },
            "on_success": { "type": "weapon-ability-grant", "target": "this-unit", "modifier": { "abilities": [kw] } } } })
    };
    let roll = run(json!({
        "type": "roll", "dice": "8D6", "roll_var": "r",
        "effect": { "type": "choice", "max_choices": 2, "options": [part("Warp Blades", "Lethal Hits"), part("Rage", "Sustained Hits 1")] },
    }));
    assert_eq!(roll.activatable, pool.activatable);
    assert_eq!(roll.activatable.len(), 2);
    // A gate on another roll's dice is not an allocation: the choice is walked as a choice.
    let other = run(json!({
        "type": "roll", "dice": "8D6", "roll_var": "q",
        "effect": { "type": "choice", "options": [part("Warp Blades", "Lethal Hits")] },
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
