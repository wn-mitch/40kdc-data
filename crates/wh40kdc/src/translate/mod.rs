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
mod effect;
mod trigger;
pub use condition::{
    condition_lead_in_value, describe_condition_value, describe_selection_eligibility_value,
};
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

// Phrases for the free-text timing strings some effect fields still carry
// (`select.timing`, a menu's `select`, a mortal-wound `timing`) — the mirror of
// `tools/src/translate/timing.ts`. Triggers and conditions use the event
// families in `trigger.rs` instead; these strings are not part of that vocabulary.

/// `EVENT_PHRASES` lookup: a timing token → its fixed phrase, or `None` when
/// unmapped. Shared by [`event_clause`] and [`describe_timing`].
fn event_phrase(e: &str) -> Option<&'static str> {
    let mapped = match e {
        "start-of-phase" => "at the start of the phase",
        "end-of-phase" => "at the end of the phase",
        "start-of-turn" => "at the start of the turn",
        "end-of-turn" => "at the end of the turn",
        "start-of-player-turn" => "at the start of your turn",
        "start-of-opponent-turn" => "at the start of the opponent's turn",
        "end-of-opponent-turn" => "at the end of the opponent's turn",
        "start-of-battle-round" => "at the start of the battle round",
        "start-of-battle" => "at the start of the battle",
        "end-of-battle-round" => "at the end of the battle round",
        "end-of-normal-move" => "when the unit ends a Normal move",
        "enemy-unit-destroyed" => "each time an enemy unit is destroyed",
        "selected-to-move" => "when the unit is selected to move",
        "selected-to-fall-back" => "when the unit is selected to Fall Back",
        "army-selection" => "when you select this model to include in your army",
        "start-of-command-phase" => "at the start of the Command phase",
        "declare-battle-formations" => "when declaring Battle Formations",
        "post-deployment" => "after deployment",
        "unit-set-up" => "when the unit is set up",
        "set-up-from-reserves" => "when the unit arrives from Reserves",
        "arrives-from-strategic-reserves" => "when the unit arrives from Strategic Reserves",
        "starts-in-strategic-reserves" => "if the unit starts in Strategic Reserves",
        "game-start-in-reserves" => "if the unit begins the battle in Reserves",
        "deep-strike-setup" => "when the unit is set up by Deep Strike",
        "reinforcements" => "when the unit arrives as Reinforcements",
        "normal-move" => "when the unit makes a Normal move",
        "advance-move" => "when the unit makes an Advance move",
        "advances" => "when the unit Advances",
        "fall-back-move" => "when the unit makes a Fall Back move",
        "falls-back" => "when the unit Falls Back",
        "charge-move" => "when the unit makes a Charge move",
        "end-of-charge-move" => "after the unit ends a Charge move",
        "charge-declaration" => "when a Charge is declared",
        "moved-through-terrain" => "when the unit moves through terrain",
        "moved-through-tall-terrain" => "when the unit moves through terrain over 4\" tall",
        "enemy-unit-ended-move" => "an enemy unit ends a move",
        "enemy-unit-fell-back" => "an enemy unit Falls Back",
        "before-hit-roll" => "before a Hit roll is made",
        "after-hit-roll" => "after a Hit roll is made",
        "before-wound-roll" => "before a Wound roll is made",
        "after-wound-roll" => "after a Wound roll is made",
        "attack-scores-wound" => "each time an attack scores a wound",
        "before-save-roll" => "before a saving throw is made",
        "after-save-roll" => "after a saving throw is made",
        "before-damage-roll" => "before a Damage roll is made",
        "after-damage-roll" => "after a Damage roll is made",
        "before-charge-roll" => "before a Charge roll is made",
        "after-charge-roll" => "after a Charge roll is made",
        "before-advance-roll" => "before an Advance roll is made",
        "after-advance-roll" => "after an Advance roll is made",
        "before-battle-shock" => "before a Battle-shock test",
        "after-battle-shock" => "after a Battle-shock test",
        "on-unit-selected" => "when the unit is selected",
        "selected-to-shoot" => "when the unit is selected to shoot",
        "selected-to-fight" => "when the unit is selected to fight",
        "selected-to-advance" => "when the unit is selected to Advance",
        "after-unit-resolves-attacks" => "after the unit resolves its attacks",
        "after-scoring-hit" => "after scoring a hit",
        "after-enemy-unit-fires" => "after an enemy unit shoots",
        "on-unit-destroyed" => "when the unit is destroyed",
        "on-model-destroyed" => "when a model in the unit is destroyed",
        "first-model-destroyed" => "the first time a model in the unit is destroyed",
        "before-bearer-removed" => "before this model is removed from play",
        "enemy-unit-destroyed-in-melee" => "when an enemy unit is destroyed in melee",
        "on-damage-allocated" => "when damage is allocated",
        "battle-shock-test" => "when the unit takes a Battle-shock test",
        "leadership-test" => "when the unit takes a Leadership test",
        "desperate-escape-test" => "when the unit takes a Desperate Escape test",
        "end-of-opponent-charge-phase" => "at the end of the opponent's Charge phase",
        "enemy-unit-completed-shooting-targeting-bearer" => {
            "after an enemy unit has shot and targeted this unit"
        }
        "enemy-unit-selects-bearer-as-charge-target" => {
            "when an enemy unit selects this unit as a charge target"
        }
        "enemy-unit-targets-bearer" => "when an enemy unit targets this unit",
        "enemy-unit-completed-fall-back-from-bearer" => {
            "after an enemy unit within Engagement Range of this unit completes a Fall Back move"
        }
        "act-of-faith-completed" => "after an Act of Faith is completed",
        "act-of-faith-performed" => "when an Act of Faith is performed",
        "miracle-die-generated" => "when a Miracle die is generated",
        "enemy-unit-selected-charge-targets-before-charge-move" => {
            "after an enemy unit selects targets for its charge but before it makes a Charge move"
        }
        "end-of-advance-move" => "when the unit ends an Advance move",
        "selected-to-disembark" => "when the unit is selected to disembark",
        "unit-disembarked" => "when the unit disembarks from a Transport",
        "becomes-battle-shocked" => "when the unit becomes Battle-shocked",
        "start-of-battle-shock-step" => "at the start of the Battle-shock step",
        "stratagem-used" => "each time you use a Stratagem",
        "dark-pact-made" => "each time the unit makes a Dark Pact",
        "agile-manoeuvre-performed" => "each time the unit performs an Agile Manoeuvre",
        "unit-empowered" => "each time the unit is Empowered",
        "ritual-manifested" => "each time the unit manifests a Ritual",
        "oath-fulfilled" => "when you fulfil an Oath",
        "shadow-in-the-warp-used" => "when you use Shadow in the Warp",
        "order-issued" => "each time the unit issues an Order",
        "order-received" => "each time an Order is issued to the unit",
        "reanimation-protocols-activated" => "each time the unit's Reanimation Protocols activate",
        "ritual-attempted" => "each time the unit attempts a Ritual",
        "warp-channelled" => "each time the unit Channels the Warp",
        "after-psychic-test" => "after a Psychic test is taken",
        "blessings-of-khorne-rolled" => "each time you make a Blessings of Khorne roll",
        "observer-selected" => "each time the unit is selected as an Observer unit",
        "malefic-surge-made" => "each time the unit makes a Malefic Surge",
        "contract-invoked" => "each time the unit invokes its contract",
        "dark-pact-test-passed" => {
            "each time the unit makes a Dark Pact and passes its Leadership test"
        }
        "contract-completed" => "each time you complete a Contract",
        "favoured-champions-changed" => "each time a unit becomes your Favoured Champions",
        "cult-ambush-marker-removed" => "each time one of your Cult Ambush markers is removed",
        "set-up-from-cult-ambush" => "when the unit is set up using Cult Ambush",
        "quarry-destroyed" => "each time your quarry is destroyed",
        "combat-doctrine-selected" => "when you select a Combat Doctrine",
        "waaagh-called" => "when you call a Waaagh!",
        "opponent-cp-gained" => "each time your opponent gains a CP",
        "flux-token-spent" => "each time a Flux token is spent",
        "yield-points-spent" => "each time you spend Yield points",
        "gate-of-infinity-used" => "when you use Gate of Infinity",
        "surge-move" => "when the unit makes a Surge move",
        _ => return None,
    };
    Some(mapped)
}

