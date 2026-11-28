//! Exact allocation of several attack lines into an attached unit: Bodyguard
//! group(s), then CHARACTER groups, each with its own save, Damage, Feel No
//! Pain, Wounds and models. Mirrors `allocateAttached` and its helpers in
//! `tools/src/cruncher/allocation.ts`, in the same arithmetic order.

use serde::Serialize;

use super::super::damage_roll::quantity_distribution;
use super::super::engine::{crunch_model, AttackModel, CriticalWound, EngineInput};
use super::joint::{add, convolve, per_attack, roll_mortals_of, trim, Joint};
use super::{
    attack_counts, derived_zeroing, gather, integral, wounds_lost, AllocationDefences,
    AllocationError, DamageZeroing, Layers, ZeroingPer, MAX_EVENT_WORK,
};
use crate::data::Dataset;

/// One allocation group of an attached target unit (rules 05.03 and 05.04):
/// one for each CHARACTER model, and one for the other models with the same
/// W, Sv and InSv.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TargetGroup {
    pub character: bool,
}

/// One group's share of an [`AttachedAllocationOutput`].
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupAllocation {
    /// Probability of each number of the group's models destroyed, from 0 to its size.
    pub models_destroyed_distribution: Vec<f64>,
}

/// [`allocate_attached`]'s result: the unit's, and each group's models
/// destroyed. Serializes with the runner's camelCase keys.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedAllocationOutput {
    /// Expected wounds removed from the target unit.
    pub damage_dealt: f64,
    pub models_destroyed: f64,
    /// Probability of each number of models destroyed, from 0 to the unit's size.
    pub models_destroyed_distribution: Vec<f64>,
    /// Probability of each number of wounds removed from the target unit, from 0 to all of them.
    pub wounds_dealt_distribution: Vec<f64>,
    /// For each group in the order given, the probability of each number of its models destroyed.
    pub groups: Vec<GroupAllocation>,
}

/// The largest number of target states [`allocate_attached`] tracks before it refuses.
pub const MAX_ATTACHED_STATES: usize = 200_000;

/// Whether two groups' models share every roll an attached target's groups must share.
fn shared_rolls(a: &AttackModel, b: &AttackModel) -> bool {
    a.models_firing == b.models_firing
        && a.attacks_stat == b.attacks_stat
        && a.attacks_reroll == b.attacks_reroll
        && a.attacks_bonus == b.attacks_bonus
        && a.rapid_fire_stat == b.rapid_fire_stat
        && a.torrent == b.torrent
        && a.hit == b.hit
        && a.sustained_stat == b.sustained_stat
        && a.lethal == b.lethal
        && a.wound == b.wound
        && a.devastating == b.devastating
        && a.precision == b.precision
        && a.roll_mortals == b.roll_mortals
}

