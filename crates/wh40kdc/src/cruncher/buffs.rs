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

use super::gates::live_buffs;
pub use super::resolved::{
    CappedMod, CoverState, CritThresholds, ExtraKeywordEntry, FeelNoPainState, HighestMod,
    IgnoredRolls, InvulnerableState, RerollState, Rerolls, ResolvedModifiers, SkillMods, SummedMod,
    ThresholdState,
};

/// Which side an ability buff was sourced from. Drives stable tie-breaking
/// inside [`resolve_buffs`].
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AbilityKind {
    Army,
    Detachment,
    DetachmentStratagem,
    Unit,
    Attached,
    Support,
    /// Any other kind a caller tags its source with (`enhancement`, `faction`, …). TS does not
    /// check the kind at runtime and the abilities-resolver corpus uses such kinds; it round-trips
    /// as written and ranks last in tie-breaks, as TS ranks an unlisted kind.
    #[serde(untagged)]
    Other(String),
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

/// The attacker's own rolls a crit threshold or an ignored-modifier buff applies to.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttackRoll {
    Hit,
    Wound,
}

/// The skill characteristic a `skill-mod` improves: WS for melee, BS for ranged attacks.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub enum SkillStat {
    #[serde(rename = "WS")]
    Ws,
    #[serde(rename = "BS")]
    Bs,
}

/// Re-roll scope. `AllFailures` strictly beats `Ones` when two reroll buffs
/// collide on the same roll type — [`resolve_buffs`] enforces that ordering.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RerollSubset {
    Ones,
    AllFailures,
}

/// Feel-no-pain scope. `All` (the default) applies to every unsaved wound;
/// `Mortal` applies only to the mortal-wound stream.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FnpScope {
    #[default]
    All,
    Mortal,
}

impl FnpScope {
    fn is_default(&self) -> bool {
        matches!(self, FnpScope::All)
    }
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
    /// Feel-no-pain: roll one D6 per unsaved wound at `threshold`+, ignoring
    /// the wound on a pass. `scope` controls which wound stream it applies to:
    /// `All` (default) fires on every unsaved wound; `Mortal` fires only on
    /// the mortal-wound stream (e.g. Death Guard 5+ FNP vs mortals). A target
    /// carrying both rolls both against mortals.
    FeelNoPain {
        threshold: f64,
        #[serde(default, skip_serializing_if = "FnpScope::is_default")]
        scope: FnpScope,
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
    /// Defender-side: subtract `value` from each unsaved damage point (floored
    /// at 1 by the engine). Multiple sources do NOT stack in 10e — the largest
    /// reduction wins. The corpus also encodes `"half"` and `"to-zero"`
    /// reductions; the buff layer only models the additive form because the
    /// other two are typically one-use ablation that doesn't fold into the
    /// expected-value math cleanly.
    DamageReduction {
        value: f64,
    },
    /// Defender-side: ability-granted invulnerable save threshold. Best
    /// (lowest) threshold wins, combined with the unit's printed invuln by
    /// the engine. Invuln bypasses both AP and cover.
    InvulnerableSave {
        threshold: f64,
    },
    /// Attacker-side: an unmodified roll of `value`+ is a critical hit/wound. Lowest wins.
    CritThreshold {
        roll: AttackRoll,
        value: f64,
    },
    /// Attacker-side: the attacker ignores every negative modifier to this roll (and, for hits,
    /// the benefit of cover). Positive modifiers still apply.
    IgnoreModifiers {
        roll: AttackRoll,
    },
    /// Attacker-side: improve the WS or BS characteristic by `value` (a characteristic change, so
    /// not capped like a hit-roll modifier). The engine floors the characteristic at 2+.
    SkillMod {
        stat: SkillStat,
        value: f64,
    },
    /// Defender-side: the Save characteristic becomes `value`+. Best (lowest) wins.
    SaveCharacteristic {
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
    /// Target must carry none of these keywords (case-insensitive). Permissive when the target's
    /// keywords are unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excluded_target_keywords: Option<Vec<String>>,
    /// Range-gated abilities (DSL `scope.range_inches`): the buff applies only
    /// when the target is within this many inches. Permissive when the caller
    /// leaves `EngineContext::distance_inches` unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_range_inches: Option<f64>,
    /// Only attacks with the weapon of this name (lower case). Permissive when the caller leaves
    /// `EngineContext::weapon_names` unset; the engine always sets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_name: Option<String>,
    /// Only attacks with a weapon that has this weapon ability (catalog keyword id, e.g.
    /// `"lethal-hits"`), printed or granted by another live buff. Permissive when the caller
    /// leaves `EngineContext::weapon_keywords` unset; the engine always sets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_keyword: Option<String>,
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
    /// Attacker made a charge move this turn — drives a `happened` Charge-move condition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_charged: Option<bool>,
    /// Within half the weapon's range — Melta / Rapid Fire fire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within_half_range: Option<bool>,
    /// Distance to the target in inches; drives `applicable_when.max_range_inches`.
    /// Unset = range gates evaluate permissively.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distance_inches: Option<f64>,
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
    /// The army's Army Faction id. Drives the `army-faction` condition; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub army_faction: Option<String>,
    /// The battle size being played (`incursion` / `strike-force` / `onslaught`). Drives the
    /// `battle-size` condition; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub battle_size: Option<String>,
    /// The attacking unit is Guided (For the Greater Good: not an Observer, targeting a Spotted
    /// unit). Drives the `guided` condition; `None` leaves it unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_guided: Option<bool>,
    /// Lower-cased names of the attacking weapon and its profile. Drives
    /// `applicable_when.weapon_name`; `None` leaves weapon-name gates permissive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_names: Option<Vec<String>>,
    /// Catalog keyword ids printed on the attacking weapon profile. Drives
    /// `applicable_when.weapon_keyword` together with the keywords live buffs grant; `None`
    /// leaves weapon-keyword gates permissive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_keywords: Option<Vec<String>>,
}

impl EngineContext {
    /// A context for `phase` with every optional flag unset (each gate it drives stays unknown).
    pub fn new(phase: Phase) -> Self {
        EngineContext {
            phase,
            attacker_stationary: None,
            attacker_charged: None,
            within_half_range: None,
            distance_inches: None,
            attacker_in_cover: None,
            target_in_cover: None,
            attacker_keywords: None,
            target_keywords: None,
            timing: None,
            attacker_attached: None,
            army_faction: None,
            battle_size: None,
            attacker_guided: None,
            weapon_names: None,
            weapon_keywords: None,
        }
    }
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
            // TS `SOURCE_KIND_RANK[...] ?? 99` for a kind the table does not list.
            AbilityKind::Other(_) => 99,
        },
        BuffSource::Manual { .. } => 6,
        BuffSource::WeaponKeyword { .. } => 7,
    }
}

