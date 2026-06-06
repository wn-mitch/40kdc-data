//! Plain-English translation of `secondary-card` scoring `awards` — the Rust
//! mirror of `tools/src/translate/` in the TS package. Output is **ASCII-only**
//! and must be byte-for-byte identical to the TS oracle; the
//! `conformance/scoring-translation` corpus pins both ports (the differ
//! compares structurally, with no tolerance). Any phrasing change here is a
//! semantic corpus change (bump `conformance/SPEC_VERSION`).

use serde_json::{Map, Value};

use crate::generated::{
    CompoundConditionOperator, Condition, ConditionNode, Phase, PlayerTurn, ScoringTrigger,
    ScoringTriggerTiming, SecondaryCard, SecondaryCardAwardsItem, SimpleCondition,
    SimpleConditionType,
};

mod effect;
pub use effect::{
    describe_ability, describe_effect, describe_effect_inline, describe_effect_with_scope,
    describe_scope,
};

/// kebab-case → space-separated words (`enemy-territory` → `enemy territory`).
pub fn dekebab(s: &str) -> String {
    s.replace('-', " ")
}

// `parameters` accessors over the open `serde_json::Map`. Defaults mirror the
// TS `?? 1` / `?? "..."` fallbacks so missing keys translate identically.
fn ps<'a>(p: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    p.get(k).and_then(Value::as_str)
}
fn pu(p: &Map<String, Value>, k: &str, default: u64) -> u64 {
    p.get(k).and_then(Value::as_u64).unwrap_or(default)
}
fn pb(p: &Map<String, Value>, k: &str) -> bool {
    p.get(k).and_then(Value::as_bool).unwrap_or(false)
}
fn po<'a>(p: &'a Map<String, Value>, k: &str) -> Option<&'a Map<String, Value>> {
    p.get(k).and_then(Value::as_object)
}
/// JS-template stringification of a parameter (numbers print bare, missing or
/// null prints `?`) — mirrors the TS `str(p.key)` after its nullish guard.
fn pj(p: &Map<String, Value>, k: &str) -> String {
    p.get(k)
        .map(effect::jval)
        .unwrap_or_else(|| "?".to_string())
}

/// `2` + `objective` → `2+ objectives`. All nouns here are regular plurals.
fn count(n: u64, noun: &str) -> String {
    format!("{n}+ {noun}s")
}

/// Join compound-condition clauses: two read as `X and Y`, three or more as a
/// serial-comma list (`X, Y, and Z`) so long chains don't read as a parser
/// dump. Mirrors `joinClauses`.
fn join_clauses(parts: &[String], connective: &str) -> String {
    if parts.len() <= 2 {
        return parts.join(&format!(" {connective} "));
    }
    format!(
        "{}, {connective} {}",
        parts[..parts.len() - 1].join(", "),
        parts[parts.len() - 1]
    )
}

/// Known timing values → readable clauses. Event-style timings (`on-*`) read
/// as `when ...`; window-style timings read as `at ...`. Unmapped values fall
/// back by prefix: `on-*` → `when <words>`, `after-*` → `after <words>`,
/// anything else → `at <words>`. Mirrors `describeTiming`.
fn describe_timing(timing: &str) -> String {
    match timing {
        "start-of-phase" | "start" => "at the start of the phase".to_string(),
        "end-of-phase" | "end" => "at the end of the phase".to_string(),
        "start-of-battle-round" => "at the start of the battle round".to_string(),
        "on-destroyed" => "when destroyed".to_string(),
        "on-unit-destroyed" => "when a unit is destroyed".to_string(),
        "on-model-destroyed" | "model-destroyed" => "when a model is destroyed".to_string(),
        "first-model-destroyed" => "when the first model is destroyed".to_string(),
        "post-deployment" => "after deployment".to_string(),
        "reinforcements" => "in the Reinforcements step".to_string(),
        "declare-battle-formations" => "when declaring battle formations".to_string(),
        "deep-strike-setup" => "when setting up by deep strike".to_string(),
        "deep-strike" => "when deep striking".to_string(),
        "once-per-battle" => "once per battle".to_string(),
        "first-this-battle" => "the first time this battle".to_string(),
        "normal-move" => "when making a normal move".to_string(),
        "advance" | "advance-move" => "when advancing".to_string(),
        "selected-to-advance" => "when selected to advance".to_string(),
        "fall-back-selected" => "when selected to fall back".to_string(),
        "making-normal-advance-or-fallback-move" => {
            "when making a normal, advance, or fall back move".to_string()
        }
        "starts-in-strategic-reserves" => "when starting in strategic reserves".to_string(),
        "arrives-from-strategic-reserves" => "when arriving from strategic reserves".to_string(),
        "after-shooting" => "after shooting".to_string(),
        "setup" => "during setup".to_string(),
        other => {
            if let Some(rest) = other.strip_prefix("on-") {
                format!("when {}", dekebab(rest))
            } else if let Some(rest) = other.strip_prefix("after-") {
                format!("after {}", dekebab(rest))
            } else {
                format!("at {}", dekebab(other))
            }
        }
    }
}

