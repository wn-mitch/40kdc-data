//! The `resource` predicate: a pool's holding, this turn's gains, the opponent's holding, and an
//! ability's unused selection capacity. Mirrors the `resource` case of `describePredicate` in
//! `tools/src/translate/condition.ts`.

use serde_json::Value;

use super::js::*;
use super::refs::*;
use crate::translate::dekebab;
use crate::translate::effect::resource_noun;

/// The predicate phrase for a `resource` condition's parameters.
pub(super) fn resource_predicate(p: &P, negated: bool) -> String {
    let neg = if negated { "not " } else { "" };
    if p.get("below_max") == Some(&Value::Bool(true)) {
        let source = obj(p.get("source_ability")).get("ability_id");
        return format!(
            "{neg}the {} ability had unused selection capacity at the end of your opponent's previous turn",
            dekebab(&st(source))
        );
    }
    // "you gained fewer than 3YP this turn": this turn's gains, not what the pool holds.
    if p.get("gained").and_then(Value::as_str) == Some("turn") {
        return format!(
            "you {} {} {} this turn",
            if negated { "did not gain" } else { "gained" },
            count_phrase(p.get("count")),
            resource_noun(p.get("pool"), None, Some(&Value::from(2)))
        );
    }
    // "if your opponent has one or more Flux tokens": the opponent's holding of a pool both players hold.
    if p.get("holder").and_then(Value::as_str) == Some("opponent") {
        return format!(
            "your opponent {} {} {}",
            if negated { "does not have" } else { "has" },
            count_phrase(p.get("count")),
            resource_noun(p.get("pool"), None, Some(&Value::from(2)))
        );
    }
    // "while you have 0 Pain tokens": an empty pool of the player's.
    let count = obj(p.get("count"));
    if count.get("max").and_then(Value::as_f64) == Some(0.0) && nn(count, "min").is_none() {
        return format!(
            "you {} 0 {}",
            if negated { "do not have" } else { "have" },
            resource_noun(p.get("pool"), None, Some(&Value::from(2)))
        );
    }
    // A pool is the player's ("If you have 3 or more Pact points").
    format!(
        "you have {} {}",
        count_phrase(p.get("count")),
        dekebab(&st(p.get("pool")))
    )
}
