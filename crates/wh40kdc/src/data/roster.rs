//! Whole-army roster legality: the per-unit loadout check on every resolved
//! unit, plus the nine army-construction dimensions (enhancements, leader
//! attachment, points, detachment points, force disposition, detachment
//! tags/restrictions, warlord, unit minimums).
//!
//! A roster is legal iff its `army` violations contain no `error`-severity entry
//! and every `units[].violations` is empty. Mirror of
//! `tools/src/data/roster-resolve.ts` (`validateRosterCore` / `checkRoster`).

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::data::battle_sizes::{
    detachment_cap_for_battle_size, enhancement_limit_for_battle_size,
    points_limit_for_battle_size, unit_limit_for_battle_size,
};
use crate::data::loadout::{check_unit_legality, loadout_models, loadout_tiers, Violation};
use crate::data::pricing::{army_unit_points, wargear_points};
use crate::generated::{Unit, UnitRole};
use crate::import::{BattleSize, Roster};
use crate::Dataset;

/// Army-construction violation codes (distinct from per-unit loadout codes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RosterViolationCode {
    EnhancementWrongDetachment,
    EnhancementOnNonCharacter,
    EnhancementOnEpicHero,
    EnhancementOnExcludedModel,
    EnhancementKeywordMismatch,
    EnhancementExcludedKeyword,
    EnhancementOverMaxTargets,
    LeaderAttachmentIllegal,
    LeaderMustAttach,
    PointsOverLimit,
    DetachmentPointsOver,
    DispositionNotPicked,
    DispositionInvalid,
    DetachmentTagConflict,
    DetachmentRestrictionRequired,
    DetachmentRestrictionExcluded,
    UnitExcludedFromFaction,
    NoWarlord,
    MultipleWarlords,
    WarlordNotMandated,
    DetachmentExcludedDatasheet,
    KeywordLimitExceeded,
    UnitLimitExceeded,
    EnhancementLimitExceeded,
    AllyPoolNotOffered,
    AllyPointsOverLimit,
    AllyCannotBeWarlord,
    AllyCannotTakeEnhancements,
    UnitMinimumUnmet,
}

impl RosterViolationCode {
    pub fn as_str(self) -> &'static str {
        match self {
            RosterViolationCode::EnhancementWrongDetachment => "enhancement-wrong-detachment",
            RosterViolationCode::EnhancementOnNonCharacter => "enhancement-on-non-character",
            RosterViolationCode::EnhancementOnEpicHero => "enhancement-on-epic-hero",
            RosterViolationCode::EnhancementOnExcludedModel => "enhancement-on-excluded-model",
            RosterViolationCode::EnhancementKeywordMismatch => "enhancement-keyword-mismatch",
            RosterViolationCode::EnhancementExcludedKeyword => "enhancement-excluded-keyword",
            RosterViolationCode::EnhancementOverMaxTargets => "enhancement-over-max-targets",
            RosterViolationCode::LeaderAttachmentIllegal => "leader-attachment-illegal",
            RosterViolationCode::LeaderMustAttach => "leader-must-attach",
            RosterViolationCode::PointsOverLimit => "points-over-limit",
            RosterViolationCode::DetachmentPointsOver => "detachment-points-over",
            RosterViolationCode::DispositionNotPicked => "disposition-not-picked",
            RosterViolationCode::DispositionInvalid => "disposition-invalid",
            RosterViolationCode::DetachmentTagConflict => "detachment-tag-conflict",
            RosterViolationCode::DetachmentRestrictionRequired => "detachment-restriction-required",
            RosterViolationCode::DetachmentRestrictionExcluded => "detachment-restriction-excluded",
            RosterViolationCode::UnitExcludedFromFaction => "unit-excluded-from-faction",
            RosterViolationCode::NoWarlord => "no-warlord",
            RosterViolationCode::MultipleWarlords => "multiple-warlords",
            RosterViolationCode::WarlordNotMandated => "warlord-not-mandated",
            RosterViolationCode::DetachmentExcludedDatasheet => "detachment-excluded-datasheet",
            RosterViolationCode::KeywordLimitExceeded => "keyword-limit-exceeded",
            RosterViolationCode::UnitLimitExceeded => "unit-limit-exceeded",
            RosterViolationCode::EnhancementLimitExceeded => "enhancement-limit-exceeded",
            RosterViolationCode::AllyPoolNotOffered => "ally-pool-not-offered",
            RosterViolationCode::AllyPointsOverLimit => "ally-points-over-limit",
            RosterViolationCode::AllyCannotBeWarlord => "ally-cannot-be-warlord",
            RosterViolationCode::AllyCannotTakeEnhancements => "ally-cannot-take-enhancements",
            RosterViolationCode::UnitMinimumUnmet => "unit-minimum-unmet",
        }
    }
}

/// Violation severity. A roster is legal iff it has no `Error` violations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warn,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warn => "warn",
        }
    }
}

