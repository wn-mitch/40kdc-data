//! Enumerates the legal wargear configurations of a unit under its MFM loadout
//! rules (see [`check_mfm_loadout`](super::check_mfm_loadout) for what legal
//! means): the configurations themselves, and how a given configuration's
//! copies sit on its models.
//!
//! Port of `tools/src/data/mfm-loadout-search.ts`; the enumeration order is
//! conformance-pinned. Each row's distinct copies are found once, lazily: the
//! walk decides how many of the row's models carry each bundle (in bundle
//! order, most first). Rows then combine in code-unit order, after the unit's
//! own picks. A partial configuration stops as soon as a checkbox cap is
//! exceeded or no allowed sum of a limit's choices can still cover its copies;
//! both only tighten as copies are added, so no legal configuration is cut.

use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::rc::Rc;

use super::check::{uniform_allows, uniform_attempts};
use super::space::{space_of, SearchTests, Space};
use super::{bare_models, Copies, MfmItem, MfmLoadoutRules};

/// The bundle index a row walk gives the models it leaves bare.
const BARE: usize = usize::MAX;

/// `count` models of loadout row `model`, each carrying `items` (per model, ascending by id).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MfmRowBundle {
    pub model: String,
    pub count: i64,
    pub items: Vec<MfmItem>,
}

/// A legal configuration: the unit's item copies and the models that carry them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MfmConfiguration {
    pub counts: BTreeMap<String, i64>,
    /// Rows in code-unit order, bundles in bundle order. The unit's own wargear has no row.
    pub groups: Vec<MfmRowBundle>,
    /// The unit's own wargear (slots and stock without a row).
    pub unit: Vec<MfmItem>,
}

/// More bundles than this on one row is refused rather than searched.
pub const MAX_SEARCH_BUNDLES: usize = 200_000;

/// A search that cannot run: a row with more bundle choices than the search takes on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MfmSearchTooLarge {
    pub row: String,
}

impl fmt::Display for MfmSearchTooLarge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}: more than {MAX_SEARCH_BUNDLES} wargear combinations to search",
            self.row
        )
    }
}

impl std::error::Error for MfmSearchTooLarge {}

/// One leaf of a search: the tracked copies and the witness that reached them.
struct Leaf {
    totals: Vec<i64>,
    /// `(row position, bundle index, models)` in walk order.
    picks: Vec<(usize, usize, i64)>,
    unit_pick: usize,
}

/// One distinct set of a row's own copies, with the first picks found for it.
struct RowResult {
    own: Vec<i64>,
    /// `(bundle index, models)` in walk order; [`BARE`] for models that carry nothing.
    picks: Vec<(usize, i64)>,
}

/// A position of the row walk: copies so far, models left, the bundle being
/// tried and the next number of models to try it on (0: start bundle `j`).
struct Frame {
    own: Vec<i64>,
    left: i64,
    j: usize,
    take: i64,
}

/// The walk over one row's distinct copies, resumable one result at a time.
/// It picks the next bundle any remaining model carries, from the current
/// bundle on, and how many carry it (most first), so its stack is no deeper
/// than the row's models. Up to `bare` models may carry nothing: a position
/// with that few models left is a result before the walk goes on from it.
struct RowWalk {
    stack: Vec<Frame>,
    picks: Vec<(usize, i64)>,
    found: HashSet<Vec<i64>>,
    walked: HashSet<(Vec<i64>, i64, usize)>,
    bare: i64,
    /// A row of no models has one result, its empty copies, still to give.
    empty_pending: bool,
    /// A row whose every model may go bare gives that result first.
    root_pending: bool,
}

impl RowWalk {
    fn new(models: i64, width: usize, bare: i64) -> Self {
        RowWalk {
            stack: if models > 0 {
                vec![Frame {
                    own: vec![0; width],
                    left: models,
                    j: 0,
                    take: 0,
                }]
            } else {
                Vec::new()
            },
            picks: Vec::new(),
            found: HashSet::new(),
            walked: HashSet::new(),
            bare,
            empty_pending: models <= 0,
            root_pending: models > 0 && models <= bare,
        }
    }

