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
//! - a slot choice holding its model's whole stock plus items the row offers
//!   only as unticked checkboxes may be taken without them;
//! - up to `bare_models` models of a row may carry nothing, as the default
//!   unit's do;
//! - a row (or the unit's own wargear) whose every option for an item is a
//!   checkbox carries at most one copy per such option, or its stock copies
//!   when more. A row the app lists model by model (`individual`) gets that
//!   cap on each model.

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
    /// The app lists the row's models one by one, each with its own widgets.
    #[serde(default, deserialize_with = "literal_true")]
    pub individual: bool,
}

/// Whether a field holds JSON `true` (anything else, `null` included, reads as false).
fn literal_true<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    Ok(Option::<serde_json::Value>::deserialize(deserializer)?
        == Some(serde_json::Value::Bool(true)))
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

/// A row slot's choices, plus the stock alone for each add-on choice that lacks
/// it: a choice holding the model's whole stock and items the row offers only as
/// checkboxes that start unticked lets the model leave those items off, as the
/// app's default for it does (Purge Corps Sulphurhounds).
fn row_slot_choices(
    rules: &MfmLoadoutRules,
    model: &str,
    choices: &[Vec<MfmItem>],
    stock: &Copies,
) -> Vec<Vec<MfmItem>> {
    let choices = slot_choices(choices, stock);
    if stock.is_empty() {
        return choices;
    }
    let unticked = |id: &str| {
        let mut options = rules
            .options
            .iter()
            .filter(|option| option.model.as_deref() == Some(model) && option.id == id)
            .peekable();
        options.peek().is_some()
            && options.all(|option| option.input == "checkbox" && option.default == 0)
    };
    let same = |a: &[MfmItem], b: &[MfmItem]| {
        let copies = copies_of(a);
        a.len() == b.len() && b.iter().all(|item| get(&copies, &item.id) == item.count)
    };
    let mut out = choices.clone();
    for choice in &choices {
        let holds_stock = stock
            .iter()
            .all(|(id, n)| choice.iter().any(|item| &item.id == id && item.count >= *n));
        if !holds_stock {
            continue;
        }
        let extras: Vec<&MfmItem> = choice
            .iter()
            .filter(|item| item.count > get(stock, &item.id))
            .collect();
        if extras.is_empty()
            || !extras
                .iter()
                .all(|item| get(stock, &item.id) == 0 && unticked(&item.id))
        {
            continue;
        }
        let plain: Vec<MfmItem> = choice
            .iter()
            .filter(|item| !extras.contains(item))
            .cloned()
            .collect();
        if !out.iter().any(|other| same(other, &plain)) {
            out.push(plain);
        }
    }
    out
}

/// The models of `model` the default unit leaves bare: its default models less
/// the most models any one of its stock items covers, at the template's copies
/// per model (one for an item the template lacks). Noise Marines: five models,
/// four of each template item. The app starts the unit that way, so up to that
/// many models of the row may carry nothing.
pub(super) fn bare_models(rules: &MfmLoadoutRules, model: &str) -> i64 {
    let template = rules.template(model);
    let Some(row) = rules
        .stock
        .iter()
        .find(|row| row.model.as_deref() == Some(model))
    else {
        return 0;
    };
    if row.models == 0 || row.items.is_empty() || template.is_empty() {
        return 0;
    }
    let per = copies_of(template);
    let covered = row
        .items
        .iter()
        .map(|item| {
            let each = per.get(&item.id).copied().unwrap_or(1);
            (item.count + each - 1) / each
        })
        .max()
        .unwrap_or(0)
        .max(0);
    (row.models - covered).max(0)
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

/// The bundles one model of `model` can carry: one pick combination per slot,
/// multiplied out, dropping any partial bundle `fits_copies` refuses. A partial
/// bundle only gains copies as slots are added, so `fits_copies` must refuse
/// every bundle that grows from one it refuses. More than `max_bundles` gives None.
fn row_bundles(
    rules: &MfmLoadoutRules,
    model: &str,
    fits_copies: &dyn Fn(&Copies) -> bool,
    max_bundles: usize,
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
    let fits = |bundle: &[MfmItem]| fits_copies(&copies_of(bundle));
    let product = |group: &[&MfmSlot]| -> Option<Vec<Copies>> {
        let mut bundles: Vec<Vec<MfmItem>> = vec![Vec::new()];
        for slot in group {
            let picks = pick_combinations(
                &row_slot_choices(rules, model, &slot.choices, &stock),
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
            if bundles.len() > max_bundles {
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
    // A row the app lists model by model (`individual`: Carnifexes, Broadside
    // Shas'ui) gives each model its own checkboxes, so its caps are per model.
    let individual = model.is_some_and(|model| {
        rules
            .stock
            .iter()
            .any(|row| row.model.as_deref() == Some(model) && row.individual)
    });
    if individual {
        for cap in caps.values_mut() {
            *cap *= models;
        }
    }
    caps
}

#[path = "mfm_loadout_limit.rs"]
mod limit;
use limit::{compile_limit, limit_holds, CompiledLimit};

#[path = "mfm_loadout_check.rs"]
mod check;
pub use check::check_mfm_loadout;

#[path = "mfm_loadout_search.rs"]
mod search;
pub use search::{
    for_each_mfm_configuration, mfm_assignment, mfm_configurations, MfmConfiguration, MfmRowBundle,
    MfmSearchTooLarge, MAX_SEARCH_BUNDLES,
};

#[path = "mfm_loadout_space.rs"]
mod space;

#[path = "mfm_loadout_bounds.rs"]
mod bounds;
pub use bounds::{mfm_weapon_bounds, MfmBound};

#[path = "mfm_loadout_unit.rs"]
mod unit;
pub use unit::{
    encode_mfm_configuration, mfm_base_loadout, mfm_resized_default, mfm_row_splits, mfm_rows,
    mfm_scaled_default, mfm_unit_assignment, mfm_unit_base_loadout, mfm_unit_bounds,
    mfm_unit_candidates, mfm_unit_violations, MfmBaseLoadout, MfmComposition, MfmModelRange,
    MFM_CANDIDATES_TRUNCATED,
};
