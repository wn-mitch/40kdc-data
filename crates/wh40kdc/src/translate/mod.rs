//! Plain-English translation of `secondary-card` scoring `awards` — the Rust
//! mirror of `tools/src/translate/` in the TS package. Output is **ASCII-only**
//! and must be byte-for-byte identical to the TS oracle; the
//! `conformance/scoring-translation` corpus pins both ports (the differ
//! compares structurally, with no tolerance). Any phrasing change here is a
//! semantic corpus change (bump `conformance/SPEC_VERSION`).

use serde_json::{Map, Value};

use crate::generated::{
    Condition, ConditionNode, Phase, PlayerTurn, ScoringTrigger, ScoringTriggerTiming,
    SecondaryCard, SecondaryCardAwardsItem,
};

mod condition;
pub mod designations;
mod effect;
mod expiry;
mod trigger;
pub use condition::{
    condition_lead_in_value, describe_condition_value, describe_selection_eligibility_value,
};
pub(crate) use effect::dice_case;
pub use effect::{
    describe_ability, describe_ability_parts, describe_applies_to, describe_effect,
    describe_effect_inline, describe_effect_with_scope, describe_scope,
};
pub use trigger::describe_trigger_value;

/// kebab-case → space-separated words (`enemy-territory` → `enemy territory`).
pub fn dekebab(s: &str) -> String {
    s.replace('-', " ")
}

/// `Number(p.key)` for a battle-round window bound: present-and-not-null integer,
/// else `None`. Mirrors the TS `p.min/p.max != null ? Number(...) : undefined`.
pub(super) fn num_param(p: &Map<String, Value>, k: &str) -> Option<i64> {
    p.get(k)
        .filter(|v| !v.is_null())
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
}

/// Battle-round ordinal: `["zeroth","first",...,"fifth"][n] ?? "{n}th"`. Out of
/// range (incl. negative) degrades to `<n>th`, matching the TS `bOrd`/`ord` helper.
pub(super) fn battle_round_ordinal(n: i64) -> String {
    let table = ["zeroth", "first", "second", "third", "fourth", "fifth"];
    usize::try_from(n)
        .ok()
        .and_then(|i| table.get(i))
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{n}th"))
}

fn phase_word(p: Phase) -> &'static str {
    match p {
        Phase::Command => "Command",
        Phase::Movement => "Movement",
        Phase::Shooting => "Shooting",
        Phase::Charge => "Charge",
        Phase::Fight => "Fight",
    }
}

/// "End of your Command phase (round 2+)" and friends.
pub fn describe_trigger(t: &ScoringTrigger) -> String {
    let turn = match t.player_turn {
        Some(PlayerTurn::OpponentTurn) => "the opponent's",
        Some(PlayerTurn::Either) => "any",
        _ => "your",
    };
    let phase = t.phase.map(phase_word).unwrap_or("");

    let mut base = match t.timing {
        Some(ScoringTriggerTiming::StartOfTurn) => format!("Start of {turn} turn"),
        Some(ScoringTriggerTiming::EndOfTurn) => format!("End of {turn} turn"),
        Some(ScoringTriggerTiming::StartOfPhase) => format!("Start of {turn} {phase} phase"),
        Some(ScoringTriggerTiming::EndOfPhase) => format!("End of {turn} {phase} phase"),
        Some(ScoringTriggerTiming::EndOfBattle) => "End of the battle".to_string(),
        None => {
            if t.phase.is_some() {
                format!("During {turn} {phase} phase")
            } else {
                "Any time".to_string()
            }
        }
    };

    if let Some(br) = &t.battle_round {
        let min = br.min.map(|n| n.get());
        let max = br.max.map(|n| n.get());
        match (min, max) {
            (Some(mn), Some(mx)) => base.push_str(&if mn == mx {
                format!(" (round {mn})")
            } else {
                format!(" (rounds {mn}-{mx})")
            }),
            (Some(mn), None) => base.push_str(&format!(" (round {mn}+)")),
            (None, Some(mx)) => base.push_str(&format!(" (rounds 1-{mx})")),
            (None, None) => {}
        }
    }
    base
}

