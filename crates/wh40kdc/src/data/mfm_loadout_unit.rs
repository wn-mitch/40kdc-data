//! A unit's MFM loadout at a model count: how the count splits across the
//! loadout's model rows, and the default wargear at that size.
//!
//! Port of `tools/src/data/mfm-loadout-unit.ts`; conformance-pinned through the
//! `mfm_loadout` corpus.

use std::collections::BTreeMap;

use super::bounds::{mfm_weapon_bounds, MfmBound};
use super::search::{mfm_assignment, mfm_configurations, MfmConfiguration, MfmSearchTooLarge};
use super::MfmLoadoutViolation;
use super::{add, check_mfm_loadout, default_mfm_loadout, Copies, MfmItem, MfmLoadoutRules};
use crate::UnitComposition;

/// One composition row's model-count range.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MfmModelRange {
    pub name: String,
    pub min: i64,
    pub max: i64,
}

/// The composition fields the split reads: its model rows, squad-size tiers and loadout.
#[derive(Clone, Debug)]
pub struct MfmComposition {
    pub models: Vec<MfmModelRange>,
    pub tiers: Vec<Vec<MfmModelRange>>,
    pub loadout: Option<MfmLoadoutRules>,
}

impl MfmComposition {
    /// The split's fields of a generated unit composition.
    pub fn from_composition(composition: &UnitComposition) -> Self {
        let range = |name: &str, min: u64, max: u64| MfmModelRange {
            name: name.to_string(),
            min: min as i64,
            max: max as i64,
        };
        MfmComposition {
            models: composition
                .models
                .iter()
                .map(|model| range(&model.name, model.min, model.max.get()))
                .collect(),
            tiers: composition
                .tiers
                .iter()
                .map(|tier| {
                    tier.models
                        .iter()
                        .map(|model| range(&model.name, model.min, model.max.get()))
                        .collect()
                })
                .collect(),
            loadout: composition
                .loadout
                .as_ref()
                .map(MfmLoadoutRules::from_loadout),
        }
    }
}

/// The model-count range a loadout row has in a tier. A row written `name#k`,
/// with `k` a positive decimal integer, is the k-th of the tier's rows of that
/// name; any other name covers all of the tier's rows with that exact name.
fn row_range(tier: &[MfmModelRange], row: &str) -> Option<(i64, i64)> {
    let numbered = row.rfind('#').filter(|hash| *hash > 0).and_then(|hash| {
        let suffix = &row[hash + 1..];
        let decimal = suffix.starts_with(|c: char| ('1'..='9').contains(&c))
            && suffix.bytes().all(|b| b.is_ascii_digit());
        decimal.then(|| (&row[..hash], suffix.parse::<usize>().ok()))
    });
    if let Some((name, k)) = numbered {
        // A k too large to index names no row.
        return tier
            .iter()
            .filter(|model| model.name == name)
            .nth(k? - 1)
            .map(|entry| (entry.min, entry.max));
    }
    let entries: Vec<&MfmModelRange> = tier.iter().filter(|model| model.name == row).collect();
    if entries.is_empty() {
        return None;
    }
    Some(entries.iter().fold((0, 0), |(min, max), model| {
        (min + model.min, max + model.max)
    }))
}

/// The default unit's rows in stock order, each with its (last given) model count.
fn default_rows(rules: &MfmLoadoutRules) -> Vec<(String, i64)> {
    let mut out: Vec<(String, i64)> = Vec::new();
    for row in &rules.stock {
        let Some(model) = &row.model else { continue };
        match out.iter_mut().find(|(name, _)| name == model) {
            Some(entry) => entry.1 = row.models,
            None => out.push((model.clone(), row.models)),
        }
    }
    out
}

