//! Chapter cohesion for the roster checker: which chapter-locked units an army
//! under a `faction-keyword-cohesion` rule may not take. Mirror of TS
//! `data/roster-chapter.ts`; pinned by the `roster_validation` conformance corpus.

use std::collections::HashSet;

use crate::generated::{Faction, KeywordList, Unit};

/// A roster unit locked to a chapter its army may not take.
pub(crate) struct ChapterMismatch {
    /// Index into the roster's units.
    pub index: usize,
    /// The unit's chapter keywords (its faction keywords other than the base keyword).
    pub keywords: Vec<String>,
}

fn keyword_strings(list: Option<&KeywordList>) -> Vec<String> {
    list.map(|k| k.0.iter().map(|kw| kw.as_str().to_string()).collect())
        .unwrap_or_default()
}

/// A child faction's own keywords: its keywords minus its parent's.
fn own_keywords(child: &Faction, parent: &Faction) -> Vec<String> {
    let inherited: HashSet<String> = keyword_strings(parent.keywords.as_ref())
        .into_iter()
        .collect();
    keyword_strings(child.keywords.as_ref())
        .into_iter()
        .filter(|k| !inherited.contains(k))
        .collect()
}

/// The units an army under a `faction-keyword-cohesion` rule may not take. A unit
/// carrying the base keyword plus other faction keywords is locked to a chapter;
/// allies (no base keyword) and generic units are not judged here. A chapter army
/// (a child of `parent`) takes only its own chapter's units. A parent army takes no
/// chapter's units: each child faction is an army of its own. `children` are the
/// factions whose `parent_faction_id` is the army's faction.
pub(crate) fn chapter_mismatches(
    faction: Option<&Faction>,
    parent: Option<&Faction>,
    children: &[&Faction],
    views: &[Option<&Unit>],
) -> Vec<ChapterMismatch> {
    let Some(faction) = faction else {
        return Vec::new();
    };
    let Some(rule) = faction
        .army_construction_rules
        .iter()
        .find(|r| r.type_.as_str() == Some("faction-keyword-cohesion"))
    else {
        return Vec::new();
    };
    let base = rule.base_faction_keyword.as_str();
    let (keywords, chapter_army): (HashSet<String>, bool) = if faction.parent_faction_id.is_some() {
        let Some(parent) = parent else {
            return Vec::new();
        };
        (own_keywords(faction, parent).into_iter().collect(), true)
    } else {
        let chapters = children
            .iter()
            .flat_map(|child| own_keywords(child, faction))
            .collect();
        (chapters, false)
    };
    if keywords.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for (index, view) in views.iter().enumerate() {
        let Some(view) = view else { continue };
        let unit_keywords = keyword_strings(view.faction_keywords.as_ref());
        if !unit_keywords.iter().any(|k| k == base) {
            continue;
        }
        let own: Vec<String> = unit_keywords.into_iter().filter(|k| k != base).collect();
        let hit = own.iter().any(|k| keywords.contains(k));
        let barred = if chapter_army { !hit } else { hit };
        if !own.is_empty() && barred {
            out.push(ChapterMismatch {
                index,
                keywords: own,
            });
        }
    }
    out
}
