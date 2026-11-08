//! Fabricated historical recipient evidence exercised through the public Dataset and buff APIs.
use serde_json::{json, Value};
use wh40kdc::cruncher::{
    effect_to_buffs, resolve_buffs, AttachmentRole, BuffSource, EngineContext, RecipientSnapshot,
    TranslationPerspective,
};
use wh40kdc::data::{Dataset, EligibilityInput, RawData};
use wh40kdc::Phase;

fn source() -> BuffSource {
    serde_json::from_value(json!({"kind":"ability","abilityId":"lasting-gift","abilityKind":"attached","sourceUnitId":"former-leader"})).unwrap()
}
fn trigger() -> Value {
    json!({"event":"battle-started","condition":{"type":"phase-is","parameters":{"phase":"command"}}})
}
fn selector() -> Value {
    json!({"filter":{"level":"model","member_of":"this-unit","attachment_role":"bodyguard"},"bind_as":"original-pool"})
}
fn pool() -> Value {
    json!({"type":"for-each-unit","selector":selector(),"effect":{"type":"sequence","steps":[
        {"type":"stat-modifier","target":{"selection_var":"original-pool"},"modifier":{"stat":"S","operation":"add","value":1,"weapons":{"type":"melee"}}},
        {"type":"stat-modifier","target":"recipient","modifier":{"stat":"T","operation":"add","value":1}}
    ]}})
}
fn snapshot(perspective: TranslationPerspective, selected: bool) -> RecipientSnapshot {
    serde_json::from_value(json!({"source":source(),"sourceUnitId":"former-leader","trigger":trigger(),
        "selectionPath":"","selector":selector(),"perspective":perspective,"recipientUnitId":"original-bodyguard","selected":selected})).unwrap()
}
fn context(perspective: TranslationPerspective, selected: bool) -> EngineContext {
    let mut context = EngineContext::new(Phase::Fight);
    context.attacker_unit_id = Some("original-bodyguard".into());
    context.target_unit_id = Some("original-bodyguard".into());
    // It no longer has any current attachment role.
    context
        .recipient_snapshots
        .push(snapshot(perspective, selected));
    context
}
fn raw() -> Value {
    json!({"abilities":[{"ability_id":"lasting-gift","name":"Lasting gift","authored_by":"40kdc-community",
    "faction_id":"example","game_version":{"edition":"11th","dataslate":"example"},
    "ability_type":"unit","behavior":"reactive","trigger":trigger(),"scope":{"duration":"battle"},"effect":pool()}],
    "units":[
        {"id":"former-leader","name":"Former leader","faction_id":"example","keywords":["CHARACTER","INFANTRY"],
         "ability_ids":["lasting-gift"],"game_version":{"edition":"11th","dataslate":"example"},
         "profiles":[{"M":6,"T":4,"Sv":3,"W":1,"Ld":6,"OC":1}]},
        {"id":"original-bodyguard","name":"Original Bodyguard","faction_id":"example","keywords":["CHARACTER","INFANTRY"],
         "game_version":{"edition":"11th","dataslate":"example"},"profiles":[{"M":6,"T":4,"Sv":3,"W":1,"Ld":6,"OC":1}]}
    ]})
}
fn dataset(value: Value) -> Dataset {
    Dataset::from_raw(serde_json::from_value::<RawData>(value).unwrap())
}
fn input() -> EligibilityInput {
    EligibilityInput {
        unit_id: "original-bodyguard".into(),
        faction_id: Some("example".into()),
        ..Default::default()
    }
}

#[test]
fn original_bodyguard_keeps_melee_strength_and_toughness_after_detachment() {
    let ds = dataset(raw());
    for perspective in [
        TranslationPerspective::Attacker,
        TranslationPerspective::Target,
    ] {
        let ctx = context(perspective, true);
        assert!(input().attached_unit_ids.is_empty());
        let historical = ds.historical_snapshot_abilities(&input(), &ctx, perspective);
        assert_eq!(historical.len(), 1);
        let result = ds.describe_buffs(
            historical[0].ability,
            historical[0].source,
            Some(&ctx),
            perspective,
            None,
        );
        if perspective == TranslationPerspective::Attacker {
            assert_eq!(result.unsupported.iter().map(|fragment| fragment.reason.as_str()).collect::<Vec<_>>(),
                ["stat-modifier T: defender-side stat; applies when the buffed unit is the target"]);
        } else {
            assert!(result.unsupported.is_empty(), "{:?}", result.unsupported);
        }
        assert!(result.activatable.is_empty());
        let resolved = resolve_buffs(&result.applied, &ctx);
        match perspective {
            TranslationPerspective::Attacker => {
                assert_eq!(resolved.strength_mod.value, 1.0);
                let mut ranged = ctx.clone();
                ranged.phase = Phase::Shooting;
                assert_eq!(
                    resolve_buffs(&result.applied, &ranged).strength_mod.value,
                    0.0
                );
            }
            TranslationPerspective::Target => assert_eq!(resolved.toughness_mod.value, 1.0),
        }
    }
}

