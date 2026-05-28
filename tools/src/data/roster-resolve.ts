/**
 * Bridge helpers between the importer's flat-data {@link Roster} types and
 * the linked {@link UnitView} the cruncher consumes. The importer ships
 * unit entries as plain interfaces (`RosterUnit` is data, not behaviour),
 * so the lookup is a free function rather than a method.
 *
 * @packageDocumentation
 */
import type { RosterUnit, RosterWargear } from "../import/types.js";
import type { Dataset } from "./dataset.js";
import type { UnitView, WeaponView } from "./entities.js";

/**
 * Resolve a roster's unit entry against the dataset, returning the linked
 * {@link UnitView}. Returns `undefined` when:
 *   - the roster's `ref.id` is `null` (the importer couldn't match the unit), or
 *   - the id doesn't appear in the dataset (e.g. the roster was authored
 *     against an older dataslate than the bundled one).
 *
 * Doesn't surface diagnostics — the caller already has them on the roster's
 * own `diagnostics` field.
 */
export function resolveRosterUnit(
  rosterUnit: RosterUnit,
  dataset: Dataset,
): UnitView | undefined {
  const id = rosterUnit.ref.id;
  if (id === null) return undefined;
  return dataset.units.get(id);
}

/**
 * Resolve every wargear entry on a roster unit to a {@link WeaponView},
 * keeping each entry's count alongside. Unresolved entries are dropped
 * silently (matching {@link resolveRosterUnit}). Useful when the SPA
 * needs to enumerate firing options after the user picks a roster unit.
 */
export function resolveRosterWargear(
  wargear: RosterWargear[],
  dataset: Dataset,
): { weapon: WeaponView; count: number }[] {
  const out: { weapon: WeaponView; count: number }[] = [];
  for (const w of wargear) {
    const id = w.ref.id;
    if (id === null) continue;
    const weapon = dataset.weapons.get(id);
    if (!weapon) continue;
    out.push({ weapon, count: w.count });
  }
  return out;
}