/// Exact allocation of several attack lines into an attached unit, fired in
/// the order given. `lines[l][g]` is line `l` crunched against group `g`: the
/// same attacker and context, with the group's own profile, model count and
/// defensive buffs. Each group must see the same Hit and Wound rolls, so give
/// every group the attached unit's keywords and its Toughness, the highest
/// among the Bodyguard models (05.02.01), and its models as the context's
/// `target_model_count`, which Blast and Cleave count.
///
/// `groups` is the defender's allocation order, CHARACTER groups after every
/// other group. The current group is the first with a model left; an attack's
/// save, Damage and Feel No Pain are that group's, and the damaged model takes
/// the next attack. A line with [PRECISION] starts on the first CHARACTER group
/// with a model left and keeps it current until the line is resolved or the
/// group is destroyed. Saves are made as each wound reaches the current group
/// rather than all at once and sorted lowest first, which is exact while every
/// group has the same save.
///
/// With one group this is the lines allocated in turn into one unit. Without
/// an explicit `defences.zeroing`, the first line's first group supplies the
/// damage-zeroing defence, shared across the groups. The dataset defaults to
/// [`Dataset::embedded`] when `None`, as for [`crunch`](super::super::crunch).
pub fn allocate_attached(
    lines: &[Vec<EngineInput>],
    groups: &[TargetGroup],
    dataset: Option<&Dataset>,
    defences: &AllocationDefences,
) -> Result<AttachedAllocationOutput, AllocationError> {
    if groups.is_empty() {
        return Err(AllocationError::Attached(
            "the target needs at least one group".into(),
        ));
    }
    if let Some(first) = groups.iter().position(|group| group.character) {
        if groups[first..].iter().any(|group| !group.character) {
            return Err(AllocationError::Attached(
                "no CHARACTER group can come before a non-CHARACTER group".into(),
            ));
        }
    }
    for line in lines {
        if line.len() != groups.len() {
            return Err(AllocationError::Attached(format!(
                "every line needs one input per group ({}), got {}",
                groups.len(),
                line.len()
            )));
        }
    }
    let mut crunched = Vec::with_capacity(lines.len());
    for line in lines {
        let mut row = Vec::with_capacity(line.len());
        for input in line {
            row.push(crunch_model(input, dataset)?);
        }
        crunched.push(row);
    }
    let zeroing = match (defences.zeroing, crunched.first()) {
        (Some(zeroing), _) => Some(zeroing),
        (None, Some(line)) => derived_zeroing(&line[0].0)?,
        (None, None) => None,
    }
    .unwrap_or(DamageZeroing {
        uses: 0,
        per: ZeroingPer::Unit,
    });
    let Some(first) = crunched.first() else {
        if groups.len() == 1 {
            return Ok(AttachedAllocationOutput {
                damage_dealt: 0.0,
                models_destroyed: 0.0,
                models_destroyed_distribution: vec![1.0],
                wounds_dealt_distribution: vec![1.0],
                groups: vec![GroupAllocation {
                    models_destroyed_distribution: vec![1.0],
                }],
            });
        }
        return Err(AllocationError::Attached(
            "give at least one line to read the target's groups from".into(),
        ));
    };
    let geometry: Vec<Geometry> = first
        .iter()
        .map(|(_, model)| Geometry {
            models: model.model_count as usize,
            wounds: model.wounds as usize,
        })
        .collect();
    let mut state: Option<Vec<f64>> = None;
    for line in &crunched {
        let models: Vec<AttackModel> = line.iter().map(|(_, model)| model.clone()).collect();
        for (g, model) in models.iter().enumerate() {
            if !model.unmodelled.is_empty() {
                return Err(AllocationError::Unmodelled(model.unmodelled.clone()));
            }
            if model.model_count as usize != geometry[g].models
                || model.wounds as usize != geometry[g].wounds
            {
                return Err(AllocationError::Attached(
                    "every line must target the same groups".into(),
                ));
            }
            if !shared_rolls(model, &models[0]) {
                return Err(AllocationError::Attached(
                    "the groups disagree on the attack's Hit or Wound rolls; give each group the attached unit's keywords, Toughness and model count".into(),
                ));
            }
        }
        state = Some(allocate_groups_from(
            &models,
            groups,
            &geometry,
            zeroing,
            state.as_deref(),
        )?);
    }
    let state = state.expect("at least one line");
    Ok(summarize_groups(&state, &geometry, zeroing.uses + 1))
}

#[derive(Clone, Copy)]
struct Geometry {
    models: usize,
    wounds: usize,
}

impl Geometry {
    /// The group's wounds at full strength, and the number of its wound states less one.
    fn full(self) -> usize {
        self.models * self.wounds
    }
}

/// Mixed-radix strides of the groups' remaining wounds, and the number of cells.
fn group_strides(geometry: &[Geometry]) -> (Vec<usize>, usize) {
    let mut strides = Vec::with_capacity(geometry.len());
    let mut cells = 1;
    for group in geometry {
        strides.push(cells);
        cells *= group.full() + 1;
    }
    (strides, cells)
}

#[derive(Clone, Copy)]
enum Kind {
    Wound,
    Critical,
    One,
    Dev,
}

/// What one wound, critical wound or mortal wound does to a group.
struct Event {
    unsaved: f64,
    removed: Vec<f64>,
    zeroable: bool,
}

struct GroupEvents {
    wound: Event,
    critical: Event,
    one: Event,
    dev: Event,
}

impl GroupEvents {
    fn of(&self, kind: Kind) -> &Event {
        match kind {
            Kind::Wound => &self.wound,
            Kind::Critical => &self.critical,
            Kind::One => &self.one,
            Kind::Dev => &self.dev,
        }
    }
}

