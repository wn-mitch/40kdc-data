//! The space an MFM loadout search walks (rows, bundles, unit picks, items) and
//! the rule tests it runs on partial copies. Port of `spaceOf`/`searchTests` in
//! `tools/src/data/mfm-loadout-search.ts`.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::check::unit_picks_of;
use super::search::{MfmSearchTooLarge, MAX_SEARCH_BUNDLES};
use super::MfmLoadoutRules;
use super::{add, checkbox_caps, compile_limit, get, row_bundles, CompiledLimit, Copies};

/// The stock a limit on `model` (or on the unit, when None) measures above: templates per model.
fn row_baseline(
    rules: &MfmLoadoutRules,
    models: &BTreeMap<String, i64>,
    rows: &[String],
    model: Option<&str>,
) -> Copies {
    let mut out = Copies::new();
    for row in rows {
        if model.is_some_and(|model| model != row) {
            continue;
        }
        add(
            &mut out,
            rules.template(row),
            models.get(row).copied().unwrap_or(0),
        );
    }
    out
}

/// The rows, bundles and unit picks a search over `rules` at `models` walks.
pub(super) struct Space {
    /// Rows with models, in code-unit order (byte order of the map's keys).
    pub rows: Vec<String>,
    pub unit_models: i64,
    /// Each row's bundles, by row position.
    pub bundles: Vec<Vec<Copies>>,
    pub unit_picks: Vec<Copies>,
    /// Every item the unit can carry, ascending.
    pub ids: Vec<String>,
    /// Items a cap or limit counts, ascending.
    pub constrained: Vec<String>,
}

pub(super) fn space_of(
    rules: &MfmLoadoutRules,
    models: &BTreeMap<String, i64>,
) -> Result<Space, MfmSearchTooLarge> {
    let rows: Vec<String> = models
        .iter()
        .filter(|(_, n)| **n > 0)
        .map(|(model, _)| model.clone())
        .collect();
    let unit_models: i64 = models.values().sum();
    let mut bundles = Vec::with_capacity(rows.len());
    for row in &rows {
        // One model's bundle is part of its row's copies, so a bundle its row's
        // caps or limits already refuse is never carried.
        let caps = checkbox_caps(rules, Some(row), models[row]);
        let baseline = row_baseline(rules, models, &rows, Some(row));
        let limits: Vec<CompiledLimit> = rules
            .limits
            .iter()
            .filter(|limit| limit.model.as_deref() == Some(row.as_str()))
            .map(|limit| compile_limit(limit, unit_models, &baseline))
            .collect();
        let fits = |bundle: &Copies| {
            caps.iter().all(|(id, cap)| get(bundle, id) <= *cap)
                && limits
                    .iter()
                    .all(|limit| limit.holds(&limit.copies_of(bundle), true))
        };
        let found = row_bundles(rules, row, &fits, MAX_SEARCH_BUNDLES)
            .ok_or_else(|| MfmSearchTooLarge { row: row.clone() })?;
        bundles.push(found);
    }
    let unit_picks = unit_picks_of(rules);
    let ids: BTreeSet<String> = bundles
        .iter()
        .flatten()
        .chain(&unit_picks)
        .flat_map(|copies| copies.iter().filter(|(_, n)| **n > 0).map(|(id, _)| id))
        .cloned()
        .collect();
    let mut constrained: BTreeSet<String> = BTreeSet::new();
    for row in std::iter::once(None).chain(rows.iter().map(|row| Some(row.as_str()))) {
        constrained.extend(checkbox_caps(rules, row, 1).into_keys());
    }
    for limit in &rules.limits {
        constrained.extend(limit.choices.iter().flatten().map(|item| item.id.clone()));
    }
    Ok(Space {
        rows,
        unit_models,
        bundles,
        unit_picks,
        constrained: constrained
            .into_iter()
            .filter(|id| ids.contains(id))
            .collect(),
        ids: ids.into_iter().collect(),
    })
}

/// A limit compiled to read its items from tracked copies (None: an untracked item, read as 0).
type TrackedLimit = (CompiledLimit, Vec<Option<usize>>);

