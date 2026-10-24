//! The discrete allocation stage: what one shooting or fighting unit's attacks
//! do to the models of the target unit, as an exact distribution rather than
//! an expected value.
//!
//! Mirrors `tools/src/cruncher/allocation.ts`. Each attack that gets through
//! deals its Damage to one model; damage beyond that model's remaining wounds
//! is lost, and an already damaged model takes the next attack. Feel No Pain
//! rolls once for each wound that would be lost. Devastating Wounds mortal
//! wounds are inflicted after all normal damage and also damage at most one
//! model each, the rest being lost.
//!
//! The state is (models alive, wounds left on the damaged model). Event counts
//! come from the exact joint distribution of normal and mortal damage events
//! per attack, so Sustained Hits, Lethal Hits and Devastating Wounds keep
//! their correlation within an attack. Arithmetic runs in the same order as
//! the TS reference so the two agree to the last few ulps.

use std::fmt;

use serde::Serialize;

use super::damage_roll::quantity_distribution;
use super::engine::{crunch_model, AttackModel, CruncherError, EngineInput};
use crate::data::Dataset;

/// The allocation result. Serializes with the runner's camelCase keys.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllocationOutput {
    /// Expected wounds removed from the target unit.
    pub damage_dealt: f64,
    pub models_destroyed: f64,
    /// Probability of each number of models destroyed, from 0 to the unit's size.
    pub models_destroyed_distribution: Vec<f64>,
}

/// Failures of [`allocate`]: the crunch itself failed, or a quantity the
/// allocation counts in whole units resolved to a fraction.
#[derive(Clone, Debug)]
pub enum AllocationError {
    Crunch(CruncherError),
    NotWhole { what: &'static str, value: f64 },
}

impl fmt::Display for AllocationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Crunch(e) => e.fmt(f),
            Self::NotWhole { what, value } => {
                write!(f, "allocate: {what} must be a whole number, got {value}")
            }
        }
    }
}

impl std::error::Error for AllocationError {}

impl From<CruncherError> for AllocationError {
    fn from(e: CruncherError) -> Self {
        Self::Crunch(e)
    }
}

/// Probabilities indexed `[normal events][mortal events]`.
type Joint = Vec<Vec<f64>>;

fn joint(rows: usize, columns: usize) -> Joint {
    vec![vec![0.0; columns]; rows]
}

fn convolve(left: &Joint, right: &Joint) -> Joint {
    let mut out = joint(
        left.len() + right.len() - 1,
        left[0].len() + right[0].len() - 1,
    );
    for (k, row) in left.iter().enumerate() {
        for (j, &p) in row.iter().enumerate() {
            if p == 0.0 {
                continue;
            }
            for (k2, other) in right.iter().enumerate() {
                for (j2, &q) in other.iter().enumerate() {
                    if q != 0.0 {
                        out[k + k2][j + j2] += p * q;
                    }
                }
            }
        }
    }
    out
}

fn power(base: &Joint, times: i64) -> Joint {
    let mut out: Joint = vec![vec![1.0]];
    for _ in 0..times.max(0) {
        out = convolve(&out, base);
    }
    out
}

/// `into + weight * from`, grown to cover both.
fn add(into: &Joint, from: &Joint, weight: f64) -> Joint {
    let mut grown = joint(into.len().max(from.len()), into[0].len().max(from[0].len()));
    for (k, row) in into.iter().enumerate() {
        for (j, &p) in row.iter().enumerate() {
            grown[k][j] += p;
        }
    }
    for (k, row) in from.iter().enumerate() {
        for (j, &p) in row.iter().enumerate() {
            grown[k][j] += weight * p;
        }
    }
    grown
}

fn integral(value: f64, what: &'static str) -> Result<i64, AllocationError> {
    if value.is_finite() && value.fract() == 0.0 {
        Ok(value as i64)
    } else {
        Err(AllocationError::NotWhole { what, value })
    }
}

