//! Resolve which roster units an ability (typically a detachment rule)
//! benefits, from its curated `applies_to` keyword filter. This is the
//! roster-highlighting contract consumers replicate: a unit matches iff it
//! carries every `required_keywords` entry and none of the `excluded_keywords`,
//! compared against the union of its `keywords` and `faction_keywords`.
//! Keywords compare without regard to case or apostrophe style
//! ([`keyword_key`]): rules print them uppercase, as `applies_to` spells them,
//! while units store datasheet spelling.
//!
//! Two distinct "no constraint" forms, both deliberate:
//!   - a `None`/absent filter has no resolvable scope and matches nothing (the
//!     app renders no highlight rather than guess);
//!   - a present filter with neither keyword list constrains nothing and
//!     matches every unit (vacuous required/excluded sets).
//!
//! Mirrors `tools/src/scope.ts` (TS) and `wh40kdc.scope` (Python); pinned
//! byte-for-byte across the ports by the `conformance/applies-to` corpus (bump
//! `conformance/SPEC_VERSION` on change). Depends only on the generated types,
//! so it stays available in a types-only (`default-features = false`) build.

use std::collections::HashSet;

use crate::{AbilityAppliesTo, Unit};

/// True when a unit owning `owned_keywords` (the union of its `keywords` and
/// `faction_keywords`) falls within `filter`'s scope. See the module docs for
/// the `None`-vs-empty-filter semantics.
pub fn unit_matches_applies_to<'a>(
    filter: Option<&AbilityAppliesTo>,
    owned_keywords: impl IntoIterator<Item = &'a str>,
) -> bool {
    let Some(filter) = filter else {
        return false;
    };
    let owned: HashSet<String> = owned_keywords.into_iter().map(keyword_key).collect();
    if let Some(required) = filter.required_keywords.as_ref() {
        if !required.0.iter().all(|kw| owned.contains(&keyword_key(kw))) {
            return false;
        }
    }
    if let Some(excluded) = filter.excluded_keywords.as_ref() {
        if excluded.0.iter().any(|kw| owned.contains(&keyword_key(kw))) {
            return false;
        }
    }
    true
}

/// How two keyword spellings compare: uppercase, with a curly apostrophe read
/// as a straight one.
pub fn keyword_key(keyword: &str) -> String {
    keyword.to_uppercase().replace('’', "'")
}

/// Convenience over [`unit_matches_applies_to`] for a typed [`Unit`]: unions the
/// unit's `keywords` and `faction_keywords` and applies the filter.
pub fn ability_applies_to_unit(filter: Option<&AbilityAppliesTo>, unit: &Unit) -> bool {
    let keywords = unit.keywords.iter().flat_map(|kl| kl.0.iter());
    let faction = unit.faction_keywords.iter().flat_map(|kl| kl.0.iter());
    unit_matches_applies_to(filter, keywords.chain(faction).map(|k| k.as_str()))
}