/// `closest-eligible` → `the closest eligible target`, etc. Mirrors
/// `describeRangeTarget`.
fn describe_range_target(target_type: &str, keyword: Option<&str>) -> String {
    match target_type {
        "friendly" => "a friendly unit".to_string(),
        "friendly-keyword" => match keyword {
            Some(k) => format!("a friendly {k} unit"),
            None => "a friendly unit".to_string(),
        },
        "closest-eligible" => "the closest eligible target".to_string(),
        "area-terrain" => "an area terrain feature".to_string(),
        "character" => "a character".to_string(),
        "fortification" => "a fortification".to_string(),
        other => dekebab(other),
    }
}

/// `this-phase`/`phase` → `this phase`, etc. — windows read as `this <span>`.
/// Mirrors `describeWindow`.
fn describe_window(window: &str) -> String {
    match window {
        "phase" | "this-phase" | "current" => "this phase".to_string(),
        "turn" | "this-turn" => "this turn".to_string(),
        "battle" => "this battle".to_string(),
        "this-attack" => "this attack".to_string(),
        other => dekebab(other),
    }
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

fn describe_node(n: &ConditionNode) -> String {
    match n {
        ConditionNode::CompoundCondition(c) => {
            let parts: Vec<String> = c.operands.iter().map(describe_node).collect();
            match c.operator {
                CompoundConditionOperator::And => join_clauses(&parts, "and"),
                CompoundConditionOperator::Or => join_clauses(&parts, "or"),
                CompoundConditionOperator::Not => format!("not ({})", parts.join(", ")),
            }
        }
        ConditionNode::SimpleCondition(s) => describe_simple(s),
    }
}

fn describe_simple(s: &SimpleCondition) -> String {
    let negate = if s.negated { "not " } else { "" };
    let p = &s.parameters;
    use SimpleConditionType as T;
    match s.type_ {
        // ── Ability-DSL conditions ──────────────────────────────────────────
        T::PhaseIs => format!("{negate}during the {} phase", ps(p, "phase").unwrap_or("")),
        T::TimingIs => format!("{negate}{}", describe_timing(ps(p, "timing").unwrap_or(""))),
        T::PlayerTurnIs => {
            let turn = match ps(p, "turn") {
                Some("your-turn") => "your",
                Some("opponent-turn") => "the opponent's",
                _ => "either player's",
            };
            format!("{negate}in {turn} turn")
        }
        T::ChargedThisTurn => format!("{negate}the unit charged this turn"),
        T::AdvancedThisTurn => format!("{negate}the unit advanced this turn"),
        T::RemainedStationary => format!("{negate}the unit remained stationary"),
        T::UnitBelowStartingStrength => format!("{negate}the unit is below starting strength"),
        T::UnitBelowHalfStrength => format!("{negate}the unit is below half strength"),
        T::UnitHasKeyword => format!(
            "{negate}the unit has \"{}\"",
            ps(p, "keyword").unwrap_or("")
        ),
        T::TargetHasKeyword => {
            format!(
                "{negate}the target has \"{}\"",
                ps(p, "keyword").unwrap_or("")
            )
        }
        T::ModelIsLeader => format!("{negate}the model is leading a unit"),
        T::IsAttached => {
            let kw = match ps(p, "keyword") {
                Some(k) => format!("{k} "),
                None => String::new(),
            };
            format!("{negate}attached to a {kw}unit")
        }
        T::AttackIsType => format!("{negate}for {} attacks", ps(p, "attack_type").unwrap_or("")),
        T::IsBattleShocked => format!("{negate}the unit is battle-shocked"),
        T::HasLostWounds => format!("{negate}the model has lost wounds"),
        T::WasHitByAttack => {
            let subject = if ps(p, "subject") == Some("target") {
                "the target"
            } else {
                "the unit"
            };
            let atk = match ps(p, "attack_type") {
                Some(t) => format!("{t} "),
                None => String::new(),
            };
            let weapon = match ps(p, "weapon_name") {
                Some(w) => format!(" by {w}"),
                None => String::new(),
            };
            let n = pu(p, "count_min", 1);
            if n > 1 {
                format!("{negate}{subject} was hit by {n}+ {atk}attacks{weapon} this phase")
            } else if atk.is_empty() {
                format!("{negate}{subject} was hit by an attack{weapon} this phase")
            } else {
                format!("{negate}{subject} was hit by a {atk}attack{weapon} this phase")
            }
        }
        T::OpponentUnitWithinRange => {
            if ps(p, "range") == Some("engagement") {
                format!("{negate}an enemy unit is within engagement range")
            } else if !matches!(p.get("range"), Some(v) if !v.is_null()) {
                format!("{negate}an enemy unit is within range")
            } else {
                format!("{negate}an enemy unit is within {}\"", pj(p, "range"))
            }
        }
        T::UnitWithinRangeOf => {
            let target_type = ps(p, "target_type").unwrap_or("target");
            let target = describe_range_target(target_type, ps(p, "keyword"));
            let kw = match ps(p, "keyword") {
                Some(k) if target_type != "friendly-keyword" => format!(" ({k})"),
                _ => String::new(),
            };
            if !matches!(p.get("range"), Some(v) if !v.is_null()) {
                format!("{negate}within range of {target}{kw}")
            } else {
                format!("{negate}within {}\" of {target}{kw}", pj(p, "range"))
            }
        }
        T::WithinRangeOfObjective => format!("{negate}within range of an objective"),
        T::HasFoughtThisPhase => format!("{negate}has fought this phase"),
        T::DestroyedByAttackType => match ps(p, "attack_type") {
            None | Some("any") => format!("{negate}destroyed by an attack"),
            Some(t) => format!("{negate}destroyed by a {t} attack"),
        },

        // ── Scoring conditions (secondary-card award `when`) ────────────────
        T::ObjectiveMajority => format!(
            "{negate}you hold more objectives than the {}",
            dekebab(ps(p, "relative_to").unwrap_or("opponent"))
        ),
        T::ControlsObjective => {
            let noun = match ps(p, "objective_role") {
                Some(r) => format!("{} objective", dekebab(r)),
                None => "objective".to_string(),
            };
            let mut out = format!(
                "{negate}you control {}",
                count(pu(p, "count_min", 1), &noun)
            );
            if let Some(o) = ps(p, "objective") {
                out.push_str(&format!(" ({})", dekebab(o)));
            }
            if let Some(sc) = ps(p, "scope") {
                out.push_str(&format!(" in {}", dekebab(sc)));
            }
            if let Some(e) = ps(p, "exclude") {
                out.push_str(&format!(" (excluding {})", dekebab(e)));
            }
            out
        }
        T::UnitsDestroyed => {
            let mut out = format!(
                "{negate}{} destroyed",
                count(pu(p, "count_min", 1), &format!("{} unit", pj(p, "side")))
            );
            if let Some(w) = ps(p, "window") {
                out.push_str(&format!(" {}", describe_window(w)));
            }
            out
        }
        T::UnitsDestroyedComparison => {
            let empty = Map::new();
            let subj = po(p, "subject").unwrap_or(&empty);
            let refr = po(p, "reference").unwrap_or(&empty);
            let (cmp, link) = if ps(p, "comparator") == Some("greater-or-equal") {
                ("at least as many", "as")
            } else {
                ("more", "than")
            };
            format!(
                "{negate}you destroyed {cmp} {} units {} {link} {} units {}",
                pj(subj, "side"),
                dekebab(&pj(subj, "window")),
                pj(refr, "side"),
                dekebab(&pj(refr, "window"))
            )
        }
        T::NewObjectiveControlled => format!(
            "{negate}you newly control {} this turn",
            count(pu(p, "count_min", 1), "objective")
        ),
        T::DestroyedWhileOnObjective => {
            let obj = match ps(p, "objective_role") {
                Some(r) => format!("a {} objective", dekebab(r)),
                None => "an objective".to_string(),
            };
            let mut out = format!(
                "{negate}{} destroyed",
                count(pu(p, "count_min", 1), "enemy unit")
            );
            if pb(p, "destroyer_on_objective") {
                out.push_str(&format!(" by a unit on {obj}"));
            }
            if pb(p, "victim_on_objective") {
                out.push_str(&format!(" while on {obj}"));
            }
            if pb(p, "victim_started_turn_on_objective") {
                out.push_str(&format!(" that started the turn on {obj}"));
            }
            out
        }
        T::DestroyedInTaggedTerrain => {
            let where_ = if pb(p, "at_start_of_turn") {
                "that started the turn in"
            } else {
                "while in"
            };
            let terrain = match ps(p, "tag") {
                Some(t) => format!("{} terrain", dekebab(t)),
                None => "a terrain area".to_string(),
            };
            format!(
                "{negate}{} destroyed {where_} {terrain}",
                count(pu(p, "count_min", 1), "enemy unit")
            )
        }
        T::OperationMarkers => {
            let side = match ps(p, "side") {
                Some(s) => format!("{s} "),
                None => String::new(),
            };
            let min = p.get("count_min").and_then(Value::as_u64);
            let max = p.get("count_max").and_then(Value::as_u64);
            let mut out = if max == Some(0) {
                format!("no {side}operation markers on the battlefield")
            } else if min.is_some() && min == max {
                let n = min.unwrap_or(1);
                let plural = if n == 1 { "" } else { "s" };
                format!("exactly {n} {side}operation marker{plural} on the battlefield")
            } else {
                format!(
                    "{}+ {side}operation markers on the battlefield",
                    min.unwrap_or(1)
                )
            };
            if let Some(w) = ps(p, "within_range_of") {
                out.push_str(&format!(" within range of {}", dekebab(w)));
            }
            if pb(p, "friendly_unit_in_same_terrain_area") {
                out.push_str(" with a friendly unit in the same terrain area");
            }
            if pb(p, "no_enemy_in_terrain_area") {
                out.push_str(" and no enemy units in that terrain area");
            }
            format!("{negate}{out}")
        }
        T::ActionCompleted => {
            let mut out = format!(
                "{negate}{} completed",
                count(pu(p, "count_min", 1), "action")
            );
            if let Some(a) = ps(p, "action_id") {
                out.push_str(&format!(" ({})", dekebab(a)));
            }
            if let Some(tk) = ps(p, "target_kind") {
                out.push_str(&format!(" on {}", dekebab(tk)));
            }
            if let Some(tf) = po(p, "target_filter") {
                if let Some(r) = ps(tf, "objective_role") {
                    out.push_str(&format!(" ({})", dekebab(r)));
                }
                if pb(tf, "in_enemy_territory") {
                    out.push_str(" in enemy territory");
                }
                if let Some(e) = ps(tf, "exclude") {
                    out.push_str(&format!(" (excluding {})", dekebab(e)));
                }
            }
            if let Some(w) = ps(p, "window") {
                out.push_str(&format!(" {}", dekebab(w)));
            }
            out
        }
        T::ObjectiveHasTag => {
            let mut out = format!(
                "{negate}{} tagged {}",
                count(pu(p, "count_min", 1), "objective"),
                dekebab(ps(p, "tag").unwrap_or(""))
            );
            if let Some(cm) = p.get("count_max").and_then(Value::as_u64) {
                out.push_str(&format!(" (at most {cm})"));
            }
            if let Some(o) = ps(p, "objective") {
                out.push_str(&format!(" ({})", dekebab(o)));
            }
            if let Some(sc) = ps(p, "scope") {
                out.push_str(&format!(" in {}", dekebab(sc)));
            }
            if pb(p, "last_marked") {
                out.push_str(" (most recently marked)");
            }
            out
        }
        T::UnitHasTag => {
            let mut out = format!(
                "{negate}{} tagged {}",
                count(
                    pu(p, "count_min", 1),
                    &format!("{} unit", ps(p, "side").unwrap_or(""))
                ),
                dekebab(ps(p, "tag").unwrap_or(""))
            );
            if let Some(w) = ps(p, "window") {
                out.push_str(&format!(" ({})", dekebab(w)));
            }
            out
        }
        T::TerrainHasTag => {
            let mut out = format!(
                "{negate}terrain tagged {}",
                dekebab(ps(p, "tag").unwrap_or(""))
            );
            if let Some(fm) = p.get("friendly_units_min").and_then(Value::as_u64) {
                out.push_str(&format!(" with {fm}+ friendly units"));
            }
            if let Some(em) = p.get("enemy_units_max").and_then(Value::as_u64) {
                out.push_str(&format!(" and at most {em} enemy units"));
            }
            if pb(p, "last_marked") {
                out.push_str(" (most recently marked)");
            }
            if pb(p, "in_enemy_dz") {
                out.push_str(" in the enemy deployment zone");
            }
            out
        }
        T::TerrainAreaControl => format!(
            "{negate}you control a terrain area with {}+ models",
            pu(p, "min_models", 1)
        ),
        T::TerritoryControl => {
            let mut out = format!(
                "{negate}you control {}",
                dekebab(ps(p, "territory_ref").unwrap_or("your-territory"))
            );
            if let Some(em) = p.get("enemy_units_max").and_then(Value::as_u64) {
                out.push_str(&format!(" with at most {em} enemy units"));
            }
            out
        }
        T::EngagementFronts => {
            format!(
                "{negate}you are engaged on {}+ fronts",
                pu(p, "count_min", 1)
            )
        }

        // Schema types with no scoring usage today — match the TS `dekebab(type)`
        // fallback so a stray occurrence still round-trips identically.
        T::EngagementState => format!("{negate}engagement state"),
        T::FightsFirst => format!("{negate}fights first"),
        T::DispositionMatches => format!("{negate}disposition matches"),
    }
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

    fn simple(type_: SimpleConditionType, params: Value) -> Condition {
        let parameters = params.as_object().cloned().unwrap_or_default();
        Condition(ConditionNode::SimpleCondition(SimpleCondition {
            negated: false,
            parameters,
            type_,
        }))
    }

    #[test]
    fn condition_phrases() {
        assert_eq!(
            describe_condition(&simple(
                SimpleConditionType::ControlsObjective,
                serde_json::json!({ "objective_role": "central", "count_min": 1 })
            )),
            "you control 1+ central objectives"
        );
        assert_eq!(
            describe_condition(&simple(
                SimpleConditionType::ObjectiveMajority,
                serde_json::json!({ "relative_to": "opponent" })
            )),
            "you hold more objectives than the opponent"
        );
        assert_eq!(
            describe_condition(&simple(
                SimpleConditionType::UnitsDestroyed,
                serde_json::json!({ "side": "enemy", "window": "this-turn", "count_min": 1 })
            )),
            "1+ enemy units destroyed this turn"
        );
    }
}
