//! Unit point-cost maths shared by every consumer of the dataset: given a unit,
//! a model count, and the unit's army ordinal, which `points` tier applies.
//!
//! 11e prices some datasheets by **army ordinal** — how many copies of that
//! datasheet you have already taken. The schema models this with optional
//! `unit_count_min`/`unit_count_max` bands on each `points` tier (1-based,
//! inclusive; an open-ended top band has `unit_count_max: null`). Selecting a
//! cost is a two-step filter: keep the tiers whose ordinal band contains this
//! copy, then pick the highest model-count tier the count reaches. A tier with
//! no `unit_count_min` is unbanded and applies to every copy (the common case).
//!
//! Some units also carry `allied_points` — alternate tiers scoped to a
//! `host_faction` that apply when the unit is fielded in another faction's army
//! (an Agents of the Imperium unit allied into any IMPERIUM army; a shared
//! Space Marine datasheet a chapter section reprices). [`host_points_tiers`]
//! selects the tier table in effect for a host army and [`host_unit_points`]
//! prices from it; [`base_unit_points`] stays native-only for callers without
//! army context. Mirror of `tools/src/data/pricing.ts`.

use crate::generated::{Faction, Unit, UnitAlliedPointsItem, UnitPointsItem};
use std::collections::{HashMap, HashSet};

/// True when `ordinal` (1-based army copy) falls within `tier`'s ordinal band.
fn tier_covers_ordinal(tier: &UnitPointsItem, ordinal: u64) -> bool {
    let Some(min) = tier.unit_count_min else {
        return true; // unbanded: applies to every copy
    };
    if ordinal < min.get() {
        return false;
    }
    match tier.unit_count_max {
        Some(max) => ordinal <= max.get(),
        None => true, // open-ended top band
    }
}

/// Base point cost for a unit of `model_count` models taken as its `ordinal`-th
/// army copy (1-based). Among the tiers whose ordinal band covers this copy,
/// returns the cost of the highest `models` threshold the count reaches (lowest
/// tier when none is reached). `models` is the tier's range floor (a range-priced
/// tier spans `models`..`models_max` at one cost, e.g. Venatari 4–6 @320), so a
/// count inside a range resolves to that range's cost. Returns 0 when no tier
/// applies — the caller surfaces a violation rather than guessing.
pub fn base_unit_points(unit: &Unit, model_count: u64, ordinal: u64) -> u64 {
    tier_cost(unit.points.iter().map(CostTier::from), model_count, ordinal)
}

/// The band/size/cost shape shared by native and allied tiers.
#[derive(Debug, Clone, Copy)]
pub(crate) struct CostTier {
    pub(crate) models: u64,
    cost: u64,
    unit_count_min: Option<u64>,
    unit_count_max: Option<u64>,
}

impl From<&UnitPointsItem> for CostTier {
    fn from(t: &UnitPointsItem) -> Self {
        CostTier {
            models: t.models.get(),
            cost: t.cost,
            unit_count_min: t.unit_count_min.map(|m| m.get()),
            unit_count_max: t.unit_count_max.map(|m| m.get()),
        }
    }
}

impl From<&UnitAlliedPointsItem> for CostTier {
    fn from(t: &UnitAlliedPointsItem) -> Self {
        CostTier {
            models: t.models.get(),
            cost: t.cost,
            unit_count_min: t.unit_count_min.map(|m| m.get()),
            unit_count_max: t.unit_count_max.map(|m| m.get()),
        }
    }
}

impl CostTier {
    fn covers_ordinal(&self, ordinal: u64) -> bool {
        let Some(min) = self.unit_count_min else {
            return true; // unbanded: applies to every copy
        };
        if ordinal < min {
            return false;
        }
        match self.unit_count_max {
            Some(max) => ordinal <= max,
            None => true, // open-ended top band
        }
    }
}

/// The two-step tier selection over an explicit tier table (native or allied).
fn tier_cost(table: impl Iterator<Item = CostTier>, model_count: u64, ordinal: u64) -> u64 {
    let mut tiers: Vec<CostTier> = table.filter(|t| t.covers_ordinal(ordinal)).collect();
    tiers.sort_by_key(|t| t.models);
    let Some(&first) = tiers.first() else {
        return 0;
    };
    let mut chosen = first;
    for t in &tiers {
        if model_count >= t.models {
            chosen = *t;
        }
    }
    chosen.cost
}

/// `Imperium` → `imperium`: faction keywords are display names, `host_faction`
/// values are id slugs.
fn keyword_slug(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
}

/// The points tiers in effect for a unit fielded in `host_faction`'s army.
///
/// A unit native to the host army (its `faction_id` IS the army's faction)
/// always prices from `points` — `allied_points` only ever applies to a unit
/// included in ANOTHER faction's army. For a foreign unit, entries whose
/// `host_faction` names the army's faction id exactly win (a chapter reprice);
/// otherwise entries naming a super-faction keyword the army's faction carries
/// apply (an Agents unit's `imperium` price). With no matching entry — or no
/// army context at all — the native table stands.
pub(crate) fn host_points_tiers(unit: &Unit, host_faction: Option<&Faction>) -> Vec<CostTier> {
    let native = || unit.points.iter().map(CostTier::from).collect::<Vec<_>>();
    let Some(host) = host_faction else {
        return native();
    };
    let entries = &unit.allied_points;
    if entries.is_empty() || unit.faction_id == host.id {
        return native();
    }
    let exact: Vec<CostTier> = entries
        .iter()
        .filter(|t| t.host_faction == host.id)
        .map(CostTier::from)
        .collect();
    if !exact.is_empty() {
        return exact;
    }
    let owned: HashSet<String> = host
        .keywords
        .as_ref()
        .map(|k| k.0.iter().map(|kw| keyword_slug(kw.as_str())).collect())
        .unwrap_or_default();
    let grouped: Vec<CostTier> = entries
        .iter()
        .filter(|t| owned.contains(t.host_faction.as_str()))
        .map(CostTier::from)
        .collect();
    if grouped.is_empty() {
        native()
    } else {
        grouped
    }
}

