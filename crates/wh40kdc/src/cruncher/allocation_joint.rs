//! One attack's joint event distribution for the allocation stage: normal
//! damage events, mortal-wound events (Devastating Wounds) or critical-wound
//! events, and the mortal wounds an ability inflicts on the attack's rolls.
//! Mirrors `perAttack` and its table helpers in
//! `tools/src/cruncher/allocation.ts`, in the same arithmetic order.

use super::super::damage_roll::quantity_distribution;
use super::super::engine::{AttackModel, RollMortalCounts};
use super::{integral, AllocationError};

/// Probabilities indexed `[normal events][mortal events][ability mortal wounds]`.
pub(super) type Joint = Vec<Vec<Vec<f64>>>;

fn joint(rows: usize, columns: usize, depth: usize) -> Joint {
    vec![vec![vec![0.0; depth]; columns]; rows]
}

pub(super) fn convolve(left: &Joint, right: &Joint) -> Joint {
    let mut out = joint(
        left.len() + right.len() - 1,
        left[0].len() + right[0].len() - 1,
        left[0][0].len() + right[0][0].len() - 1,
    );
    for (k, row) in left.iter().enumerate() {
        for (j, cell) in row.iter().enumerate() {
            for (a, &p) in cell.iter().enumerate() {
                if p == 0.0 {
                    continue;
                }
                for (k2, other) in right.iter().enumerate() {
                    for (j2, cell2) in other.iter().enumerate() {
                        for (a2, &q) in cell2.iter().enumerate() {
                            if q != 0.0 {
                                out[k + k2][j + j2][a + a2] += p * q;
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

/// `table` without trailing all-zero rows, columns and depth; convolution
/// skips zeros, so the nonzero values are unchanged.
pub(super) fn trim(table: Joint) -> Joint {
    let zero = |cell: &[f64]| cell.iter().all(|&p| p == 0.0);
    let mut rows = table.len();
    while rows > 1 && table[rows - 1].iter().all(|cell| zero(cell)) {
        rows -= 1;
    }
    let mut columns = table[0].len();
    while columns > 1 && table[..rows].iter().all(|row| zero(&row[columns - 1])) {
        columns -= 1;
    }
    let mut depth = table[0][0].len();
    while depth > 1
        && table[..rows]
            .iter()
            .all(|row| row[..columns].iter().all(|cell| cell[depth - 1] == 0.0))
    {
        depth -= 1;
    }
    table[..rows]
        .iter()
        .map(|row| {
            row[..columns]
                .iter()
                .map(|cell| cell[..depth].to_vec())
                .collect()
        })
        .collect()
}

fn power(base: &Joint, times: i64) -> Joint {
    let mut out: Joint = vec![vec![vec![1.0]]];
    for _ in 0..times.max(0) {
        out = convolve(&out, base);
    }
    out
}

/// `into + weight * from`, grown to cover both.
pub(super) fn add(into: &Joint, from: &Joint, weight: f64) -> Joint {
    let mut grown = joint(
        into.len().max(from.len()),
        into[0].len().max(from[0].len()),
        into[0][0].len().max(from[0][0].len()),
    );
    for (k, row) in into.iter().enumerate() {
        for (j, cell) in row.iter().enumerate() {
            for (a, &p) in cell.iter().enumerate() {
                grown[k][j][a] += p;
            }
        }
    }
    for (k, row) in from.iter().enumerate() {
        for (j, cell) in row.iter().enumerate() {
            for (a, &p) in cell.iter().enumerate() {
                grown[k][j][a] += weight * p;
            }
        }
    }
    grown
}

/// `table` with every ability mortal-wound count raised by `by`.
fn shift(table: Joint, by: usize) -> Joint {
    if by == 0 {
        return table;
    }
    table
        .into_iter()
        .map(|row| {
            row.into_iter()
                .map(|cell| {
                    let mut out = vec![0.0; by];
                    out.extend(cell);
                    out
                })
                .collect()
        })
        .collect()
}

/// Mortal wounds an attack's rolls inflict, each count whole and not negative.
#[derive(Clone, Copy)]
pub(super) struct RollMortalCountsWhole {
    pub hit: usize,
    pub critical_hit: usize,
    pub wound: usize,
    pub critical_wound: usize,
    pub critical_wound_of_critical_hit: usize,
}

pub(super) fn roll_mortals_of(
    mortals: &RollMortalCounts,
) -> Result<RollMortalCountsWhole, AllocationError> {
    let whole = |value: f64, what: &'static str| -> Result<usize, AllocationError> {
        let count = integral(value, what)?;
        if count < 0 {
            return Err(AllocationError::NotWhole { what, value });
        }
        Ok(count as usize)
    };
    Ok(RollMortalCountsWhole {
        hit: whole(mortals.hit, "mortal wounds on a roll (hit)")?,
        critical_hit: whole(
            mortals.critical_hit,
            "mortal wounds on a roll (criticalHit)",
        )?,
        wound: whole(mortals.wound, "mortal wounds on a roll (wound)")?,
        critical_wound: whole(
            mortals.critical_wound,
            "mortal wounds on a roll (criticalWound)",
        )?,
        critical_wound_of_critical_hit: whole(
            mortals.critical_wound_of_critical_hit,
            "mortal wounds on a roll (criticalWoundOfCriticalHit)",
        )?,
    })
}

/// Distribution of one attack's normal damage events, its second kind of
/// event (mortal wounds with Devastating Wounds, otherwise unsaved critical
/// wounds when they have their own save and Damage, else none) and the mortal
/// wounds its rolls inflict.
pub(super) fn per_attack(model: &AttackModel) -> Result<Joint, AllocationError> {
    let mortals = roll_mortals_of(&model.roll_mortals)?;
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
    // `extra`: the mortal wounds a critical wound inflicts beyond every critical wound's.
    let wound_roll = |extra: usize| -> Joint {
        let on_wound = mortals.wound;
        let on_critical = on_wound + mortals.critical_wound + extra;
        if on_wound == 0 && on_critical == 0 {
            return vec![
                vec![vec![1.0 - to_main - to_second], vec![to_second]],
                vec![vec![to_main], vec![0.0]],
            ];
        }
        let mut out = joint(2, 2, on_wound.max(on_critical) + 1);
        let crit = model.wound.crit;
        let (crit_unsaved, crit_event) = if model.devastating {
            (1.0, (0, 1))
        } else if let Some(critical) = split {
            (critical.unsaved, (0, 1))
        } else {
            (model.unsaved, (1, 0))
        };
        out[0][0][0] += 1.0 - model.wound.pass;
        out[1][0][on_wound] += normal_wound * model.unsaved;
        out[0][0][on_wound] += normal_wound * (1.0 - model.unsaved);
        out[crit_event.0][crit_event.1][on_critical] += crit * crit_unsaved;
        out[0][0][on_critical] += crit * (1.0 - crit_unsaved);
        out
    };
    let auto_wound = shift(
        vec![vec![vec![1.0 - model.unsaved]], vec![vec![model.unsaved]]],
        mortals.wound,
    );
    let normal_hit = if model.torrent {
        1.0
    } else {
        model.hit.pass - model.hit.crit
    };
    let crit_hit = if model.torrent { 0.0 } else { model.hit.crit };
    let mut out = joint(1, 1, 1);
    out[0][0][0] = 1.0 - normal_hit - crit_hit;
    let mut result = add(&out, &shift(wound_roll(0), mortals.hit), normal_hit);
    if crit_hit > 0.0 {
        let first = if model.lethal {
            auto_wound
        } else {
            wound_roll(mortals.critical_wound_of_critical_hit)
        };
        let extras = match &model.sustained_stat {
            None => vec![(0.0, 1.0)],
            Some(stat) => quantity_distribution(stat)?,
        };
        let plain = wound_roll(0);
        for (count, probability) in extras {
            let extra_hits = power(&plain, integral(count, "Sustained Hits")?);
            let hits = shift(
                convolve(&first, &extra_hits),
                mortals.hit + mortals.critical_hit,
            );
            result = add(&result, &hits, crit_hit * probability);
        }
    }
    Ok(result)
}
