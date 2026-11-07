//! Catalog weapon keywords use the same canonical DSL walker as ordinary abilities.
//! Engine-native keywords retain their catalog references and exact parameters;
//! model membership and unresolved selections never become whole-unit buffs.

use super::buffs::{Buff, BuffContribution, BuffSource, EngineContext, WeaponKeywordRef};
use super::from_dsl::{effect_to_buffs, TranslationPerspective};
use serde_json::Value;

const ENGINE_DISPATCH_KEYWORDS: &[&str] = &[
    "lethal-hits",
    "sustained-hits",
    "devastating-wounds",
    "anti",
    "melta",
    "rapid-fire",
    "torrent",
    "blast",
    "ignores-cover",
];

/// Translate a catalog effect or retain an engine-native keyword reference.
pub fn buffs_from_keyword(
    keyword_id: &str,
    weapon_id: &str,
    effect: Option<&Value>,
    parameters: Option<&Value>,
    context: &EngineContext,
) -> Vec<Buff> {
    let source = BuffSource::WeaponKeyword {
        weapon_id: weapon_id.to_string(),
        keyword_id: keyword_id.to_string(),
    };
    if keyword_id == "blast" && parameters.and_then(|value| value.get("value")).is_none() {
        return Vec::new();
    }
    if ENGINE_DISPATCH_KEYWORDS.contains(&keyword_id) {
        return vec![Buff {
            source,
            applicable_when: None,
            contribution: BuffContribution::ExtraKeyword {
                keyword_ref: WeaponKeywordRef {
                    keyword_id: keyword_id.to_string(),
                    parameters: parameters.cloned(),
                },
            },
        }];
    }
    effect
        .map(|effect| catalog_effect_buffs(effect, &source, context))
        .unwrap_or_default()
}

fn catalog_effect_buffs(effect: &Value, source: &BuffSource, context: &EngineContext) -> Vec<Buff> {
    match effect.get("type").and_then(Value::as_str) {
        Some("rules-bundle" | "sequence") => effect
            .get("steps")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .flat_map(|child| catalog_effect_buffs(child, source, context))
            .collect(),
        Some("conditional") => {
            let holds = effect
                .get("condition")
                .and_then(Value::as_object)
                .and_then(|condition| {
                    super::from_dsl::conditions::evaluate_condition(
                        condition,
                        context,
                        TranslationPerspective::Attacker,
                    )
                });
            if holds == Some(true) {
                effect
                    .get("effect")
                    .map(|body| catalog_effect_buffs(body, source, context))
                    .unwrap_or_default()
            } else {
                Vec::new()
            }
        }
        _ => {
            let defensive = effect.get("type").and_then(Value::as_str) == Some("feel-no-pain")
                || effect.pointer("/modifier/roll").and_then(Value::as_str) == Some("save");
            effect_to_buffs(
                effect,
                source,
                context,
                if defensive {
                    TranslationPerspective::Target
                } else {
                    TranslationPerspective::Attacker
                },
            )
            .applied
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Phase;
    use serde_json::json;

    fn context() -> EngineContext {
        EngineContext::new(Phase::Shooting)
    }

    #[test]
    fn model_grants_require_resolved_membership() {
        let effect = json!({
            "type": "ability-grant",
            "target": {"owner": "friendly", "level": "model", "member_of": "this-unit", "attachment_role": "leader"},
            "modifier": {"definition": {"type": "roll-modifier", "target": "this-unit", "modifier": {"roll": "hit", "operation": "add", "value": 1}}}
        });
        assert!(
            buffs_from_keyword("test", "test-weapon", Some(&effect), None, &context()).is_empty()
        );
    }

    #[test]
    fn rules_bundle_walks_every_effect_step() {
        let effect = json!({"type": "rules-bundle", "steps": [
            {"type": "re-roll", "target": "this-unit", "modifier": {"roll": "hit", "subset": "ones"}},
            {"type": "re-roll", "target": "this-unit", "modifier": {"roll": "wound", "subset": "ones"}}
        ]});
        assert_eq!(
            buffs_from_keyword("test", "test-weapon", Some(&effect), None, &context()).len(),
            2
        );
    }

    #[test]
    fn retained_selection_is_not_invented() {
        let effect = json!({"type": "re-roll", "target": {"selection_var": "retained"}, "modifier": {"roll": "hit", "subset": "all-failures"}});
        assert!(
            buffs_from_keyword("test", "test-weapon", Some(&effect), None, &context()).is_empty()
        );
    }

    #[test]
    fn catalog_keyword_grants_preserve_parameters() {
        let effect = json!({"type": "weapon-ability-grant", "target": "this-unit", "modifier": {"keywords": [{"keyword_id": "sustained-hits", "parameters": {"value": 2}}]}});
        let buffs = buffs_from_keyword("test", "test-weapon", Some(&effect), None, &context());
        assert_eq!(
            serde_json::to_value(&buffs[0]).unwrap()["contribution"]["keywordRef"]["parameters"],
            json!({"value": 2})
        );
    }
}