/// "End of your Command phase (round 2+): 3 VP per controlled objective when ..."
pub fn describe_award(a: &SecondaryCardAwardsItem) -> String {
    let (trigger, when, cumulative, exclusive, amount) = match a {
        SecondaryCardAwardsItem::Variant0 {
            trigger,
            when,
            cumulative,
            exclusive_group,
            vp,
            ..
        } => (
            trigger,
            when,
            *cumulative,
            exclusive_group.is_some(),
            format!("{vp} VP"),
        ),
        SecondaryCardAwardsItem::Variant1 {
            trigger,
            when,
            cumulative,
            exclusive_group,
            vp_per,
            per,
            per_max,
            ..
        } => {
            let mut amt = format!("{vp_per} VP per {}", dekebab(per));
            if let Some(pm) = per_max {
                amt.push_str(&format!(" (max {})", pm.get()));
            }
            (trigger, when, *cumulative, exclusive_group.is_some(), amt)
        }
    };

    let prefix = if cumulative { "+ " } else { "" };
    let trig = describe_trigger(trigger);
    let when_clause = match when {
        Some(c) => format!(" when {}", describe_condition(c)),
        None => String::new(),
    };
    let tier = if exclusive { " [highest tier]" } else { "" };
    format!("{prefix}{trig}: {amount}{when_clause}{tier}")
}

/// Humanize every award on a card, in array order (the order is load-bearing).
pub fn describe_scoring_card(card: &SecondaryCard) -> Vec<String> {
    card.awards.iter().map(describe_award).collect()
}

pub fn describe_condition(c: &Condition) -> String {
    describe_node(&c.0)
}

/// A condition node as a predicate phrase (see [`condition::describe_condition_value`]).
pub(super) fn describe_node(n: &ConditionNode) -> String {
    condition::describe_condition_value(&condition_value(n))
}

/// The JSON form of a typed condition node, as the TS describer sees it.
pub(super) fn condition_value(n: &ConditionNode) -> Value {
    serde_json::to_value(n).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::ScoringTriggerBattleRound;
    use std::num::NonZeroU64;

    fn br(min: Option<u64>, max: Option<u64>) -> ScoringTriggerBattleRound {
        ScoringTriggerBattleRound {
            min: min.and_then(NonZeroU64::new),
            max: max.and_then(NonZeroU64::new),
        }
    }

    #[test]
    fn trigger_phrases() {
        let t = ScoringTrigger {
            timing: Some(ScoringTriggerTiming::EndOfPhase),
            phase: Some(Phase::Command),
            player_turn: Some(PlayerTurn::YourTurn),
            battle_round: Some(br(Some(2), None)),
        };
        assert_eq!(describe_trigger(&t), "End of your Command phase (round 2+)");

        let t2 = ScoringTrigger {
            timing: Some(ScoringTriggerTiming::EndOfTurn),
            phase: None,
            player_turn: None,
            battle_round: Some(br(None, Some(2))),
        };
        assert_eq!(describe_trigger(&t2), "End of your turn (rounds 1-2)");

        let t3 = ScoringTrigger {
            timing: Some(ScoringTriggerTiming::EndOfBattle),
            phase: None,
            player_turn: None,
            battle_round: None,
        };
        assert_eq!(describe_trigger(&t3), "End of the battle");
    }

    fn condition(v: Value) -> Condition {
        serde_json::from_value(v).expect("condition matches the schema")
    }

    #[test]
    fn condition_phrases() {
        assert_eq!(
            describe_condition(&condition(serde_json::json!({
                "type": "controls",
                "parameters": { "objective": { "role": "central" }, "count": { "min": 1 } }
            }))),
            "you control 1+ central objectives"
        );
        assert_eq!(
            describe_condition(&condition(serde_json::json!({
                "type": "controls",
                "parameters": { "compare": { "comparison": "gt", "owner": "enemy" } }
            }))),
            "you hold more objectives than the opponent"
        );
        assert_eq!(
            describe_condition(&condition(serde_json::json!({
                "type": "happened",
                "parameters": {
                    "event": "destroyed",
                    "object": { "owner": "enemy" },
                    "window": "turn",
                    "count": { "min": 1 }
                }
            }))),
            "1+ enemy units destroyed this turn"
        );
        // Negation is only the `not` operator; a single negated predicate reads inline.
        assert_eq!(
            describe_condition(&condition(serde_json::json!({
                "operator": "not",
                "operands": [{ "type": "matches", "parameters": { "filter": { "state": "engaged" } } }]
            }))),
            "the unit is unengaged"
        );
    }
}
