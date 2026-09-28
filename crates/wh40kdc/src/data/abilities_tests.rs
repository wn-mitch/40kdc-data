use serde_json::{json, Value};

use super::*;
use crate::cruncher::buffs::{AbilityKind, BuffContribution};
use crate::data::RawData;

fn source(id: &str, kind: AbilityKind) -> BuffSource {
    BuffSource::Ability {
        ability_id: id.to_string(),
        ability_kind: kind,
        source_unit_id: None,
    }
}

/// A minimal schema-valid ability record.
fn ability(id: &str, effect: Value, extra: Value) -> Ability {
    let mut a = json!({
        "ability_id": id,
        "authored_by": "40kdc-community",
        "effect": effect,
        "faction_id": "orks",
        "game_version": { "dataslate": "codex-orks", "edition": "11th" },
        "name": id,
        "scope": { "duration": "permanent" },
    });
    a.as_object_mut()
        .unwrap()
        .extend(extra.as_object().cloned().unwrap_or_default());
    serde_json::from_value(a).expect("test ability deserializes")
}

fn dataset(abilities: Vec<Ability>) -> Dataset {
    Dataset::from_raw(RawData {
        abilities,
        ..RawData::default()
    })
}

fn grant(id: &str) -> Value {
    json!({ "type": "ability-grant", "target": "this-unit", "modifier": { "ability": id, "rules_bundle": true } })
}

fn assault() -> Value {
    json!({ "type": "weapon-ability-grant", "target": "this-unit", "modifier": { "abilities": ["Assault"] } })
}