    /// The bare result at a position with `left` models left, unless its copies
    /// were already given or the row's caps and limits refuse them.
    fn bare_result(
        &mut self,
        tests: &SearchTests,
        r: usize,
        own: &[i64],
        left: i64,
    ) -> Option<RowResult> {
        if self.found.contains(own) || !tests.row_holds(r, own, false) {
            return None;
        }
        self.found.insert(own.to_vec());
        let mut picks = self.picks.clone();
        picks.push((BARE, left));
        Some(RowResult {
            own: own.to_vec(),
            picks,
        })
    }

    fn pop(&mut self) {
        self.stack.pop();
        // Every frame but the root was entered through a pick.
        if !self.stack.is_empty() {
            self.picks.pop();
        }
    }

    fn next(
        &mut self,
        tests: &SearchTests,
        r: usize,
        bundles: &[(usize, Vec<i64>)],
    ) -> Option<RowResult> {
        if self.empty_pending {
            self.empty_pending = false;
            let own = vec![0; tests.width];
            return tests.row_holds(r, &own, false).then(|| RowResult {
                own,
                picks: Vec::new(),
            });
        }
        if self.root_pending {
            self.root_pending = false;
            let (own, left) = (self.stack[0].own.clone(), self.stack[0].left);
            if let Some(result) = self.bare_result(tests, r, &own, left) {
                return Some(result);
            }
        }
        loop {
            let top = self.stack.last_mut()?;
            if top.take == 0 {
                if top.j >= bundles.len() {
                    self.pop();
                    continue;
                }
                // Walking on from bundle j with these copies covers every later
                // bundle too, so a position already walked ends this frame.
                if !self.walked.insert((top.own.clone(), top.left, top.j)) {
                    self.pop();
                    continue;
                }
                top.take = top.left;
            }
            let (j, take) = (top.j, top.take);
            top.take -= 1;
            if top.take == 0 {
                top.j += 1;
            }
            let (index, bundle) = &bundles[j];
            let next: Vec<i64> = top
                .own
                .iter()
                .zip(bundle)
                .map(|(k, n)| k + n * take)
                .collect();
            let left = top.left - take;
            if !tests.under_ceiling(&next)
                || !tests.row_holds(r, &next, true)
                || !tests.unit_holds(&next, true)
            {
                continue;
            }
            if left == 0 {
                if !self.found.contains(&next) && tests.row_holds(r, &next, false) {
                    self.found.insert(next.clone());
                    let mut picks = self.picks.clone();
                    picks.push((*index, take));
                    return Some(RowResult { own: next, picks });
                }
                continue;
            }
            self.picks.push((*index, take));
            self.stack.push(Frame {
                own: next.clone(),
                left,
                j: j + 1,
                take: 0,
            });
            if left <= self.bare {
                if let Some(result) = self.bare_result(tests, r, &next, left) {
                    return Some(result);
                }
            }
        }
    }
}

/// A row's results by position, produced on first request and kept for later ones.
struct RowCache {
    items: Vec<Rc<RowResult>>,
    walk: RowWalk,
    done: bool,
}

impl RowCache {
    fn get(
        &mut self,
        k: usize,
        tests: &SearchTests,
        r: usize,
        bundles: &[(usize, Vec<i64>)],
    ) -> Option<Rc<RowResult>> {
        while !self.done && self.items.len() <= k {
            match self.walk.next(tests, r, bundles) {
                Some(result) => self.items.push(Rc::new(result)),
                None => self.done = true,
            }
        }
        self.items.get(k).cloned()
    }
}