#[test]
fn later_leader_and_absent_conflicting_or_mismatched_evidence_never_gain_snapshot_buffs() {
    let ds = dataset(raw());
    let ability = ds
        .abilities
        .get_in_faction("lasting-gift", "example")
        .unwrap();
    let perspective = TranslationPerspective::Attacker;
    let mut excluded = context(perspective, false);
    excluded.attacker_attachment_role = Some(AttachmentRole::Leader);
    let result = ds.describe_buffs(ability, &source(), Some(&excluded), perspective, None);
    assert!(
        result.applied.is_empty() && result.activatable.is_empty() && result.unsupported.is_empty()
    );
    for mismatch in [
        "missing",
        "source",
        "path",
        "trigger",
        "selector",
        "recipient",
        "perspective",
        "conflict",
    ] {
        let mut ctx = context(perspective, true);
        match mismatch {
            "missing" => ctx.recipient_snapshots.clear(),
            "source" => ctx.recipient_snapshots[0].source_unit_id = "other-owner".into(),
            "path" => ctx.recipient_snapshots[0].selection_path = "/steps/1".into(),
            "trigger" => ctx.recipient_snapshots[0].trigger = serde_json::from_value(json!({"event":"turn-started"})).unwrap(),
            "selector" => ctx.recipient_snapshots[0].selector = serde_json::from_value(json!({"filter":{"level":"model","member_of":"this-unit","attachment_role":"leader"}})).unwrap(),
            "recipient" => ctx.recipient_snapshots[0].recipient_unit_id = "later-leader".into(),
            "perspective" => ctx.recipient_snapshots[0].perspective = TranslationPerspective::Target,
            "conflict" => ctx.recipient_snapshots.push(snapshot(perspective, false)),
            _ => unreachable!(),
        }
        ctx.attacker_attachment_role = Some(AttachmentRole::Bodyguard);
        let result = ds.describe_buffs(ability, &source(), Some(&ctx), perspective, None);
        assert!(
            result.applied.is_empty() && result.activatable.is_empty(),
            "{mismatch}"
        );
        assert_eq!(result.unsupported.len(), 1, "{mismatch}");
    }
}

#[test]
fn local_snapshot_paths_preserve_independent_current_guards() {
    let perspective = TranslationPerspective::Attacker;
    let mut ctx = context(perspective, true);
    ctx.recipient_snapshots[0].selection_path = "/steps/0/effect/effect".into();
    let mut effect = json!({"type":"sequence","steps":[{"type":"ability-part","trigger":trigger(),
        "effect":{"type":"conditional","condition":{"type":"phase-is","parameters":{"phase":"shooting"}},"effect":pool()}}]});
    let blocked = effect_to_buffs(&effect, &source(), &ctx, perspective);
    assert!(blocked.applied.is_empty() && blocked.unsupported.is_empty());
    effect["steps"][0]["effect"]["condition"]["parameters"]["phase"] = json!("fight");
    let applied = effect_to_buffs(&effect, &source(), &ctx, perspective);
    assert_eq!(
        applied
            .unsupported
            .iter()
            .map(|fragment| fragment.reason.as_str())
            .collect::<Vec<_>>(),
        ["stat-modifier T: defender-side stat; applies when the buffed unit is the target"]
    );
    assert_eq!(
        resolve_buffs(&applied.applied, &ctx).strength_mod.value,
        1.0
    );
}

#[test]
fn historical_enhancement_source_requires_eligible_owner_and_selected_detachment() {
    let mut value = raw();
    value["units"][0]["ability_ids"] = json!([]);
    value["enhancements"] = json!([{"id":"example-enhancement","name":"Example enhancement","cost":10,
        "detachment_id":"example-detachment","ability_id":"lasting-gift","keyword_restriction_groups":[["CHARACTER","INFANTRY"]],
        "game_version":{"edition":"11th","dataslate":"example"}}]);
    let ctx = context(TranslationPerspective::Attacker, true);
    let mut eligible = input();
    eligible.detachment_id = Some("example-detachment".into());
    let ds = dataset(value.clone());
    assert_eq!(
        ds.historical_snapshot_abilities(&eligible, &ctx, TranslationPerspective::Attacker)
            .len(),
        1
    );
    assert!(ds
        .historical_snapshot_abilities(&input(), &ctx, TranslationPerspective::Attacker)
        .is_empty());
    for invalid in [
        "unowned",
        "non-character",
        "epic-hero",
        "exclusion",
        "restriction",
    ] {
        let mut bad = value.clone();
        match invalid {
            "unowned" => bad["enhancements"] = json!([]),
            "non-character" => bad["units"][0]["keywords"] = json!(["INFANTRY"]),
            "epic-hero" => bad["units"][0]["role"] = json!("epic-hero"),
            "exclusion" => bad["enhancements"][0]["exclusion_keywords"] = json!(["INFANTRY"]),
            "restriction" => {
                bad["enhancements"][0]["keyword_restriction_groups"] = json!([["VEHICLE"]])
            }
            _ => unreachable!(),
        }
        assert!(
            dataset(bad)
                .historical_snapshot_abilities(&eligible, &ctx, TranslationPerspective::Attacker)
                .is_empty(),
            "{invalid}"
        );
    }
}