fn keyword_ids(t: &EffectTranslation) -> Vec<String> {
    t.applied
        .iter()
        .filter_map(|b| match &b.contribution {
            BuffContribution::ExtraKeyword { keyword_ref } => Some(keyword_ref.keyword_id.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_bundle_grant_expands_into_the_bundle_it_names() {
    let ds = Dataset::embedded();
    let runts = ds
        .abilities
        .get_in_faction("super-runts", "orks")
        .expect("super-runts");
    let src = source("super-runts", AbilityKind::Unit);
    let expanded = ds.describe_buffs(runts, &src, None, TranslationPerspective::Attacker);
    // Riled Up's [ASSAULT] grant reaches the unit only through the expansion.
    assert_eq!(keyword_ids(&expanded), ["assault"]);
    let raw = effect_to_buffs(
        &serde_json::to_value(&runts.effect).unwrap(),
        &src,
        &EngineContext::new(Phase::Shooting),
        TranslationPerspective::Attacker,
    );
    assert!(keyword_ids(&raw).is_empty());
    assert!(raw
        .unsupported
        .iter()
        .any(|u| u.reason == "effect type \"ability-grant\" is not modelled by the buff layer"));
}

#[test]
fn a_cyclic_or_non_bundle_grant_stays_unexpanded() {
    let a = ability(
        "bundle-a",
        json!({ "type": "rules-bundle", "steps": [grant("bundle-b"), assault()] }),
        json!({}),
    );
    let b = ability(
        "bundle-b",
        json!({ "type": "rules-bundle", "steps": [grant("bundle-a")] }),
        json!({}),
    );
    let plain = ability("plain", assault(), json!({}));
    let granter = ability(
        "granter",
        json!({ "type": "sequence", "steps": [grant("plain"), grant("bundle-a")] }),
        json!({}),
    );
    let ds = dataset(vec![a, b, plain, granter]);
    let granter = ds.abilities.get_any("granter").unwrap();
    let t = ds.describe_buffs(
        granter,
        &source("granter", AbilityKind::Unit),
        None,
        TranslationPerspective::Attacker,
    );
    // bundle-a expands (one [ASSAULT]); its grant of bundle-b expands, whose grant of
    // bundle-a is a cycle and stays; the grant of a non-bundle ability stays.
    assert_eq!(keyword_ids(&t), ["assault"]);
    let unexpanded = t
        .unsupported
        .iter()
        .filter(|u| u.reason == "effect type \"ability-grant\" is not modelled by the buff layer")
        .count();
    assert_eq!(unexpanded, 2);
}

#[test]
fn a_usage_limit_makes_the_buff_a_lever_named_by_the_first_limit() {
    let limits = json!([
        { "frequency": "n-per-battle", "count": 1 },
        { "frequency": "once-per-battle-round" }
    ]);
    let a = ability(
        "once",
        assault(),
        json!({ "ability_type": "unit", "usage": limits }),
    );
    let ds = dataset(vec![a]);
    let once = ds.abilities.get_any("once").unwrap();
    let t = ds.describe_buffs(
        once,
        &source("once", AbilityKind::Unit),
        None,
        TranslationPerspective::Attacker,
    );
    assert!(t.applied.is_empty(), "a limited use is not always on");
    let ids: Vec<&str> = t.activatable.iter().map(|l| l.id.as_str()).collect();
    assert_eq!(ids, ["once@n-per-battle"]);
    // A stratagem is already opt-in: its usage adds no gate.
    assert_eq!(
        usage_gated(Some(&json!("stratagem")), Some(&limits), &assault()),
        assault()
    );
}

#[test]
fn a_reactive_trigger_gates_unless_it_is_an_attack_step() {
    let effect = assault();
    let moment = json!({ "event": "phase-started", "filter": { "phase": "shooting" } });
    let gated = trigger_gated(Some(&json!("reactive")), Some(&moment), &effect).expect("gated");
    assert_eq!(gated["condition"]["parameters"]["timing"], "phase-started");
    let hit = json!({ "event": "after-roll", "filter": { "roll": "hit" } });
    assert_eq!(
        trigger_gated(Some(&json!("reactive")), Some(&hit), &effect),
        None
    );
    assert_eq!(
        trigger_gated(Some(&json!("passive")), Some(&moment), &effect),
        None
    );
}

#[test]
fn only_a_single_aura_range_gates_the_buffs() {
    let within = |inches: u64| json!({ "type": "re-roll", "target": { "owner": "friendly", "within": { "range": { "inches": inches } } }, "modifier": { "roll": "hit", "subset": "ones" } });
    assert_eq!(aura_inches(&within(6)), Some(6.0));
    let two = json!({ "type": "sequence", "steps": [within(6), within(9)] });
    assert_eq!(aura_inches(&two), None);
    let ds = dataset(vec![ability("aura", within(6), json!({}))]);
    let aura = ds.abilities.get_any("aura").unwrap();
    let t = ds.describe_buffs(
        aura,
        &source("aura", AbilityKind::Unit),
        None,
        TranslationPerspective::Attacker,
    );
    let gate = t.applied[0]
        .applicable_when
        .as_ref()
        .and_then(|w| w.max_range_inches);
    assert_eq!(gate, Some(6.0));
}

#[test]
fn eligible_abilities_keep_the_source_order_and_dedupe_per_kind() {
    let ds = Dataset::embedded();
    let input = EligibilityInput {
        unit_id: "intercessor-squad".into(),
        faction_id: Some("adeptus-astartes".into()),
        ..EligibilityInput::default()
    };
    let got = ds.eligible_abilities(&input, Phase::Shooting);
    let kinds: Vec<&str> = got.iter().map(|e| e.source.kind()).collect();
    let first_unit = kinds
        .iter()
        .position(|k| *k == "unit")
        .expect("unit abilities");
    assert!(
        kinds[..first_unit].iter().all(|k| *k == "army"),
        "army before unit: {kinds:?}"
    );
    let mut keys: Vec<String> = got
        .iter()
        .map(|e| format!("{}::{}", e.source.kind(), e.ability.ability_id.as_str()))
        .collect();
    let n = keys.len();
    keys.dedup();
    assert_eq!(keys.len(), n);
    assert!(ds
        .eligible_abilities(
            &EligibilityInput {
                unit_id: "no-such-unit".into(),
                ..input
            },
            Phase::Shooting
        )
        .is_empty());
}