/// Collapse a flat buff stack into a [`ResolvedModifiers`] read-out. Pure
/// function; the engine — and any UI that wants to render the resolved table
/// before crunching — both go through this.
pub fn resolve_buffs(buffs: &[Buff], ctx: &EngineContext) -> ResolvedModifiers {
    let mut out = ResolvedModifiers::default();
    let mut hit_contribs: Vec<Contribution> = Vec::new();
    let mut wound_contribs: Vec<Contribution> = Vec::new();

    for b in live_buffs(buffs, ctx) {
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
            BuffContribution::FeelNoPain { threshold, scope } => {
                // Best (lowest) threshold wins per scope. An undeclared scope
                // (the default) is "all" — fires on every wound; "mortal"
                // fires only on the mortal-wound stream.
                let slot: &mut Option<FeelNoPainState> = match scope {
                    FnpScope::All => &mut out.feel_no_pain,
                    FnpScope::Mortal => &mut out.feel_no_pain_mortal,
                };
                let take = match slot.as_ref() {
                    None => true,
                    Some(cur) => *threshold < cur.threshold,
                };
                if take {
                    *slot = Some(FeelNoPainState {
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
            BuffContribution::DamageReduction { value } => {
                let take = match &out.damage_reduction.dominant_source {
                    None => true,
                    Some(prev) => {
                        *value > out.damage_reduction.value
                            || (*value == out.damage_reduction.value
                                && rank(&b.source) < rank(prev))
                    }
                };
                if take {
                    out.damage_reduction = HighestMod {
                        value: *value,
                        dominant_source: Some(b.source.clone()),
                    };
                }
            }
            BuffContribution::InvulnerableSave { threshold } => {
                let take = match &out.invulnerable {
                    None => true,
                    Some(cur) => {
                        *threshold < cur.threshold
                            || (*threshold == cur.threshold
                                && rank(&b.source) < rank(&cur.dominant_source))
                    }
                };
                if take {
                    out.invulnerable = Some(InvulnerableState {
                        threshold: *threshold,
                        dominant_source: b.source.clone(),
                    });
                }
            }
            BuffContribution::CritThreshold { roll, value } => {
                let slot = match roll {
                    AttackRoll::Hit => &mut out.crit_thresholds.hit,
                    AttackRoll::Wound => &mut out.crit_thresholds.wound,
                };
                take_lowest(slot, *value, &b.source);
            }
            BuffContribution::IgnoreModifiers { roll } => {
                let slot = match roll {
                    AttackRoll::Hit => &mut out.ignore_modifiers.hit,
                    AttackRoll::Wound => &mut out.ignore_modifiers.wound,
                };
                if slot.as_ref().is_none_or(|cur| rank(&b.source) < rank(cur)) {
                    *slot = Some(b.source.clone());
                }
            }
            BuffContribution::SkillMod { stat, value } => {
                let summed = match stat {
                    SkillStat::Ws => &mut out.skill_mod.ws,
                    SkillStat::Bs => &mut out.skill_mod.bs,
                };
                sum_into(summed, *value, &b.source);
            }
            BuffContribution::SaveCharacteristic { value } => {
                take_lowest(&mut out.save_characteristic, *value, &b.source);
            }
        }
    }

    // An ignored roll keeps only its positive modifiers.
    let kept = |contribs: Vec<Contribution>, ignored: bool| -> Vec<Contribution> {
        if ignored {
            contribs.into_iter().filter(|c| c.value > 0.0).collect()
        } else {
            contribs
        }
    };
    out.hit_mod = cap_modifier(&kept(hit_contribs, out.ignore_modifiers.hit.is_some()));
    out.wound_mod = cap_modifier(&kept(wound_contribs, out.ignore_modifiers.wound.is_some()));
    out
}

/// Lowest value wins; an equal value goes to the better-ranked source.
fn take_lowest(slot: &mut Option<ThresholdState>, value: f64, source: &BuffSource) {
    let take = slot.as_ref().is_none_or(|cur| {
        value < cur.value || (value == cur.value && rank(source) < rank(&cur.dominant_source))
    });
    if take {
        *slot = Some(ThresholdState {
            value,
            dominant_source: source.clone(),
        });
    }
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