#[test]
fn snapshot_source_and_selector_fingerprints_are_not_broad_permissions() {
    let ds = dataset(raw());
    let ability = ds
        .abilities
        .get_in_faction("lasting-gift", "example")
        .unwrap();
    let perspective = TranslationPerspective::Attacker;
    let ctx = context(perspective, true);
    let other: BuffSource = serde_json::from_value(json!({
        "kind":"ability","abilityId":"other-ability","abilityKind":"attached","sourceUnitId":"former-leader"
    })).unwrap();
    let result = ds.describe_buffs(ability, &other, Some(&ctx), perspective, None);
    assert!(result.applied.is_empty());
    assert_eq!(
        result.unsupported[0].reason,
        "recipient snapshot source does not own this ability"
    );
    let mut changed = context(perspective, true);
    changed.recipient_snapshots[0].source = serde_json::from_value(json!({
        "kind":"ability","abilityId":"lasting-gift","abilityKind":"support","sourceUnitId":"former-leader"
    })).unwrap();
    let result = ds.describe_buffs(ability, &source(), Some(&changed), perspective, None);
    assert!(result.applied.is_empty() && result.unsupported.len() == 1);
    let mut mixed = pool();
    mixed["effect"]["steps"][1]["target"] = json!("this-model");
    let effect = json!({"type":"ability-part","trigger":trigger(),"effect":mixed});
    let mut ctx = context(perspective, true);
    ctx.recipient_snapshots[0].selection_path = "/effect".into();
    let result = effect_to_buffs(&effect, &source(), &ctx, perspective);
    assert!(result.applied.is_empty() && result.activatable.is_empty());
    assert_eq!(
        result.unsupported[0].reason,
        "recipient snapshot cannot bind mixed or unresolved recipient effects"
    );
}

#[test]
fn historical_snapshot_does_not_replace_unrelated_current_membership() {
    let perspective = TranslationPerspective::Attacker;
    let mut ctx = context(perspective, true);
    ctx.recipient_snapshots[0].selection_path = "/steps/0/effect".into();
    ctx.attacker_attachment_role = Some(AttachmentRole::Leader);
    let mut current = pool();
    current["effect"] = json!({"type":"roll-modifier","target":"recipient","modifier":{"roll":"hit","operation":"add","value":2}});
    let effect = json!({"type":"sequence","steps":[
        {"type":"ability-part","trigger":trigger(),"effect":pool()}, current
    ]});
    let result = effect_to_buffs(&effect, &source(), &ctx, perspective);
    let resolved = resolve_buffs(&result.applied, &ctx);
    assert_eq!(resolved.strength_mod.value, 1.0);
    assert_eq!(resolved.hit_mod.value, 0.0);
    assert!(result.unsupported.iter().all(|fragment| fragment.reason
        == "stat-modifier T: defender-side stat; applies when the buffed unit is the target"));
}

#[test]
fn snapshot_recipients_keep_own_weapon_stat_semantics() {
    for (stat, phase, operation) in [
        ("AP", Phase::Fight, "subtract"),
        ("WS", Phase::Fight, "improve"),
        ("BS", Phase::Shooting, "improve"),
    ] {
        let perspective = TranslationPerspective::Attacker;
        let mut ctx = context(perspective, true);
        ctx.phase = phase;
        ctx.recipient_snapshots[0].selection_path = "/effect".into();
        let mut recipients = pool();
        recipients["effect"] = json!({"type":"stat-modifier","target":"recipient",
            "modifier":{"stat":stat,"operation":operation,"value":1}});
        let effect = json!({"type":"ability-part","trigger":trigger(),"effect":recipients});
        let result = effect_to_buffs(&effect, &source(), &ctx, perspective);
        assert!(
            result.unsupported.is_empty(),
            "{stat}: {:?}",
            result.unsupported
        );
        assert!(result.activatable.is_empty());
        let resolved = resolve_buffs(&result.applied, &ctx);
        match stat {
            "AP" => assert_eq!(resolved.ap_mod.value, -1.0),
            "WS" => assert_eq!(resolved.skill_mod.ws.value, 1.0),
            "BS" => assert_eq!(resolved.skill_mod.bs.value, 1.0),
            _ => unreachable!(),
        }
    }
}