/// One army-level legality violation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterViolation {
    pub code: RosterViolationCode,
    /// Offending entity id (enhancement/unit/keyword/tag), or "roster" for army-wide.
    pub id: String,
    pub message: String,
    /// Index into the roster's units for unit-scoped codes; `None` for army-wide.
    pub unit_index: Option<usize>,
    pub severity: Severity,
}

/// The loadout-legality verdict for one resolved roster unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnitLegality {
    pub unit_id: String,
    pub unit_index: usize,
    pub model_count: u64,
    pub violations: Vec<Violation>,
}

/// The full roster-legality verdict: per-unit loadout + army-construction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterLegality {
    pub units: Vec<UnitLegality>,
    pub army: Vec<RosterViolation>,
}

/// One unit in the normalised roster the core checker consumes.
#[derive(Debug, Clone)]
pub struct NormUnit {
    pub unit_id: String,
    pub model_count: u64,
    pub is_warlord: bool,
    pub enhancement_id: Option<String>,
    pub leader_bodyguard_id: Option<String>,
    pub counts: HashMap<String, i64>,
}

/// Normalised roster input shared by [`check_roster`] (from a full [`Roster`])
/// and the `check_roster_legality` runner op (from a compact spec), so the two
/// entry points run the exact same checks.
#[derive(Debug, Clone)]
pub struct NormRoster {
    pub faction_id: Option<String>,
    pub battle_size: Option<BattleSize>,
    pub force_disposition: Option<String>,
    pub detachment_ids: Vec<String>,
    pub units: Vec<NormUnit>,
}

/// The complete roster-legality keyword set for a unit: its `keywords`,
/// `faction_keywords`, and display name; eligible army-faction keywords;
/// conditionally granted keywords; then source-format overrides.
fn roster_keyword_set(
    view: &Unit,
    army_keywords: &HashSet<String>,
    detachment_ids: &[String],
    overrides: &[String],
) -> HashSet<String> {
    let mut out = HashSet::new();
    if let Some(kws) = &view.keywords {
        out.extend(kws.0.iter().map(|keyword| keyword.as_str().to_string()));
    }
    if let Some(kws) = &view.faction_keywords {
        out.extend(kws.0.iter().map(|keyword| keyword.as_str().to_string()));
    }
    out.insert(view.name.as_str().to_string());

    let in_pool = view
        .faction_keywords
        .as_ref()
        .map(|kws| {
            kws.0
                .iter()
                .all(|keyword| army_keywords.contains(keyword.as_str()))
        })
        .unwrap_or(true);
    if !army_keywords.is_empty() && in_pool {
        out.extend(army_keywords.iter().cloned());
    }

    for grant in &view.conditional_keywords {
        if grant.required_detachment_id.as_ref().is_some_and(|id| {
            !detachment_ids
                .iter()
                .any(|selected| selected == id.as_str())
        }) || grant
            .required_faction_keyword
            .as_ref()
            .is_some_and(|keyword| !army_keywords.contains(keyword.as_str()))
        {
            continue;
        }
        out.insert(grant.keyword.as_str().to_string());
    }
    out.extend(overrides.iter().cloned());
    out
}

/// Whether a unit counts as a Character for enhancement and support-attachment
/// eligibility. Source-format Character annotations are passed as overrides.
fn is_character(view: &Unit, overrides: &[String]) -> bool {
    matches!(
        view.role,
        Some(UnitRole::Character) | Some(UnitRole::EpicHero)
    ) || view
        .keywords
        .as_ref()
        .map(|keywords| {
            keywords
                .0
                .iter()
                .any(|keyword| keyword.as_str() == "Character")
        })
        .unwrap_or(false)
        || overrides.iter().any(|keyword| keyword == "Character")
}

/// Compatibility entry point for normalised callers without source-format
/// keyword annotations.
pub fn validate_roster_core(spec: &NormRoster, dataset: &Dataset) -> RosterLegality {
    validate_roster_core_with_keyword_overrides(spec, dataset, &[])
}

