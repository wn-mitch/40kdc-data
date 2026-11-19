//! A Stratagem's secondary effect: the option a `choice` marks `secondary_option` costs the
//! Stratagem's `secondary_effect_extra_cp`. Mirrors the "a Stratagem's secondary effect" cases of
//! `tools/test/stackable-levers.test.ts` for the defensive levers this crate exposes. Fabricated
//! army, no GW rule prose.

use serde_json::{json, Value};
use wh40kdc::cruncher::EngineContext;
use wh40kdc::data::{EligibilityInput, LeverCost};
use wh40kdc::{Dataset, RawData};

const VERSION: fn() -> Value = || json!({ "edition": "11th", "dataslate": "test" });

fn wound_minus() -> Value {
    json!({ "type": "roll-modifier", "target": "attacker", "modifier": { "roll": "wound", "operation": "subtract", "value": 1 } })
}

/// Fix Brace is a defensive Stratagem whose second option is its secondary effect.
fn dataset(extra_cp: Option<u64>) -> Dataset {
    let mut stratagem = json!({
        "id": "fix-brace-s", "name": "Fix Brace", "category": "detachment", "detachment_id": "fix-det",
        "cp_cost": 1, "phases": ["fight"], "player_turn": "either", "timing": "once-per-phase", "ability_id": "fix-brace", "game_version": VERSION(),
    });
    if let Some(extra) = extra_cp {
        stratagem["secondary_effect_extra_cp"] = json!(extra);
    }
    let raw: RawData = serde_json::from_value(json!({
        "units": [{
            "id": "fix-mob", "name": "fix-mob", "faction_id": "orks",
            "profiles": [{ "name": "fix-mob", "M": 6, "T": 5, "W": 1, "Sv": 5, "Ld": 7, "OC": 2 }],
            "keywords": ["Infantry", "Mob"], "faction_keywords": ["Orks"],
            "model_count": { "min": 1, "max": 10 }, "ability_ids": [], "game_version": VERSION(),
        }],
        "abilities": [{
            "ability_id": "fix-brace", "name": "fix-brace", "authored_by": "40kdc-community",
            "faction_id": "orks", "game_version": VERSION(), "ability_type": "stratagem",
            "behavior": "passive", "detachment_id": "fix-det", "scope": { "duration": "permanent" },
            "effect": {
                "type": "choice", "secondary_option": 1,
                "options": [
                    { "type": "conditional", "condition": { "type": "attack-is", "parameters": { "attack_type": "melee" } }, "effect": wound_minus() },
                    wound_minus(),
                ],
            },
        }],
        "detachments": [{ "id": "fix-det", "name": "Fix Detachment", "faction_id": "orks", "stratagem_ids": ["fix-brace-s"], "game_version": VERSION() }],
        "stratagems": [stratagem],
    }))
    .expect("fabricated army deserializes");
    Dataset::from_raw(raw)
}

fn levers(ds: &Dataset) -> Vec<(String, Option<LeverCost>)> {
    let input: EligibilityInput = serde_json::from_value(
        json!({ "unitId": "fix-mob", "factionId": "orks", "detachmentId": "fix-det" }),
    )
    .expect("input");
    let context: EngineContext =
        serde_json::from_value(json!({ "phase": "fight" })).expect("context");
    ds.defensive_levers_for(&input, &["fix-brace-s".to_string()], &context)
        .levers
        .into_iter()
        .map(|lever| (lever.id, lever.cost))
        .collect()
}

#[test]
fn charges_the_extra_cp_on_a_defensive_stratagems_secondary_option_once_opted_in() {
    let got = levers(&dataset(Some(1)));
    assert_eq!(
        got,
        vec![
            ("fix-brace?0".to_string(), None),
            (
                "fix-brace?1".to_string(),
                Some(LeverCost {
                    cp: Some(1),
                    points: None
                })
            ),
        ]
    );
}

#[test]
fn charges_nothing_extra_where_the_secondary_effect_has_no_extra_cp() {
    let got = levers(&dataset(None));
    assert_eq!(
        got,
        vec![
            ("fix-brace?0".to_string(), None),
            ("fix-brace?1".to_string(), None)
        ]
    );
}