/// Distribution of one attack's normal and mortal damage events.
fn per_attack(model: &AttackModel) -> Result<Joint, AllocationError> {
    let normal_wound = model.wound.pass - model.wound.crit;
    let to_main = (normal_wound
        + if model.devastating {
            0.0
        } else {
            model.wound.crit
        })
        * model.unsaved;
    let to_mortal = if model.devastating {
        model.wound.crit
    } else {
        0.0
    };
    let wound_roll: Joint = vec![
        vec![1.0 - to_main - to_mortal, to_mortal],
        vec![to_main, 0.0],
    ];
    let auto_wound: Joint = vec![vec![1.0 - model.unsaved], vec![model.unsaved]];
    let normal_hit = if model.torrent {
        1.0
    } else {
        model.hit.pass - model.hit.crit
    };
    let crit_hit = if model.torrent { 0.0 } else { model.hit.crit };
    let mut out = joint(1, 1);
    out[0][0] = 1.0 - normal_hit - crit_hit;
    let mut result = add(&out, &wound_roll, normal_hit);
    if crit_hit > 0.0 {
        let first = if model.lethal {
            &auto_wound
        } else {
            &wound_roll
        };
        let extras = match &model.sustained_stat {
            None => vec![(0.0, 1.0)],
            Some(stat) => quantity_distribution(stat)?,
        };
        for (count, probability) in extras {
            let extra_hits = power(&wound_roll, integral(count, "Sustained Hits")?);
            result = add(
                &result,
                &convolve(first, &extra_hits),
                crit_hit * probability,
            );
        }
    }
    Ok(result)
}

/// Insertion-ordered `count → probability` pairs: iteration order fixes the
/// summation order, matching the TS `Map`.
#[derive(Default)]
struct Counts(Vec<(i64, f64)>);

impl Counts {
    fn add(&mut self, key: i64, probability: f64) {
        match self.0.iter_mut().find(|(existing, _)| *existing == key) {
            Some((_, p)) => *p += probability,
            None => self.0.push((key, probability)),
        }
    }

    fn get(&self, key: i64) -> f64 {
        self.0
            .iter()
            .find(|(existing, _)| *existing == key)
            .map_or(0.0, |(_, p)| *p)
    }
}

/// Distribution of the unit's total attacks: each model rolls its own Attacks.
fn attack_counts(model: &AttackModel) -> Result<Counts, AllocationError> {
    let mut one = Counts::default();
    let rapid = match &model.rapid_fire_stat {
        None => vec![(0.0, 1.0)],
        Some(stat) => quantity_distribution(stat)?,
    };
    for (attacks, p) in quantity_distribution(&model.attacks_stat)? {
        for &(extra, q) in &rapid {
            let total = integral(attacks + extra + model.attacks_bonus, "Attacks")?.max(0);
            one.add(total, p * q);
        }
    }
    let mut all = Counts(vec![(0, 1.0)]);
    for _ in 0..model.models_firing {
        let mut next = Counts::default();
        for &(sum, p) in &all.0 {
            for &(count, q) in &one.0 {
                next.add(sum + count, p * q);
            }
        }
        all = next;
    }
    Ok(all)
}

fn binomial(trials: i64, successes: i64, p: f64) -> f64 {
    let mut coefficient = 1.0;
    for index in 0..successes {
        coefficient = coefficient * (trials - index) as f64 / (index + 1) as f64;
    }
    coefficient * p.powf(successes as f64) * (1.0 - p).powf((trials - successes) as f64)
}

/// Distribution of wounds one event removes before the damaged model's
/// remaining wounds cap it: each wound is lost with probability `lost`.
fn wounds_lost(model: &AttackModel, lost: f64) -> Result<Vec<f64>, AllocationError> {
    let mut out: Vec<f64> = Vec::new();
    for &(value, probability) in &model.damage {
        let damage = integral(value, "Damage")?;
        for removed in 0..=damage {
            let index = removed as usize;
            if out.len() <= index {
                out.resize(index + 1, 0.0);
            }
            out[index] += probability * binomial(damage, removed, lost);
        }
    }
    Ok(out)
}

