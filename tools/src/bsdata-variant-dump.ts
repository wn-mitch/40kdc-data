import { normModelName } from "./convert-bsdata-wargear.js";
import { arr, str, type JsonNode } from "./bsdata-equipment.js";

/** One whole-model loadout of a composition row, as the variant converter projects it. */
export interface LoadoutVariant { name: string; weapon_ids: string[]; max_count?: number }

export const sameItems = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index]);

const itemIds = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(itemIds) : [];

const optionItems = (options: readonly JsonNode[]): string[] =>
  options.flatMap((option) => [...itemIds(option.replaces), ...itemIds(option.replacement), ...itemIds(option.replacement_choice)]);

/**
 * Why `variants` cannot stand for `row` against the MFM dump, or undefined when they can. The
 * rows' defaults and the unit's option items are everything the dump lets the unit carry; without
 * the options or recorded defaults there is no inventory to hold the variants to.
 */
export function dumpConflict(row: JsonNode, rows: readonly JsonNode[], variants: readonly LoadoutVariant[], wargearOptions?: readonly JsonNode[]): string | undefined {
  const dumpItems = wargearOptions && rows.some((candidate) => Array.isArray(candidate.default_weapon_ids))
    ? new Set([...rows.flatMap((candidate) => itemIds(candidate.default_weapon_ids)), ...optionItems(wargearOptions)])
    : undefined;
  // An item the dump never gives the unit is a loadout the live game does not
  // offer (or a source name resolving to the wrong item).
  const offDump = [...new Set(variants.flatMap((variant) => variant.weapon_ids))].filter((id) => dumpItems && !dumpItems.has(id));
  if (offDump.length) return `${offDump.join(", ")} not in the unit's MFM wargear`;
  // Every model of a full row can keep the MFM default loadout, so some
  // variant must carry exactly those items with room for the whole row.
  const defaults = Array.isArray(row.default_weapon_ids) ? itemIds(row.default_weapon_ids) : undefined;
  const rowMax = typeof row.max === "number" ? row.max : 0;
  if (defaults && !variants.some((variant) => sameItems(variant.weapon_ids, defaults) && (variant.max_count === undefined || variant.max_count >= rowMax))) {
    return "no variant holds the MFM default loadout for the full row";
  }
  // A peer named for another MFM row (a Soul Weaver beside a Shade Runner) is
  // that row's model, not an alternative loadout of this one.
  const ownRowOf = variants.map((variant) => variant.name)
    .filter((name) => rows.some((other) => other !== row && normModelName(str(other.name) ?? "") === normModelName(name)));
  return ownRowOf.length ? `${ownRowOf.join(", ")} named for another MFM row` : undefined;
}

/**
 * Rows of `projected` the source no longer projects onto (their peers renamed or removed upstream,
 * or a projection refused) take back their committed variants from `compositions` while those still
 * agree with the dump. Variants that do not leave the row to its MFM defaults and options, and an
 * item only they reached leaves the unit's `weapon_ids` in `units` with them, so the weapon list
 * never names an item nothing fields. Returns whether any unit's `weapon_ids` changed.
 */
export function restoreCommittedRows(
  projected: readonly JsonNode[],
  compositions: readonly JsonNode[],
  units: readonly JsonNode[],
  wargearOptions: readonly JsonNode[],
  notes: string[],
): boolean {
  let unitsChanged = false;
  for (const [unitIndex, composition] of projected.entries()) {
    const unitId = str(composition.unit_id);
    const committed = arr(compositions[unitIndex]?.models);
    const options = wargearOptions.filter((option) => option.unit_id === unitId);
    const rows = arr(composition.models);
    const dropped = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const kept = committed[index];
      if (row.loadout_variants !== undefined || !kept?.loadout_variants) continue;
      const variants = arr(kept.loadout_variants) as unknown as LoadoutVariant[];
      const conflict = dumpConflict(row, rows, variants, options);
      if (conflict) {
        for (const variant of variants) for (const id of variant.weapon_ids) dropped.add(id);
        notes.push(`${unitId}: ${str(row.name)}: committed variants dropped: ${conflict}`);
        continue;
      }
      row.loadout_variants = structuredClone(kept.loadout_variants);
      if (kept.loadout_variant_budgets) row.loadout_variant_budgets = structuredClone(kept.loadout_variant_budgets);
      notes.push(`${unitId}: ${str(row.name)}: committed variants kept; no source projection replaces them`);
    }
    if (!dropped.size) continue;
    const reachable = new Set([
      ...rows.flatMap((row) => [...itemIds(row.default_weapon_ids), ...arr(row.loadout_variants).flatMap((variant) => itemIds(variant.weapon_ids))]),
      ...optionItems(options),
    ]);
    const unit = units.find((candidate) => candidate.id === unitId);
    const weaponIds = Array.isArray(unit?.weapon_ids) ? (unit.weapon_ids as string[]) : [];
    const stranded = weaponIds.filter((id) => dropped.has(id) && !reachable.has(id));
    if (!unit || !stranded.length) continue;
    unit.weapon_ids = weaponIds.filter((id) => !stranded.includes(id));
    notes.push(`${unitId}: weapon_ids dropped ${stranded.join(", ")}: no remaining loadout fields it`);
    unitsChanged = true;
  }
  return unitsChanged;
}
