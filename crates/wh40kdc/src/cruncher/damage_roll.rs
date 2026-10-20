//! Per-attack damage as an exact distribution over the Damage roll.
//!
//! Mirrors `tools/src/cruncher/damage-roll.ts`. A Damage characteristic is
//! either fixed (`3`) or a dice expression (`D6`, `2D3`, `D6+1`). Each rolled
//! total passes through the same transform the engine applies to every
//! attack: add Melta and the damage modifier, floor at 0, then subtract damage
//! reduction to a minimum of 1 when reduction is active. The expectation is
//! taken over that transformed value, so a floor or a reduction acts on each
//! roll rather than on the mean.

use super::buffs::RerollSubset;
use serde_json::Value;

use super::engine::CruncherError;
use crate::StatValue;

/// Inputs to [`damage_roll`].
#[derive(Clone, Debug)]
pub(crate) struct DamageRollInput<'a> {
    /// The profile's printed D: a number or a dice expression.
    pub stat: &'a StatValue,
    /// Flat bonus added after the roll (Melta at half range).
    pub bonus: f64,
    /// Summed damage modifier.
    pub modifier: f64,
    /// Defender damage reduction; 0 when inactive.
    pub reduction: f64,
    /// Damage-roll reroll permission, if any.
    pub reroll: Option<RerollSubset>,
}

/// Per-attack damage outcome.
#[derive(Clone, Debug)]
pub(crate) struct DamageRoll {
    /// Probability of each final per-attack damage value, ascending by value.
    pub distribution: Vec<(f64, f64)>,
    pub expected: f64,
    /// Whether the reroll permission changed any outcome.
    pub reroll_used: bool,
}

#[derive(Clone, Copy, Debug)]
struct DiceExpression {
    count: usize,
    die: usize,
    offset: f64,
}

enum ParsedDamage {
    Fixed(f64),
    Dice(DiceExpression),
}

fn parse_damage(stat: &StatValue) -> Result<ParsedDamage, CruncherError> {
    match stat {
        StatValue::Integer(n) => Ok(ParsedDamage::Fixed(*n as f64)),
        StatValue::DiceExpression(s) => parse_quantity_str(s),
    }
}

/// Parses a keyword-parameter or characteristic value: a finite number or a
/// string holding a number or dice expression. Anything else is unresolved.
fn parse_quantity(stat: &Value) -> Result<ParsedDamage, CruncherError> {
    match stat {
        Value::Number(n) => n
            .as_f64()
            .filter(|value| value.is_finite())
            .map(ParsedDamage::Fixed)
            .ok_or_else(|| CruncherError::ParseStat(n.to_string())),
        Value::String(s) => parse_quantity_str(s),
        other => Err(CruncherError::ParseStat(other.to_string())),
    }
}

fn parse_quantity_str(raw: &str) -> Result<ParsedDamage, CruncherError> {
    let err = || CruncherError::ParseStat(raw.to_string());
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(err());
    }
    if let Ok(n) = trimmed.parse::<f64>() {
        return if n.is_finite() {
            Ok(ParsedDamage::Fixed(n))
        } else {
            Err(err())
        };
    }
    parse_dice_expression(trimmed)
        .map(ParsedDamage::Dice)
        .ok_or_else(err)
}

/// Parses `^(\d*)D(\d+)([+-]\d+)?$` (case-insensitive `D`).
fn parse_dice_expression(input: &str) -> Option<DiceExpression> {
    let split = input.find(['D', 'd'])?;
    let (count_str, rest) = (&input[..split], &input[split + 1..]);
    if !count_str.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let die_end = rest
        .bytes()
        .position(|b| !b.is_ascii_digit())
        .unwrap_or(rest.len());
    let (die_str, offset_str) = rest.split_at(die_end);
    if die_str.is_empty() {
        return None;
    }
    let offset = if offset_str.is_empty() {
        0.0
    } else {
        let (sign, digits) = match offset_str.as_bytes()[0] {
            b'+' => (1.0, &offset_str[1..]),
            b'-' => (-1.0, &offset_str[1..]),
            _ => return None,
        };
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        sign * digits.parse::<f64>().ok()?
    };
    let count = if count_str.is_empty() {
        1
    } else {
        count_str.parse().ok()?
    };
    Some(DiceExpression {
        count,
        die: die_str.parse().ok()?,
        offset,
    })
}

/// Exact distribution of a quantity characteristic (a number or a dice
/// expression such as `D6+1`), as (value, probability) ascending by value.
pub fn quantity_distribution(stat: &Value) -> Result<Vec<(f64, f64)>, CruncherError> {
    Ok(match parse_quantity(stat)? {
        ParsedDamage::Fixed(n) => vec![(n, 1.0)],
        ParsedDamage::Dice(dice) => dice_totals(dice.count, dice.die)
            .into_iter()
            .map(|(total, probability)| (total as f64 + dice.offset, probability))
            .collect(),
    })
}

/// Distribution of the summed dice, as (total, probability) ascending by total.
fn dice_totals(count: usize, die: usize) -> Vec<(usize, f64)> {
    let mut totals = vec![1.0];
    for _ in 0..count {
        let mut next = vec![0.0; totals.len() + die];
        for (total, probability) in totals.iter().enumerate() {
            if *probability == 0.0 {
                continue;
            }
            for face in 1..=die {
                next[total + face] += probability / die as f64;
            }
        }
        totals = next;
    }
    totals
        .into_iter()
        .enumerate()
        .filter(|(_, probability)| *probability > 0.0)
        .collect()
}