/// The state of one unit pick's combination of rows.
struct Combine<'a> {
    tests: &'a SearchTests,
    allowed: &'a [Vec<(usize, Vec<i64>)>],
    caches: &'a mut [RowCache],
    seen: &'a mut HashSet<Vec<i64>>,
    /// Combinations already walked under this unit pick: their completions were visited.
    walked: HashSet<(Vec<i64>, usize)>,
    picks: Vec<Rc<RowResult>>,
    unit_pick: usize,
    visit: &'a mut dyn FnMut(&Leaf) -> bool,
}

impl Combine<'_> {
    fn run(&mut self, r: usize, totals: Vec<i64>) -> bool {
        if r == self.caches.len() {
            if !self.tests.unit_holds(&totals, false) || self.seen.contains(&totals) {
                return false;
            }
            self.seen.insert(totals.clone());
            let picks = self
                .picks
                .iter()
                .enumerate()
                .flat_map(|(row, result)| {
                    result
                        .picks
                        .iter()
                        .map(move |(bundle, take)| (row, *bundle, *take))
                })
                .collect();
            return (self.visit)(&Leaf {
                totals,
                picks,
                unit_pick: self.unit_pick,
            });
        }
        if !self.walked.insert((totals.clone(), r)) {
            return false;
        }
        for k in 0.. {
            let Some(result) = self.caches[r].get(k, self.tests, r, &self.allowed[r]) else {
                break;
            };
            let next: Vec<i64> = totals.iter().zip(&result.own).map(|(a, b)| a + b).collect();
            if !self.tests.under_ceiling(&next) || !self.tests.unit_holds(&next, true) {
                continue;
            }
            self.picks.push(result);
            let stop = self.run(r + 1, next);
            self.picks.pop();
            if stop {
                return true;
            }
        }
        false
    }
}

/// Walks every legal configuration of `space`, tracking every item, and calls
/// `visit` on each distinct total (the first configuration to reach it).
/// `visit` returns true to stop.
fn search(
    rules: &MfmLoadoutRules,
    models: &BTreeMap<String, i64>,
    space: &Space,
    ceiling: Option<Vec<i64>>,
    visit: &mut dyn FnMut(&Leaf) -> bool,
) {
    let tests = SearchTests::new(rules, models, space, &space.ids, ceiling);
    let mut seen: HashSet<Vec<i64>> = HashSet::new();
    for attempt in uniform_attempts(rules) {
        // Bundles with the same tracked copies are interchangeable to the
        // search, so only the first of each is walked.
        let allowed: Vec<Vec<(usize, Vec<i64>)>> = space
            .rows
            .iter()
            .zip(&space.bundles)
            .map(|(row, bundles)| {
                let mut keys = HashSet::new();
                bundles
                    .iter()
                    .enumerate()
                    .filter(|(_, bundle)| uniform_allows(rules, row, bundle, &attempt))
                    .map(|(index, bundle)| (index, tests.vector(bundle)))
                    .filter(|(_, vector)| keys.insert(vector.clone()))
                    .collect()
            })
            .collect();
        // Each row's distinct own copies, found once: a row's copies are part of
        // the unit's, so a row the unit's limits or the ceiling refuse is cut here too.
        let mut caches: Vec<RowCache> = space
            .rows
            .iter()
            .map(|row| RowCache {
                items: Vec::new(),
                walk: RowWalk::new(models[row], space.ids.len(), bare_models(rules, row)),
                done: false,
            })
            .collect();
        for (u, unit_pick) in space.unit_picks.iter().enumerate() {
            if !tests.unit_pick_fits(unit_pick) {
                continue;
            }
            let start = tests.vector(unit_pick);
            if !tests.under_ceiling(&start) || !tests.unit_holds(&start, true) {
                continue;
            }
            let mut combine = Combine {
                tests: &tests,
                allowed: &allowed,
                caches: &mut caches,
                seen: &mut seen,
                walked: HashSet::new(),
                picks: Vec::new(),
                unit_pick: u,
                visit: &mut *visit,
            };
            if combine.run(0, start) {
                return;
            }
        }
    }
}