/// Context-aware roster validation. `keyword_overrides` is ordered in parallel
/// with `spec.units`; missing trailing entries have no overrides.
pub fn validate_roster_core_with_keyword_overrides(
    spec: &NormRoster,
    dataset: &Dataset,
    keyword_overrides: &[Vec<String>],
) -> RosterLegality {
    let mut army: Vec<RosterViolation> = Vec::new();
    let faction = spec.faction_id.as_deref();
    // `roster_keyword_set` grants them to eligible units.
    let army_keywords: HashSet<String> = faction
        .and_then(|f| dataset.factions.get(f))
        .and_then(|fac| fac.keywords.as_ref())
        .map(|k| k.0.iter().map(|kw| kw.as_str().to_string()).collect())
        .unwrap_or_default();

    let resolve_unit = |unit_id: &str| -> Option<&Unit> {
        if unit_id.is_empty() {
            return None;
        }
        faction
            .and_then(|f| {
                dataset
                    .units
                    .by_faction(f)
                    .into_iter()
                    .find(|u| u.id.as_str() == unit_id)
            })
            .or_else(|| dataset.units.get_any(unit_id))
    };

    let views: Vec<Option<&Unit>> = spec
        .units
        .iter()
        .map(|u| resolve_unit(&u.unit_id))
        .collect();

    // --- Per-unit loadout (reuse the tier/bounds checker). --------------------
    let mut units: Vec<UnitLegality> = Vec::new();
    for (idx, su) in spec.units.iter().enumerate() {
        let Some(view) = views[idx] else { continue };
        let options = dataset.wargear_options_of(view);
        let comp = dataset.unit_compositions.iter().find(|c| {
            c.unit_id.as_str() == view.id.as_str()
                && c.faction_id.as_str() == view.faction_id.as_str()
        });
        let models = comp.map(|c| loadout_models(&c.models));
        let tiers = comp.map(|c| loadout_tiers(&c.tiers));
        let violations = check_unit_legality(
            view,
            su.model_count,
            &options,
            &su.counts,
            models.as_deref(),
            tiers.as_deref(),
        );
        units.push(UnitLegality {
            unit_id: view.id.as_str().to_string(),
            unit_index: idx,
            model_count: su.model_count,
            violations,
        });
    }

    let detachments: Vec<&crate::generated::Detachment> = spec
        .detachment_ids
        .iter()
        // Shared detachment ids (Codex chapters) resolve within the roster's
        // faction; fall back first-wins when the spec names no faction.
        .filter_map(|id| {
            faction
                .and_then(|f| dataset.detachments.get_in_faction(id, f))
                .or_else(|| dataset.detachments.get_any(id))
        })
        .collect();

    // --- Enhancements: per-unit eligibility + army-wide uniqueness. -----------
    let mut enh_uses: BTreeMap<String, u64> = BTreeMap::new();
    for (idx, su) in spec.units.iter().enumerate() {
        let Some(enh_id) = &su.enhancement_id else {
            continue;
        };
        let overrides = keyword_overrides.get(idx).map(Vec::as_slice).unwrap_or(&[]);
        *enh_uses.entry(enh_id.clone()).or_insert(0) += 1;
        let (Some(enh), Some(view)) = (dataset.enhancements.get(enh_id), views[idx]) else {
            continue;
        };
        if !spec
            .detachment_ids
            .iter()
            .any(|d| d == enh.detachment_id.as_str())
        {
            army.push(RosterViolation {
                code: RosterViolationCode::EnhancementWrongDetachment,
                id: enh.id.as_str().to_string(),
                message: format!(
                    "{} is not from a detachment in this roster",
                    enh.id.as_str()
                ),
                unit_index: Some(idx),
                severity: Severity::Error,
            });
        }
        if !is_character(view, overrides) && !enh.upgrade_tag {
            army.push(RosterViolation {
                code: RosterViolationCode::EnhancementOnNonCharacter,
                id: enh.id.as_str().to_string(),
                message: format!("{} can only be taken by a Character", enh.id.as_str()),
                unit_index: Some(idx),
                severity: Severity::Error,
            });
        }
        let kws = roster_keyword_set(view, &army_keywords, &spec.detachment_ids, overrides);
        // 11e Select Enhancements: EPIC HERO models cannot be given Enhancements
        // (Upgrades included). Mirror of TS `enhancement-on-epic-hero`.
        if matches!(view.role, Some(UnitRole::EpicHero)) || kws.contains("Epic Hero") {
            army.push(RosterViolation {
                code: RosterViolationCode::EnhancementOnEpicHero,
                id: enh.id.as_str().to_string(),
                message: format!(
                    "{} cannot be given to Epic Hero {}",
                    enh.id.as_str(),
                    view.id.as_str()
                ),
                unit_index: Some(idx),
                severity: Severity::Error,
            });
        }
        // A unit whose every model is `excluded_from_enhancements` has no model that
        // can carry the Enhancement. Mirror of TS `enhancement-on-excluded-model`.
        let rows = dataset
            .unit_compositions
            .iter()
            .find(|c| {
                c.unit_id.as_str() == view.id.as_str()
                    && c.faction_id.as_str() == view.faction_id.as_str()
            })
            .map(|c| c.models.as_slice())
            .unwrap_or(&[]);
        if !rows.is_empty() && rows.iter().all(|m| m.excluded_from_enhancements) {
            army.push(RosterViolation {
                code: RosterViolationCode::EnhancementOnExcludedModel,
                id: enh.id.as_str().to_string(),
                message: format!(
                    "{} cannot be given to {}: no model in it can take Enhancements",
                    enh.id.as_str(),
                    view.id.as_str()
                ),
                unit_index: Some(idx),
                severity: Severity::Error,
            });
        }
        // Keyword groups or datasheet groups (mirror of TS `meetsEnhancementGroups`).
        let keyword_eligible = if let Some(groups) = &enh.keyword_restriction_groups {
            Some(
                groups
                    .iter()
                    .any(|group| group.iter().all(|k| kws.contains(k.as_str()))),
            )
        } else {
            enh.keyword_restrictions
                .as_ref()
                .map(|req| req.0.iter().all(|k| kws.contains(k.as_str())))
        };
        let datasheet_eligible = enh.datasheet_restriction_groups.iter().any(|group| {
            group.unit_id.as_str() == view.id.as_str()
                && group
                    .keywords
                    .as_ref()
                    .is_none_or(|ks| ks.iter().all(|k| kws.contains(k.as_str())))
        });
        let eligible = match keyword_eligible {
            Some(ok) => ok || datasheet_eligible,
            None => enh.datasheet_restriction_groups.is_empty() || datasheet_eligible,
        };
        if !eligible {
            army.push(RosterViolation {
                code: RosterViolationCode::EnhancementKeywordMismatch,
                id: enh.id.as_str().to_string(),
                message: format!(
                    "{} lacks an eligible keyword group for {}",
                    view.id.as_str(),
                    enh.id.as_str()
                ),
                unit_index: Some(idx),
                severity: Severity::Error,
            });
        }
        if let Some(excl) = &enh.exclusion_keywords {
            if excl.0.iter().any(|k| kws.contains(k.as_str())) {
                army.push(RosterViolation {
                    code: RosterViolationCode::EnhancementExcludedKeyword,
                    id: enh.id.as_str().to_string(),
                    message: format!(
                        "{} carries a keyword excluded by {}",
                        view.id.as_str(),
                        enh.id.as_str()
                    ),
                    unit_index: Some(idx),
                    severity: Severity::Error,
                });
            }
        }
    }
    for (enh_id, uses) in &enh_uses {
        let max = dataset
            .enhancements
            .get(enh_id)
            .map(|e| e.max_targets.get())
            .unwrap_or(1);
        if *uses > max {
            army.push(RosterViolation {
                code: RosterViolationCode::EnhancementOverMaxTargets,
                id: enh_id.clone(),
                message: format!("{enh_id} taken {uses} times, max {max}"),
                unit_index: None,
                severity: Severity::Error,
            });
        }
    }

    // --- Leader attachment. ----------------------------------------------------
    for (idx, su) in spec.units.iter().enumerate() {
        let Some(view) = views[idx] else { continue };
        let overrides = keyword_overrides.get(idx).map(Vec::as_slice).unwrap_or(&[]);
        if let Some(bodyguard_id) = &su.leader_bodyguard_id {
            let mut eligible: HashSet<String> = dataset
                .bodyguards_attachable_from(view.id.as_str())
                .into_iter()
                .map(|candidate| candidate.id.as_str().to_string())
                .collect();
            if let Some(enhancement) = su
                .enhancement_id
                .as_deref()
                .and_then(|id| dataset.enhancements.get(id))
            {
                eligible.extend(
                    enhancement
                        .attachment_bodyguard_ids
                        .as_deref()
                        .unwrap_or(&[])
                        .iter()
                        .map(|id| id.as_str().to_string()),
                );
            }
            if !eligible.contains(bodyguard_id) {
                army.push(RosterViolation {
                    code: RosterViolationCode::LeaderAttachmentIllegal,
                    id: view.id.as_str().to_string(),
                    message: format!("{} cannot attach to {}", view.id.as_str(), bodyguard_id),
                    unit_index: Some(idx),
                    severity: Severity::Error,
                });
            }
        } else if view.attachment_role == Some(crate::generated::UnitAttachmentRole::Support)
            && is_character(view, overrides)
        {
            army.push(RosterViolation {
                code: RosterViolationCode::LeaderMustAttach,
                id: view.id.as_str().to_string(),
                message: format!(
                    "{} is a Support character and must attach to a unit",
                    view.id.as_str()
                ),
                unit_index: Some(idx),
                severity: Severity::Error,
            });
        }
    }

    // --- Points total (ordinal-aware) + wargear + enhancement costs. ----------
    // Host-aware: a foreign unit with an `allied_points` entry for this army
    // (Agents' Imperium price, a chapter's reprice of a shared datasheet)
    // prices from that entry, not its native table.
    let roster_faction = faction.and_then(|f| dataset.factions.get(f));
    let mut ordinals: HashMap<String, u64> = HashMap::new();
    let mut unit_costs: Vec<u64> = vec![0; spec.units.len()];
    let mut total: u64 = 0;
    for (idx, su) in spec.units.iter().enumerate() {
        let Some(view) = views[idx] else { continue };
        let ord = ordinals.entry(su.unit_id.clone()).or_insert(0);
        *ord += 1;
        let mut cost = army_unit_points(
            view,
            su.model_count,
            *ord,
            roster_faction,
            &spec.detachment_ids,
        );
        cost += wargear_points(view, &su.counts);
        if let Some(enh_id) = &su.enhancement_id {
            cost += dataset
                .enhancements
                .get(enh_id)
                .map(|e| e.cost)
                .unwrap_or(0);
        }
        unit_costs[idx] = cost;
        total += cost;
    }
    if let Some(limit) = points_limit_for_battle_size(spec.battle_size) {
        if total > limit {
            army.push(RosterViolation {
                code: RosterViolationCode::PointsOverLimit,
                id: "roster".to_string(),
                message: format!("army totals {total}, over the {limit} limit"),
                unit_index: None,
                severity: Severity::Error,
            });
        }
    }

    // --- Detachment-point budget. ---------------------------------------------
    if let Some(cap) = detachment_cap_for_battle_size(spec.battle_size) {
        let dp_used: u64 = detachments
            .iter()
            .map(|d| d.detachment_points.map(|n| n.get()).unwrap_or(0))
            .sum();
        if dp_used > cap {
            army.push(RosterViolation {
                code: RosterViolationCode::DetachmentPointsOver,
                id: "roster".to_string(),
                message: format!("detachments cost {dp_used} DP, over the {cap} budget"),
                unit_index: None,
                severity: Severity::Error,
            });
        }
    }

    // --- Force disposition (advisory / warn). ---------------------------------
    match &spec.force_disposition {
        None => army.push(RosterViolation {
            code: RosterViolationCode::DispositionNotPicked,
            id: "roster".to_string(),
            message: "no Force Disposition selected".to_string(),
            unit_index: None,
            severity: Severity::Warn,
        }),
        Some(disp) => {
            // Any selected detachment may grant the pick; detachments whose
            // data does not record force_dispositions are skipped, and when
            // none record them the check is inconclusive and stays silent.
            let recorded: Vec<_> = detachments
                .iter()
                .filter_map(|d| d.force_dispositions.as_ref())
                .collect();
            if !recorded.is_empty()
                && !recorded
                    .iter()
                    .any(|fds| fds.iter().any(|d| d.as_str() == disp))
            {
                army.push(RosterViolation {
                    code: RosterViolationCode::DispositionInvalid,
                    id: disp.clone(),
                    message: format!("{disp} is not offered by any selected detachment"),
                    unit_index: None,
                    severity: Severity::Warn,
                });
            }
        }
    }

    // --- Detachment tag uniqueness (one per shared tag). ----------------------
    let mut tag_counts: BTreeMap<String, u64> = BTreeMap::new();
    for d in &detachments {
        if let Some(tags) = &d.tags {
            for t in tags {
                *tag_counts.entry(t.clone()).or_insert(0) += 1;
            }
        }
    }
    for (tag, n) in &tag_counts {
        if *n > 1 {
            army.push(RosterViolation {
                code: RosterViolationCode::DetachmentTagConflict,
                id: tag.clone(),
                message: format!("{n} detachments share the '{tag}' tag"),
                unit_index: None,
                severity: Severity::Error,
            });
        }
    }

    // --- Detachment restrictions (required/excluded army keywords, per unit). -
    for d in &detachments {
        let Some(r) = &d.restrictions else { continue };
        for (idx, _su) in spec.units.iter().enumerate() {
            let Some(view) = views[idx] else { continue };
            let overrides = keyword_overrides.get(idx).map(Vec::as_slice).unwrap_or(&[]);
            let kws = roster_keyword_set(view, &army_keywords, &spec.detachment_ids, overrides);
            if let Some(req) = &r.required_keywords {
                if req.0.iter().any(|k| !kws.contains(k.as_str())) {
                    army.push(RosterViolation {
                        code: RosterViolationCode::DetachmentRestrictionRequired,
                        id: view.id.as_str().to_string(),
                        message: format!(
                            "{} lacks a keyword required by {}",
                            view.id.as_str(),
                            d.id.as_str()
                        ),
                        unit_index: Some(idx),
                        severity: Severity::Error,
                    });
                }
            }
            if let Some(excl) = &r.excluded_keywords {
                if excl.0.iter().any(|k| kws.contains(k.as_str())) {
                    army.push(RosterViolation {
                        code: RosterViolationCode::DetachmentRestrictionExcluded,
                        id: view.id.as_str().to_string(),
                        message: format!(
                            "{} carries a keyword excluded by {}",
                            view.id.as_str(),
                            d.id.as_str()
                        ),
                        unit_index: Some(idx),
                        severity: Severity::Error,
                    });
                }
            }
        }
    }

    // --- Faction exclusions (a generic unit barred from this army's chapter). --
    // The shared Space Marine pool can't drop a generic datasheet for one chapter,
    // so a removed-without-replacement unit (e.g. Librarians for Black Templars)
    // carries `excluded_faction_keywords`; it is illegal when the army's faction
    // keywords intersect that list. Mirror of TS `unit-excluded-from-faction`.
    let faction_keywords = &army_keywords;
    if !faction_keywords.is_empty() {
        for (idx, _su) in spec.units.iter().enumerate() {
            let Some(view) = views[idx] else { continue };
            let Some(excl) = &view.excluded_faction_keywords else {
                continue;
            };
            let barred: Vec<&str> = excl
                .0
                .iter()
                .map(|k| k.as_str())
                .filter(|k| faction_keywords.contains(*k))
                .collect();
            if !barred.is_empty() {
                army.push(RosterViolation {
                    code: RosterViolationCode::UnitExcludedFromFaction,
                    id: view.id.as_str().to_string(),
                    message: format!(
                        "{} cannot be taken by {} (barred by {})",
                        view.id.as_str(),
                        faction.unwrap_or(""),
                        barred.join(", ")
                    ),
                    unit_index: Some(idx),
                    severity: Severity::Error,
                });
            }
        }
    }

    // --- Warlord present (exactly one). ---------------------------------------
    let warlords = spec.units.iter().filter(|su| su.is_warlord).count();
    if warlords == 0 {
        army.push(RosterViolation {
            code: RosterViolationCode::NoWarlord,
            id: "roster".to_string(),
            message: "army has no warlord".to_string(),
            unit_index: None,
            severity: Severity::Error,
        });
    } else if warlords > 1 {
        army.push(RosterViolation {
            code: RosterViolationCode::MultipleWarlords,
            id: "roster".to_string(),
            message: format!("army has {warlords} warlords"),
            unit_index: None,
            severity: Severity::Error,
        });
    }

    // --- Detachment Warlord requirement (e.g. Devoted of Ynnead). -------------
    // Checked only when a Warlord is chosen; a missing one is `no-warlord` above.
    // Mirror of TS `warlord-not-mandated`.
    for d in &detachments {
        let Some(mandated) = &d.mandatory_warlord_datasheet_ids else {
            continue;
        };
        if mandated.is_empty() || warlords == 0 {
            continue;
        }
        let satisfied = spec
            .units
            .iter()
            .any(|su| su.is_warlord && mandated.iter().any(|m| m.as_str() == su.unit_id));
        if !satisfied {
            let names: Vec<&str> = mandated.iter().map(|m| m.as_str()).collect();
            army.push(RosterViolation {
                code: RosterViolationCode::WarlordNotMandated,
                id: d.id.as_str().to_string(),
                message: format!(
                    "{} requires the Warlord to be one of: {}",
                    d.id.as_str(),
                    names.join(", ")
                ),
                unit_index: None,
                severity: Severity::Error,
            });
        }
    }

    // --- Detachment datasheet exclusions (e.g. Shadow Legion). ----------------
    // Mirror of TS `detachment-excluded-datasheet`.
    for d in &detachments {
        let Some(excluded) = &d.excluded_datasheet_ids else {
            continue;
        };
        for (idx, su) in spec.units.iter().enumerate() {
            if excluded.iter().any(|x| x.as_str() == su.unit_id) {
                army.push(RosterViolation {
                    code: RosterViolationCode::DetachmentExcludedDatasheet,
                    id: su.unit_id.clone(),
                    message: format!("{} cannot be included with {}", su.unit_id, d.id.as_str()),
                    unit_index: Some(idx),
                    severity: Severity::Error,
                });
            }
        }
    }

    // --- Unit limit per datasheet (11e Select Battle Size). -------------------
    // Mirror of TS `unit-limit-exceeded`: incursion 2 / strike-force 3, doubled
    // for BATTLELINE (incl. detachment-granted) and DEDICATED TRANSPORT units;
    // every EPIC HERO is limited to 1.
    let unit_limit = unit_limit_for_battle_size(spec.battle_size);
    let mut copies: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    for (idx, view) in views.iter().enumerate() {
        let Some(view) = *view else { continue };
        let overrides = keyword_overrides.get(idx).map(Vec::as_slice).unwrap_or(&[]);
        let kws = roster_keyword_set(view, &army_keywords, &spec.detachment_ids, overrides);
        let limit = if matches!(view.role, Some(UnitRole::EpicHero)) || kws.contains("Epic Hero") {
            Some(1)
        } else if matches!(
            view.role,
            Some(UnitRole::Battleline) | Some(UnitRole::DedicatedTransport)
        ) || kws.contains("Battleline")
            || kws.contains("Dedicated Transport")
        {
            unit_limit.map(|l| l * 2)
        } else {
            unit_limit
        };
        let Some(limit) = limit else { continue };
        let entry = copies
            .entry(view.id.as_str().to_string())
            .or_insert((0, limit));
        entry.0 += 1;
        entry.1 = entry.1.max(limit);
    }
    for (id, (count, limit)) in &copies {
        if count > limit {
            army.push(RosterViolation {
                code: RosterViolationCode::UnitLimitExceeded,
                id: id.clone(),
                message: format!("army includes {count} {id} units, over the limit of {limit}"),
                unit_index: None,
                severity: Severity::Error,
            });
        }
    }

    // --- Enhancement limit (incursion 2, strike-force 4), distinct choices. ---
    if let Some(limit) = enhancement_limit_for_battle_size(spec.battle_size) {
        let chosen: HashSet<&str> = spec
            .units
            .iter()
            .filter_map(|su| su.enhancement_id.as_deref())
            .collect();
        if chosen.len() as u64 > limit {
            army.push(RosterViolation {
                code: RosterViolationCode::EnhancementLimitExceeded,
                id: "roster".to_string(),
                message: format!(
                    "army takes {} Enhancements, over the limit of {limit}",
                    chosen.len()
                ),
                unit_index: None,
                severity: Severity::Error,
            });
        }
    }

    // --- Army-wide keyword caps (faction `keyword_limits`). -------------------
    // Mirror of TS `keyword-limit-exceeded`: units with an exempt faction keyword
    // never count; `mode` picks units-with-every-keyword or distinct alternatives;
    // a selected detachment's override for the same keyword set replaces `max`
    // (largest wins).
    let sorted_keywords = |list: &crate::generated::KeywordList| -> Vec<String> {
        let mut v: Vec<String> = list.0.iter().map(|k| k.as_str().to_string()).collect();
        v.sort();
        v
    };
    if let Some(fac) = roster_faction {
        for kl in &fac.keyword_limits {
            let keys = sorted_keywords(&kl.keywords);
            let mut max = kl.max;
            let mut overridden = false;
            for d in &detachments {
                for o in &d.keyword_limit_overrides {
                    if sorted_keywords(&o.keywords) == keys {
                        max = if overridden { max.max(o.max) } else { o.max };
                        overridden = true;
                    }
                }
            }
            let exempt: Vec<String> = kl
                .exempt_faction_keywords
                .as_ref()
                .map(sorted_keywords)
                .unwrap_or_default();
            let counted: Vec<HashSet<String>> = spec
                .units
                .iter()
                .enumerate()
                .filter_map(|(idx, _)| {
                    let view = views[idx]?;
                    let is_exempt = view.faction_keywords.as_ref().is_some_and(|fks| {
                        fks.0.iter().any(|k| exempt.iter().any(|e| e == k.as_str()))
                    });
                    if is_exempt {
                        return None;
                    }
                    let overrides = keyword_overrides.get(idx).map(Vec::as_slice).unwrap_or(&[]);
                    Some(roster_keyword_set(
                        view,
                        &army_keywords,
                        &spec.detachment_ids,
                        overrides,
                    ))
                })
                .collect();
            // `units`: units carrying every keyword. `alternatives`: distinct
            // keywords present on any unit (Farsight / Ethereal).
            let count = match kl.mode {
                crate::generated::FactionKeywordLimitsItemMode::Alternatives => {
                    keys.iter()
                        .filter(|k| counted.iter().any(|kws| kws.contains(*k)))
                        .count() as u64
                }
                crate::generated::FactionKeywordLimitsItemMode::Units => counted
                    .iter()
                    .filter(|kws| keys.iter().all(|k| kws.contains(k)))
                    .count()
                    as u64,
            };
            if count > max {
                let id = keys.join("+");
                army.push(RosterViolation {
                    code: RosterViolationCode::KeywordLimitExceeded,
                    message: format!("army includes {count} of {id}, over the limit of {max}"),
                    id,
                    unit_index: None,
                    severity: Severity::Error,
                });
            }
        }
    }

    // --- Exclusive allied pools (the army faction's own pool-only units). -----
    // Mirror of TS: the rule must be offered, and its points cap and
    // Warlord/Enhancement locks apply; a selected detachment's mandatory or
    // granted Warlord datasheets lift the Warlord lock.
    let detachment_warlords: HashSet<&str> = detachments
        .iter()
        .flat_map(|d| {
            d.mandatory_warlord_datasheet_ids
                .iter()
                .flatten()
                .chain(d.granted_warlord_datasheet_ids.iter().flatten())
                .map(|id| id.as_str())
        })
        .collect();
    if let Some(army_faction) = faction {
        for rule in dataset.allied_rules.all() {
            if !rule.exclusive
                || rule.source_faction_id.as_ref().map(|f| f.as_str()) != Some(army_faction)
            {
                continue;
            }
            let pool: HashSet<&str> = rule
                .source_datasheet_ids
                .iter()
                .flatten()
                .map(|id| id.as_str())
                .collect();
            let members: Vec<usize> = spec
                .units
                .iter()
                .enumerate()
                .filter(|(idx, su)| {
                    views[*idx].is_some_and(|v| v.faction_id.as_str() == army_faction)
                        && pool.contains(su.unit_id.as_str())
                })
                .map(|(idx, _)| idx)
                .collect();
            if members.is_empty() {
                continue;
            }
            let army_gate = rule
                .army_keywords_any
                .as_ref()
                .map(|ks| {
                    ks.0.is_empty() || ks.0.iter().any(|k| army_keywords.contains(k.as_str()))
                })
                .unwrap_or(true);
            let detachment_gate = rule
                .detachment_ids
                .as_ref()
                .map(|ids| {
                    ids.is_empty()
                        || ids
                            .iter()
                            .any(|id| spec.detachment_ids.iter().any(|s| s == id.as_str()))
                })
                .unwrap_or(true);
            if !army_gate || !detachment_gate {
                for &idx in &members {
                    let unit_id = &spec.units[idx].unit_id;
                    army.push(RosterViolation {
                        code: RosterViolationCode::AllyPoolNotOffered,
                        id: unit_id.clone(),
                        message: format!(
                            "{unit_id} is only available through {}, which this army does not offer",
                            rule.id.as_str()
                        ),
                        unit_index: Some(idx),
                        severity: Severity::Error,
                    });
                }
            }
            let cap = rule.points_limits.iter().flatten().find(|p| {
                matches!(
                    (p.battle_size, spec.battle_size),
                    (
                        crate::generated::AlliedPointsLimitBattleSize::Incursion,
                        Some(BattleSize::Incursion)
                    ) | (
                        crate::generated::AlliedPointsLimitBattleSize::StrikeForce,
                        Some(BattleSize::StrikeForce)
                    )
                )
            });
            if let Some(cap) = cap {
                let spent: u64 = members.iter().map(|&idx| unit_costs[idx]).sum();
                if spent > cap.max_points {
                    army.push(RosterViolation {
                        code: RosterViolationCode::AllyPointsOverLimit,
                        id: rule.id.as_str().to_string(),
                        message: format!(
                            "{} units total {spent}, over the {} limit",
                            rule.id.as_str(),
                            cap.max_points
                        ),
                        unit_index: None,
                        severity: Severity::Error,
                    });
                }
            }
            for &idx in &members {
                let su = &spec.units[idx];
                if rule.cannot_be_warlord
                    && su.is_warlord
                    && !detachment_warlords.contains(su.unit_id.as_str())
                {
                    army.push(RosterViolation {
                        code: RosterViolationCode::AllyCannotBeWarlord,
                        id: su.unit_id.clone(),
                        message: format!(
                            "{} cannot be Warlord under {}",
                            su.unit_id,
                            rule.id.as_str()
                        ),
                        unit_index: Some(idx),
                        severity: Severity::Error,
                    });
                }
                if rule.cannot_take_enhancements && su.enhancement_id.is_some() {
                    army.push(RosterViolation {
                        code: RosterViolationCode::AllyCannotTakeEnhancements,
                        id: su.unit_id.clone(),
                        message: format!(
                            "{} cannot take an Enhancement under {}",
                            su.unit_id,
                            rule.id.as_str()
                        ),
                        unit_index: Some(idx),
                        severity: Severity::Error,
                    });
                }
            }
        }
    }

    // --- Unit minimums (e.g. Houndpack: 3+ WAR DOG units). --------------------
    for d in &detachments {
        for um in &d.unit_minimums {
            let keyword = um.keyword.as_str();
            let count = views
                .iter()
                .enumerate()
                .filter(|(idx, view)| {
                    view.map(|view| {
                        roster_keyword_set(
                            view,
                            &army_keywords,
                            &spec.detachment_ids,
                            keyword_overrides
                                .get(*idx)
                                .map(Vec::as_slice)
                                .unwrap_or(&[]),
                        )
                        .contains(keyword)
                    })
                    .unwrap_or(false)
                })
                .count() as u64;
            if count < um.min.get() {
                army.push(RosterViolation {
                    code: RosterViolationCode::UnitMinimumUnmet,
                    id: keyword.to_string(),
                    message: format!(
                        "{} requires {}+ {} units, found {}",
                        d.id.as_str(),
                        um.min.get(),
                        keyword,
                        count
                    ),
                    unit_index: None,
                    severity: Severity::Error,
                });
            }
        }
    }

    army.sort_by(|a, b| {
        if a.code == b.code {
            a.id.cmp(&b.id)
        } else {
            a.code.as_str().cmp(b.code.as_str())
        }
    });
    RosterLegality { units, army }
}

