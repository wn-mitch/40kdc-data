//! Flat `Buff` type every contribution flows through, and the
//! [`resolve_buffs`] resolver that collapses a stack into a
//! [`ResolvedModifiers`] read-out the engine can consume.
//!
//! Mirrors `tools/src/cruncher/buffs.ts`. The same shape carries weapon-keyword
//! effects, ability buffs, stratagem effects, and manual UI toggles — reroll-
//! stacking, hit/wound caps, and feel-no-pain-best-threshold all fall out of one
//! resolver rather than each source kind reinventing precedence.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Phase;

/// Which side an ability buff was sourced from. Drives stable tie-breaking
/// inside [`resolve_buffs`].
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AbilityKind {
    Army,
    Detachment,
    DetachmentStratagem,
    Unit,
    Attached,
    Support,
}

/// Where a buff originated. Drives stable tie-breaking inside [`resolve_buffs`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum BuffSource {
    WeaponKeyword {
        weapon_id: String,
        keyword_id: String,
    },
    Ability {
        ability_id: String,
        ability_kind: AbilityKind,
        /// For `ability_kind = Attached`, the combined-unit member the ability
        /// came from (so a UI can name it and show its leader/bodyguard role).
        /// Absent for other kinds.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_unit_id: Option<String>,
    },
    Manual {
        label: String,
    },
}

/// A weapon-keyword reference (id + parameter map), as found on weapon
/// profiles. `parameters` stays a free-form [`Value`] so callers can carry
/// catalog-shaped (`target_keyword`/`threshold`/`value`) keys without the
/// engine knowing each variant up front.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WeaponKeywordRef {
    pub keyword_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Value>,
}

/// Which die-roll a buff modifies. Matches TS `"hit" | "wound" | "save" | "damage"`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RollKind {
    Hit,
    Wound,
    Save,
    Damage,
}

/// Re-roll scope. `AllFailures` strictly beats `Ones` when two reroll buffs
/// collide on the same roll type — [`resolve_buffs`] enforces that ordering.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RerollSubset {
    Ones,
    AllFailures,
}

/// One typed contribution; the engine reads [`ResolvedModifiers`] for the rest.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum BuffContribution {
    HitMod {
        value: f64,
    },
    WoundMod {
        value: f64,
    },
    SaveMod {
        value: f64,
    },
    Cover,
    Reroll {
        roll: RollKind,
        subset: RerollSubset,
    },
    ExtraKeyword {
        keyword_ref: WeaponKeywordRef,
    },
    FeelNoPain {
        threshold: f64,
    },
    DamageMod {
        value: f64,
    },
    /// Additive modifier to the attacker's per-model attack count (A stat).
    AttacksMod {
        value: f64,
    },
    /// Additive modifier to the attacker's Strength stat.
    StrengthMod {
        value: f64,
    },
    /// Additive modifier to the defender's Toughness stat.
    ToughnessMod {
        value: f64,
    },
    /// Additive modifier to the attacker's weapon AP. AP is signed against the
    /// defender's save (negative = more piercing), so a value of `-1` here
    /// makes the weapon one AP more piercing.
    ApMod {
        value: f64,
    },
}

/// Optional gating; the resolver drops buffs whose gate fails.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuffApplicability {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phases: Option<Vec<Phase>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roll_type: Option<RollKind>,
    /// Target must carry this keyword (case-insensitive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_target_keyword: Option<String>,
    /// Attacker must carry this keyword (case-insensitive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_attacker_keyword: Option<String>,
}

/// A single buff: where it came from, when it applies, what it contributes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Buff {
    pub source: BuffSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applicable_when: Option<BuffApplicability>,
    pub contribution: BuffContribution,
}

/// Shared engine context. Carries the phase plus a few attacker/target flags
/// the keyword translator and the resolver both need.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineContext {
    pub phase: Phase,
    /// Attacker has not moved this turn — Heavy fires its +1 to hit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_stationary: Option<bool>,
    /// Attacker made a charge move this turn — drives `charged-this-turn`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_charged: Option<bool>,
    /// Within half the weapon's range — Melta / Rapid Fire fire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within_half_range: Option<bool>,
    /// Attacker benefits from cover (mostly informational).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_in_cover: Option<bool>,
    /// Target is in cover.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_in_cover: Option<bool>,
    /// Attacker keywords (union of `unit.keywords + faction_keywords`), lower-cased.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_keywords: Option<Vec<String>>,
    /// Target keywords (union of `unit.keywords + faction_keywords`), lower-cased.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_keywords: Option<Vec<String>>,
    /// Sub-phase timing flag consumed by the `timing-is` condition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<String>,
    /// The buffed unit is part of a combined ("attached") unit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_attached: Option<bool>,
}