/// `copies` as items with copies, ascending by id.
fn items_of(copies: &Copies) -> Vec<MfmItem> {
    let mut items: Vec<MfmItem> = copies
        .iter()
        .filter(|(_, n)| **n > 0)
        .map(|(id, n)| MfmItem {
            id: id.clone(),
            count: *n,
        })
        .collect();
    items.sort_by(|a, b| a.id.cmp(&b.id));
    items
}

fn configuration_of(space: &Space, leaf: &Leaf) -> MfmConfiguration {
    MfmConfiguration {
        counts: leaf
            .totals
            .iter()
            .enumerate()
            .filter(|(_, n)| **n > 0)
            .map(|(i, n)| (space.ids[i].clone(), *n))
            .collect(),
        groups: leaf
            .picks
            .iter()
            .map(|(row, bundle, take)| MfmRowBundle {
                model: space.rows[*row].clone(),
                count: *take,
                items: if *bundle == BARE {
                    Vec::new()
                } else {
                    items_of(&space.bundles[*row][*bundle])
                },
            })
            .collect(),
        unit: items_of(&space.unit_picks[leaf.unit_pick]),
    }
}

/// The unit's distinct legal configurations at `models` models per row, in
/// search order, up to `limit`, and whether more exist.
pub fn mfm_configurations(
    rules: &MfmLoadoutRules,
    models: &BTreeMap<String, i64>,
    limit: usize,
) -> Result<(Vec<MfmConfiguration>, bool), MfmSearchTooLarge> {
    let space = space_of(rules, models)?;
    let mut configurations = Vec::new();
    let mut truncated = false;
    search(rules, models, &space, None, &mut |leaf| {
        if configurations.len() == limit {
            truncated = true;
            return true;
        }
        configurations.push(configuration_of(&space, leaf));
        false
    });
    Ok((configurations, truncated))
}

/// How `counts` sit on the unit's models at `models` models per row: the first
/// configuration the search finds with exactly these copies, or None when none
/// is legal.
pub fn mfm_assignment(
    rules: &MfmLoadoutRules,
    models: &BTreeMap<String, i64>,
    counts: &BTreeMap<String, i64>,
) -> Result<Option<MfmConfiguration>, MfmSearchTooLarge> {
    let space = space_of(rules, models)?;
    if counts
        .iter()
        .any(|(id, n)| *n > 0 && space.ids.binary_search(id).is_err())
    {
        return Ok(None);
    }
    let ceiling: Vec<i64> = space
        .ids
        .iter()
        .map(|id| counts.get(id).copied().unwrap_or(0))
        .collect();
    let mut found = None;
    search(rules, models, &space, Some(ceiling.clone()), &mut |leaf| {
        if leaf.totals != ceiling {
            return false;
        }
        found = Some(configuration_of(&space, leaf));
        true
    });
    Ok(found)
}

/// Calls `visit` on each distinct legal configuration at `models` models per
/// row, in search order, until it returns true. With `ceiling`, only
/// configurations carrying no more than its copies of each item are walked; an
/// item it leaves out may not be carried.
pub fn for_each_mfm_configuration(
    rules: &MfmLoadoutRules,
    models: &BTreeMap<String, i64>,
    visit: &mut dyn FnMut(MfmConfiguration) -> bool,
    ceiling: Option<&BTreeMap<String, i64>>,
) -> Result<(), MfmSearchTooLarge> {
    let space = space_of(rules, models)?;
    let ceiling = ceiling.map(|ceiling| {
        space
            .ids
            .iter()
            .map(|id| ceiling.get(id).copied().unwrap_or(0))
            .collect()
    });
    search(rules, models, &space, ceiling, &mut |leaf| {
        visit(configuration_of(&space, leaf))
    });
    Ok(())
}