/// Exact allocation of an attacking unit's damage into the target's models.
/// The dataset defaults to [`Dataset::embedded`] when `None`, as for
/// [`crunch`](super::crunch).
pub fn allocate(
    input: &EngineInput,
    dataset: Option<&Dataset>,
) -> Result<AllocationOutput, AllocationError> {
    let (_, model) = crunch_model(input, dataset)?;
    allocate_model(&model)
}

/// [`allocate`] from an already computed [`AttackModel`].
pub fn allocate_model(model: &AttackModel) -> Result<AllocationOutput, AllocationError> {
    let models = model.model_count as usize;
    let wounds = model.wounds as usize;
    if models == 0 || wounds == 0 {
        return Ok(AllocationOutput {
            damage_dealt: 0.0,
            models_destroyed: 0.0,
            models_destroyed_distribution: vec![1.0],
        });
    }
    let dead = models * wounds;
    // Alive state (m, w) is (m - 1) * wounds + (w - 1); `dead` absorbs.
    let step = |state: &[f64], removed: &[f64]| -> Vec<f64> {
        let mut out = vec![0.0; dead + 1];
        out[dead] = state[dead];
        for (id, &p) in state.iter().enumerate().take(dead) {
            if p == 0.0 {
                continue;
            }
            let alive = id / wounds + 1;
            let left = id % wounds + 1;
            for (amount, &q) in removed.iter().enumerate() {
                if q == 0.0 {
                    continue;
                }
                let next = if amount == 0 {
                    id
                } else if amount < left {
                    id - amount
                } else if alive == 1 {
                    dead
                } else {
                    (alive - 2) * wounds + (wounds - 1)
                };
                out[next] += p * q;
            }
        }
        out
    };

    let events = {
        let per = per_attack(model)?;
        let mut total: Joint = vec![vec![0.0]];
        let mut acc: Joint = vec![vec![1.0]];
        let counts = attack_counts(model)?;
        let most = counts.0.iter().map(|(count, _)| *count).max().unwrap_or(0);
        for attacks in 0..=most {
            let weight = counts.get(attacks);
            if weight > 0.0 {
                total = add(&total, &acc, weight);
            }
            if attacks < most {
                acc = convolve(&acc, &per);
            }
        }
        total
    };

    let normal = wounds_lost(model, model.wound_lost)?;
    let mortal = wounds_lost(model, model.mortal_wound_lost)?;
    let mut state = vec![0.0; dead + 1];
    state[(models - 1) * wounds + (wounds - 1)] = 1.0;
    let mut finals = vec![0.0; dead + 1];
    for (normal_events, row) in events.iter().enumerate() {
        if normal_events > 0 {
            state = step(&state, &normal);
        }
        if !row.iter().any(|&p| p > 0.0) {
            continue;
        }
        let mut after = state.clone();
        for (mortal_events, &p) in row.iter().enumerate() {
            if mortal_events > 0 {
                after = step(&after, &mortal);
            }
            if p > 0.0 {
                for (id, &q) in after.iter().enumerate() {
                    finals[id] += p * q;
                }
            }
        }
    }

    let mut destroyed = vec![0.0; models + 1];
    let mut damage_dealt = 0.0;
    for (id, &p) in finals.iter().enumerate() {
        let alive = if id == dead { 0 } else { id / wounds + 1 };
        let remaining = if id == dead {
            0
        } else {
            (alive - 1) * wounds + id % wounds + 1
        };
        destroyed[models - alive] += p;
        damage_dealt += p * (dead - remaining) as f64;
    }
    let models_destroyed = destroyed
        .iter()
        .enumerate()
        .fold(0.0, |sum, (count, &p)| sum + p * count as f64);
    Ok(AllocationOutput {
        damage_dealt,
        models_destroyed,
        models_destroyed_distribution: destroyed,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;
    use crate::cruncher::engine::RollProbabilities;

    /// An attack model that always hits, wounds and goes unsaved.
    fn model() -> AttackModel {
        AttackModel {
            models_firing: 1,
            attacks_stat: json!(1),
            attacks_bonus: 0.0,
            rapid_fire_stat: None,
            torrent: false,
            hit: RollProbabilities {
                pass: 1.0,
                crit: 0.0,
            },
            sustained_stat: None,
            lethal: false,
            wound: RollProbabilities {
                pass: 1.0,
                crit: 0.0,
            },
            devastating: false,
            unsaved: 1.0,
            damage: vec![(1.0, 1.0)],
            wound_lost: 1.0,
            mortal_wound_lost: 1.0,
            wounds: 1,
            model_count: 1,
        }
    }

    fn assert_close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() < tolerance,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn loses_damage_beyond_the_damaged_model_and_carries_a_wound_over() {
        // Two D2 attacks into one 3-wound model: 2, then 1 more kills it and 1 is lost.
        let out = allocate_model(&AttackModel {
            attacks_stat: json!(2),
            damage: vec![(2.0, 1.0)],
            wounds: 3,
            model_count: 2,
            ..model()
        })
        .expect("whole quantities");
        assert_close(out.damage_dealt, 3.0, 1e-12);
        assert_close(out.models_destroyed, 1.0, 1e-12);
        assert_eq!(out.models_destroyed_distribution, vec![0.0, 1.0, 0.0]);
    }

    #[test]
    fn caps_at_the_unit_and_matches_the_expected_value_when_nothing_is_lost() {
        let open = AttackModel {
            attacks_stat: Value::String("2D6".into()),
            hit: RollProbabilities {
                pass: 2.0 / 3.0,
                crit: 1.0 / 6.0,
            },
            wound: RollProbabilities {
                pass: 1.0 / 2.0,
                crit: 1.0 / 6.0,
            },
            unsaved: 2.0 / 3.0,
            model_count: 40,
            ..model()
        };
        // E[attacks] * P(hit) * P(wound) * P(unsaved), with no model ever close to running out.
        let expected = 7.0 * (2.0 / 3.0) * (1.0 / 2.0) * (2.0 / 3.0);
        assert_close(allocate_model(&open).unwrap().damage_dealt, expected, 1e-9);
        let capped = allocate_model(&AttackModel {
            model_count: 1,
            ..open
        })
        .unwrap();
        assert!(capped.damage_dealt <= 1.0);
        let total: f64 = capped.models_destroyed_distribution.iter().sum();
        assert_close(total, 1.0, 1e-12);
    }

    #[test]
    fn inflicts_devastating_wounds_after_normal_damage_with_their_own_feel_no_pain() {
        // A normal wound always lands before a mortal one, so a 1-model unit dies to the
        // normal wound and the mortal wound is lost; mortal-only Feel No Pain cannot change that.
        let out = allocate_model(&AttackModel {
            attacks_stat: json!(2),
            wound: RollProbabilities {
                pass: 1.0,
                crit: 0.5,
            },
            devastating: true,
            mortal_wound_lost: 0.5,
            ..model()
        })
        .unwrap();
        // Only both attacks critting leaves the model to two mortal wounds: 1 - 0.25 * (0.5 * 0.5).
        assert_close(out.models_destroyed, 1.0 - 0.25 * 0.25, 1e-12);
    }

    #[test]
    fn rejects_a_fractional_quantity_instead_of_rounding_it() {
        let err = allocate_model(&AttackModel {
            damage: vec![(1.5, 1.0)],
            ..model()
        })
        .expect_err("fractional Damage");
        assert!(matches!(
            err,
            AllocationError::NotWhole { what: "Damage", .. }
        ));
        let err = allocate_model(&AttackModel {
            attacks_bonus: 0.5,
            ..model()
        })
        .expect_err("fractional Attacks");
        assert!(matches!(
            err,
            AllocationError::NotWhole {
                what: "Attacks",
                ..
            }
        ));
    }
}
