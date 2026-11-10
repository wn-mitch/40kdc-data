//! Wargear legality against a unit's MFM loadout (unit-composition `loadout`).
//!
//! Port of `tools/src/data/mfm-loadout.ts`; conformance-pinned through the
//! `mfm_loadout` corpus. A loadout is legal when its models can be assigned
//! picks that produce exactly the unit's item counts:
//!
//! - each model makes `picks` choices from every slot on its row, or from its
//!   row's alternate slots instead of all of them; a slot without a row is
//!   filled once for the unit;
//! - every limit holds on the copies of its row (or of the unit): the copies
//!   above the row's stock, or all copies when the limit lists the stock
//!   itself, must be the sum of at most the limit's cap of its choices, each
//!   taken at most `per_choice` times. A stock item listed alongside a
//!   non-stock item in a choice is the item that model keeps, and is not
//!   counted;
//! - in a uniform set, every model on the row (or in the unit) that takes no
//!   substitute carries the same main option;
//! - a row (or the unit's own wargear) whose every option for an item is a
//!   checkbox carries at most one copy per such option, or its stock copies
//!   when more. A row the app shows per model gets that cap on each model.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Deserialize;

use crate::UnitCompositionLoadout;

/// More bundles than this on one row is reported rather than searched.
const MAX_BUNDLES: usize = 20_000;

