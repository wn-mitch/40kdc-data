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
//! The state is (models alive, wounds left on the damaged model, zeroing uses
//! left). Event counts come from the exact joint distribution of normal and
//! mortal damage events per attack, so Sustained Hits, Lethal Hits and
//! Devastating Wounds keep their correlation within an attack. Arithmetic runs
//! in the same order as the TS reference so the two agree to the last few
//! ulps.
//!
//! A damage-zeroing defence changes an unsaved attack's Damage to 0 before it
//! is rolled. Every normal damage event has the same Damage distribution, so
//! the defender spends a use on the first event it can: for this activation no
//! later choice does better. Mortal-wound events are not attacks with a Damage
//! characteristic and are never zeroed.

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

/// Whose uses a [`DamageZeroing`] defence counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ZeroingPer {
    /// One pool shared by the unit.
    Unit,
    /// `uses` for each model, refilled when the next model takes the attacks.
    Model,
}

/// A defence that changes the Damage of an attack allocated to the target to
/// 0, `uses` times.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DamageZeroing {
    pub uses: usize,
    pub per: ZeroingPer,
}

impl DamageZeroing {
    /// Reads the wire shape `{"uses": N, "per": "unit" | "model"}`.
    pub fn from_json(value: &serde_json::Value) -> Result<Self, AllocationError> {
        let per = match value.get("per").and_then(serde_json::Value::as_str) {
            Some("unit") => ZeroingPer::Unit,
            Some("model") => ZeroingPer::Model,
            other => {
                return Err(AllocationError::InvalidZeroing(format!(
                    "zeroing per must be \"unit\" or \"model\", got {}",
                    other.unwrap_or("none")
                )))
            }
        };
        let Some(uses) = value.get("uses").and_then(serde_json::Value::as_f64) else {
            return Err(AllocationError::InvalidZeroing(
                "zeroing uses must be a number".into(),
            ));
        };
        let uses = integral(uses, "zeroing uses")?;
        if uses < 0 {
            return Err(AllocationError::InvalidZeroing(format!(
                "zeroing uses must not be negative, got {uses}"
            )));
        }
        Ok(Self {
            uses: uses as usize,
            per,
        })
    }
}

/// Defender options that act on individual attacks, which only the
/// allocation stage sees.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AllocationDefences {
    pub zeroing: Option<DamageZeroing>,
}

/// The largest event table the exact computation builds, measured as attacks
/// × table rows × table columns. Past it the allocation is refused rather
/// than approximated.
pub const MAX_EVENT_WORK: u64 = 1_000_000;