/// A timing token → natural clause ("an enemy unit ends a move", "before a
/// saving throw is made"). Mirrors the TS `eventClause` in `timing.ts`; an
/// unmapped token falls back to `when <dekebab>`.
pub(super) fn event_clause(e: &str) -> String {
    match event_phrase(e) {
        Some(p) => p.to_string(),
        None => format!("when {}", dekebab(e)),
    }
}
/// Legacy `timing-is` string → its canonical `GameEvent` token. Mirrors
/// `TIMING_ALIASES`; applied before the `EVENT_PHRASES` lookup in
/// [`describe_timing`].
fn timing_alias(t: &str) -> Option<&'static str> {
    Some(match t {
        "advance" => "advances",
        "after-attacks" => "after-unit-resolves-attacks",
        "after-attacking-unit-finishes-attacks" => "after-unit-resolves-attacks",
        "after-shooting" => "after-unit-resolves-attacks",
        "after-unit-shot" => "after-unit-resolves-attacks",
        "after-unit-has-shot" => "after-unit-resolves-attacks",
        "after-this-model-has-shot" => "after-unit-resolves-attacks",
        "after-shot-hits-scored" => "after-scoring-hit",
        "deep-strike" => "deep-strike-setup",
        "end" => "end-of-turn",
        "start" => "start-of-turn",
        "fall-back" => "falls-back",
        "model-destroyed" => "on-model-destroyed",
        "on-destroyed" => "on-unit-destroyed",
        "before-this-model-removed" => "before-bearer-removed",
        "reinforcements-step" => "reinforcements",
        "setup" => "unit-set-up",
        "set-up-this-turn" => "unit-set-up",
        "after-move-through-terrain-over-4-inches" => "moved-through-tall-terrain",
        "after-moving-through-tall-terrain" => "moved-through-tall-terrain",
        "when-selected-to-shoot" => "selected-to-shoot",
        "when-this-unit-selected-to-shoot" => "selected-to-shoot",
        _ => return None,
    })
}

