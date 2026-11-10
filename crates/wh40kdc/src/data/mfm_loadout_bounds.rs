//! Each item's fewest and most copies over a unit's legal configurations under
//! its MFM loadout rules.
//!
//! Port of `tools/src/data/mfm-loadout-bounds.ts`. Legality depends only on the
//! items a cap or limit counts, so the search walks those items' copies and
//! carries, for every other item, the fewest and most copies any path to the
//! same state holds. Rows are independent once their counted copies are fixed,
//! so a unit's interval for an item is the sum of its rows' intervals, and the
//! bounds are exact.

use std::collections::{BTreeMap, HashMap};

use super::check::{uniform_allows, uniform_attempts};
use super::search::MfmSearchTooLarge;
use super::space::{space_of, SearchTests};
use super::{get, Copies, MfmLoadoutRules};

/// Counted copies with the fewest (`lo`) and most (`hi`) copies of every other item.
#[derive(Clone)]
struct State {
    own: Vec<i64>,
    lo: Vec<i64>,
    hi: Vec<i64>,
}

/// Adds `state` under `key`, widening the intervals of a state already there.
fn merge<K: Eq + std::hash::Hash>(into: &mut HashMap<K, State>, key: K, state: State) {
    match into.get_mut(&key) {
        None => {
            into.insert(key, state);
        }
        Some(known) => widen(known, &state),
    }
}

fn widen(known: &mut State, state: &State) {
    for i in 0..state.lo.len() {
        known.lo[i] = known.lo[i].min(state.lo[i]);
        known.hi[i] = known.hi[i].max(state.hi[i]);
    }
}

fn sum(a: &[i64], b: &[i64], times: i64) -> Vec<i64> {
    a.iter().zip(b).map(|(x, y)| x + y * times).collect()
}

/// An item's fewest and most copies.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MfmBound {
    pub min: i64,
    pub max: i64,
}

/// Each item's fewest and most copies over the unit's legal configurations at
/// `models` models per row, for every item it can carry; None when it has no
/// legal configuration.
pub fn mfm_weapon_bounds(
    rules: &MfmLoadoutRules,
    models: &BTreeMap<String, i64>,
) -> Result<Option<BTreeMap<String, MfmBound>>, MfmSearchTooLarge> {
    let space = space_of(rules, models)?;
    let counted = &space.constrained;
    let free: Vec<&String> = space
        .ids
        .iter()
        .filter(|id| counted.binary_search(id).is_err())
        .collect();
    let tests = SearchTests::new(rules, models, &space, counted, None);
    let free_of = |copies: &Copies| -> Vec<i64> { free.iter().map(|id| get(copies, id)).collect() };
    let position = |id: &String| space.ids.binary_search(id).expect("an id of the space");
    let counted_at: Vec<usize> = counted.iter().map(position).collect();
    let free_at: Vec<usize> = free.iter().map(|id| position(id)).collect();
    let mut lows = vec![i64::MAX; space.ids.len()];
    let mut highs = vec![i64::MIN; space.ids.len()];
    let mut legal = false;

    for attempt in uniform_attempts(rules) {
        let row_results: Vec<Vec<State>> = space
            .rows
            .iter()
            .enumerate()
            .map(|(r, row)| {
                // Bundles with the same counted copies are one choice; each other
                // item ranges over theirs.
                let mut groups: HashMap<Vec<i64>, State> = HashMap::new();
                for bundle in &space.bundles[r] {
                    if !uniform_allows(rules, row, bundle, &attempt) {
                        continue;
                    }
                    let own = tests.vector(bundle);
                    let copies = free_of(bundle);
                    merge(
                        &mut groups,
                        own.clone(),
                        State {
                            own,
                            lo: copies.clone(),
                            hi: copies,
                        },
                    );
                }
                let n = models[row];
                let zero = vec![0; free.len()];
                let mut layer: HashMap<(Vec<i64>, i64), State> = HashMap::new();
                layer.insert(
                    (vec![0; counted.len()], n),
                    State {
                        own: vec![0; counted.len()],
                        lo: zero.clone(),
                        hi: zero,
                    },
                );
                for group in groups.values() {
                    let mut next: HashMap<(Vec<i64>, i64), State> = HashMap::new();
                    for ((_, state_left), state) in &layer {
                        for take in 0..=*state_left {
                            let own = sum(&state.own, &group.own, take);
                            // The tests only tighten as copies are added, so a failing take ends the loop.
                            if take > 0
                                && (!tests.row_holds(r, &own, true)
                                    || !tests.unit_holds(&own, true))
                            {
                                break;
                            }
                            let left = state_left - take;
                            let lo = sum(&state.lo, &group.lo, take);
                            let hi = sum(&state.hi, &group.hi, take);
                            merge(&mut next, (own.clone(), left), State { own, lo, hi });
                        }
                    }
                    layer = next;
                }
                let mut results: HashMap<Vec<i64>, State> = HashMap::new();
                for ((own, left), state) in layer {
                    if left == 0 && tests.row_holds(r, &own, false) {
                        merge(&mut results, own, state);
                    }
                }
                results.into_values().collect()
            })
            .collect();

        for unit_pick in &space.unit_picks {
            if !tests.unit_pick_fits(unit_pick) {
                continue;
            }
            let start = tests.vector(unit_pick);
            if !tests.unit_holds(&start, true) {
                continue;
            }
            let mut states: HashMap<Vec<i64>, State> = HashMap::new();
            states.insert(
                start.clone(),
                State {
                    own: start,
                    lo: free_of(unit_pick),
                    hi: free_of(unit_pick),
                },
            );
            for results in &row_results {
                let mut next: HashMap<Vec<i64>, State> = HashMap::new();
                for state in states.values() {
                    for result in results {
                        let own = sum(&state.own, &result.own, 1);
                        if !tests.unit_holds(&own, true) {
                            continue;
                        }
                        let merged = State {
                            own: own.clone(),
                            lo: sum(&state.lo, &result.lo, 1),
                            hi: sum(&state.hi, &result.hi, 1),
                        };
                        merge(&mut next, own, merged);
                    }
                }
                states = next;
            }
            for state in states.values() {
                if !tests.unit_holds(&state.own, false) {
                    continue;
                }
                legal = true;
                for (i, at) in counted_at.iter().enumerate() {
                    lows[*at] = lows[*at].min(state.own[i]);
                    highs[*at] = highs[*at].max(state.own[i]);
                }
                for (i, at) in free_at.iter().enumerate() {
                    lows[*at] = lows[*at].min(state.lo[i]);
                    highs[*at] = highs[*at].max(state.hi[i]);
                }
            }
        }
    }
    if !legal {
        return Ok(None);
    }
    Ok(Some(
        space
            .ids
            .iter()
            .enumerate()
            .map(|(i, id)| {
                (
                    id.clone(),
                    MfmBound {
                        min: lows[i],
                        max: highs[i],
                    },
                )
            })
            .collect(),
    ))
}
