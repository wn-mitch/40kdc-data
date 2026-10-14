//! Pins the tag-dispatched deserializers codegen emits for `EffectNode` and `ConditionNode`.
//!
//! Untagged derives try every variant from one large frame, so deep abilities overflowed a
//! 2 MiB thread in debug builds. These tests parse on threads with an explicit 2 MiB stack
//! (independent of `RUST_MIN_STACK`), and check that a wrong tag reports itself.

use serde_json::{json, Value};
use wh40kdc::{Ability, EffectNode, RawData};

const TWO_MIB: usize = 2 * 1024 * 1024;

fn on_two_mib<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new()
        .stack_size(TWO_MIB)
        .spawn(f)
        .expect("spawn")
        .join()
        .expect("parse finished without overflowing or panicking")
}

#[test]
fn embedded_bundle_parses_on_a_two_mib_stack() {
    let raw: RawData = on_two_mib(|| {
        serde_json::from_str(include_str!("../src/data/bundle.generated.json"))
            .expect("bundle deserializes")
    });
    assert!(!raw.abilities.is_empty());
}

/// An effect nested well past the deepest shipped ability still fits: each level costs one
/// variant's frame, not every variant's.
#[test]
fn deeply_nested_effect_parses_on_a_two_mib_stack() {
    let mut effect = json!({"type": "no-effect"});
    // 12 rounds = 24 effect levels, over 3x the deepest shipped ability (7).
    for _ in 0..12 {
        effect = json!({
            "type": "conditional",
            "condition": {"operator": "not", "operands": [
                {"operator": "and", "operands": [{"type": "unit-state", "parameters": {"state": "battle-shocked"}}]}
            ]},
            "effect": {"type": "sequence", "steps": [effect]}
        });
    }
    let text = effect.to_string();
    let node: EffectNode = on_two_mib(move || serde_json::from_str(&text).expect("deserializes"));
    assert!(matches!(node, EffectNode::ConditionalEffect(_)));
}

#[test]
fn every_shipped_ability_round_trips_through_dispatch() {
    let raw: Value =
        serde_json::from_str(include_str!("../src/data/bundle.generated.json")).unwrap();
    for a in raw["abilities"].as_array().unwrap() {
        let parsed: Ability = serde_json::from_value(a.clone())
            .unwrap_or_else(|e| panic!("{}: {e}", a["ability_id"]));
        // Serialize, then parse again: dispatch must pick the same variant every level.
        let again: Ability = serde_json::from_value(serde_json::to_value(&parsed).unwrap())
            .unwrap_or_else(|e| panic!("{} did not re-parse: {e}", a["ability_id"]));
        assert_eq!(again, parsed, "{} changed on round trip", a["ability_id"]);
    }
}

#[test]
fn unknown_effect_type_names_the_type() {
    let err = serde_json::from_value::<EffectNode>(json!({"type": "named-effect"})).unwrap_err();
    assert!(
        err.to_string()
            .contains("unknown effect node type `named-effect`"),
        "{err}"
    );
    let err = serde_json::from_value::<EffectNode>(json!({"steps": []})).unwrap_err();
    assert!(err.to_string().contains("no string `type`"), "{err}");
}

#[test]
fn a_leaf_with_the_wrong_modifier_fails_on_that_leaf() {
    // `re-roll` takes `roll`, not a stat-modifier's `stat`: its own modifier type rejects it,
    // rather than the stat-modifier type every leaf once shared accepting it.
    let err = serde_json::from_value::<EffectNode>(json!({
        "type": "re-roll", "target": "this-unit", "modifier": {"stat": "T", "operation": "add"}
    }))
    .unwrap_err();
    assert!(err.to_string().contains("ReRollEffectModifier"), "{err}");
}
