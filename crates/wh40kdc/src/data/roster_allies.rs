//! Allied-pool attribution, caps and locks for the roster checker. Mirror of TS
//! `data/roster-allies.ts`; pinned by the `roster_validation` conformance corpus.

use std::collections::{BTreeMap, HashSet};

use crate::generated::{
    AlliedKeywordLimitBattleSize, AlliedPointsLimitBattleSize, AlliedRule, Unit,
};
use crate::import::BattleSize;
use crate::Dataset;

use super::roster::RosterViolationCode;

/// A violation the allied-pool checks raise; `unit_index` is `None` for an
/// army-level one.
pub(crate) struct AllyViolation {
    pub code: RosterViolationCode,
    pub id: String,
    pub message: String,
    pub unit_index: Option<usize>,
}

/// A roster unit included through an allied rule, as `ally_pool_violations`
/// reads it.
pub(crate) struct AllyMember<'a> {
    pub unit_id: &'a str,
    /// Index into the roster's units.
    pub index: usize,
    /// The unit's roster cost (host-aware points, wargear and enhancement).
    pub cost: u64,
    pub is_warlord: bool,
    pub has_enhancement: bool,
    /// True when the unit is BATTLELINE (role or keyword).
    pub battleline: bool,
    /// The unit's roster keyword set.
    pub keywords: HashSet<String>,
}

/// The offered allied rule each foreign roster unit is included through, by
/// index into `views`. A unit is foreign when its `faction_id` differs from the
/// army's and it carries a Faction keyword the army faction lacks. It is
/// attributed to the first offered, non-`exclusive` rule (`allies_for` order)
/// whose pool (`ally_units_for`) lists its id; otherwise it is left out.
pub(crate) fn attribute_allies<'a>(
    dataset: &'a Dataset,
    faction_id: Option<&str>,
    detachment_ids: &[String],
    army_keywords: &HashSet<String>,
    views: &[Option<&Unit>],
) -> BTreeMap<usize, &'a AlliedRule> {
    let mut out = BTreeMap::new();
    let Some(faction_id) = faction_id else {
        return out;
    };
    let detachments: Vec<&str> = detachment_ids.iter().map(String::as_str).collect();
    let pools: Vec<(&AlliedRule, HashSet<&str>)> = dataset
        .allies_for(faction_id, &detachments)
        .into_iter()
        .filter(|rule| !rule.exclusive)
        .map(|rule| {
            let ids = dataset
                .ally_units_for(rule.id.as_str())
                .into_iter()
                .map(|u| u.id.as_str())
                .collect();
            (rule, ids)
        })
        .collect();
    for (idx, view) in views.iter().enumerate() {
        let Some(view) = view else { continue };
        if view.faction_id.as_str() == faction_id {
            continue;
        }
        let in_army = view
            .faction_keywords
            .as_ref()
            .map(|kws| kws.0.iter().all(|k| army_keywords.contains(k.as_str())))
            .unwrap_or(true);
        if in_army {
            continue;
        }
        if let Some((rule, _)) = pools.iter().find(|(_, ids)| ids.contains(view.id.as_str())) {
            out.insert(idx, *rule);
        }
    }
    out
}

fn same_size(limit: AlliedKeywordLimitBattleSize, size: BattleSize) -> bool {
    matches!(
        (limit, size),
        (
            AlliedKeywordLimitBattleSize::Incursion,
            BattleSize::Incursion
        ) | (
            AlliedKeywordLimitBattleSize::StrikeForce,
            BattleSize::StrikeForce
        )
    )
}