/// Failures of [`allocate`]: the crunch itself failed, a quantity the
/// allocation counts in whole units resolved to a fraction, or the event table
/// would pass [`MAX_EVENT_WORK`].
#[derive(Clone, Debug)]
pub enum AllocationError {
    Crunch(CruncherError),
    NotWhole { what: &'static str, value: f64 },
    TooManyAttacks { attacks: i64, work: u64 },
    InvalidZeroing(String),
}

impl fmt::Display for AllocationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Crunch(e) => e.fmt(f),
            Self::NotWhole { what, value } => {
                write!(f, "allocate: {what} must be a whole number, got {value}")
            }
            Self::InvalidZeroing(detail) => write!(f, "allocate: {detail}"),
            Self::TooManyAttacks { attacks, work } => write!(
                f,
                "allocate: {attacks} attacks exceed the exact allocation bound (work {work} > {MAX_EVENT_WORK})"
            ),
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

/// `table` without trailing all-zero rows and columns; convolution skips
/// zeros, so the nonzero values are unchanged.
fn trim(table: Joint) -> Joint {
    let mut rows = table.len();
    while rows > 1 && table[rows - 1].iter().all(|&p| p == 0.0) {
        rows -= 1;
    }
    let mut columns = table[0].len();
    while columns > 1 && table[..rows].iter().all(|row| row[columns - 1] == 0.0) {
        columns -= 1;
    }
    table[..rows]
        .iter()
        .map(|row| row[..columns].to_vec())
        .collect()
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
    let split = model.critical_wound.as_ref().filter(|_| !model.devastating);
    let to_main = (normal_wound
        + if model.devastating || split.is_some() {
            0.0
        } else {
            model.wound.crit
        })
        * model.unsaved;
    let to_second = match split {
        _ if model.devastating => model.wound.crit,
        Some(critical) => model.wound.crit * critical.unsaved,
        None => 0.0,
    };
    let wound_roll: Joint = vec![
        vec![1.0 - to_main - to_second, to_second],
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
fn wounds_lost(damage_roll: &[(f64, f64)], lost: f64) -> Result<Vec<f64>, AllocationError> {
    let mut out: Vec<f64> = Vec::new();
    for &(value, probability) in damage_roll {
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
    allocate_with(input, dataset, &AllocationDefences::default())
}

/// [`allocate`] against the target's per-attack defences.
///
/// Without an explicit `defences.zeroing`, the input's `damage-zeroing` buffs
/// supply it.
pub fn allocate_with(
    input: &EngineInput,
    dataset: Option<&Dataset>,
    defences: &AllocationDefences,
) -> Result<AllocationOutput, AllocationError> {
    let (output, model) = crunch_model(input, dataset)?;
    if defences.zeroing.is_some() {
        return allocate_model_with(&model, defences);
    }
    let zeroing = &output.resolved.damage_zeroing;
    let derived = match (zeroing.unit, zeroing.model) {
        (0, 0) => None,
        (uses, 0) => Some(DamageZeroing {
            uses,
            per: ZeroingPer::Unit,
        }),
        (0, uses) => Some(DamageZeroing {
            uses,
            per: ZeroingPer::Model,
        }),
        _ => {
            return Err(AllocationError::InvalidZeroing(
                "unit-wide and per-model damage zeroing together are not modelled".into(),
            ))
        }
    };
    allocate_model_with(&model, &AllocationDefences { zeroing: derived })
}

/// [`allocate`] from an already computed [`AttackModel`].
pub fn allocate_model(model: &AttackModel) -> Result<AllocationOutput, AllocationError> {
    allocate_model_with(model, &AllocationDefences::default())
}

/// [`allocate_with`] from an already computed [`AttackModel`].
pub fn allocate_model_with(
    model: &AttackModel,
    defences: &AllocationDefences,
) -> Result<AllocationOutput, AllocationError> {
    let models = model.model_count as usize;
    let wounds = model.wounds as usize;
    if models == 0 || wounds == 0 {
        return Ok(AllocationOutput {
            damage_dealt: 0.0,
            models_destroyed: 0.0,
            models_destroyed_distribution: vec![1.0],
        });
    }
    let zeroing = defences.zeroing.unwrap_or(DamageZeroing {
        uses: 0,
        per: ZeroingPer::Unit,
    });
    let uses = zeroing.uses + 1;
    let cells = models * wounds;
    let dead = cells * uses;
    // Alive state (m, w, u) is ((m - 1) * wounds + (w - 1)) * uses + u; `dead` absorbs.
    let step = |state: &[f64], removed: &[f64], zeroable: bool| -> Vec<f64> {
        let mut out = vec![0.0; dead + 1];
        out[dead] = state[dead];
        for (id, &p) in state.iter().enumerate().take(dead) {
            if p == 0.0 {
                continue;
            }
            let cell = id / uses;
            let left = cell % wounds + 1;
            let unused = id % uses;
            if zeroable && unused > 0 {
                out[id - 1] += p;
                continue;
            }
            let alive = cell / wounds + 1;
            let refilled = match zeroing.per {
                ZeroingPer::Model => uses - 1,
                ZeroingPer::Unit => unused,
            };
            for (amount, &q) in removed.iter().enumerate() {
                if q == 0.0 {
                    continue;
                }
                let next = if amount == 0 {
                    id
                } else if amount < left {
                    id - amount * uses
                } else if alive == 1 {
                    dead
                } else {
                    ((alive - 2) * wounds + (wounds - 1)) * uses + refilled
                };
                out[next] += p * q;
            }
        }
        out
    };

    let per = trim(per_attack(model)?);
    let counts = attack_counts(model)?;
    let most = counts.0.iter().map(|(count, _)| *count).max().unwrap_or(0);
    let span = |size: usize| most as u64 * (size as u64 - 1) + 1;
    let work = most as u64 * span(per.len()) * span(per[0].len());
    if work > MAX_EVENT_WORK {
        return Err(AllocationError::TooManyAttacks {
            attacks: most,
            work,
        });
    }
    let normal = wounds_lost(&model.damage, model.wound_lost)?;
    let mut state = vec![0.0; dead + 1];
    state[dead - 1] = 1.0;
    let mut finals = vec![0.0; dead + 1];
    if let Some(critical) = model.critical_wound.as_ref().filter(|_| !model.devastating) {
        // Critical wounds with their own save and Damage land in attack order, so the
        // allocation steps one attack at a time: each attack's normal wounds, then its
        // critical ones.
        let critical_lost = wounds_lost(&critical.damage, model.wound_lost)?;
        for attacks in 0..=most {
            let weight = counts.get(attacks);
            if weight > 0.0 {
                for (id, &q) in state.iter().enumerate() {
                    finals[id] += weight * q;
                }
            }
            if attacks == most {
                break;
            }
            let mut next = vec![0.0; dead + 1];
            let mut after_normal = state.clone();
            for (normal_events, row) in per.iter().enumerate() {
                if normal_events > 0 {
                    after_normal = step(&after_normal, &normal, true);
                }
                let mut after = after_normal.clone();
                for (critical_events, &p) in row.iter().enumerate() {
                    if critical_events > 0 {
                        after = step(&after, &critical_lost, true);
                    }
                    if p > 0.0 {
                        for (id, &q) in after.iter().enumerate() {
                            next[id] += p * q;
                        }
                    }
                }
            }
            state = next;
        }
        return Ok(summarise(&finals, models, wounds, uses, cells, dead));
    }
    let events = {
        let mut total: Joint = vec![vec![0.0]];
        let mut acc: Joint = vec![vec![1.0]];
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

    // Devastating Wounds' mortal wounds deal a critical wound's own Damage when it has one.
    let mortal_roll = model
        .critical_wound
        .as_ref()
        .map_or(&model.damage, |critical| &critical.damage);
    let mortal = wounds_lost(mortal_roll, model.mortal_wound_lost)?;
    for (normal_events, row) in events.iter().enumerate() {
        if normal_events > 0 {
            state = step(&state, &normal, true);
        }
        if !row.iter().any(|&p| p > 0.0) {
            continue;
        }
        let mut after = state.clone();
        for (mortal_events, &p) in row.iter().enumerate() {
            if mortal_events > 0 {
                after = step(&after, &mortal, false);
            }
            if p > 0.0 {
                for (id, &q) in after.iter().enumerate() {
                    finals[id] += p * q;
                }
            }
        }
    }

    Ok(summarise(&finals, models, wounds, uses, cells, dead))
}

/// Expected wounds removed, expected models destroyed and their distribution.
fn summarise(
    finals: &[f64],
    models: usize,
    wounds: usize,
    uses: usize,
    cells: usize,
    dead: usize,
) -> AllocationOutput {
    let mut destroyed = vec![0.0; models + 1];
    let mut damage_dealt = 0.0;
    for (id, &p) in finals.iter().enumerate() {
        let cell = id / uses;
        let alive = if id == dead { 0 } else { cell / wounds + 1 };
        let remaining = if id == dead {
            0
        } else {
            (alive - 1) * wounds + cell % wounds + 1
        };
        destroyed[models - alive] += p;
        damage_dealt += p * (cells - remaining) as f64;
    }
    let models_destroyed = destroyed
        .iter()
        .enumerate()
        .fold(0.0, |sum, (count, &p)| sum + p * count as f64);
    AllocationOutput {
        damage_dealt,
        models_destroyed,
        models_destroyed_distribution: destroyed,
    }
}

#[cfg(test)]
#[path = "allocation_tests.rs"]
mod tests;
