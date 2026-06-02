//! Wargear-loadout maths shared by every consumer of the dataset: how many
//! models may take an option, the maximal (take-every-swap) loadout, the valid
//! count range for each weapon, and whether an edited loadout is legal.
//!
//! The base loadout is derived, not stored: a weapon in `unit.weapon_ids` that
//! never appears as the *replacement* of any option is a **base** weapon, carried
//! by every model; a weapon that does appear as a replacement is **optional**,
//! carried only by the models that took the swap. This holds for uniform
//! infantry squads and is exactly what the conformance corpus pins. Mirror of
//! `tools/src/data/loadout.ts`.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::generated::{Unit, WargearOption};

/// Inclusive count range a single weapon/wargear id may take in a loadout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WeaponBound {
    pub min: u64,
    pub max: u64,
}

/// A resolved loadout: entity id (weapon or wargear) → count across the unit.
/// Counts are signed because an intermediate swap can drive a malformed dataset
/// negative; valid data never does.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Loadout {
    pub counts: BTreeMap<String, i64>,
}

/// A loadout-rule violation. `id` is the offending weapon/wargear id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    pub id: String,
    pub code: ViolationCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViolationCode {
    ExceedsMax,
    BelowMin,
}

impl ViolationCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ViolationCode::ExceedsMax => "exceeds-max",
            ViolationCode::BelowMin => "below-min",
        }
    }
}

/// The maximum number of models that may take `option` in a unit of
/// `model_count` models. See [`super`] / the TS mirror for the semantics.
pub fn option_cap(option: &WargearOption, model_count: u64) -> u64 {
    let Some(c) = option.model_constraint.as_ref() else {
        return model_count;
    };
    let mut cap = if c.any_number {
        model_count
    } else if let Some(per) = c.per_n_models {
        model_count / per.get()
    } else {
        c.max_count.map(|m| m.get()).unwrap_or(1)
    };
    if let Some(m) = c.max_count {
        cap = cap.min(m.get());
    }
    cap
}

/// The ids a single option adds for the given choice branch (default 0).
fn added_ids(option: &WargearOption, choice_index: usize) -> Vec<&str> {
    if !option.replacement.is_empty() {
        return option.replacement.iter().map(|i| i.as_str()).collect();
    }
    option
        .replacement_choice
        .get(choice_index)
        .map(|g| g.iter().map(|i| i.as_str()).collect())
        .unwrap_or_default()
}

/// Every id that any option can add — across all choice branches.
fn all_replacement_ids(options: &[&WargearOption]) -> HashSet<String> {
    let mut out = HashSet::new();
    for o in options {
        for id in &o.replacement {
            out.insert(id.to_string());
        }
        for group in &o.replacement_choice {
            for id in group {
                out.insert(id.to_string());
            }
        }
    }
    out
}

/// Base (always-carried) weapon ids: in `weapon_ids`, never a replacement.
fn base_weapon_ids(unit: &Unit, options: &[&WargearOption]) -> Vec<String> {
    let replacements = all_replacement_ids(options);
    unit.weapon_ids
        .iter()
        .map(|i| i.to_string())
        .filter(|id| !replacements.contains(id))
        .collect()
}

/// The maximal loadout: every base weapon on every model, then each option
/// applied at its full [`option_cap`] (choices take their first branch).
pub fn maximal_loadout(unit: &Unit, model_count: u64, options: &[&WargearOption]) -> Loadout {
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for id in base_weapon_ids(unit, options) {
        *counts.entry(id).or_insert(0) += model_count as i64;
    }
    for option in options {
        let cap = option_cap(option, model_count) as i64;
        if cap == 0 {
            continue;
        }
        for id in &option.replaces {
            *counts.entry(id.to_string()).or_insert(0) -= cap;
        }
        for id in added_ids(option, 0) {
            *counts.entry(id.to_string()).or_insert(0) += cap;
        }
    }
    counts.retain(|_, n| *n != 0);
    Loadout { counts }
}