/// [`base_unit_points`], priced from the tier table in effect inside
/// `host_faction`'s army (see [`host_points_tiers`]). With no `host_faction`
/// this IS `base_unit_points`. Size coverage is identical across tables (allied
/// tiers reprice the native sizes), so [`points_tier_missing`] stays
/// native-only.
pub fn host_unit_points(
    unit: &Unit,
    model_count: u64,
    ordinal: u64,
    host_faction: Option<&Faction>,
) -> u64 {
    tier_cost(
        host_points_tiers(unit, host_faction).into_iter(),
        model_count,
        ordinal,
    )
}

/// True when no points tier covers `model_count` for this `ordinal` — the count
/// falls outside every tier's `[models, models_max]` range (below the smallest
/// tier, above the largest, or in a gap between non-contiguous tiers), or the
/// ordinal has no banded price. A single-size tier (no `models_max`) covers only
/// `models`. Mirrors the band filter of [`base_unit_points`].
pub fn points_tier_missing(unit: &Unit, model_count: u64, ordinal: u64) -> bool {
    for t in unit
        .points
        .iter()
        .filter(|t| tier_covers_ordinal(t, ordinal))
    {
        let lo = t.models.get();
        let hi = t.models_max.map(|m| m.get()).unwrap_or(lo);
        if lo <= model_count && model_count <= hi {
            return false;
        }
    }
    // No covering tier: either none present for this ordinal, or none contains the count.
    true
}

/// Per-item MFM wargear surcharge for a unit whose final loadout has `counts`
/// copies of each weapon/wargear id. Each `wargear_costs` entry charges `cost` for
/// every copy of `item_id` present — a Terminator Assault Squad's five thunder
/// hammers add 25, a Chapter Ancient's Banner of Macragge adds 10. Items with no
/// cost entry are free; absent `wargear_costs` contributes 0, so a unit's total is
/// `base_unit_points + wargear_points + enhancement`. Mirror of
/// `tools/src/data/pricing.ts` `wargearPoints`.
pub fn wargear_points(unit: &Unit, counts: &HashMap<String, i64>) -> u64 {
    let mut total: u64 = 0;
    for wc in &unit.wargear_costs {
        let n = counts.get(wc.item_id.as_str()).copied().unwrap_or(0).max(0) as u64;
        total += wc.cost * n;
    }
    total
}

#[cfg(all(test, feature = "bundled-data"))]
mod tests {
    use super::*;
    use crate::Dataset;

    /// World Eaters Chaos Terminators (the id is shared with Emperor's Children,
    /// so resolve the WE copy via `by_faction`).
    fn we_chaos_terminators() -> &'static Unit {
        Dataset::embedded()
            .units
            .by_faction("world-eaters")
            .into_iter()
            .find(|u| u.id.as_str() == "chaos-terminators")
            .expect("WE chaos terminators in dataset")
    }

    #[test]
    fn ordinal_bands_we_chaos_terminators() {
        let ct = we_chaos_terminators();
        // 1st–2nd copy: lower band.
        assert_eq!(base_unit_points(ct, 5, 1), 165);
        assert_eq!(base_unit_points(ct, 5, 2), 165);
        assert_eq!(base_unit_points(ct, 10, 1), 330);
        // 3rd+ copy: higher band (open-ended top).
        assert_eq!(base_unit_points(ct, 5, 3), 175);
        assert_eq!(base_unit_points(ct, 10, 3), 340);
        assert_eq!(base_unit_points(ct, 5, 7), 175);
        // The second build is a 6–10 range tier, so 7 models prices at it (330),
        // not the 5-model tier — a count inside a range resolves to that range.
        assert_eq!(base_unit_points(ct, 7, 1), 330);
    }

    #[test]
    fn unbanded_unit_ignores_ordinal() {
        let ds = Dataset::embedded();
        let bz = ds.units.get("khorne-berzerkers").expect("berzerkers");
        assert_eq!(base_unit_points(bz, 10, 1), base_unit_points(bz, 10, 99));
    }

    #[test]
    fn tier_missing_below_smallest_band_tier() {
        let ct = we_chaos_terminators();
        assert!(!points_tier_missing(ct, 5, 1));
        assert!(!points_tier_missing(ct, 5, 3));
        assert!(points_tier_missing(ct, 4, 1));
    }

    /// Venatari Custodians: 3 models @150 for the first two copies (160
    /// thereafter), or 4–6 @300 (310 thereafter).
    #[test]
    fn range_priced_tier_venatari() {
        let ds = Dataset::embedded();
        let ven = ds
            .units
            .by_faction("adeptus-custodes")
            .into_iter()
            .find(|u| u.id.as_str() == "venatari-custodians")
            .expect("venatari custodians in dataset");
        assert_eq!(base_unit_points(ven, 3, 1), 150);
        assert_eq!(base_unit_points(ven, 4, 1), 300);
        assert_eq!(base_unit_points(ven, 5, 1), 300);
        assert_eq!(base_unit_points(ven, 6, 1), 300);
        // Outside every tier range → missing (below the floor, above the ceiling).
        assert!(points_tier_missing(ven, 2, 1));
        assert!(!points_tier_missing(ven, 4, 1));
        assert!(!points_tier_missing(ven, 6, 1));
        assert!(points_tier_missing(ven, 7, 1));
    }
}
