//! Named ability grants: a printed definition applies to its holders, and a friendly filter naming
//! the ability being resolved in `has_ability` selects its holder. Mirrors
//! `tools/test/cruncher-named-grants.test.ts`.
use serde_json::json;

use super::*;
use crate::Phase;

fn source(kind: AbilityKind) -> BuffSource {
    BuffSource::Ability {
        ability_id: "fabricated-named".into(),
        ability_kind: kind,
        source_unit_id: None,
        selects_model: None,
    }
}

fn grant(target: Value, printed: bool) -> Value {
    let mut modifier =
        json!({"ability":{"ability_id":"fabricated-named","definition_id":"fabricated-part"}});
    if printed {
        modifier["definition"] = json!({"type":"ability-part","name":"Fabricated Part","effect":{
            "type":"weapon-ability-grant","target":"this-unit","modifier":{"keywords":[{"keyword_id":"lethal-hits"}]}}});
    }
    json!({"type":"ability-grant","target":target,"modifier":modifier})
}

fn applied(effect: &Value, kind: AbilityKind) -> EffectTranslation {
    let mut context = EngineContext::new(Phase::Shooting);
    context.attacker_keywords = Some(vec!["kill team".into()]);
    effect_to_buffs(
        effect,
        &source(kind),
        &context,
        TranslationPerspective::Attacker,
    )
}

#[test]
fn a_named_grant_translates_the_definition_it_prints() {
    let out = applied(&grant(json!("this-unit"), true), AbilityKind::Detachment);
    assert_eq!(out.applied.len(), 1);
    assert_eq!(
        serde_json::to_value(&out.applied[0].contribution).expect("contribution"),
        json!({"type":"extra-keyword","keywordRef":{"keyword_id":"lethal-hits"}})
    );
    assert!(out.unsupported.is_empty());
    let bare = applied(&grant(json!("this-unit"), false), AbilityKind::Detachment);
    assert!(bare.applied.is_empty());
    assert_eq!(
        bare.unsupported[0].reason,
        "ability-grant: named ability ownership is not resolved by the buff engine"
    );
}

#[test]
fn a_friendly_filter_selects_the_holder_of_the_ability_being_resolved() {
    let filter = |has: &str| json!({"owner":"friendly","all_of":["KILL TEAM"],"has_ability":[has]});
    assert_eq!(
        applied(
            &grant(filter("fabricated-named"), true),
            AbilityKind::Detachment
        )
        .applied
        .len(),
        1
    );
    assert!(applied(
        &grant(filter("fabricated-other"), true),
        AbilityKind::Detachment
    )
    .applied
    .is_empty());
    assert!(applied(
        &grant(filter("fabricated-named"), true),
        AbilityKind::Support
    )
    .applied
    .is_empty());
}
