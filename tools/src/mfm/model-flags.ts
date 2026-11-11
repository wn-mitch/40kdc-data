/**
 * Per-model boolean flags the MFM dump carries on `miniature` rows and the
 * unit-composition model row field each one lands in. Rows are matched to
 * miniatures by English display name; a flag is written only when true.
 */
import type { MfmDump } from "./loader.js";

export const MODEL_FLAGS = [
  { source: "excludedFromEnhancements", field: "excluded_from_enhancements" },
  { source: "cannotBeWarlord", field: "cannot_be_warlord" },
  { source: "canBeNonCharacterWarlord", field: "can_be_non_character_warlord" },
  { source: "isSupremeCommander", field: "is_supreme_commander" },
] as const;

export type ModelFlagField = (typeof MODEL_FLAGS)[number]["field"];

/** For each flag field, the names of the datasheet's miniatures whose flag is true. */
export function flaggedModelNames(dump: MfmDump, datasheetId: string): Map<ModelFlagField, Set<string>> {
  const minis = dump.groupBy("miniature", "datasheetId").get(datasheetId) ?? [];
  const out = new Map<ModelFlagField, Set<string>>();
  for (const { source, field } of MODEL_FLAGS) {
    const names = new Set<string>();
    for (const m of minis) {
      if (m[source] !== true) continue;
      const name = dump.enName(m);
      if (name) names.add(name);
    }
    out.set(field, names);
  }
  return out;
}

/**
 * Set each flag on `row` when its name is flagged and clear it otherwise.
 * Returns true when the row changed.
 */
export function applyModelFlags(
  row: { name: string; [k: string]: unknown },
  flagged: Map<ModelFlagField, Set<string>>,
): boolean {
  let changed = false;
  for (const { field } of MODEL_FLAGS) {
    const on = flagged.get(field)?.has(row.name) === true;
    if (on && row[field] !== true) {
      row[field] = true;
      changed = true;
    } else if (!on && row[field] !== undefined) {
      delete row[field];
      changed = true;
    }
  }
  return changed;
}