/// The keyword-cap violations of one allied rule over the keyword sets of the
/// units included through it (keywords match case-insensitively): each
/// `keyword_limits` cap at `battle_size`, less one counted receiver unit per
/// donor unit for each exemption; and, for `keyword_limits_exclusive`, more than
/// one limited keyword present at any battle size.
pub(crate) fn ally_keyword_limit_violations(
    rule: &AlliedRule,
    members: &[HashSet<String>],
    battle_size: Option<BattleSize>,
) -> Vec<AllyViolation> {
    let mut out = Vec::new();
    let lowered: Vec<HashSet<String>> = members
        .iter()
        .map(|kws| kws.iter().map(|k| k.to_lowercase()).collect())
        .collect();
    let has_all = |kws: &HashSet<String>, need: &[crate::generated::Keyword]| {
        need.iter()
            .all(|k| kws.contains(&k.as_str().to_lowercase()))
    };
    let limits = rule.keyword_limits.as_deref().unwrap_or(&[]);
    for limit in limits {
        let Some(size) = battle_size else { continue };
        if !same_size(limit.battle_size, size) {
            continue;
        }
        let keyword = limit.keyword.as_str();
        let wanted = keyword.to_lowercase();
        let counted: Vec<usize> = (0..lowered.len())
            .filter(|&i| lowered[i].contains(&wanted))
            .collect();
        let mut exempt: HashSet<usize> = HashSet::new();
        for ex in limit.exemptions.iter().flatten() {
            let mut donors = lowered
                .iter()
                .filter(|kws| has_all(kws, &ex.donor_keywords))
                .count();
            for &i in &counted {
                if donors == 0 {
                    break;
                }
                if exempt.contains(&i) || !has_all(&lowered[i], &ex.receiver_keywords) {
                    continue;
                }
                exempt.insert(i);
                donors -= 1;
            }
        }
        let count = (counted.len() - exempt.len()) as u64;
        if count > limit.max_count {
            out.push(AllyViolation {
                code: RosterViolationCode::AllyKeywordLimitExceeded,
                id: format!("{}:{}", rule.id.as_str(), keyword),
                message: format!(
                    "{} includes {} {} units, over the limit of {}",
                    rule.id.as_str(),
                    count,
                    keyword,
                    limit.max_count
                ),
                unit_index: None,
            });
        }
    }
    if rule.keyword_limits_exclusive {
        let mut keywords: Vec<&str> = Vec::new();
        for limit in limits {
            if !keywords.contains(&limit.keyword.as_str()) {
                keywords.push(limit.keyword.as_str());
            }
        }
        let mut used: Vec<&str> = keywords
            .iter()
            .copied()
            .filter(|k| {
                let k = k.to_lowercase();
                lowered.iter().any(|kws| kws.contains(&k))
            })
            .collect();
        used.sort();
        if used.len() > 1 {
            keywords.sort();
            out.push(AllyViolation {
                code: RosterViolationCode::AllyKeywordLimitsExclusive,
                id: rule.id.as_str().to_string(),
                message: format!(
                    "{} allows only one of {}; the army includes {} units",
                    rule.id.as_str(),
                    keywords.join(", "),
                    used.join(" and ")
                ),
                unit_index: None,
            });
        }
    }
    out
}

/// The pool-level violations of one allied rule over the units included
/// through it, in this order: the `points_limits` cap at `battle_size` on the
/// members' combined cost; the `cannot_be_warlord` lock (lifted for a datasheet
/// in `warlord_exempt`); the `cannot_take_enhancements` lock; and, for each
/// `battleline_ratio_keywords` keyword at any battle size, more non-BATTLELINE
/// members carrying it than BATTLELINE ones (keywords match case-insensitively).
pub(crate) fn ally_pool_violations(
    rule: &AlliedRule,
    members: &[AllyMember],
    battle_size: Option<BattleSize>,
    warlord_exempt: &HashSet<&str>,
) -> Vec<AllyViolation> {
    let mut out = Vec::new();
    let cap = rule.points_limits.iter().flatten().find(|p| {
        matches!(
            (p.battle_size, battle_size),
            (
                AlliedPointsLimitBattleSize::Incursion,
                Some(BattleSize::Incursion)
            ) | (
                AlliedPointsLimitBattleSize::StrikeForce,
                Some(BattleSize::StrikeForce)
            )
        )
    });
    if let Some(cap) = cap {
        let spent: u64 = members.iter().map(|m| m.cost).sum();
        if spent > cap.max_points {
            out.push(AllyViolation {
                code: RosterViolationCode::AllyPointsOverLimit,
                id: rule.id.as_str().to_string(),
                message: format!(
                    "{} units total {spent}, over the {} limit",
                    rule.id.as_str(),
                    cap.max_points
                ),
                unit_index: None,
            });
        }
    }
    for m in members {
        if rule.cannot_be_warlord && m.is_warlord && !warlord_exempt.contains(m.unit_id) {
            out.push(AllyViolation {
                code: RosterViolationCode::AllyCannotBeWarlord,
                id: m.unit_id.to_string(),
                message: format!("{} cannot be Warlord under {}", m.unit_id, rule.id.as_str()),
                unit_index: Some(m.index),
            });
        }
        if rule.cannot_take_enhancements && m.has_enhancement {
            out.push(AllyViolation {
                code: RosterViolationCode::AllyCannotTakeEnhancements,
                id: m.unit_id.to_string(),
                message: format!(
                    "{} cannot take an Enhancement under {}",
                    m.unit_id,
                    rule.id.as_str()
                ),
                unit_index: Some(m.index),
            });
        }
    }
    for keyword in rule
        .battleline_ratio_keywords
        .iter()
        .flat_map(|ks| ks.0.iter())
    {
        let keyword = keyword.as_str();
        let lower = keyword.to_lowercase();
        let (mut battleline, mut other) = (0usize, 0usize);
        for m in members {
            if !m.keywords.iter().any(|k| k.to_lowercase() == lower) {
                continue;
            }
            if m.battleline {
                battleline += 1;
            } else {
                other += 1;
            }
        }
        if other > battleline {
            out.push(AllyViolation {
                code: RosterViolationCode::AllyBattlelineRatioExceeded,
                id: format!("{}:{}", rule.id.as_str(), keyword),
                message: format!(
                    "{} includes {other} non-Battleline {keyword} units, more than its {battleline} Battleline {keyword} units",
                    rule.id.as_str()
                ),
                unit_index: None,
            });
        }
    }
    out
}
