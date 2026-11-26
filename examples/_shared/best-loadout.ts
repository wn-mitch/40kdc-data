import type { Dataset, Unit } from "@alpaca-software/40kdc-data";

import best from "./best-loadouts.json";

type BestLoadouts = Record<string, Record<string, Record<string, Record<string, number>>>>;

const LOADOUTS = best.loadouts as BestLoadouts;

/**
 * The loadout a unit of `modelCount` models starts with: the best legal loadout the points-value
 * audit found for that datasheet and size (`npm run audit:points-value`), else its out-of-the-box
 * loadout. A cached loadout the current wargear rules refuse (the data changed since the audit ran)
 * falls back to the out-of-the-box one.
 */
export function startingLoadout(ds: Dataset, unit: Unit, modelCount: number): Map<string, number> | null {
  const rules = ds.loadoutOf(unit);
  const cached = LOADOUTS[unit.faction_id]?.[unit.id]?.[String(modelCount)];
  if (cached) {
    const counts = new Map(Object.entries(cached));
    if (rules.check(modelCount, counts).length === 0) return counts;
  }
  return rules.base(modelCount);
}
