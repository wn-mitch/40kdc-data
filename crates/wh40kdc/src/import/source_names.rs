//! Source-name spellings the importer accepts for a weapon, wargear item or
//! ability: the name as printed, its punctuation-normalized form, and a
//! curated alias. Mirror of the TS `sourceNameVariants` / `lookupNameKeys` in
//! `tools/src/import/resolve.ts`, plus the weapon and wargear-item lookups
//! built on them.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::Regex;

use crate::data::{normalize_name, strip_leading_the, Dataset};

/// Export spellings with no matching repo name, keyed by `normalize_name` of
/// the punctuation-normalized source name. Tried after the printed name.
const SOURCE_NAME_ALIASES: &[(&str, &str)] = &[
    ("astartes chainsword", "Chainsword"),
    ("exo armour grenade launcher", "Exoarmour grenade launcher"),
    ("kombi rokkit", "Kombi-weapon"),
    ("kombi shoota", "Kombi-weapon"),
    ("leaders bio weapons", "Leader’s cult weapons"),
    ("pan spectral scanner", "Panspectral Scanner"),
    ("squig bomb", "Bomb Squig"),
];

static RE_DASHES: Lazy<Regex> = Lazy::new(|| Regex::new("[‐‑‒–—]").unwrap());
static RE_AMPERSAND: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*&\s*").unwrap());
static RE_AUTOCANON: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bautocanon\b").unwrap());

/// Unify dash variants, spell out `&`, and repair the "autocanon" typo.
fn normalized_source_punctuation(raw_name: &str) -> String {
    let dashes = RE_DASHES.replace_all(raw_name, "-");
    let ampersand = RE_AMPERSAND.replace_all(&dashes, " and ");
    RE_AUTOCANON
        .replace_all(&ampersand, "autocannon")
        .into_owned()
}

fn source_name_alias(raw_name: &str) -> Option<&'static str> {
    let key = normalize_name(&normalized_source_punctuation(raw_name));
    SOURCE_NAME_ALIASES
        .iter()
        .find(|(from, _)| *from == key)
        .map(|(_, to)| *to)
}

/// The printed name, its punctuation-normalized form, then its alias, in that
/// order and without duplicates.
fn source_name_variants(raw_name: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let candidates = [
        Some(raw_name.to_string()),
        Some(normalized_source_punctuation(raw_name)),
        source_name_alias(raw_name).map(str::to_string),
    ];
    for candidate in candidates.into_iter().flatten() {
        if !out.contains(&candidate) {
            out.push(candidate);
        }
    }
    out
}

/// Normalized keys for every variant, each with leading-"The" tolerance in
/// both directions.
pub(super) fn lookup_name_keys(raw_name: &str) -> HashSet<String> {
    let mut keys = HashSet::new();
    for variant in source_name_variants(raw_name) {
        keys.insert(normalize_name(&variant));
        keys.insert(normalize_name(&format!("The {variant}")));
        if let Some(stripped) = strip_leading_the(&variant) {
            keys.insert(normalize_name(&stripped));
        }
    }
    keys
}

/// True when any variant of a record name is one of `keys`.
pub(super) fn name_matches(keys: &HashSet<String>, record_name: &str) -> bool {
    source_name_variants(record_name)
        .iter()
        .any(|variant| keys.contains(&normalize_name(variant)))
}

/// Resolve a weapon raw name to candidate weapons, tolerating a leading "The "
/// mismatch in either direction (NewRecruit "The Bloody Twins" ↔ data "Bloody
/// Twins"; GW "Fire Axe" ↔ data "The Fire Axe"). For each source-name variant
/// (printed, punctuation-normalized, alias) tries the name as given, then the
/// "The"-stripped form, then the "The"-prefixed form, returning the first
/// non-empty match set. Mirror of the TS `findWeaponCandidates`.
pub(super) fn find_weapon_candidates<'a>(
    ds: &'a Dataset,
    raw_name: &str,
) -> Vec<&'a crate::Weapon> {
    for variant in source_name_variants(raw_name) {
        let direct = ds.weapons.find_all(&variant);
        if !direct.is_empty() {
            return direct;
        }
        if let Some(stripped) = strip_leading_the(&variant) {
            let hits = ds.weapons.find_all(&stripped);
            if !hits.is_empty() {
                return hits;
            }
        }
        let prefixed = ds.weapons.find_all(&format!("The {variant}"));
        if !prefixed.is_empty() {
            return prefixed;
        }
    }
    Vec::new()
}