/// Inclusive valid count range for each weapon/wargear id, used to clamp a UI's
/// per-weapon inputs so invalid loadouts are unreachable.
pub fn weapon_bounds(
    unit: &Unit,
    model_count: u64,
    options: &[&WargearOption],
) -> BTreeMap<String, WeaponBound> {
    let mut bounds: BTreeMap<String, WeaponBound> = BTreeMap::new();
    for id in base_weapon_ids(unit, options) {
        bounds.insert(
            id,
            WeaponBound {
                min: model_count,
                max: model_count,
            },
        );
    }
    for option in options {
        let cap = option_cap(option, model_count);
        for id in &option.replaces {
            let b = bounds.entry(id.to_string()).or_insert(WeaponBound { min: 0, max: 0 });
            b.min = b.min.saturating_sub(cap);
        }
        let mut adds: HashSet<String> = HashSet::new();
        for id in &option.replacement {
            adds.insert(id.to_string());
        }
        for group in &option.replacement_choice {
            for id in group {
                adds.insert(id.to_string());
            }
        }
        for id in adds {
            let b = bounds.entry(id).or_insert(WeaponBound { min: 0, max: 0 });
            b.max += cap;
        }
    }
    bounds
}

/// Clamp a single weapon's requested count into its valid range. Ids with no
/// bound are returned unchanged (floored at zero).
pub fn clamp_weapon_count(
    bounds: &BTreeMap<String, WeaponBound>,
    id: &str,
    requested: u64,
) -> u64 {
    match bounds.get(id) {
        Some(b) => requested.min(b.max).max(b.min),
        None => requested,
    }
}

/// Report every weapon/wargear count outside its valid range, sorted by
/// `(id, code)` for stable cross-impl comparison.
pub fn validate_loadout(
    unit: &Unit,
    model_count: u64,
    options: &[&WargearOption],
    counts: &HashMap<String, i64>,
) -> Vec<Violation> {
    let bounds = weapon_bounds(unit, model_count, options);
    let mut out = Vec::new();
    for (id, &n) in counts {
        let Some(b) = bounds.get(id) else { continue };
        if n > b.max as i64 {
            out.push(Violation {
                id: id.clone(),
                code: ViolationCode::ExceedsMax,
                message: format!("{id}: {n} exceeds max {}", b.max),
            });
        } else if n < b.min as i64 {
            out.push(Violation {
                id: id.clone(),
                code: ViolationCode::BelowMin,
                message: format!("{id}: {n} below min {}", b.min),
            });
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id).then(a.code.as_str().cmp(b.code.as_str())));
    out
}

#[cfg(all(test, feature = "bundled-data"))]
mod tests {
    use super::*;
    use crate::Dataset;

    fn berzerkers() -> (&'static crate::generated::Unit, Vec<&'static WargearOption>) {
        let ds = Dataset::embedded();
        let bz = ds.units.get("khorne-berzerkers").expect("berzerkers in dataset");
        (bz, ds.wargear_options_of(bz))
    }

    #[test]
    fn maximal_loadout_berzerkers_at_10_matches_locked_numbers() {
        let (bz, opts) = berzerkers();
        assert_eq!(opts.len(), 4, "3 swaps + 1 add-on");
        let lo = maximal_loadout(bz, 10, &opts);
        let get = |k: &str| lo.counts.get(k).copied().unwrap_or(0);
        assert_eq!(get("bolt-pistol"), 7);
        assert_eq!(get("chainblade"), 8);
        assert_eq!(get("plasma-pistol"), 3);
        assert_eq!(get("khornate-eviscerator"), 2);
        assert_eq!(get("icon-of-khorne"), 1);
    }

    #[test]
    fn option_cap_floors_a_ratio() {
        let (_bz, opts) = berzerkers();
        let ratio = opts
            .iter()
            .find(|o| o.model_constraint.as_ref().and_then(|c| c.per_n_models).is_some())
            .expect("a per_n_models option");
        assert_eq!(option_cap(ratio, 10), 2);
        assert_eq!(option_cap(ratio, 9), 1);
    }

    #[test]
    fn validate_flags_over_cap_and_accepts_maximal() {
        let (bz, opts) = berzerkers();
        let mut over = HashMap::new();
        over.insert("plasma-pistol".to_string(), 4i64);
        let v = validate_loadout(bz, 10, &opts, &over);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].id, "plasma-pistol");
        assert_eq!(v[0].code, ViolationCode::ExceedsMax);

        let lo = maximal_loadout(bz, 10, &opts);
        let counts: HashMap<String, i64> = lo.counts.into_iter().collect();
        assert!(validate_loadout(bz, 10, &opts, &counts).is_empty());
    }
}
