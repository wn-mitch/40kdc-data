//! Complementary re-roll pairs in a sequence ("C: A", "not C: B") whose condition is undecided.
//! Mirrors `complementaryFloors` in `tools/src/cruncher/from-dsl.ts`.

use serde_json::Value;

use super::js::*;
use super::levers::evaluate_condition;
use super::WalkOpts;

/// The reason the stronger of a complementary re-roll pair is reported under while its condition
/// is undecided.
pub(super) const COMPLEMENT_REASON: &str = "conditional: the stronger re-roll of a complementary pair needs its undecided condition; the weaker applies";

/// A step's role in a complementary pair.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Floor {
    /// Applied without its condition.
    Weaker,
    /// Reported as needing its condition.
    Stronger,
}

/// How much of a roll a re-roll covers: a re-roll of a higher rank re-rolls every die a lower one
/// does.
fn reroll_rank(modifier: &Obj) -> Option<u8> {
    if is_str(modifier, "result_scope", "any-result") {
        return Some(4);
    }
    match modifier.get("subset").and_then(Value::as_str) {
        Some("ones") => Some(1),
        Some("ones-and-twos") => Some(2),
        Some("all-failures") => Some(3),
        _ => None,
    }
}

/// The re-roll effect's target and modifier without its coverage, which two comparable re-rolls
/// share, with its rank.
fn reroll_identity(effect: Option<&Value>) -> Option<((Option<Value>, Obj), u8)> {
    let effect = effect?.as_object()?;
    if !is_str(effect, "type", "re-roll") {
        return None;
    }
    let modifier = effect.get("modifier")?.as_object()?;
    let rank = reroll_rank(modifier)?;
    let mut rest = modifier.clone();
    rest.remove("subset");
    rest.remove("result_scope");
    Some(((effect.get("target").cloned(), rest), rank))
}

/// The operand of a single-operand `not`.
fn negation_of(condition: Option<&Value>) -> Option<&Value> {
    let condition = condition?.as_object()?;
    if !is_str(condition, "operator", "not") {
        return None;
    }
    match condition.get("operands").and_then(Value::as_array) {
        Some(operands) if operands.len() == 1 => operands.first(),
        _ => None,
    }
}

/// Steps of a sequence that form complementary conditionals whose condition is undecided and
/// whose effects are re-rolls of the same roll, one covering the other. Exactly one of them
/// applies, so the weaker always does. Pairs are taken left to right; a paired step is not paired
/// again.
pub(super) fn complementary_floors(steps: &[Value], opts: &WalkOpts) -> Vec<Option<Floor>> {
    let mut floors: Vec<Option<Floor>> = vec![None; steps.len()];
    for left in 0..steps.len() {
        for right in left + 1..steps.len() {
            if floors[left].is_some() || floors[right].is_some() {
                continue;
            }
            let (Some(a), Some(b)) = (steps[left].as_object(), steps[right].as_object()) else {
                continue;
            };
            if !is_str(a, "type", "conditional") || !is_str(b, "type", "conditional") {
                continue;
            }
            let (ac, bc) = (a.get("condition"), b.get("condition"));
            let positive = if negation_of(ac).is_some() && negation_of(ac) == bc {
                bc
            } else if negation_of(bc).is_some() && negation_of(bc) == ac {
                ac
            } else {
                None
            };
            let Some(positive) = positive.and_then(Value::as_object) else {
                continue;
            };
            if evaluate_condition(positive, opts).is_some() {
                continue;
            }
            let (Some((id_a, rank_a)), Some((id_b, rank_b))) = (
                reroll_identity(a.get("effect")),
                reroll_identity(b.get("effect")),
            ) else {
                continue;
            };
            if id_a != id_b {
                continue;
            }
            let left_weaker = rank_a <= rank_b;
            floors[left] = Some(if left_weaker {
                Floor::Weaker
            } else {
                Floor::Stronger
            });
            floors[right] = Some(if left_weaker {
                Floor::Stronger
            } else {
                Floor::Weaker
            });
        }
    }
    floors
}
