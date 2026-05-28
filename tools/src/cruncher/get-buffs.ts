/**
 * Concatenate the buff contributions from every item in a list of "has-buffs"
 * objects. Lower-level utility behind {@link Dataset.buffsFor}; surfaced as
 * its own export so callers who want to wire their stack differently can
 * still keep the one-liner ergonomics.
 */
import type { Buff } from "./buffs.js";

export interface HasBuffs {
  // The runtime contract is loose on purpose: any of the package's view
  // classes — WeaponView, WeaponKeywordView, AbilityView (M2), or anything
  // a caller hand-rolls — can satisfy it.
  getBuffs(...args: unknown[]): Buff[];
}

export function getBuffs(items: HasBuffs[], ...args: unknown[]): Buff[] {
  const out: Buff[] = [];
  for (const item of items) out.push(...item.getBuffs(...args));
  return out;
}