/// Read-out of a resolved buff stack, with provenance per field.
#[derive(Clone, Debug, Default)]
pub struct ResolvedModifiers {
    pub hit_mod: CappedMod,
    pub wound_mod: CappedMod,
    pub save_mod: SummedMod,
    pub cover: CoverState,
    pub rerolls: Rerolls,
    pub extra_keywords: Vec<ExtraKeywordEntry>,
    pub feel_no_pain: Option<FeelNoPainState>,
    pub damage_mod: SummedMod,
    pub attacks_mod: SummedMod,
    pub strength_mod: SummedMod,
    pub toughness_mod: SummedMod,
    pub ap_mod: SummedMod,
}

/// Hit/wound mod: signed sum clamped to ±1, dominant source picked from the
/// surviving-sign contributors by the resolver's internal source-rank table.
#[derive(Clone, Debug, Default)]
pub struct CappedMod {
    pub value: f64,
    pub dominant_source: Option<BuffSource>,
}

/// Save/AP/damage/A/S/T: monotone additive across contributors.
#[derive(Clone, Debug, Default)]
pub struct SummedMod {
    pub value: f64,
    pub sources: Vec<BuffSource>,
}

#[derive(Clone, Debug, Default)]
pub struct CoverState {
    pub active: bool,
    pub source: Option<BuffSource>,
}

#[derive(Clone, Debug, Default)]
pub struct Rerolls {
    pub hit: Option<RerollState>,
    pub wound: Option<RerollState>,
    pub save: Option<RerollState>,
    pub damage: Option<RerollState>,
}