/// One line's attacks into the groups, from `start` (an earlier line's
/// states) or the unit at full strength. A state is the wounds each group has
/// left, plus zeroing uses left: a group has at most one damaged model, so its
/// wounds left say how many models it has and how hurt the damaged one is.
fn allocate_groups_from(
    models: &[AttackModel],
    groups: &[TargetGroup],
    geometry: &[Geometry],
    zeroing: DamageZeroing,
    start: Option<&[f64]>,
) -> Result<Vec<f64>, AllocationError> {
    let model = &models[0];
    let uses = zeroing.uses + 1;
    let (strides, cells) = group_strides(geometry);
    let size = cells * uses;
    if size > MAX_ATTACHED_STATES {
        return Err(AllocationError::TooManyStates { size });
    }
    let left = |cell: usize, g: usize| cell / strides[g] % (geometry[g].full() + 1);
    let full: usize = geometry
        .iter()
        .enumerate()
        .map(|(g, group)| group.full() * strides[g])
        .sum();
    let zeros = || vec![0.0; size];
    let initial = match start {
        Some(start) => start.to_vec(),
        None => {
            let mut initial = zeros();
            initial[full * uses + uses - 1] = 1.0;
            initial
        }
    };

    let split = models.iter().any(|m| m.critical_wound.is_some()) && !model.devastating;
    let mut params = Vec::with_capacity(models.len());
    for m in models {
        let (critical_unsaved, critical_damage) = match &m.critical_wound {
            Some(critical) => (critical.unsaved, &critical.damage),
            None => (m.unsaved, &m.damage),
        };
        let dev_damage = m
            .critical_wound
            .as_ref()
            .map_or(&m.damage, |critical| &critical.damage);
        params.push(GroupEvents {
            wound: Event {
                unsaved: m.unsaved,
                removed: wounds_lost(&m.damage, m.wound_lost)?,
                zeroable: true,
            },
            critical: Event {
                unsaved: critical_unsaved,
                removed: wounds_lost(critical_damage, m.wound_lost)?,
                zeroable: true,
            },
            one: Event {
                unsaved: 1.0,
                removed: wounds_lost(&[(1.0, 1.0)], m.mortal_wound_lost)?,
                zeroable: false,
            },
            dev: Event {
                unsaved: 1.0,
                removed: wounds_lost(dev_damage, m.mortal_wound_lost)?,
                zeroable: false,
            },
        });
    }
    let first_alive =
        |cell: usize, order: &[usize]| order.iter().copied().find(|&g| left(cell, g) > 0);
    let default_order: Vec<usize> = (0..groups.len()).collect();
    let characters: Vec<usize> = (0..groups.len()).filter(|&g| groups[g].character).collect();

    let mut table_model = model.clone();
    table_model.unsaved = 1.0;
    if split {
        table_model.critical_wound = Some(CriticalWound {
            unsaved: 1.0,
            damage: model.damage.clone(),
        });
    }
    let per = trim(per_attack(&table_model)?);
    let counts = attack_counts(model)?;
    let most = counts.0.iter().map(|(count, _)| *count).max().unwrap_or(0);
    let span = |size: usize| most as u64 * (size as u64 - 1) + 1;
    let work = most as u64 * span(per.len()) * span(per[0].len()) * span(per[0][0].len());
    if work > MAX_EVENT_WORK {
        return Err(AllocationError::TooManyAttacks {
            attacks: most,
            work,
        });
    }
    let mortals = roll_mortals_of(&model.roll_mortals)?;
    let normal_hit = if model.torrent {
        1.0
    } else {
        model.hit.pass - model.hit.crit
    };
    let crit_hit = if model.torrent { 0.0 } else { model.hit.crit };
    let mut extras = match &model.sustained_stat {
        None => vec![(0.0, 1.0)],
        Some(stat) => quantity_distribution(stat)?,
    };
    extras.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut extra_counts = Vec::with_capacity(extras.len());
    for &(count, probability) in &extras {
        extra_counts.push((integral(count, "Sustained Hits")?, probability));
    }

    // The line's attacks from one share of the start, `chosen` the group [PRECISION] keeps current.
    let run = |from: Vec<f64>, chosen: Option<usize>| -> Vec<f64> {
        let current: Vec<Option<usize>> = (0..cells)
            .map(|cell| match chosen {
                Some(g) if left(cell, g) > 0 => Some(g),
                _ => first_alive(cell, &default_order),
            })
            .collect();
        let step = |state: &[f64], kind: Kind| -> Vec<f64> {
            let mut out = zeros();
            for (id, &p) in state.iter().enumerate() {
                if p == 0.0 {
                    continue;
                }
                let cell = id / uses;
                let Some(g) = current[cell] else {
                    out[id] += p;
                    continue;
                };
                let event = params[g].of(kind);
                let (unsaved, zeroable) = (event.unsaved, event.zeroable);
                if unsaved < 1.0 {
                    out[id] += p * (1.0 - unsaved);
                }
                let hit = p * unsaved;
                if hit == 0.0 {
                    continue;
                }
                let unused = id % uses;
                if zeroable && unused > 0 {
                    out[id - 1] += hit;
                    continue;
                }
                let wounds = geometry[g].wounds;
                let remaining = left(cell, g);
                let alive = remaining.div_ceil(wounds);
                let on_model = remaining - (alive - 1) * wounds;
                for (amount, &q) in event.removed.iter().enumerate() {
                    if q == 0.0 {
                        continue;
                    }
                    let kills = amount >= on_model;
                    let next = if amount == 0 {
                        remaining
                    } else if kills {
                        (alive - 1) * wounds
                    } else {
                        remaining - amount
                    };
                    let refilled = if kills && zeroing.per == ZeroingPer::Model {
                        uses - 1
                    } else {
                        unused
                    };
                    out[(cell - (remaining - next) * strides[g]) * uses + refilled] += hit * q;
                }
            }
            out
        };
        let step_all = |layers: &Layers, kind: Kind| -> Layers {
            layers.iter().map(|layer| step(layer, kind)).collect()
        };
        let shift_all = |layers: Layers, by: usize| -> Layers {
            if by == 0 {
                return layers;
            }
            let mut out: Layers = (0..by).map(|_| zeros()).collect();
            out.extend(layers);
            out
        };
        let mut pending: Layers = Vec::new();
        if split {
            // Critical wounds with their own save or Damage land in the order their hits wound.
            let blend = |parts: &[(f64, &Layers)]| -> Layers {
                let mut out: Layers = vec![zeros()];
                for &(weight, layers) in parts {
                    if weight > 0.0 {
                        gather(&mut out, layers, weight, size - 1);
                    }
                }
                out
            };
            let wound_roll = |layers: &Layers, extra: usize| -> Layers {
                blend(&[
                    (1.0 - model.wound.pass, layers),
                    (
                        model.wound.pass - model.wound.crit,
                        &shift_all(step_all(layers, Kind::Wound), mortals.wound),
                    ),
                    (
                        model.wound.crit,
                        &shift_all(
                            step_all(layers, Kind::Critical),
                            mortals.wound + mortals.critical_wound + extra,
                        ),
                    ),
                ])
            };
            let first_wound = |layers: &Layers| -> Layers {
                if model.lethal {
                    shift_all(step_all(layers, Kind::Wound), mortals.wound)
                } else {
                    wound_roll(layers, mortals.critical_wound_of_critical_hit)
                }
            };
            let attack = |layers: &Layers| -> Layers {
                let hit = shift_all(wound_roll(layers, 0), mortals.hit);
                let mut crits: Vec<(f64, Layers)> = Vec::new();
                if crit_hit > 0.0 {
                    let mut after = first_wound(&shift_all(
                        layers.clone(),
                        mortals.hit + mortals.critical_hit,
                    ));
                    let mut done = 0;
                    for &(count, probability) in &extra_counts {
                        while done < count {
                            after = wound_roll(&after, 0);
                            done += 1;
                        }
                        crits.push((crit_hit * probability, after.clone()));
                    }
                }
                let mut parts: Vec<(f64, &Layers)> =
                    vec![(1.0 - normal_hit - crit_hit, layers), (normal_hit, &hit)];
                parts.extend(crits.iter().map(|(weight, state)| (*weight, state)));
                blend(&parts)
            };
            let mut layers: Layers = vec![from];
            for attacks in 0..=most {
                let weight = counts.get(attacks);
                if weight > 0.0 {
                    gather(&mut pending, &layers, weight, size - 1);
                }
                if attacks == most {
                    break;
                }
                layers = attack(&layers);
            }
        } else {
            // Wounds, then the ability's mortal wounds, then Devastating Wounds' mortal wounds.
            let mut events: Joint = vec![vec![vec![0.0]]];
            let mut acc: Joint = vec![vec![vec![1.0]]];
            for attacks in 0..=most {
                let weight = counts.get(attacks);
                if weight > 0.0 {
                    events = add(&events, &acc, weight);
                }
                if attacks < most {
                    acc = convolve(&acc, &per);
                }
            }
            let mut target = zeros();
            let mut after_normal = from;
            for (normal_events, row) in events.iter().enumerate() {
                if normal_events > 0 {
                    after_normal = step(&after_normal, Kind::Wound);
                }
                let mut after_ones = after_normal.clone();
                for ones in 0..row[0].len() {
                    if !row.iter().any(|cell| cell[ones..].iter().any(|&p| p > 0.0)) {
                        break;
                    }
                    if ones > 0 {
                        after_ones = step(&after_ones, Kind::One);
                    }
                    let mut after = after_ones.clone();
                    for (dev_events, cell) in row.iter().enumerate() {
                        if dev_events > 0 {
                            after = step(&after, Kind::Dev);
                        }
                        let p = cell[ones];
                        if p > 0.0 {
                            for (id, &q) in after.iter().enumerate() {
                                target[id] += p * q;
                            }
                        }
                    }
                }
            }
            pending.push(target);
        }
        let mut finals = pending
            .pop()
            .filter(|layer| !layer.is_empty())
            .unwrap_or_else(zeros);
        while let Some(layer) = pending.pop() {
            finals = step(&finals, Kind::One);
            for (id, &q) in layer.iter().enumerate() {
                finals[id] += q;
            }
        }
        finals
    };

    if !model.precision || characters.is_empty() {
        return Ok(run(initial, None));
    }
    // [PRECISION] picks a CHARACTER group at the start of the line: split the start by which one.
    let mut shares: Vec<(Option<usize>, Vec<f64>)> = Vec::new();
    for (id, &p) in initial.iter().enumerate() {
        if p == 0.0 {
            continue;
        }
        let chosen = first_alive(id / uses, &characters);
        let index = match shares.iter().position(|(existing, _)| *existing == chosen) {
            Some(index) => index,
            None => {
                shares.push((chosen, zeros()));
                shares.len() - 1
            }
        };
        shares[index].1[id] += p;
    }
    let mut out = zeros();
    for (chosen, share) in shares {
        for (id, q) in run(share, chosen).into_iter().enumerate() {
            out[id] += q;
        }
    }
    Ok(out)
}

