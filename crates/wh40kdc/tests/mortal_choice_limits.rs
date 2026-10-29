//! Mortal wound sources a selection may count together: a choice's options stay within its limit.

use serde_json::json;
use wh40kdc::cruncher::{mortal_wound_sources, within_choice_limits, EngineContext};
use wh40kdc::Phase;

fn select(count: i64) -> serde_json::Value {
    json!({
        "type": "select-units",
        "selector": {"filter": {"owner": "enemy"}, "count": {"min": 1, "max": 1}},
        "effect": {"type": "mortal-wounds", "target": "selected-unit", "modifier": {"count": count}},
    })
}

#[test]
fn a_choice_keeps_its_options_to_its_limit() {
    let charge = json!({"event": "move-ended", "filter": {"move_types": ["charge"]}});
    let context = EngineContext::new(Phase::Shooting);
    let one = mortal_wound_sources(
        "x",
        &json!({"type": "choice", "options": [select(1), select(2)]}),
        &charge,
        &context,
        None,
    );
    let all: Vec<_> = one.sources.iter().collect();
    let ids = |kept: Vec<&wh40kdc::cruncher::MortalWoundSource>| {
        kept.iter().map(|s| s.id.clone()).collect::<Vec<_>>()
    };
    assert_eq!(ids(within_choice_limits(&all)), ["x?0"]);
    let reversed: Vec<_> = all.iter().rev().copied().collect();
    assert_eq!(ids(within_choice_limits(&reversed)), ["x?1"]);
    let two = mortal_wound_sources(
        "x",
        &json!({"type": "choice", "max_choices": 2, "options": [select(1), select(2)]}),
        &charge,
        &context,
        None,
    );
    assert_eq!(
        ids(within_choice_limits(
            &two.sources.iter().collect::<Vec<_>>()
        )),
        ["x?0", "x?1"]
    );
}
