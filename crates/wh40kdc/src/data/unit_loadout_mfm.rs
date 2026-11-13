//! The MFM half of [`UnitLoadout`](super::UnitLoadout): a unit whose
//! composition carries MFM loadout rules. Port of `mfmView`, `mfmGroups` and
//! `mfmGroupRowOrder` in `tools/src/data/unit-loadout.ts`.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use super::super::loadout::{
    CompletedLoadout, LoadoutGroup, LoadoutGroupWeapon, Violation, ViolationCode, WeaponBound,
};
use super::super::mfm_loadout::{
    check_mfm_loadout, default_mfm_loadout, for_each_mfm_configuration, mfm_assignment,
    mfm_base_loadout, mfm_row_splits, mfm_rows, mfm_weapon_bounds, MfmComposition,
    MfmConfiguration, MfmItem, MfmLoadoutRules, MfmSearchTooLarge,
};
use super::{Bounds, Splits};

pub(super) struct MfmView {
    pub(super) composition: MfmComposition,
    row_order: Vec<String>,
    splits: Mutex<HashMap<u64, Splits>>,
    base: Mutex<HashMap<u64, Option<BTreeMap<String, i64>>>>,
    bounds: Mutex<HashMap<u64, Bounds>>,
}

/// A row's model name: `name#k` names the k-th row called `name`.
fn model_name(row: &str) -> &str {
    match row.rfind('#').filter(|hash| *hash > 0) {
        Some(hash)
            if row[hash + 1..].starts_with(|c: char| ('1'..='9').contains(&c))
                && row[hash + 1..].bytes().all(|b| b.is_ascii_digit()) =>
        {
            &row[..hash]
        }
        _ => row,
    }
}

/// The order groups list a composition's loadout rows in: by the position of
/// the row's model name among the composition's models, then in stock order. A
/// name the models lack sorts last.
pub fn mfm_group_row_order(composition: &MfmComposition) -> Vec<String> {
    let Some(rules) = composition.loadout.as_ref() else {
        return Vec::new();
    };
    let rank = |row: &str| {
        let name = model_name(row);
        composition
            .models
            .iter()
            .position(|model| model.name == name)
            .unwrap_or(composition.models.len())
    };
    let mut rows = stock_rows(rules);
    // A stable sort keeps stock order among rows of one rank.
    rows.sort_by_key(|row| rank(row));
    rows
}

/// The default unit's rows in stock order, each once.
fn stock_rows(rules: &MfmLoadoutRules) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for model in rules.stock.iter().filter_map(|row| row.model.as_ref()) {
        if !out.contains(model) {
            out.push(model.clone());
        }
    }
    debug_assert_eq!(out.len(), default_mfm_loadout(rules).0.len());
    out
}

fn weapons_of(items: &[MfmItem]) -> Vec<LoadoutGroupWeapon> {
    items
        .iter()
        .map(|item| LoadoutGroupWeapon {
            id: item.id.clone(),
            count: item.count.max(0) as u64,
        })
        .collect()
}

/// A configuration's models as loadout groups: rows in `row_order`
/// ([`mfm_group_row_order`]), a row's bundles most models first (ties in search
/// order), bundles of one model name with the same items merged into the first,
/// and the unit's own wargear last as one unnamed group.
pub fn mfm_groups(configuration: &MfmConfiguration, row_order: &[String]) -> Vec<LoadoutGroup> {
    let rank = |row: &str| {
        row_order
            .iter()
            .position(|r| r == row)
            .unwrap_or(row_order.len())
    };
    let mut bundles: Vec<_> = configuration.groups.iter().collect();
    // A stable sort keeps search order among ties.
    bundles.sort_by(|a, b| {
        rank(&a.model)
            .cmp(&rank(&b.model))
            .then(b.count.cmp(&a.count))
    });
    let mut out: Vec<(LoadoutGroup, &[MfmItem])> = Vec::new();
    for bundle in bundles {
        let name = model_name(&bundle.model);
        let count = bundle.count.max(0) as u64;
        match out.iter_mut().find(|(group, items)| {
            group.model_name.as_deref() == Some(name) && *items == bundle.items.as_slice()
        }) {
            Some((group, _)) => group.count += count,
            None => out.push((
                LoadoutGroup {
                    model_name: Some(name.to_string()),
                    count,
                    weapons: weapons_of(&bundle.items),
                },
                &bundle.items,
            )),
        }
    }
    let mut out: Vec<LoadoutGroup> = out.into_iter().map(|(group, _)| group).collect();
    if !configuration.unit.is_empty() {
        out.push(LoadoutGroup {
            model_name: None,
            count: 1,
            weapons: weapons_of(&configuration.unit),
        });
    }
    out
}