/// One item id with its copy count.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct MfmItem {
    pub id: String,
    pub count: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MfmStockRow {
    pub model: Option<String>,
    pub models: i64,
    pub items: Vec<MfmItem>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MfmTemplate {
    pub model: String,
    pub items: Vec<MfmItem>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MfmSlot {
    pub model: Option<String>,
    pub picks: i64,
    pub repeats: bool,
    pub alternate: bool,
    pub choices: Vec<Vec<MfmItem>>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MfmBreakpoint {
    pub models: i64,
    pub choices: i64,
    pub per_choice: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MfmLimit {
    pub model: Option<String>,
    pub breakpoints: Vec<MfmBreakpoint>,
    pub choices: Vec<Vec<MfmItem>>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MfmUniformChoice {
    pub items: Vec<MfmItem>,
    pub substitute: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MfmUniform {
    pub model: Option<String>,
    pub choices: Vec<MfmUniformChoice>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MfmOption {
    pub model: Option<String>,
    pub id: String,
    pub input: String,
    pub default: i64,
}

/// A unit composition's `loadout`, keyed by repo item ids and model names.
#[derive(Clone, Debug, Deserialize)]
pub struct MfmLoadoutRules {
    pub stock: Vec<MfmStockRow>,
    pub templates: Vec<MfmTemplate>,
    pub slots: Vec<MfmSlot>,
    pub limits: Vec<MfmLimit>,
    pub uniform: Vec<MfmUniform>,
    pub options: Vec<MfmOption>,
}

impl MfmLoadoutRules {
    /// The rules of a composition's generated `loadout`.
    pub fn from_loadout(loadout: &UnitCompositionLoadout) -> Self {
        let value = serde_json::to_value(loadout).expect("a loadout serializes");
        serde_json::from_value(value).expect("a schema-valid loadout reads as rules")
    }

    fn template(&self, model: &str) -> &[MfmItem] {
        self.templates
            .iter()
            .find(|entry| entry.model == model)
            .map_or(&[], |entry| entry.items.as_slice())
    }
}

/// One reason a loadout is illegal: `unknown-item`, `no-assignment` or `too-many-options`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MfmLoadoutViolation {
    pub code: &'static str,
    pub message: String,
}

type Copies = HashMap<String, i64>;

fn add(into: &mut Copies, items: &[MfmItem], times: i64) {
    for item in items {
        *into.entry(item.id.clone()).or_insert(0) += item.count * times;
    }
}

fn copies_of(items: &[MfmItem]) -> Copies {
    let mut out = Copies::new();
    add(&mut out, items, 1);
    out
}

fn get(copies: &Copies, id: &str) -> i64 {
    copies.get(id).copied().unwrap_or(0)
}

fn contains(bundle: &Copies, items: &[MfmItem]) -> bool {
    !items.is_empty() && items.iter().all(|item| get(bundle, &item.id) >= item.count)
}

/// Every multiset of `picks` choices; only the empty choice repeats unless `repeats`.
fn pick_combinations(choices: &[Vec<MfmItem>], picks: i64, repeats: bool) -> Vec<Vec<MfmItem>> {
    fn walk(
        choices: &[Vec<MfmItem>],
        repeats: bool,
        from: usize,
        left: i64,
        acc: Vec<MfmItem>,
        out: &mut Vec<Vec<MfmItem>>,
    ) {
        if left == 0 {
            out.push(acc);
            return;
        }
        for i in from..choices.len() {
            let next = if repeats || choices[i].is_empty() {
                i
            } else {
                i + 1
            };
            let mut joined = acc.clone();
            joined.extend(choices[i].iter().cloned());
            walk(choices, repeats, next, left - 1, joined, out);
        }
    }
    let has_empty = choices.iter().any(Vec::is_empty);
    let start = if repeats || has_empty {
        picks
    } else {
        picks.min(choices.len() as i64)
    };
    let mut out = Vec::new();
    walk(choices, repeats, 0, start, Vec::new(), &mut out);
    out
}

/// A slot's choices, plus "take nothing" when none of them is part of `stock`.
fn slot_choices(choices: &[Vec<MfmItem>], stock: &Copies) -> Vec<Vec<MfmItem>> {
    let swap = choices
        .iter()
        .any(|choice| choice.is_empty() || contains(stock, choice));
    let mut out = choices.to_vec();
    if !swap {
        out.push(Vec::new());
    }
    out
}

/// One model's start: its template, or its default copies over its model count, rounded up.
fn model_stock(rules: &MfmLoadoutRules, model: &str) -> Copies {
    let mut out = copies_of(rules.template(model));
    let row = rules
        .stock
        .iter()
        .find(|row| row.model.as_deref() == Some(model));
    if let Some(row) = row.filter(|row| row.models > 0) {
        for item in &row.items {
            let per = (item.count + row.models - 1) / row.models;
            let held = out.entry(item.id.clone()).or_insert(0);
            *held = (*held).max(per);
        }
    }
    out
}

fn bundle_key(bundle: &Copies) -> Vec<(String, i64)> {
    let mut key: Vec<(String, i64)> = bundle
        .iter()
        .filter(|(_, n)| **n > 0)
        .map(|(id, n)| (id.clone(), *n))
        .collect();
    key.sort();
    key
}

/// The bundles one model of `model` can carry within `counts`, or None past MAX_BUNDLES.
fn row_bundles(
    rules: &MfmLoadoutRules,
    model: &str,
    counts: &BTreeMap<String, i64>,
) -> Option<Vec<Copies>> {
    let slots: Vec<&MfmSlot> = rules
        .slots
        .iter()
        .filter(|slot| slot.model.as_deref() == Some(model))
        .collect();
    if slots.is_empty() {
        return Some(vec![copies_of(rules.template(model))]);
    }
    let stock = model_stock(rules, model);
    let fits = |bundle: &[MfmItem]| {
        copies_of(bundle)
            .iter()
            .all(|(id, n)| *n <= counts.get(id).copied().unwrap_or(0))
    };
    let product = |group: &[&MfmSlot]| -> Option<Vec<Copies>> {
        let mut bundles: Vec<Vec<MfmItem>> = vec![Vec::new()];
        for slot in group {
            let picks = pick_combinations(
                &slot_choices(&slot.choices, &stock),
                slot.picks,
                slot.repeats,
            );
            let mut next = Vec::new();
            for bundle in &bundles {
                for pick in &picks {
                    let mut joined = bundle.clone();
                    joined.extend(pick.iter().cloned());
                    if fits(&joined) {
                        next.push(joined);
                    }
                }
            }
            bundles = next;
            if bundles.len() > MAX_BUNDLES {
                return None;
            }
        }
        Some(bundles.iter().map(|bundle| copies_of(bundle)).collect())
    };
    let regular: Vec<&MfmSlot> = slots
        .iter()
        .copied()
        .filter(|slot| !slot.alternate)
        .collect();
    let alternate: Vec<&MfmSlot> = slots
        .iter()
        .copied()
        .filter(|slot| slot.alternate)
        .collect();
    let base = product(&regular)?;
    let alt = if alternate.is_empty() {
        Vec::new()
    } else {
        product(&alternate)?
    };
    let mut seen = HashSet::new();
    Some(
        base.into_iter()
            .chain(alt)
            .filter(|bundle| seen.insert(bundle_key(bundle)))
            .collect(),
    )
}

/// The default unit's model counts and item copies. A row with models but no
/// default copies of its own carries its stock template on each model;
/// unit-level stock is counted once.
pub fn default_mfm_loadout(
    rules: &MfmLoadoutRules,
) -> (BTreeMap<String, i64>, BTreeMap<String, i64>) {
    let mut models = BTreeMap::new();
    let mut counts = Copies::new();
    for row in &rules.stock {
        let Some(model) = &row.model else {
            add(&mut counts, &row.items, 1);
            continue;
        };
        models.insert(model.clone(), row.models);
        // A row the default unit has no models of lists what a model brings when added.
        if row.models == 0 {
            continue;
        }
        if row.items.is_empty() {
            add(&mut counts, rules.template(model), row.models);
        } else {
            add(&mut counts, &row.items, 1);
        }
    }
    (models, counts.into_iter().collect())
}

/// Whether the app shows `model`'s widgets once per model rather than once for the row.
fn per_model_row(rules: &MfmLoadoutRules, model: &str) -> bool {
    let default_models = rules
        .stock
        .iter()
        .find(|row| row.model.as_deref() == Some(model))
        .map_or(0, |row| row.models);
    let stock: Vec<&MfmOption> = rules
        .options
        .iter()
        .filter(|option| option.model.as_deref() == Some(model) && option.default > 0)
        .collect();
    default_models <= 1
        && !stock.is_empty()
        && stock.iter().all(|option| option.input == "checkbox")
}

/// The most copies of each checkbox-only item `model` (or the unit) may carry.
fn checkbox_caps(
    rules: &MfmLoadoutRules,
    model: Option<&str>,
    models: i64,
) -> HashMap<String, i64> {
    let mut caps: HashMap<String, i64> = HashMap::new();
    let mut steppers = HashSet::new();
    for option in rules
        .options
        .iter()
        .filter(|option| option.model.as_deref() == model)
    {
        if option.input == "stepper" {
            steppers.insert(option.id.clone());
        } else {
            *caps.entry(option.id.clone()).or_insert(0) += 1;
        }
    }
    for id in &steppers {
        caps.remove(id);
    }
    for row in rules
        .stock
        .iter()
        .filter(|row| row.model.as_deref() == model)
    {
        for item in &row.items {
            if let Some(cap) = caps.get_mut(&item.id) {
                *cap = (*cap).max(item.count);
            }
        }
    }
    if let Some(model) = model {
        if per_model_row(rules, model) {
            for cap in caps.values_mut() {
                *cap *= models;
            }
        }
    }
    caps
}

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

/// Whether `copies` of a limit's items, over the scope's stock baseline, fit the limit.
fn limit_holds(limit: &MfmLimit, unit_models: i64, copies: &Copies, baseline: &Copies) -> bool {
    let (cap, per_choice) = limit_cap(limit, unit_models);
    let is_stock = |id: &str| get(baseline, id) > 0;
    let stock_choice = limit.choices.iter().any(|choice| {
        !choice.is_empty()
            && choice
                .iter()
                .all(|item| baseline.get(&item.id) == Some(&item.count))
    });
    let mut ids: Vec<&str> = Vec::new();
    for item in limit.choices.iter().flatten() {
        if !ids.contains(&item.id.as_str()) {
            ids.push(&item.id);
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
    let target: Vec<i64> = ids
        .iter()
        .map(|id| {
            let over = if stock_choice { 0 } else { get(baseline, id) };
            (get(copies, id) - over).max(0)
        })
        .collect();

    struct Search<'a> {
        vectors: &'a [Vec<i64>],
        per_choice: Option<i64>,
        failed: HashSet<(usize, i64, Vec<i64>)>,
    }
    fn fits(search: &mut Search<'_>, index: usize, left: i64, rest: Vec<i64>) -> bool {
        if rest.iter().all(|n| *n == 0) {
            return true;
        }
        if index >= search.vectors.len() || left == 0 {
            return false;
        }
        let key = (index, left, rest.clone());
        if search.failed.contains(&key) {
            return false;
        }
        let most = left.min(search.per_choice.unwrap_or(left));
        for used in (0..=most).rev() {
            let next: Vec<i64> = rest
                .iter()
                .zip(&search.vectors[index])
                .map(|(n, v)| n - v * used)
                .collect();
            if next.iter().any(|n| *n < 0) {
                continue;
            }
            if fits(search, index + 1, left - used, next) {
                return true;
            }
        }
        search.failed.insert(key);
        false
    }
    let mut search = Search {
        vectors: &vectors,
        per_choice,
        failed: HashSet::new(),
    };
    fits(&mut search, 0, cap, target)
}

#[path = "mfm_loadout_check.rs"]
mod check;
pub use check::check_mfm_loadout;