/// The rule tests a search over `tracked` items runs: the tracked copies of a
/// set of copies, each row's caps and limits on its own copies, the unit's
/// limits on its copies, and the ceiling partial copies are cut above.
pub(super) struct SearchTests {
    index_of: HashMap<String, usize>,
    pub(super) width: usize,
    /// The unit's checkbox caps, read on a unit pick's raw copies.
    pub unit_caps: HashMap<String, i64>,
    row_caps: Vec<Vec<(usize, i64)>>,
    row_limits: Vec<Vec<TrackedLimit>>,
    unit_limits: Vec<TrackedLimit>,
    ceiling: Option<Vec<i64>>,
}

impl SearchTests {
    pub fn new(
        rules: &MfmLoadoutRules,
        models: &BTreeMap<String, i64>,
        space: &Space,
        tracked: &[String],
        ceiling: Option<Vec<i64>>,
    ) -> Self {
        let index_of: HashMap<String, usize> = tracked
            .iter()
            .enumerate()
            .map(|(i, id)| (id.clone(), i))
            .collect();
        // Each limit's test reads its items from the tracked copies; every item a limit counts is tracked.
        let compiled = |limit, baseline: &Copies| -> TrackedLimit {
            let limit = compile_limit(limit, space.unit_models, baseline);
            let at = limit
                .ids
                .iter()
                .map(|id| index_of.get(id).copied())
                .collect();
            (limit, at)
        };
        let row_caps = space
            .rows
            .iter()
            .map(|row| {
                checkbox_caps(rules, Some(row), models[row])
                    .into_iter()
                    .filter_map(|(id, cap)| index_of.get(&id).map(|i| (*i, cap)))
                    .collect()
            })
            .collect();
        let row_limits = space
            .rows
            .iter()
            .map(|row| {
                let baseline = row_baseline(rules, models, &space.rows, Some(row));
                rules
                    .limits
                    .iter()
                    .filter(|limit| limit.model.as_deref() == Some(row.as_str()))
                    .map(|limit| compiled(limit, &baseline))
                    .collect()
            })
            .collect();
        let unit_baseline = row_baseline(rules, models, &space.rows, None);
        let unit_limits = rules
            .limits
            .iter()
            .filter(|limit| limit.model.is_none())
            .map(|limit| compiled(limit, &unit_baseline))
            .collect();
        SearchTests {
            width: tracked.len(),
            unit_caps: checkbox_caps(rules, None, 1),
            row_caps,
            row_limits,
            unit_limits,
            ceiling,
            index_of,
        }
    }

    /// The tracked copies of `copies`.
    pub fn vector(&self, copies: &Copies) -> Vec<i64> {
        let mut out = vec![0; self.width];
        for (id, n) in copies {
            if let Some(i) = self.index_of.get(id) {
                out[*i] += n;
            }
        }
        out
    }

    fn limits_hold(limits: &[TrackedLimit], totals: &[i64], at_least: bool) -> bool {
        limits.iter().all(|(limit, at)| {
            let copies: Vec<i64> = at.iter().map(|i| i.map_or(0, |i| totals[i])).collect();
            limit.holds(&copies, at_least)
        })
    }

    /// Whether row `r`'s own tracked copies pass its caps and limits.
    pub fn row_holds(&self, r: usize, own: &[i64], at_least: bool) -> bool {
        self.row_caps[r].iter().all(|(i, cap)| own[*i] <= *cap)
            && Self::limits_hold(&self.row_limits[r], own, at_least)
    }

    /// Whether the unit's tracked copies pass its limits.
    pub fn unit_holds(&self, totals: &[i64], at_least: bool) -> bool {
        Self::limits_hold(&self.unit_limits, totals, at_least)
    }

    pub fn under_ceiling(&self, totals: &[i64]) -> bool {
        self.ceiling
            .as_ref()
            .is_none_or(|ceiling| totals.iter().zip(ceiling).all(|(n, c)| n <= c))
    }

    /// Whether a unit pick's raw copies are within the unit's checkbox caps.
    pub fn unit_pick_fits(&self, pick: &Copies) -> bool {
        self.unit_caps.iter().all(|(id, cap)| get(pick, id) <= *cap)
    }
}