pub(super) fn signed(model_count: u64) -> i64 {
    i64::try_from(model_count).unwrap_or(i64::MAX)
}

/// The cached value for `model_count`, computing it on first request.
fn memo<T: Clone>(
    cache: &Mutex<HashMap<u64, T>>,
    model_count: u64,
    compute: impl FnOnce() -> T,
) -> T {
    if let Some(found) = cache.lock().expect("loadout cache").get(&model_count) {
        return found.clone();
    }
    let value = compute();
    cache
        .lock()
        .expect("loadout cache")
        .insert(model_count, value.clone());
    value
}

impl MfmView {
    pub(super) fn new(composition: MfmComposition) -> Self {
        MfmView {
            row_order: mfm_group_row_order(&composition),
            composition,
            splits: Mutex::default(),
            base: Mutex::default(),
            bounds: Mutex::default(),
        }
    }

    fn rules(&self) -> &MfmLoadoutRules {
        self.composition
            .loadout
            .as_ref()
            .expect("an MFM view has rules")
    }

    fn splits(&self, model_count: u64) -> Splits {
        memo(&self.splits, model_count, || {
            Arc::new(mfm_row_splits(&self.composition, signed(model_count)))
        })
    }

    fn base_at(&self, rows: &BTreeMap<String, i64>) -> Option<BTreeMap<String, i64>> {
        mfm_base_loadout(self.rules(), rows).map(|base| base.counts)
    }

    pub(super) fn base(&self, model_count: u64) -> Option<BTreeMap<String, i64>> {
        memo(&self.base, model_count, || {
            self.base_at(&mfm_rows(&self.composition, signed(model_count))?)
        })
    }

    /// Bounds on any split: the widest range any split with a legal
    /// configuration gives each item. A split that cannot carry an item gives it 0–0.
    pub(super) fn bounds(&self, model_count: u64) -> Bounds {
        memo(&self.bounds, model_count, || {
            let mut found = Vec::new();
            for rows in self.splits(model_count).iter() {
                if let Some(each) = mfm_weapon_bounds(self.rules(), rows)? {
                    found.push(each);
                }
            }
            if found.is_empty() {
                return Ok(None);
            }
            let ids: BTreeSet<&String> = found.iter().flat_map(|each| each.keys()).collect();
            Ok(Some(
                ids.into_iter()
                    .map(|id| {
                        let ranges = found.iter().map(|each| {
                            each.get(id)
                                .map_or((0, 0), |range| (range.min.max(0), range.max.max(0)))
                        });
                        let min = ranges.clone().map(|(min, _)| min).min().unwrap_or(0);
                        let max = ranges.map(|(_, max)| max).max().unwrap_or(0);
                        (
                            id.clone(),
                            WeaponBound {
                                min: min as u64,
                                max: max as u64,
                            },
                        )
                    })
                    .collect(),
            ))
        })
    }

    pub(super) fn maximal(
        &self,
        model_count: u64,
    ) -> Result<Option<BTreeMap<String, i64>>, MfmSearchTooLarge> {
        let Some(rows) = mfm_rows(&self.composition, signed(model_count)) else {
            return Ok(None);
        };
        let stock = self.base_at(&rows).unwrap_or_default();
        let mut best = None;
        let mut most = -1;
        for_each_mfm_configuration(
            self.rules(),
            &rows,
            &mut |configuration| {
                let added: i64 = configuration
                    .counts
                    .iter()
                    .map(|(id, n)| (n - stock.get(id).copied().unwrap_or(0)).max(0))
                    .sum();
                if added > most {
                    most = added;
                    best = Some(configuration.counts);
                }
                false
            },
            None,
        )?;
        Ok(best)
    }

