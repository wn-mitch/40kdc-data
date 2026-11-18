/**
 * The enhancement fields the dump states as flags on the `enhancement` row, plus the wargear its
 * bearer must carry (`enhancement_required_wargear_item`). `runEnhancements` reconciles them onto
 * matched records and stamps them on seeds; each record carries a field only when it differs from
 * the schema default, so the common case adds nothing to the data.
 */
import * as fs from "fs";
import * as path from "path";
import type { EnhancementRow, MfmDump } from "./loader.js";
import { repoDirs } from "./faction-map.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";

/** The flag fields, by record field name, with the schema default each is omitted at. */
const FLAG_DEFAULTS = {
  counts_toward_enhancement_limit: true,
  equipable_by_non_character: false,
  equipable_by_epic_hero: false,
  bearer_cannot_be_warlord: false,
} as const;

type FlagField = keyof typeof FLAG_DEFAULTS;

export interface EnhancementFlags {
  counts_toward_enhancement_limit: boolean;
  equipable_by_non_character: boolean;
  equipable_by_epic_hero: boolean;
  bearer_cannot_be_warlord: boolean;
  /** Repo weapon ids the bearer must carry, sorted; null when the dump requires none. */
  required_wargear_ids: string[] | null;
  /** Required `wargear_item` ids that resolve to no single repo weapon (the field is then left as authored). */
  unresolvedWargearItemIds: string[];
}

/** A change one reconcile made to a record field. */
export interface FlagChange {
  field: FlagField | "required_wargear_ids";
  from: unknown;
  to: unknown;
}

/**
 * MFM `wargear_item` id → the repo weapon id carrying it as an `mfm` external ref. An item two
 * distinct weapon ids carry maps to `null` (ambiguous).
 */
export function weaponIdsByWargearItem(): ReadonlyMap<string, string | null> {
  const out = new Map<string, string | null>();
  for (const dir of [...repoDirs()].sort()) {
    const file = path.join(CORE_DIR, dir, "weapons.json");
    if (!fs.existsSync(file)) continue;
    for (const weapon of readJsonArray<{ id: string; external_refs?: { namespace: string; id?: string }[] }>(file)) {
      for (const ref of weapon.external_refs ?? []) {
        if (ref.namespace !== "mfm" || !ref.id) continue;
        const seen = out.get(ref.id);
        if (seen === undefined) out.set(ref.id, weapon.id);
        else if (seen !== weapon.id) out.set(ref.id, null);
      }
    }
  }
  return out;
}

/** Enhancement row id → the `wargear_item` ids its bearer must carry. */
export function requiredWargearItemsByEnhancement(dump: MfmDump): ReadonlyMap<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of dump.tables.enhancement_required_wargear_item ? dump.table("enhancement_required_wargear_item") : []) {
    (out.get(row.enhancementId) ?? out.set(row.enhancementId, []).get(row.enhancementId)!).push(row.wargearItemId);
  }
  return out;
}

/** The flag fields of one dump enhancement row. */
export function enhancementFlags(
  row: EnhancementRow,
  requiredItemIds: readonly string[],
  weaponIdOf: ReadonlyMap<string, string | null>,
): EnhancementFlags {
  const weapons = new Set<string>();
  const unresolved: string[] = [];
  for (const itemId of requiredItemIds) {
    const weaponId = weaponIdOf.get(itemId);
    if (weaponId) weapons.add(weaponId);
    else unresolved.push(itemId);
  }
  return {
    counts_toward_enhancement_limit: row.isIncludedInEnhancementLimit,
    equipable_by_non_character: row.isEquipableByNonCharacterUnit,
    equipable_by_epic_hero: row.isEquipableByEpicHero,
    bearer_cannot_be_warlord: row.cannotBeWarlord,
    required_wargear_ids: weapons.size ? [...weapons].sort((a, b) => a.localeCompare(b)) : null,
    unresolvedWargearItemIds: unresolved,
  };
}

/**
 * Write the dump's flags onto `record`: a flag at its schema default is removed, any other value
 * set. `required_wargear_ids` follows the dump unless one of its items did not resolve. Returns the
 * fields that changed.
 */
export function reconcileEnhancementFlags(record: Record<string, unknown>, flags: EnhancementFlags): FlagChange[] {
  const changes: FlagChange[] = [];
  for (const field of Object.keys(FLAG_DEFAULTS) as FlagField[]) {
    const fallback = FLAG_DEFAULTS[field];
    const from = (record[field] as boolean | undefined) ?? fallback;
    const to = flags[field];
    if (from !== to || (to === fallback && field in record)) {
      if (from !== to) changes.push({ field, from, to });
      if (to === fallback) delete record[field];
      else record[field] = to;
    }
  }
  if (flags.unresolvedWargearItemIds.length === 0) {
    const from = (record.required_wargear_ids as string[] | undefined) ?? null;
    if (JSON.stringify(from) !== JSON.stringify(flags.required_wargear_ids)) {
      changes.push({ field: "required_wargear_ids", from, to: flags.required_wargear_ids });
      if (flags.required_wargear_ids === null) delete record.required_wargear_ids;
      else record.required_wargear_ids = flags.required_wargear_ids;
    }
  }
  return changes;
}