fn summarize_groups(
    final_states: &[f64],
    geometry: &[Geometry],
    uses: usize,
) -> AttachedAllocationOutput {
    let (strides, _) = group_strides(geometry);
    let total: usize = geometry.iter().map(|group| group.models).sum();
    let total_wounds: usize = geometry.iter().map(|group| group.full()).sum();
    let mut destroyed = vec![0.0; total + 1];
    let mut dealt = vec![0.0; total_wounds + 1];
    let mut by_group: Vec<Vec<f64>> = geometry
        .iter()
        .map(|group| vec![0.0; group.models + 1])
        .collect();
    let mut damage_dealt = 0.0;
    for (id, &p) in final_states.iter().enumerate() {
        if p == 0.0 {
            continue;
        }
        let cell = id / uses;
        let mut killed = 0;
        let mut lost = 0;
        for (g, group) in geometry.iter().enumerate() {
            let remaining = cell / strides[g] % (group.full() + 1);
            let dead = group.models - remaining.div_ceil(group.wounds.max(1));
            by_group[g][dead] += p;
            killed += dead;
            lost += group.full() - remaining;
        }
        destroyed[killed] += p;
        dealt[lost] += p;
        damage_dealt += p * lost as f64;
    }
    let models_destroyed = destroyed
        .iter()
        .enumerate()
        .fold(0.0, |sum, (count, &p)| sum + p * count as f64);
    AttachedAllocationOutput {
        damage_dealt,
        models_destroyed,
        models_destroyed_distribution: destroyed,
        wounds_dealt_distribution: dealt,
        groups: by_group
            .into_iter()
            .map(|distribution| GroupAllocation {
                models_destroyed_distribution: distribution,
            })
            .collect(),
    }
}