/// Ids reachable from a unit: its `weapon_ids`, then every wargear option's
/// replaced, replacement and replacement-choice ids, in order, deduplicated.
fn unit_reachable_ids<'a>(ds: &'a Dataset, unit: &'a crate::Unit) -> Vec<&'a str> {
    let mut out: Vec<&str> = Vec::new();
    let mut push = |id: &'a str| {
        if !out.contains(&id) {
            out.push(id);
        }
    };
    for id in &unit.weapon_ids {
        push(id.as_str());
    }
    for opt in ds.wargear_options_of(unit) {
        for id in opt
            .replaces
            .iter()
            .chain(&opt.replacement)
            .chain(opt.replacement_choice.iter().flatten())
        {
            push(id.as_str());
        }
    }
    out
}

/// Resolve a weapon raw name to one of the RESOLVED unit's own weapon ids — its
/// `weapon_ids` plus ids reachable through its wargear options. Per-unit stat
/// variants share a NAME, so a name match must pick the variant the resolved
/// unit actually fields. The printed name (and its punctuation-normalized form)
/// is matched first, so a unit that really carries a weapon under that name
/// keeps it; only then do the leading-"The" and alias variants apply. Returns
/// None when the unit fields no weapon of that name (the caller falls back to
/// the global lookup). Mirror of the TS `scopedWeaponId`.
pub(super) fn scoped_weapon_id<'a>(
    ds: &'a Dataset,
    unit: &'a crate::Unit,
    raw_name: &str,
) -> Option<&'a str> {
    let ids = unit_reachable_ids(ds, unit);
    let weapon = |id: &str| {
        ds.weapons
            .get_in_faction(id, unit.faction_id.as_str())
            .or_else(|| ds.weapons.get_any(id))
    };
    let direct_targets = [
        normalize_name(raw_name),
        normalize_name(&normalized_source_punctuation(raw_name)),
    ];
    for id in &ids {
        if let Some(w) = weapon(id) {
            let names = [
                normalize_name(&w.name),
                normalize_name(&normalized_source_punctuation(&w.name)),
            ];
            if names.iter().any(|n| direct_targets.contains(n)) {
                return Some(w.id.as_str());
            }
        }
    }
    let keys = lookup_name_keys(raw_name);
    ids.iter()
        .filter_map(|id| weapon(id))
        .find(|w| name_matches(&keys, &w.name))
        .map(|w| w.id.as_str())
}

/// Fallback for wargear ITEMS (Simulacrum Imperialis, Daemonic Icon, …) — raw
/// names that are not weapons but do exist in the wargear collection. Runs only
/// after BOTH weapon lookups miss, so a wargear item whose name collides with a
/// weapon ("multi-melta", "power weapon") keeps resolving to the weapon exactly
/// as before. Scoped-first: ids reachable through the resolved unit's wargear
/// options, then the global collection (wargear is replicated-identical across
/// factions, so a global first-match is safe). Same `normalize_name` +
/// leading-"The" tolerance as the weapon lookups. Mirror of the TS
/// `resolveWargearItemId`.
pub(super) fn resolve_wargear_item_id<'a>(
    ds: &'a Dataset,
    hit: Option<&crate::Unit>,
    raw_name: &str,
) -> Option<&'a str> {
    if let Some(unit) = hit {
        let keys = lookup_name_keys(raw_name);
        for opt in ds.wargear_options_of(unit) {
            for id in opt
                .replaces
                .iter()
                .chain(&opt.replacement)
                .chain(opt.replacement_choice.iter().flatten())
            {
                if let Some(item) = ds.wargear.get_any(id.as_str()) {
                    if name_matches(&keys, &item.name) {
                        return Some(item.id.as_str());
                    }
                }
            }
        }
    }
    for variant in source_name_variants(raw_name) {
        if let Some(item) = ds.wargear.find(&variant) {
            return Some(item.id.as_str());
        }
        if let Some(stripped) = strip_leading_the(&variant) {
            if let Some(item) = ds.wargear.find(&stripped) {
                return Some(item.id.as_str());
            }
        }
        if let Some(item) = ds.wargear.find(&format!("The {variant}")) {
            return Some(item.id.as_str());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_try_printed_name_before_alias() {
        assert_eq!(
            source_name_variants("Astartes chainsword"),
            vec!["Astartes chainsword".to_string(), "Chainsword".to_string()]
        );
        assert_eq!(
            source_name_variants("Squig–bomb"),
            vec![
                "Squig–bomb".to_string(),
                "Squig-bomb".to_string(),
                "Bomb Squig".to_string()
            ]
        );
    }

    #[test]
    fn punctuation_normalizes_ampersand_and_typo() {
        assert_eq!(
            normalized_source_punctuation("Bolt rifle & Autocanon"),
            "Bolt rifle and autocannon"
        );
    }
}