    pub(super) fn check(
        &self,
        unit_id: &str,
        model_count: u64,
        counts: &HashMap<String, i64>,
    ) -> Result<Vec<Violation>, MfmSearchTooLarge> {
        let splits = self.splits(model_count);
        if splits.is_empty() {
            return Ok(vec![Violation {
                id: unit_id.to_string(),
                code: ViolationCode::InvalidModelCount,
                message: format!("{unit_id}: no squad size has {model_count} models"),
            }]);
        }
        let sorted: BTreeMap<String, i64> = counts.iter().map(|(k, v)| (k.clone(), *v)).collect();
        if splits
            .iter()
            .any(|rows| check_mfm_loadout(self.rules(), rows, &sorted).is_empty())
        {
            return Ok(Vec::new());
        }
        let ranges = self.bounds(model_count)?.unwrap_or_default();
        let ids: BTreeSet<&String> = sorted.keys().chain(ranges.keys()).collect();
        let mut out = Vec::new();
        for id in ids {
            let n = sorted.get(id).copied().unwrap_or(0);
            let (min, max) = ranges
                .get(id)
                .map_or((0, 0), |range| (range.min as i64, range.max as i64));
            if n > max {
                out.push(Violation {
                    id: id.clone(),
                    code: ViolationCode::ExceedsMax,
                    message: format!(
                        "{unit_id}: {n} × {id} exceeds the most a legal loadout carries ({max})"
                    ),
                });
            } else if n < min {
                out.push(Violation {
                    id: id.clone(),
                    code: ViolationCode::BelowMin,
                    message: format!(
                        "{unit_id}: {n} × {id} is below the fewest a legal loadout carries ({min})"
                    ),
                });
            }
        }
        if out.is_empty() {
            out.push(Violation {
                id: unit_id.to_string(),
                code: ViolationCode::SwapConflict,
                message: format!(
                    "{unit_id}: no legal whole-model assignment carries exactly these counts"
                ),
            });
        }
        out.sort_by(|a, b| a.id.cmp(&b.id).then(a.code.as_str().cmp(b.code.as_str())));
        Ok(out)
    }

    pub(super) fn groups(
        &self,
        model_count: u64,
        counts: &BTreeMap<String, i64>,
    ) -> Result<Option<Vec<LoadoutGroup>>, MfmSearchTooLarge> {
        if model_count <= 1 {
            return Ok(None);
        }
        for rows in self.splits(model_count).iter() {
            if let Some(found) = mfm_assignment(self.rules(), rows, counts)? {
                return Ok(Some(mfm_groups(&found, &self.row_order)));
            }
        }
        Ok(None)
    }

    pub(super) fn complete(
        &self,
        model_count: u64,
        explicit: &BTreeMap<String, i64>,
    ) -> Result<Option<CompletedLoadout>, MfmSearchTooLarge> {
        for rows in self.splits(model_count).iter() {
            let mut ceiling = self.base_at(rows).unwrap_or_default();
            for (id, n) in explicit {
                let have = ceiling.entry(id.clone()).or_insert(0);
                *have = (*have).max(*n);
            }
            let mut found = None;
            for_each_mfm_configuration(
                self.rules(),
                rows,
                &mut |configuration| {
                    let covers = explicit
                        .iter()
                        .all(|(id, n)| configuration.counts.get(id).copied().unwrap_or(0) >= *n);
                    if covers {
                        found = Some(configuration);
                    }
                    covers
                },
                Some(&ceiling),
            )?;
            if let Some(found) = found {
                return Ok(Some(CompletedLoadout {
                    groups: (model_count > 1).then(|| mfm_groups(&found, &self.row_order)),
                    counts: found.counts,
                }));
            }
        }
        Ok(None)
    }
}