/// The loadout rows' model counts for a unit of `model_count` models, or None
/// when no tier holds that count. The first tier (in declaration order) whose
/// range holds the count fixes each row's range; the default unit's rows are
/// clamped into it, and the difference goes to (or comes from) the row with the
/// most default models that has room, ties to the first in stock order, until
/// the count is reached.
pub fn mfm_rows(composition: &MfmComposition, model_count: i64) -> Option<BTreeMap<String, i64>> {
    let rules = composition.loadout.as_ref()?;
    let tiers: Vec<&[MfmModelRange]> = if composition.tiers.is_empty() {
        vec![&composition.models]
    } else {
        composition.tiers.iter().map(Vec::as_slice).collect()
    };
    let defaults = default_rows(rules);
    for tier in tiers {
        // A row the tier does not list keeps its default count.
        let ranges: Vec<(i64, i64)> = defaults
            .iter()
            .map(|(row, n)| row_range(tier, row).unwrap_or((*n, *n)))
            .collect();
        let low: i64 = ranges.iter().map(|(min, _)| min).sum();
        let high: i64 = ranges.iter().map(|(_, max)| max).sum();
        if model_count < low || model_count > high {
            continue;
        }
        let mut rows: Vec<i64> = defaults
            .iter()
            .zip(&ranges)
            .map(|((_, n), (min, max))| (*n).max(*min).min(*max))
            .collect();
        let mut delta = model_count - rows.iter().sum::<i64>();
        while delta != 0 {
            let grow = delta > 0;
            // The tier's range holds the count, so some row has room; the first
            // with the most default models wins.
            let mut best: Option<usize> = None;
            for (i, n) in rows.iter().enumerate() {
                let (min, max) = ranges[i];
                let room = if grow { *n < max } else { *n > min };
                if room && best.is_none_or(|b| defaults[i].1 > defaults[b].1) {
                    best = Some(i);
                }
            }
            let i = best.expect("a tier that holds the count has a row with room");
            let (min, max) = ranges[i];
            let room = if grow { max - rows[i] } else { rows[i] - min };
            let step = room.min(delta.abs());
            rows[i] += if grow { step } else { -step };
            delta += if grow { -step } else { step };
        }
        return Some(
            defaults
                .iter()
                .zip(rows)
                .map(|((row, _), n)| (row.clone(), n))
                .collect(),
        );
    }
    None
}

/// The default wargear of a unit with `rows` models per loadout row: the
/// default unit's copies, plus a row's template for each model it has beyond
/// the default and less one for each it has fewer. None when removing models
/// would take copies the default does not have.
pub fn mfm_resized_default(
    rules: &MfmLoadoutRules,
    rows: &BTreeMap<String, i64>,
) -> Option<BTreeMap<String, i64>> {
    let (models, counts) = default_mfm_loadout(rules);
    let mut out: Copies = counts.into_iter().collect();
    for (row, n) in rows {
        let delta = n - models.get(row).copied().unwrap_or(0);
        if delta != 0 {
            add(&mut out, rules.template(row), delta);
        }
    }
    if out.values().any(|n| *n < 0) {
        return None;
    }
    Some(out.into_iter().filter(|(_, n)| *n > 0).collect())
}

/// The default wargear of a unit with `rows` models per loadout row, scaling
/// each row's default copies per model. None when a row's copies do not split
/// evenly over its default models, or a row the default unit has none of is
/// given models.
pub fn mfm_scaled_default(
    rules: &MfmLoadoutRules,
    rows: &BTreeMap<String, i64>,
) -> Option<BTreeMap<String, i64>> {
    let mut out: BTreeMap<String, i64> = BTreeMap::new();
    for row in &rules.stock {
        let Some(model) = &row.model else {
            for item in &row.items {
                *out.entry(item.id.clone()).or_insert(0) += item.count;
            }
            continue;
        };
        let n = rows.get(model).copied().unwrap_or(0);
        if n == 0 {
            continue;
        }
        if row.models == 0 {
            return None;
        }
        let items: Vec<MfmItem> = if row.items.is_empty() {
            rules
                .template(model)
                .iter()
                .map(|item| MfmItem {
                    id: item.id.clone(),
                    count: item.count * row.models,
                })
                .collect()
        } else {
            row.items.clone()
        };
        for item in items {
            if (item.count * n) % row.models != 0 {
                return None;
            }
            *out.entry(item.id).or_insert(0) += item.count * n / row.models;
        }
    }
    Some(out)
}

/// A base loadout: its copies and whether the checker accepts them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MfmBaseLoadout {
    pub counts: BTreeMap<String, i64>,
    pub legal: bool,
}

/// The base loadout of a unit with `rows` models per loadout row: the default
/// resized by templates ([`mfm_resized_default`]) when it is legal, else the
/// default scaled per model ([`mfm_scaled_default`]) when that is, else the
/// resized default with `legal` false. None when neither can be built.
pub fn mfm_base_loadout(
    rules: &MfmLoadoutRules,
    rows: &BTreeMap<String, i64>,
) -> Option<MfmBaseLoadout> {
    let resized = mfm_resized_default(rules, rows);
    let scaled = mfm_scaled_default(rules, rows);
    for counts in [&resized, &scaled].into_iter().flatten() {
        if check_mfm_loadout(rules, rows, counts).is_empty() {
            return Some(MfmBaseLoadout {
                counts: counts.clone(),
                legal: true,
            });
        }
    }
    resized.or(scaled).map(|counts| MfmBaseLoadout {
        counts,
        legal: false,
    })
}

