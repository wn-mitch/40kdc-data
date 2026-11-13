//! Limit tests behind the MFM loadout checker and search: whether a scope's
//! copies of a limit's items are (or can grow to be) a sum of its choices.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use super::{get, Copies, MfmBreakpoint, MfmItem, MfmLimit};

/// The cap and per-choice ceiling a limit's breakpoints give a unit of `models` models.
fn limit_cap(limit: &MfmLimit, models: i64) -> (i64, Option<i64>) {
    let mut points: Vec<&MfmBreakpoint> = limit.breakpoints.iter().collect();
    points.sort_by_key(|point| point.models);
    points
        .into_iter()
        .filter(|point| point.models <= models)
        .last()
        .map_or((0, None), |point| (point.choices, point.per_choice))
}

/// A limit's test, fixed to a scope's stock baseline and a unit of
/// `unit_models` models. Given the scope's copies of each of `ids` (in that
/// order), [`CompiledLimit::holds`] says whether they fit the limit, or with
/// `at_least`, whether some allowed sum of its choices covers them instead,
/// which holds for every partial count a fitting count can grow from. The
/// copies above the baseline, or all copies when the limit lists the baseline
/// itself as a choice, must be the sum of at most the cap of its choices.
pub(super) struct CompiledLimit {
    pub(super) ids: Vec<String>,
    over: Vec<i64>,
    vectors: Vec<Vec<i64>>,
    cap: i64,
    per_choice: Option<i64>,
    answers: RefCell<HashMap<(bool, Vec<i64>), bool>>,
}

pub(super) fn compile_limit(
    limit: &MfmLimit,
    unit_models: i64,
    baseline: &Copies,
) -> CompiledLimit {
    let (cap, per_choice) = limit_cap(limit, unit_models);
    let is_stock = |id: &str| get(baseline, id) > 0;
    let stock_choice = limit.choices.iter().any(|choice| {
        !choice.is_empty()
            && choice
                .iter()
                .all(|item| baseline.get(&item.id) == Some(&item.count))
    });
    let mut ids: Vec<String> = Vec::new();
    for item in limit.choices.iter().flatten() {
        if !ids.contains(&item.id) {
            ids.push(item.id.clone());
        }
    }
    let vectors: Vec<Vec<i64>> = limit
        .choices
        .iter()
        .map(|choice| {
            let keep: Vec<&MfmItem> = if choice.iter().any(|item| !is_stock(&item.id)) {
                choice.iter().filter(|item| !is_stock(&item.id)).collect()
            } else {
                choice.iter().collect()
            };
            ids.iter()
                .map(|id| {
                    keep.iter()
                        .filter(|item| item.id == *id)
                        .map(|item| item.count)
                        .sum()
                })
                .collect()
        })
        .collect();
    let over = ids
        .iter()
        .map(|id| if stock_choice { 0 } else { get(baseline, id) })
        .collect();
    CompiledLimit {
        ids,
        over,
        vectors,
        cap,
        per_choice,
        answers: RefCell::new(HashMap::new()),
    }
}

impl CompiledLimit {
    /// Whether the scope's `copies` of each of `ids` fit (or, `at_least`, can grow to fit) the limit.
    pub(super) fn holds(&self, copies: &[i64], at_least: bool) -> bool {
        let target: Vec<i64> = copies
            .iter()
            .zip(&self.over)
            .map(|(n, over)| (n - over).max(0))
            .collect();
        let key = (at_least, target);
        if let Some(known) = self.answers.borrow().get(&key) {
            return *known;
        }
        let mut failed = HashSet::new();
        let answer = self.fits(&mut failed, at_least, 0, self.cap, key.1.clone());
        self.answers.borrow_mut().insert(key, answer);
        answer
    }

    fn fits(
        &self,
        failed: &mut HashSet<(usize, i64, Vec<i64>)>,
        at_least: bool,
        index: usize,
        left: i64,
        rest: Vec<i64>,
    ) -> bool {
        if rest.iter().all(|n| *n <= 0) {
            return true;
        }
        if index >= self.vectors.len() || left == 0 {
            return false;
        }
        let key = (index, left, rest);
        if failed.contains(&key) {
            return false;
        }
        let most = left.min(self.per_choice.unwrap_or(left));
        for used in (0..=most).rev() {
            let next: Vec<i64> = key
                .2
                .iter()
                .zip(&self.vectors[index])
                .map(|(n, v)| {
                    let n = n - v * used;
                    if at_least {
                        n.max(0)
                    } else {
                        n
                    }
                })
                .collect();
            if next.iter().any(|n| *n < 0) {
                continue;
            }
            if self.fits(failed, at_least, index + 1, left - used, next) {
                return true;
            }
        }
        failed.insert(key);
        false
    }

    /// The copies of the limit's items, in its `ids` order.
    pub(super) fn copies_of(&self, copies: &Copies) -> Vec<i64> {
        self.ids.iter().map(|id| get(copies, id)).collect()
    }
}

/// Whether `copies` of a limit's items, over the scope's stock baseline, fit the
/// limit (see [`compile_limit`]).
pub(super) fn limit_holds(
    limit: &MfmLimit,
    unit_models: i64,
    copies: &Copies,
    baseline: &Copies,
    at_least: bool,
) -> bool {
    let compiled = compile_limit(limit, unit_models, baseline);
    compiled.holds(&compiled.copies_of(copies), at_least)
}