/// `timing-is` tokens with no canonical `GameEvent` — these keep their own
/// phrase. Mirrors `TIMING_ONLY_PHRASES`.
fn timing_only_phrase(t: &str) -> Option<&'static str> {
    Some(match t {
        "once-per-battle" => "once per battle",
        "once-per-phase" => "once per phase",
        "once-per-opponent-turn" => "once per opponent's turn",
        "first-this-battle" => "the first time this battle",
        "first-time-this-phase" => "the first time this phase",
        "in-reserves" => "while it is in Reserves",
        "shooting-phase" => "in the Shooting phase",
        "command-phase" => "during the Command phase",
        "start-of-shooting-phase" => "at the start of your Shooting phase",
        "start-of-fight-phase" => "at the start of the Fight phase",
        "start-of-first-battle-round" => "at the start of the first battle round",
        "start-of-movement-phase" => "at the start of the Movement phase",
        "shooting-or-fight-phase" => "in the Shooting or Fight phase",
        "this-model-starts-or-ends-a-move" => "each time this model starts or ends a move",
        "friendly-unit-empowered-within-9" => {
            "each time you spend 1 Pain token to Empower a friendly unit within 9\" of this unit"
        }
        "enemy-unit-fails-battle-shock" => "each time an enemy unit fails a Battle-shock test",
        _ => return None,
    })
}

/// A `timing-is` token → natural GW-voice clause.
pub(super) fn describe_timing(t: &str) -> String {
    if let Some(p) = timing_only_phrase(t) {
        return p.to_string();
    }
    let canon = timing_alias(t).unwrap_or(t);
    if let Some(p) = event_phrase(canon) {
        return p.to_string();
    }
    if let Some(rest) = t.strip_prefix("after-") {
        return format!("after {}", dekebab(rest));
    }
    if let Some(rest) = t.strip_prefix("on-") {
        return format!("when {}", dekebab(rest));
    }
    if t.ends_with("-destroyed") {
        return format!("each time {}", dekebab(t));
    }
    format!("at {}", dekebab(t))
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
                "parameters": { "objective": { "role": "central" }, "count_min": 1 }
            }))),
            "you control 1+ central objectives"
        );
        assert_eq!(
            describe_condition(&condition(serde_json::json!({
                "type": "controls",
                "parameters": { "compare": "more-than-opponent" }
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
                    "count_min": 1
                }
            }))),
            "1+ enemy units destroyed this turn"
        );
        // Negation is only the `not` operator; a single negated predicate reads inline.
        assert_eq!(
            describe_condition(&condition(serde_json::json!({
                "operator": "not",
                "operands": [{ "type": "unit-state", "parameters": { "state": "engaged" } }]
            }))),
            "the unit is unengaged"
        );
    }
}