/// Violations of a unit of `model_count` models carrying `counts`, under its
/// composition's loadout split by [`mfm_rows`]: a loadout violation, or
/// `invalid-model-count` when no tier holds the count. None when the
/// composition has no loadout.
pub fn mfm_unit_violations(
    composition: &MfmComposition,
    model_count: i64,
    counts: &BTreeMap<String, i64>,
) -> Option<Vec<MfmLoadoutViolation>> {
    let rules = composition.loadout.as_ref()?;
    let Some(rows) = mfm_rows(composition, model_count) else {
        return Some(vec![MfmLoadoutViolation {
            code: "invalid-model-count",
            message: format!("no squad size of this unit has {model_count} models"),
        }]);
    };
    Some(check_mfm_loadout(rules, &rows, counts))
}

/// The composition's loadout and its rows at `model_count`, when both exist.
fn rules_at(
    composition: &MfmComposition,
    model_count: i64,
) -> Option<(&MfmLoadoutRules, BTreeMap<String, i64>)> {
    Some((
        composition.loadout.as_ref()?,
        mfm_rows(composition, model_count)?,
    ))
}

/// The base loadout of a unit of `model_count` models ([`mfm_base_loadout`]); None when it cannot be built.
pub fn mfm_unit_base_loadout(
    composition: &MfmComposition,
    model_count: i64,
) -> Option<MfmBaseLoadout> {
    let (rules, rows) = rules_at(composition, model_count)?;
    mfm_base_loadout(rules, &rows)
}

/// Each item's fewest and most copies in a unit of `model_count` models ([`mfm_weapon_bounds`]).
pub fn mfm_unit_bounds(
    composition: &MfmComposition,
    model_count: i64,
) -> Result<Option<BTreeMap<String, MfmBound>>, MfmSearchTooLarge> {
    match rules_at(composition, model_count) {
        Some((rules, rows)) => mfm_weapon_bounds(rules, &rows),
        None => Ok(None),
    }
}

/// How `counts` sit on a unit of `model_count` models ([`mfm_assignment`]).
pub fn mfm_unit_assignment(
    composition: &MfmComposition,
    model_count: i64,
    counts: &BTreeMap<String, i64>,
) -> Result<Option<MfmConfiguration>, MfmSearchTooLarge> {
    match rules_at(composition, model_count) {
        Some((rules, rows)) => mfm_assignment(rules, &rows, counts),
        None => Ok(None),
    }
}

/// The marker that ends a candidate list cut at its limit.
pub const MFM_CANDIDATES_TRUNCATED: &str = "…truncated";

fn item_list<'a>(items: impl Iterator<Item = (&'a str, i64)>) -> String {
    items
        .map(|(id, count)| format!("{id}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn items(items: &[MfmItem]) -> String {
    item_list(items.iter().map(|item| (item.id.as_str(), item.count)))
}

/// A configuration as `<witness> => <counts>`: each group as
/// `<row>×<models>[<items per model>]` in search order, then the unit's own
/// wargear as `unit[<items>]` when it has any, joined by `; `; counts as
/// ascending `id:count` pairs joined by `,`.
pub fn encode_mfm_configuration(configuration: &MfmConfiguration) -> String {
    let mut groups: Vec<String> = configuration
        .groups
        .iter()
        .map(|group| format!("{}×{}[{}]", group.model, group.count, items(&group.items)))
        .collect();
    if !configuration.unit.is_empty() {
        groups.push(format!("unit[{}]", items(&configuration.unit)));
    }
    let counts = item_list(configuration.counts.iter().map(|(id, n)| (id.as_str(), *n)));
    format!("{} => {counts}", groups.join("; "))
}

/// The legal configurations of a unit of `model_count` models, encoded by
/// [`encode_mfm_configuration`] in search order, up to `limit`, then
/// [`MFM_CANDIDATES_TRUNCATED`] when more exist. Empty when the size cannot be built.
pub fn mfm_unit_candidates(
    composition: &MfmComposition,
    model_count: i64,
    limit: usize,
) -> Result<Vec<String>, MfmSearchTooLarge> {
    let Some((rules, rows)) = rules_at(composition, model_count) else {
        return Ok(Vec::new());
    };
    let (configurations, truncated) = mfm_configurations(rules, &rows, limit)?;
    let mut out: Vec<String> = configurations
        .iter()
        .map(encode_mfm_configuration)
        .collect();
    if truncated {
        out.push(MFM_CANDIDATES_TRUNCATED.to_string());
    }
    Ok(out)
}
