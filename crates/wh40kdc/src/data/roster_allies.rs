//! Allied-pool attribution and keyword caps for the roster checker. Mirror of TS
//! `data/roster-allies.ts`; pinned by the `roster_validation` conformance corpus.

use std::collections::{BTreeMap, HashSet};

use crate::generated::{AlliedKeywordLimitBattleSize, AlliedRule, Unit};
use crate::import::BattleSize;
use crate::Dataset;

use super::roster::RosterViolationCode;

/// An army-level violation the allied-pool checks raise.
pub(crate) struct AllyViolation {
    pub code: RosterViolationCode,
    pub id: String,
    pub message: String,
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
            });
        }
    }
    out
}
