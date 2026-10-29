/**
 * Critical wounds with their own AP and Damage. A buff gated `onCritical: "wound"` applies only to
 * the attacks that score a critical wound, so those wounds take their save at their own AP and deal
 * their own Damage, and with Devastating Wounds their mortal wounds deal that Damage.
 */
import { type Buff, type EngineContext, type ResolvedModifiers, resolveBuffs } from "./buffs.js";

/** Whether any buff applies only on a critical wound. */
export function hasCriticalWoundBuffs(buffs: readonly Buff[]): boolean {
  return buffs.some((buff) => buff.applicableWhen?.onCritical === "wound");
}

/** The buffs resolved for an attack that scored a critical wound. */
export function resolveCriticalWound(buffs: Buff[], ctx: EngineContext): ResolvedModifiers {
  return resolveBuffs(buffs, { ...ctx, criticalRoll: "wound" });
}

/** The AP an attack has under `resolved`; worsening AP stops at 0. */
export function attackAp(resolved: ResolvedModifiers, printedAp: number): number {
  return Math.min(0, (resolved.statSet.AP?.value ?? printedAp) + resolved.apMod.value);
}

/**
 * The expected unsaved wounds of two streams that take the same save at different targets, with a
 * "re-roll one saving throw" spent on the stream a failed save is likelier to come from.
 * `stream` gives each stream's wounds, save chance and re-rollable failure chance.
 */
export function splitUnsaved(
  streams: ReadonlyArray<{ wounds: number; saved: number; open: number; fresh: number }>,
  rerollOneDice: (pool: number, open: number) => number,
  rerollOne: boolean,
): { unsaved: number; dice: number } {
  let unsaved = streams.reduce((sum, stream) => sum + stream.wounds * (1 - stream.saved), 0);
  if (!rerollOne) return { unsaved, dice: 0 };
  const pool = streams.reduce((sum, stream) => sum + stream.wounds, 0);
  const failing = streams.reduce((sum, stream) => sum + stream.wounds * stream.open, 0);
  if (pool <= 0 || failing <= 0) return { unsaved, dice: 0 };
  const dice = rerollOneDice(pool, failing / pool);
  // The re-rolled save comes from each stream in proportion to its re-rollable failures.
  unsaved -= dice * streams.reduce((sum, stream) => sum + stream.wounds * stream.open * stream.fresh, 0) / failing;
  return { unsaved, dice };
}

/**
 * Two per-roll damage distributions mixed by weight, ascending by value with each value once, as
 * `oneDamageRerollGain` reads them.
 */
export function mixDistributions(
  parts: ReadonlyArray<{ weight: number; distribution: ReadonlyArray<{ value: number; probability: number }> }>,
): Array<{ value: number; probability: number }> {
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  const byValue = new Map<number, number>();
  for (const { weight, distribution } of parts) {
    for (const { value, probability } of distribution) {
      byValue.set(value, (byValue.get(value) ?? 0) + (total > 0 ? probability * weight / total : 0));
    }
  }
  return [...byValue.entries()].sort((a, b) => a[0] - b[0]).map(([value, probability]) => ({ value, probability }));
}