/// Exact per-attack damage. A reroll replaces a roll only when the
/// replacement's expected final damage exceeds the kept roll's, which is the
/// optimal one-shot policy. `Ones` permits rerolling a dice total of 1, so it
/// can only act on a single die; `AllFailures` permits rerolling any total.
pub(crate) fn damage_roll(input: &DamageRollInput<'_>) -> Result<DamageRoll, CruncherError> {
    let final_value = |rolled: f64| {
        let before_reduction = (rolled + input.bonus + input.modifier).max(0.0);
        if input.reduction > 0.0 {
            (before_reduction - input.reduction).max(1.0)
        } else {
            before_reduction
        }
    };
    let dice = match parse_damage(input.stat)? {
        ParsedDamage::Fixed(n) => {
            let value = final_value(n);
            return Ok(DamageRoll {
                distribution: vec![(value, 1.0)],
                expected: value,
                reroll_used: false,
            });
        }
        ParsedDamage::Dice(dice) => dice,
    };
    let totals = dice_totals(dice.count, dice.die);
    let roll_value = |total: usize| final_value(total as f64 + dice.offset);
    let fresh: f64 = totals
        .iter()
        .map(|&(total, probability)| probability * roll_value(total))
        .sum();
    // Insertion-ordered (value, probability) pairs, merged on exact value.
    let mut outcomes: Vec<(f64, f64)> = Vec::new();
    let mut add = |value: f64, probability: f64| match outcomes
        .iter_mut()
        .find(|(existing, _)| *existing == value)
    {
        Some((_, p)) => *p += probability,
        None => outcomes.push((value, probability)),
    };
    let mut reroll_used = false;
    for &(total, probability) in &totals {
        let kept = roll_value(total);
        let eligible = match input.reroll {
            Some(RerollSubset::AllFailures) => true,
            Some(RerollSubset::Ones) => total == 1,
            None => false,
        };
        if eligible && kept < fresh {
            reroll_used = true;
            for &(again, again_probability) in &totals {
                add(roll_value(again), probability * again_probability);
            }
        } else {
            add(kept, probability);
        }
    }
    outcomes.sort_by(|(left, _), (right, _)| left.total_cmp(right));
    let expected = outcomes
        .iter()
        .map(|(value, probability)| value * probability)
        .sum();
    Ok(DamageRoll {
        distribution: outcomes,
        expected,
        reroll_used,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roll(
        stat: StatValue,
        modifier: f64,
        reduction: f64,
        reroll: Option<RerollSubset>,
    ) -> DamageRoll {
        damage_roll(&DamageRollInput {
            stat: &stat,
            bonus: 0.0,
            modifier,
            reduction,
            reroll,
        })
        .expect("damage parses")
    }

    fn dice(s: &str) -> StatValue {
        StatValue::DiceExpression(s.parse().expect("valid dice expression"))
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-12,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn keeps_the_printed_mean_when_nothing_clamps() {
        assert_close(roll(dice("D6+1"), 0.0, 0.0, None).expected, 4.5);
        assert_close(roll(dice("2D3"), 0.0, 0.0, None).expected, 4.0);
        assert_eq!(roll(StatValue::Integer(3), 0.0, 0.0, None).expected, 3.0);
    }

    #[test]
    fn floors_each_roll_at_zero_not_the_mean() {
        // D3-2 rolls 0, 0, 1; the mean-then-floor shortcut gives 0.
        assert_close(roll(dice("D3"), -2.0, 0.0, None).expected, 1.0 / 3.0);
    }

    #[test]
    fn applies_reduction_to_each_roll_with_a_minimum_of_one() {
        assert_close(roll(dice("D6"), 0.0, 3.0, None).expected, 1.5);
        // A fixed 0 still rises to 1 under active reduction.
        assert_eq!(roll(StatValue::Integer(1), -1.0, 1.0, None).expected, 1.0);
    }

    #[test]
    fn rerolls_only_totals_whose_final_damage_is_below_the_fresh_mean() {
        let rolled = roll(dice("D6"), 0.0, 0.0, Some(RerollSubset::AllFailures));
        assert_close(rolled.expected, 4.25);
        assert!(rolled.reroll_used);
        assert_close(rolled.distribution.iter().map(|(_, p)| p).sum(), 1.0);
    }

    #[test]
    fn limits_a_ones_reroll_to_a_single_die_showing_one() {
        assert_close(
            roll(dice("D6"), 0.0, 0.0, Some(RerollSubset::Ones)).expected,
            3.5 + 2.5 / 6.0,
        );
        // A 2D6 total can never be 1.
        let pair = roll(dice("2D6"), 0.0, 0.0, Some(RerollSubset::Ones));
        assert_close(pair.expected, 7.0);
        assert!(!pair.reroll_used);
    }

    #[test]
    fn never_rerolls_a_fixed_characteristic_or_a_roll_already_at_the_clamp() {
        let fixed = roll(
            StatValue::Integer(2),
            0.0,
            0.0,
            Some(RerollSubset::AllFailures),
        );
        assert_eq!(fixed.expected, 2.0);
        assert!(!fixed.reroll_used);
        // D3 under reduction 3 is always 1: rerolling cannot help.
        let clamped = roll(dice("D3"), 0.0, 3.0, Some(RerollSubset::AllFailures));
        assert_eq!(clamped.expected, 1.0);
        assert!(!clamped.reroll_used);
    }
}
