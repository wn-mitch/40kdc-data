/**
 * Datasheet-scoped enhancement eligibility. A dump `enhancement_required_keyword_group` row with a
 * `datasheetId` admits that one datasheet (with the group's keywords), not every unit that carries
 * the datasheet's name as a keyword: the Big Mek datasheet group of an Ork enhancement must not
 * admit the Big Mek Dakkarig, which carries the BIG MEK keyword. Core stores such a group in
 * `datasheet_restriction_groups` by the repo unit id the datasheet maps to.
 */
import * as fs from "fs";
import * as path from "path";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import { repoDirs } from "./faction-map.js";

/** One datasheet-scoped eligibility group: the bearer's unit is `unit_id` and carries every keyword. */
export interface DatasheetRestriction {
  unit_id: string;
  keywords?: string[];
}

/**
 * The core unit a dump datasheet id maps to: one unit id, `"none"` when no core unit claims the
 * datasheet (a Legends sheet the repo culled), or `"ambiguous"` when several distinct units do.
 */
export type DatasheetUnit = { unit_id: string } | "none" | "ambiguous";

export type DatasheetUnitResolver = (datasheetId: string) => DatasheetUnit;

interface UnitRow {
  id: string;
  external_refs?: { namespace?: string; id?: string }[];
}

/**
 * Resolve dump datasheets to core units by each unit's `mfm` external reference. A datasheet that
 * several distinct unit ids claim is ambiguous, so its group stays unresolved rather than picking one.
 */
export function coreUnitIdsByDatasheet(coreDir: string = CORE_DIR, dirs: Iterable<string> = repoDirs()): DatasheetUnitResolver {
  const byDatasheet = new Map<string, Set<string>>();
  for (const dir of dirs) {
    const file = path.join(coreDir, dir, "units.json");
    if (!fs.existsSync(file)) continue;
    for (const unit of readJsonArray<UnitRow>(file)) {
      for (const ref of unit.external_refs ?? []) {
        if (ref.namespace !== "mfm" || !ref.id) continue;
        const ids = byDatasheet.get(ref.id) ?? new Set<string>();
        ids.add(unit.id);
        byDatasheet.set(ref.id, ids);
      }
    }
  }
  return (datasheetId) => {
    const ids = byDatasheet.get(datasheetId);
    if (!ids || ids.size === 0) return "none";
    return ids.size === 1 ? { unit_id: [...ids][0]! } : "ambiguous";
  };
}

const groupKey = (group: DatasheetRestriction): string => JSON.stringify([group.unit_id, [...(group.keywords ?? [])].sort((a, b) => a.localeCompare(b))]);

/** Distinct groups in a stable order (unit id, then keywords), keywords sorted; null when there are none. */
export function canonicalDatasheetGroups(groups: readonly DatasheetRestriction[]): DatasheetRestriction[] | null {
  const distinct = new Map<string, DatasheetRestriction>();
  for (const group of groups) {
    const keywords = [...new Set(group.keywords ?? [])].sort((a, b) => a.localeCompare(b));
    const canonical: DatasheetRestriction = keywords.length ? { unit_id: group.unit_id, keywords } : { unit_id: group.unit_id };
    distinct.set(groupKey(canonical), canonical);
  }
  const out = [...distinct.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => group);
  return out.length ? out : null;
}

/** Order-insensitive equality of two datasheet group lists, null and absent read as empty. */
export function sameDatasheetGroups(a: readonly DatasheetRestriction[] | null | undefined, b: readonly DatasheetRestriction[] | null | undefined): boolean {
  const keys = (groups: readonly DatasheetRestriction[] | null | undefined) => (groups ?? []).map(groupKey).sort().join("\u0000");
  return keys(a) === keys(b);
}
