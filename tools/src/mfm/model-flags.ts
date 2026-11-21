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

const STATLINE_KEYS = ["movement", "toughness", "save", "wounds", "leadership", "objectiveControl"] as const;

/**
 * For each of the datasheet's miniature names, the name of the visible miniature whose statline it
 * prints: its own when it is visible, else the one visible miniature with its identical statline
 * (the app hides a statline that repeats another). Absent when a hidden statline repeats none or
 * several.
 */
export function statlineSources(dump: MfmDump, datasheetId: string): Map<string, string> {
  const minis = (dump.groupBy("miniature", "datasheetId").get(datasheetId) ?? []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
  const line = (mini: (typeof minis)[number]): string => JSON.stringify(STATLINE_KEYS.map((key) => (mini as unknown as Record<string, unknown>)[key]));
  const visible = minis.filter((mini) => !mini.statlineHidden);
  const out = new Map<string, string>();
  for (const mini of minis) {
    const name = dump.enName(mini);
    if (!name) continue;
    if (!mini.statlineHidden) {
      out.set(name, name);
      continue;
    }
    const sources = [...new Set(visible.filter((shown) => line(shown) === line(mini)).map((shown) => dump.enName(shown)).filter((n): n is string => !!n))];
    if (sources.length === 1) out.set(name, sources[0]!);
  }
  return out;
}

/**
 * Point `row.profile_name` at the unit profile its model prints: removed when it names another model
 * while the model prints its own statline, set when the model repeats another's. Left alone when
 * the dump does not say. Returns true when the row changed.
 */
export function applyStatlineSource(row: { name: string; profile_name?: string | null; [k: string]: unknown }, sources: Map<string, string>, profileNames: ReadonlySet<string>): boolean {
  const source = sources.get(row.name);
  if (source === undefined || !profileNames.has(source)) return false;
  if (source === row.name) {
    // The row prints its own statline: a profile_name naming another model is stale.
    if (row.profile_name === undefined || row.profile_name === null || row.profile_name === row.name) return false;
    delete row.profile_name;
    return true;
  }
  if (row.profile_name === source) return false;
  row.profile_name = source;
  return true;
}
