import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CompileError } from "./compile-fragments.js";

/**
 * The faction id an `army-faction` condition names. A rule names its Army Faction by the faction
 * keyword it prints ("HERETIC ASTARTES"), but the engine reads an army's faction by id, so a
 * keyword lowers to the faction whose record and units carry it. Read from the repo's core data.
 */

type Row = Record<string, unknown>;

const DEFAULT_DATA_ROOT = fileURLToPath(new URL("../../../data", import.meta.url));

interface FactionIndex {
  ids: Set<string>;
  /** Faction keyword id → the faction ids whose faction record carries it. */
  byRecord: Map<string, Set<string>>;
  /** Faction keyword id → the faction ids whose units carry it as a faction keyword. */
  byUnits: Map<string, Set<string>>;
}

const cache = new Map<string, FactionIndex>();

/** A faction keyword as an id: lower-case, apostrophes dropped, other runs of non-alphanumerics a hyphen. */
export function factionKeywordId(keyword: string): string {
  return keyword.toLowerCase().replace(/[‘’']/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function readRows(path: string): Row[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return Array.isArray(parsed) ? parsed as Row[] : [];
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function factionIndex(dataRoot: string): FactionIndex {
  const cached = cache.get(dataRoot);
  if (cached) return cached;
  const coreRoot = join(dataRoot, "core");
  const index: FactionIndex = { ids: new Set(), byRecord: new Map(), byUnits: new Map() };
  for (const dir of existsSync(coreRoot) ? readdirSync(coreRoot).sort() : []) {
    for (const faction of readRows(join(coreRoot, dir, "factions.json"))) {
      if (typeof faction.id !== "string") continue;
      index.ids.add(faction.id);
      for (const keyword of Array.isArray(faction.keywords) ? faction.keywords : []) {
        if (typeof keyword === "string") add(index.byRecord, factionKeywordId(keyword), faction.id);
      }
    }
    for (const unit of readRows(join(coreRoot, dir, "units.json"))) {
      if (typeof unit.faction_id !== "string") continue;
      for (const keyword of Array.isArray(unit.faction_keywords) ? unit.faction_keywords : []) {
        if (typeof keyword === "string") add(index.byUnits, factionKeywordId(keyword), unit.faction_id);
      }
    }
  }
  cache.set(dataRoot, index);
  return index;
}

/**
 * The faction id an Army Faction value names. A faction id passes unchanged. A faction keyword
 * lowers to the one faction whose record carries it and whose units carry it as their faction
 * keyword. Anything else is refused: a keyword no faction carries, one several faction records
 * carry (CHAOS, IMPERIUM), and an Army Faction with no faction record of its own (a keyword only
 * some other faction's units carry), which no army's faction id can match.
 */
export function armyFactionId(value: string, dataRoot = process.env.SEMANTIC_AUTHORING_DATA_ROOT ? resolve(process.env.SEMANTIC_AUTHORING_DATA_ROOT) : DEFAULT_DATA_ROOT): string {
  const index = factionIndex(dataRoot);
  if (index.ids.has(value)) return value;
  const key = factionKeywordId(value);
  const records = [...(index.byRecord.get(key) ?? [])].sort();
  const units = [...(index.byUnits.get(key) ?? [])].sort();
  if (records.length === 1 && units.includes(records[0])) return records[0];
  if (records.length > 1) {
    throw new CompileError(`Army Faction "${value}" is a keyword of several factions (${records.join(", ")}); name one faction.`);
  }
  if (units.length > 0) {
    throw new CompileError(`Army Faction "${value}" has no faction record (only units of ${units.join(", ")} carry it), so no army's faction id can match it.`);
  }
  throw new CompileError(`Army Faction "${value}" names no faction: no faction record or unit carries it.`);
}
