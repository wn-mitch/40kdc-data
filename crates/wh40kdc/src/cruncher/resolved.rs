//! The [`ResolvedModifiers`] read-out [`resolve_buffs`](super::buffs::resolve_buffs) collapses a
//! buff stack into, with provenance per field. Mirrors the `ResolvedModifiers` type in
//! `tools/src/cruncher/buffs.ts`; re-exported from [`super::buffs`].

use super::buffs::{BuffSource, RerollSubset, RollKind, WeaponKeywordRef};

/// Damage-zeroing uses a buff stack grants, summed over its sources.
#[derive(Clone, Debug, Default)]
pub struct ZeroingUses {
    pub unit: usize,
    pub model: usize,
    pub sources: Vec<BuffSource>,
}

/// Read-out of a resolved buff stack, with provenance per field.
#[derive(Clone, Debug, Default)]
pub struct ResolvedModifiers {
    pub hit_mod: CappedMod,
    pub wound_mod: CappedMod,
    pub save_mod: SummedMod,
    pub cover: CoverState,
    pub rerolls: Rerolls,
    /// One re-rolled die per roll, from a `reroll-one`; several sources still give one die.
    pub reroll_one: RerollOne,
    pub extra_keywords: Vec<ExtraKeywordEntry>,
    /// All-wound FNP — fires on the main and mortal damage streams alike.
    pub feel_no_pain: Option<FeelNoPainState>,
    /// Mortal-only FNP — fires only on the mortal-wound damage stream.
    pub feel_no_pain_mortal: Option<FeelNoPainState>,
    pub damage_mod: SummedMod,
    pub attacks_mod: SummedMod,
    pub strength_mod: SummedMod,
    pub toughness_mod: SummedMod,
    pub ap_mod: SummedMod,
    /// Ability-set weapon characteristics; an absent stat keeps the profile's value.
    pub stat_set: StatSets,
    /// Defender-side damage reduction. Highest-wins (multiple sources do not
    /// stack in 10e); the dominant source is the one whose value matches the
    /// surviving reduction.
    pub damage_reduction: HighestMod,
    /// Damage-zeroing uses, summed over sources: a pool the unit shares and
    /// uses for each model.
    pub damage_zeroing: ZeroingUses,
    /// Ability-granted invulnerable save. Best (lowest threshold) wins. `None`
    /// when no ability granted one; the engine still uses the unit's printed
    /// `invuln_sv` from the profile in that case.
    pub invulnerable: Option<InvulnerableState>,
    /// Lowest critical threshold granted per roll; an absent roll crits on a 6.
    pub crit_thresholds: CritThresholds,
    /// Rolls whose negative modifiers the attacker ignores.
    pub ignore_modifiers: IgnoredRolls,
    /// Summed WS/BS characteristic improvements.
    pub skill_mod: SkillMods,
    /// Ability-set Save characteristic (lowest wins); `None` keeps the printed one.
    pub save_characteristic: Option<ThresholdState>,
    /// Summed capped Save improvements; `None` when none applies.
    pub save_improve: Option<SaveImproveState>,
}

/// Summed `save-improve` contributions: the total improvement and the most restrictive (largest)
/// cap among them.
#[derive(Clone, Debug)]
pub struct SaveImproveState {
    pub value: f64,
    pub best: f64,
    pub sources: Vec<BuffSource>,
}

/// A lowest-wins threshold plus the source that produced it (rank breaks ties).
#[derive(Clone, Debug)]
pub struct ThresholdState {
    pub value: f64,
    pub dominant_source: BuffSource,
}

/// Per-roll critical thresholds from `crit-threshold` buffs.
#[derive(Clone, Debug, Default)]
pub struct CritThresholds {
    pub hit: Option<ThresholdState>,
    pub wound: Option<ThresholdState>,
}

/// Per-roll `ignore-modifiers` buffs: the dominant source, when the roll's modifiers are ignored.
#[derive(Clone, Debug, Default)]
pub struct IgnoredRolls {
    pub hit: Option<BuffSource>,
    pub wound: Option<BuffSource>,
}

/// The attacker's best `stat-set` per weapon characteristic.
#[derive(Clone, Debug, Default)]
pub struct StatSets {
    pub a: Option<ThresholdState>,
    pub s: Option<ThresholdState>,
    pub ap: Option<ThresholdState>,
    pub d: Option<ThresholdState>,
}

/// Summed `skill-mod` improvements per characteristic.
#[derive(Clone, Debug, Default)]
pub struct SkillMods {
    pub ws: SummedMod,
    pub bs: SummedMod,
}

/// Ability-granted invulnerable save read-out: the surviving threshold plus
/// the source that produced it. Combined with the unit's printed invuln in
/// the engine.
#[derive(Clone, Debug)]
pub struct InvulnerableState {
    pub threshold: f64,
    pub dominant_source: BuffSource,
}

/// Highest-wins modifier: `value` is the largest contributor, `dominant_source`
/// is the one that produced it (with rank as the tiebreaker on equal values).
#[derive(Clone, Debug, Default)]
pub struct HighestMod {
    pub value: f64,
    pub dominant_source: Option<BuffSource>,
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

#[derive(Clone, Debug, Default)]
pub struct RerollOne {
    pub hit: Option<RerollOneState>,
    pub wound: Option<RerollOneState>,
    pub save: Option<RerollOneState>,
    pub damage: Option<RerollOneState>,
}

impl RerollOne {
    pub fn for_roll(&self, roll: RollKind) -> Option<&RerollOneState> {
        match roll {
            RollKind::Hit => self.hit.as_ref(),
            RollKind::Wound => self.wound.as_ref(),
            RollKind::Save => self.save.as_ref(),
            RollKind::Damage => self.damage.as_ref(),
        }
    }

    pub(super) fn for_roll_mut(&mut self, roll: RollKind) -> &mut Option<RerollOneState> {
        match roll {
            RollKind::Hit => &mut self.hit,
            RollKind::Wound => &mut self.wound,
            RollKind::Save => &mut self.save,
            RollKind::Damage => &mut self.damage,
        }
    }
}

#[derive(Clone, Debug)]
pub struct RerollOneState {
    pub dominant_source: BuffSource,
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
