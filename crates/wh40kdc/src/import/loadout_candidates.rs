//! Exact per-model loadout groups read from a text export. A group is kept only
//! when the groups together account for every model and every wargear count, so
//! resolve can trust them instead of rebuilding groups from composition. Mirror
//! of the `candidateGroups` check in `tools/src/import/gw-headerless.ts`.

use super::types::{ParsedLoadoutGroup, ParsedWargear};

/// The candidate groups when they cover `model_count` models and reproduce the
/// unit's wargear totals exactly; otherwise None.
pub(super) fn exact_loadout_groups(
    candidates: Vec<ParsedLoadoutGroup>,
    model_count: u64,
    wargear: &[ParsedWargear],
) -> Option<Vec<ParsedLoadoutGroup>> {
    let grouped_models: u64 = candidates.iter().map(|g| g.count).sum();
    if grouped_models != model_count {
        return None;
    }
    let mut grouped: Vec<(&str, u64)> = Vec::new();
    for group in &candidates {
        for item in &group.wargear {
            let total = item.count * group.count;
            match grouped.iter_mut().find(|(name, _)| *name == item.raw_name) {
                Some((_, count)) => *count += total,
                None => grouped.push((item.raw_name.as_str(), total)),
            }
        }
    }
    let exact = grouped.len() == wargear.len()
        && wargear.iter().all(|w| {
            grouped
                .iter()
                .any(|(name, count)| *name == w.raw_name && *count == w.count)
        });
    exact.then_some(candidates)
}