impl Rerolls {
    pub fn for_roll(&self, roll: RollKind) -> Option<&RerollState> {
        match roll {
            RollKind::Hit => self.hit.as_ref(),
            RollKind::Wound => self.wound.as_ref(),
            RollKind::Save => self.save.as_ref(),
            RollKind::Damage => self.damage.as_ref(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct RerollState {
    pub subset: RerollSubset,
    pub dominant_source: BuffSource,
}

#[derive(Clone, Debug)]
pub struct ExtraKeywordEntry {
    pub keyword_ref: WeaponKeywordRef,
    pub source: BuffSource,
}

#[derive(Clone, Debug)]
pub struct FeelNoPainState {
    pub threshold: f64,
    pub dominant_source: BuffSource,
}

/// Stable ordering used to break ties when multiple buffs claim the same field.
/// Mirrors `SOURCE_KIND_RANK` in `buffs.ts`.
fn rank(source: &BuffSource) -> u32 {
    match source {
        BuffSource::Ability { ability_kind, .. } => match ability_kind {
            AbilityKind::Army => 0,
            AbilityKind::Detachment => 1,
            AbilityKind::DetachmentStratagem => 2,
            AbilityKind::Unit => 3,
            AbilityKind::Attached => 4,
            AbilityKind::Support => 5,
        },
        BuffSource::Manual { .. } => 6,
        BuffSource::WeaponKeyword { .. } => 7,
    }
}

fn applies(buff: &Buff, ctx: &EngineContext) -> bool {
    let Some(w) = buff.applicable_when.as_ref() else {
        return true;
    };
    if let Some(phases) = &w.phases {
        if !phases.is_empty() && !phases.contains(&ctx.phase) {
            return false;
        }
    }
    if let (Some(want), BuffContribution::Reroll { roll, .. }) = (w.roll_type, &buff.contribution) {
        if *roll != want {
            return false;
        }
    }
    if let Some(req) = &w.requires_target_keyword {
        let req_lower = req.to_lowercase();
        let ok = ctx
            .target_keywords
            .as_ref()
            .is_some_and(|kws| kws.iter().any(|k| k == &req_lower));
        if !ok {
            return false;
        }
    }
    if let Some(req) = &w.requires_attacker_keyword {
        let req_lower = req.to_lowercase();
        let ok = ctx
            .attacker_keywords
            .as_ref()
            .is_some_and(|kws| kws.iter().any(|k| k == &req_lower));
        if !ok {
            return false;
        }
    }
    true
}

/// Collapse a flat buff stack into a [`ResolvedModifiers`] read-out. Pure
/// function; the engine — and any UI that wants to render the resolved table
/// before crunching — both go through this.
pub fn resolve_buffs(buffs: &[Buff], ctx: &EngineContext) -> ResolvedModifiers {
    let mut out = ResolvedModifiers::default();
    let mut hit_contribs: Vec<Contribution> = Vec::new();
    let mut wound_contribs: Vec<Contribution> = Vec::new();

    for b in buffs.iter().filter(|b| applies(b, ctx)) {
        match &b.contribution {
            BuffContribution::HitMod { value } => {
                hit_contribs.push(Contribution {
                    value: *value,
                    source: b.source.clone(),
                });
            }
            BuffContribution::WoundMod { value } => {
                wound_contribs.push(Contribution {
                    value: *value,
                    source: b.source.clone(),
                });
            }
            BuffContribution::SaveMod { value } => {
                out.save_mod.value += value;
                out.save_mod.sources.push(b.source.clone());
            }
            BuffContribution::Cover => {
                let take = match &out.cover.source {
                    None => true,
                    Some(prev) => rank(&b.source) < rank(prev),
                };
                if take {
                    out.cover = CoverState {
                        active: true,
                        source: Some(b.source.clone()),
                    };
                }
            }
            BuffContribution::Reroll { roll, subset } => {
                merge_reroll(&mut out.rerolls, *roll, *subset, &b.source);
            }
            BuffContribution::ExtraKeyword { keyword_ref } => {
                let key = canonical_keyword_key(keyword_ref);
                if !out
                    .extra_keywords
                    .iter()
                    .any(|e| canonical_keyword_key(&e.keyword_ref) == key)
                {
                    out.extra_keywords.push(ExtraKeywordEntry {
                        keyword_ref: keyword_ref.clone(),
                        source: b.source.clone(),
                    });
                }
            }
            BuffContribution::FeelNoPain { threshold } => {
                let take = match &out.feel_no_pain {
                    None => true,
                    Some(cur) => *threshold < cur.threshold,
                };
                if take {
                    out.feel_no_pain = Some(FeelNoPainState {
                        threshold: *threshold,
                        dominant_source: b.source.clone(),
                    });
                }
            }
            BuffContribution::DamageMod { value } => {
                sum_into(&mut out.damage_mod, *value, &b.source)
            }
            BuffContribution::AttacksMod { value } => {
                sum_into(&mut out.attacks_mod, *value, &b.source)
            }
            BuffContribution::StrengthMod { value } => {
                sum_into(&mut out.strength_mod, *value, &b.source)
            }
            BuffContribution::ToughnessMod { value } => {
                sum_into(&mut out.toughness_mod, *value, &b.source)
            }
            BuffContribution::ApMod { value } => sum_into(&mut out.ap_mod, *value, &b.source),
        }
    }

    out.hit_mod = cap_modifier(&hit_contribs);
    out.wound_mod = cap_modifier(&wound_contribs);
    out
}

#[derive(Clone)]
struct Contribution {
    value: f64,
    source: BuffSource,
}

fn sum_into(m: &mut SummedMod, value: f64, source: &BuffSource) {
    m.value += value;
    m.sources.push(source.clone());
}

fn merge_reroll(
    rerolls: &mut Rerolls,
    roll: RollKind,
    incoming: RerollSubset,
    source: &BuffSource,
) {
    let slot: &mut Option<RerollState> = match roll {
        RollKind::Hit => &mut rerolls.hit,
        RollKind::Wound => &mut rerolls.wound,
        RollKind::Save => &mut rerolls.save,
        RollKind::Damage => &mut rerolls.damage,
    };
    match slot {
        None => {
            *slot = Some(RerollState {
                subset: incoming,
                dominant_source: source.clone(),
            });
        }
        Some(cur) => {
            // `all-failures` strictly beats `ones`; same-subset uses rank.
            let stronger = match (incoming, cur.subset) {
                (RerollSubset::AllFailures, RerollSubset::Ones) => true,
                (RerollSubset::Ones, RerollSubset::AllFailures) => false,
                _ => rank(source) < rank(&cur.dominant_source),
            };
            if stronger {
                *cur = RerollState {
                    subset: incoming,
                    dominant_source: source.clone(),
                };
            }
        }
    }
}

/// Sum, clamp to ±1, then pick the dominant contributing source by rank.
fn cap_modifier(contribs: &[Contribution]) -> CappedMod {
    if contribs.is_empty() {
        return CappedMod::default();
    }
    let sum: f64 = contribs.iter().map(|c| c.value).sum();
    let capped = sum.clamp(-1.0, 1.0);
    if capped == 0.0 {
        return CappedMod {
            value: 0.0,
            dominant_source: None,
        };
    }
    let sign = capped.signum();
    let mut matching: Vec<&Contribution> = contribs
        .iter()
        .filter(|c| c.value.signum() == sign)
        .collect();
    matching.sort_by_key(|c| rank(&c.source));
    CappedMod {
        value: capped,
        dominant_source: matching.first().map(|c| c.source.clone()),
    }
}

/// Dedupe key for an extra-keyword buff. Mirrors TS
/// `${keyword_id}::${JSON.stringify(parameters ?? {})}` but sorts the
/// top-level parameter keys so caller-supplied param maps with different
/// insertion orders still collapse to the same key.
fn canonical_keyword_key(ref_: &WeaponKeywordRef) -> String {
    let params_str = match ref_.parameters.as_ref() {
        Some(Value::Object(map)) => {
            let sorted: BTreeMap<&str, &Value> = map.iter().map(|(k, v)| (k.as_str(), v)).collect();
            serde_json::to_string(&sorted).unwrap_or_else(|_| "{}".to_string())
        }
        Some(other) => serde_json::to_string(other).unwrap_or_else(|_| "{}".to_string()),
        None => "{}".to_string(),
    };
    format!("{}::{}", ref_.keyword_id, params_str)
}