/// Whole-army legality for a resolved [`Roster`]. A roster is legal iff `army`
/// has no `Error`-severity entries and every `units[].violations` is empty.
/// Mirror of TS `checkRoster`.
pub fn check_roster(roster: &Roster, dataset: &Dataset) -> RosterLegality {
    let units = roster
        .units
        .iter()
        .map(|u| {
            let mut counts: HashMap<String, i64> = HashMap::new();
            for w in &u.wargear {
                if let Some(id) = &w.ref_.id {
                    *counts.entry(id.clone()).or_insert(0) += w.count as i64;
                }
            }
            NormUnit {
                unit_id: u.ref_.id.clone().unwrap_or_default(),
                model_count: u.model_count,
                is_warlord: u.is_warlord,
                enhancement_id: u.enhancement.as_ref().and_then(|e| e.id.clone()),
                leader_bodyguard_id: u
                    .leader_attachment
                    .as_ref()
                    .and_then(|la| la.bodyguard_ref.id.clone()),
                counts,
            }
        })
        .collect();
    let keyword_overrides = roster
        .units
        .iter()
        .map(|unit| unit.keyword_overrides.clone())
        .collect::<Vec<_>>();
    let spec = NormRoster {
        faction_id: roster.faction_id.clone(),
        battle_size: roster.battle_size,
        force_disposition: roster.force_disposition.clone(),
        detachment_ids: roster
            .detachments
            .iter()
            .filter_map(|d| d.ref_.id.clone())
            .collect(),
        units,
    };
    validate_roster_core_with_keyword_overrides(&spec, dataset, &keyword_overrides)
}
