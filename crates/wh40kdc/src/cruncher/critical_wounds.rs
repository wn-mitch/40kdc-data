//! Critical wounds with their own AP and Damage. A buff gated `onCritical: "wound"` applies only to
//! the attacks that score a critical wound, so those wounds take their save at their own AP and
//! deal their own Damage, and with Devastating Wounds their mortal wounds deal that Damage.
//! Mirrors `tools/src/cruncher/critical-wounds.ts`.

use super::buffs::{resolve_buffs, Buff, EngineContext, ResolvedModifiers};

/// Whether any buff applies only on a critical wound.
pub(crate) fn has_critical_wound_buffs(buffs: &[Buff]) -> bool {
    buffs.iter().any(|buff| {
        buff.applicable_when
            .as_ref()
            .is_some_and(|w| w.on_critical.as_deref() == Some("wound"))
    })
}

/// The buffs resolved for an attack that scored a critical wound.
pub(crate) fn resolve_critical_wound(buffs: &[Buff], ctx: &EngineContext) -> ResolvedModifiers {
    let mut ctx = ctx.clone();
    ctx.critical_roll = Some("wound".to_string());
    resolve_buffs(buffs, &ctx)
}

/// The AP an attack has under `resolved`; worsening AP stops at 0.
pub(crate) fn attack_ap(resolved: &ResolvedModifiers, printed_ap: f64) -> f64 {
    let base = resolved
        .stat_set
        .ap
        .as_ref()
        .map_or(printed_ap, |set| set.value);
    (base + resolved.ap_mod.value).min(0.0)
}

/// One stream of wounds taking a save: its wounds, save chance, re-rollable failure chance and
/// re-rolled save chance.
pub(crate) struct SaveStream {
    pub wounds: f64,
    pub saved: f64,
    pub open: f64,
    pub fresh: f64,
}

/// The expected unsaved wounds of streams that take the same save at different targets, with a
/// "re-roll one saving throw" spent on the stream a failed save is likelier to come from. Returns
/// the unsaved wounds and the re-rolled dice.
pub(crate) fn split_unsaved(
    streams: &[SaveStream],
    reroll_one_dice: impl Fn(f64, f64) -> f64,
    reroll_one: bool,
) -> (f64, f64) {
    let mut unsaved: f64 = streams.iter().map(|s| s.wounds * (1.0 - s.saved)).sum();
    if !reroll_one {
        return (unsaved, 0.0);
    }
    let pool: f64 = streams.iter().map(|s| s.wounds).sum();
    let failing: f64 = streams.iter().map(|s| s.wounds * s.open).sum();
    if pool <= 0.0 || failing <= 0.0 {
        return (unsaved, 0.0);
    }
    let dice = reroll_one_dice(pool, failing / pool);
    // The re-rolled save comes from each stream in proportion to its re-rollable failures.
    unsaved -= dice
        * streams
            .iter()
            .map(|s| s.wounds * s.open * s.fresh)
            .sum::<f64>()
        / failing;
    (unsaved, dice)
}

/// Per-roll damage distributions mixed by weight, ascending by value with each value once, as
/// `one_damage_reroll_gain` reads them.
pub(crate) fn mix_distributions(parts: &[(f64, &[(f64, f64)])]) -> Vec<(f64, f64)> {
    let total: f64 = parts.iter().map(|(weight, _)| weight).sum();
    let mut mixed: Vec<(f64, f64)> = Vec::new();
    for (weight, distribution) in parts {
        for &(value, probability) in *distribution {
            let share = if total > 0.0 {
                probability * weight / total
            } else {
                0.0
            };
            match mixed.iter_mut().find(|(v, _)| *v == value) {
                Some(entry) => entry.1 += share,
                None => mixed.push((value, share)),
            }
        }
    }
    mixed.sort_by(|a, b| a.0.total_cmp(&b.0));
    mixed
}
