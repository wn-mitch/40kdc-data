import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expectedWindow } from "./restriction-families.js";
import { namedAbilityProblem } from "./named-ability-checks.js";

/**
 * Restriction leaves that describe what the core records already hold (a stratagem's phases, an
 * enhancement's eligible bearers). Compiling them writes nothing; these checks compare the leaf
 * with the core record and return the disagreements, which block approval of the member.
 */

export type CoreCheck =
  | { kind: "use-window"; parameters: Record<string, unknown> }
  | { kind: "bearer-eligibility"; parameters: Record<string, unknown> }
  /** An ability, Stratagem, manoeuvre or action a leaf names by id (named-ability-checks.ts). */
  | { kind: "named-ability"; parameters: Record<string, unknown> };

type CoreRecord = Record<string, unknown>;

/** A keyword as compared: upper case, with curly apostrophes as straight ones (EMPEROR’S is EMPEROR'S). */
const upper = (value: unknown) => String(value).replace(/[‘’]/gu, "'").toUpperCase();

const cache = new Map<string, Map<string, CoreRecord>>();
/** The core faction directory each record was read from ("" for the core rules' own file). */
const recordFaction = new WeakMap<CoreRecord, string>();
const unitCache = new Map<string, Array<{ id: string; labels: Set<string> }>>();

/**
 * A faction's units, each with every label a restriction can name it by: its keywords, its
 * faction keywords and its name (a datasheet-scoped core group names the datasheet).
 */
function factionUnits(dataRoot: string, faction: string): Array<{ id: string; labels: Set<string> }> {
  const key = `${dataRoot}\u0000${faction}`;
  const cached = unitCache.get(key);
  if (cached) return cached;
  const path = join(dataRoot, "core", faction, "units.json");
  const units = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Array<{ id: string; name?: string; keywords?: string[]; faction_keywords?: string[] }>).map((unit) => ({
      id: unit.id,
      labels: new Set([...(unit.keywords ?? []), ...(unit.faction_keywords ?? []), ...(unit.name ? [unit.name] : [])].map(upper)),
    }))
    : [];
  unitCache.set(key, units);
  return units;
}

/**
 * Core records of one kind, keyed by ability id: the core rules' own file (Fire Overwatch,
 * Command Re-roll) and every faction directory's.
 */
function coreRecords(dataRoot: string, file: "stratagems.json" | "enhancements.json"): Map<string, CoreRecord> {
  const key = `${dataRoot}\u0000${file}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const records = new Map<string, CoreRecord>();
  const core = join(dataRoot, "core");
  if (existsSync(core)) {
    for (const faction of ["", ...readdirSync(core)]) {
      const path = join(core, faction, file);
      if (!existsSync(path)) continue;
      for (const record of JSON.parse(readFileSync(path, "utf8")) as CoreRecord[]) {
        records.set(String(record.ability_id ?? record.id), record);
        recordFaction.set(record, faction);
      }
    }
  }
  cache.set(key, records);
  return records;
}

const nonCharacterCache = new Map<string, Map<string, boolean> | null>();

/**
 * Whether each dump enhancement may go to a non-Character (`isEquipableByNonCharacterUnit`), by
 * its MFM id, from the private dump beside the data directory; null when there is no dump.
 */
function nonCharacterFlags(dataRoot: string): Map<string, boolean> | null {
  if (nonCharacterCache.has(dataRoot)) return nonCharacterCache.get(dataRoot)!;
  const path = join(dataRoot, "..", "_private", "dump.json");
  let flags: Map<string, boolean> | null = null;
  if (existsSync(path)) {
    const rows = (JSON.parse(readFileSync(path, "utf8")) as { data?: { enhancement?: Array<{ id: string; isEquipableByNonCharacterUnit?: boolean }> } }).data?.enhancement ?? [];
    flags = new Map(rows.map((row) => [row.id, row.isEquipableByNonCharacterUnit === true]));
  }
  nonCharacterCache.set(dataRoot, flags);
  return flags;
}

/**
 * Whether the bearer must be a CHARACTER although the core record does not list it: the dump
 * says this enhancement is not for non-Character units, a requirement the core entity has no
 * field for. Without the dump, nothing is implied.
 */
function characterImplied(dataRoot: string, record: CoreRecord): boolean {
  const flags = nonCharacterFlags(dataRoot);
  const refs = Array.isArray(record.external_refs) ? record.external_refs as Array<{ namespace?: string; id?: string }> : [];
  const id = refs.find((ref) => ref.namespace === "mfm")?.id;
  return flags !== null && id !== undefined && flags.get(id) === false;
}


function eligibilityProblem(record: CoreRecord, parameters: Record<string, unknown>, implied: boolean): string | null {
  const groups = Array.isArray(record.keyword_restriction_groups)
    ? (record.keyword_restriction_groups as unknown[][]).map((group) => group.map(upper))
    : Array.isArray(record.keyword_restrictions) ? [(record.keyword_restrictions as unknown[]).map(upper)] : [];
  // CHARACTER the record leaves implied is not a keyword its groups must list.
  const words = (parameters.keywords as string[]).map(upper).filter((word) => !(implied && word === "CHARACTER" && !groups.some((group) => group.includes(word))));
  if (groups.length === 0) return "the core enhancement names no eligible keywords";
  // Excluded models, when the leaf names any, must be exactly the ones core excludes.
  if (Array.isArray(parameters.excluded_keywords)) {
    const excluded = (parameters.excluded_keywords as string[]).map(upper).sort();
    const coreExcluded = (Array.isArray(record.exclusion_keywords) ? record.exclusion_keywords as unknown[] : []).map(upper).sort();
    if (excluded.join() !== coreExcluded.join()) return `core excludes ${coreExcluded.join(", ") || "no keywords"}`;
  }
  // Core adds the army's faction keyword the wording leaves out, so each named keyword must be
  // present, not the lists equal.
  if (Array.isArray(parameters.any_keywords)) {
    // Every keyword plus one of several: one core group per one-of keyword, each holding all the
    // required keywords and exactly that one.
    const any = (parameters.any_keywords as string[]).map(upper);
    const fits = groups.length === any.length && groups.every((group) => words.every((word) => group.includes(word)) && any.filter((word) => group.includes(word)).length === 1)
      && any.every((word) => groups.some((group) => group.includes(word)));
    return fits ? null : `core requires ${groups.map((group) => group.join(" + ")).join(" or ")}`;
  }
  if (parameters.match === "all") {
    return groups.length === 1 && words.every((word) => groups[0]!.includes(word)) ? null : `core requires ${groups.map((group) => group.join(" + ")).join(" or ")}`;
  }
  const matched = words.every((word) => groups.some((group) => group.includes(word))) && groups.every((group) => words.some((word) => group.includes(word)));
  return matched ? null : `core allows ${groups.map((group) => group.join(" + ")).join(" or ")}`;
}

/**
 * Whether the leaf and the core record admit the same units of the record's faction, when they
 * spell the bearer differently: the printed IRON-MASTER where the dump requires BRÔKHYR, the
 * TRISTRAEN'S GILDED BLADES keyword where the dump names the Tristraen datasheet. Both readings
 * must admit at least one unit; an implied CHARACTER requirement applies to both.
 */
function sameBearers(dataRoot: string, record: CoreRecord, parameters: Record<string, unknown>, implied: boolean): boolean {
  const faction = recordFaction.get(record);
  if (faction === undefined || faction === "") return false;
  const groups = Array.isArray(record.keyword_restriction_groups)
    ? (record.keyword_restriction_groups as unknown[][]).map((group) => group.map(upper))
    : Array.isArray(record.keyword_restrictions) ? [(record.keyword_restrictions as unknown[]).map(upper)] : [];
  if (groups.length === 0) return false;
  const words = (parameters.keywords as string[]).map(upper);
  const any = Array.isArray(parameters.any_keywords) ? (parameters.any_keywords as string[]).map(upper) : null;
  const byLeaf = (labels: Set<string>) => any
    ? words.every((word) => labels.has(word)) && any.some((word) => labels.has(word))
    : parameters.match === "any" ? words.some((word) => labels.has(word)) : words.every((word) => labels.has(word));
  const byCore = (labels: Set<string>) => groups.some((group) => group.every((word) => labels.has(word)));
  const units = factionUnits(dataRoot, faction).filter((unit) => !implied || unit.labels.has("CHARACTER"));
  const leafIds = units.filter((unit) => byLeaf(unit.labels)).map((unit) => unit.id).sort();
  const coreIds = units.filter((unit) => byCore(unit.labels)).map((unit) => unit.id).sort();
  return leafIds.length > 0 && leafIds.join() === coreIds.join();
}

function eligibleReading(parameters: Record<string, unknown>): string {
  const keywords = (parameters.keywords as string[]).join(parameters.match === "any" ? " or " : " + ");
  return Array.isArray(parameters.any_keywords) ? `${keywords} + (${(parameters.any_keywords as string[]).join(" or ")})` : keywords;
}

/** Disagreements between restriction leaves and the core record for one ability. */
export function coreCheckErrors(dataRoot: string, abilityId: string, checks: readonly CoreCheck[]): string[] {
  const errors: string[] = [];
  for (const check of checks) {
    if (check.kind === "named-ability") {
      const problem = namedAbilityProblem(dataRoot, abilityId, check.parameters);
      if (problem) errors.push(`The named ${String(check.parameters.activity)} does not resolve: ${problem}`);
    } else if (check.kind === "use-window") {
      const record = coreRecords(dataRoot, "stratagems.json").get(abilityId);
      if (!record) {
        errors.push("The WHEN leaf names phases, but there is no core stratagem record to check them against.");
        continue;
      }
      const expected = expectedWindow(check.parameters);
      const phases = [...(record.phases as string[] ?? [])].sort();
      if (phases.join() !== [...expected.phases].sort().join() || record.player_turn !== expected.player_turn) {
        errors.push(`WHEN reads as ${expected.phases.join(", ")} in ${expected.player_turn}, but core says ${phases.join(", ")} in ${String(record.player_turn)}.`);
      }
    } else {
      const record = coreRecords(dataRoot, "enhancements.json").get(abilityId);
      if (!record) {
        errors.push("The eligibility leaf names bearers, but there is no core enhancement record to check them against.");
        continue;
      }
      const implied = characterImplied(dataRoot, record);
      let problem = eligibilityProblem(record, check.parameters, implied);
      if (problem && !problem.startsWith("core excludes") && sameBearers(dataRoot, record, check.parameters, implied)) problem = null;
      if (problem) errors.push(`Eligible bearers read as ${eligibleReading(check.parameters)}, but ${problem}.`);
    }
  }
  return errors;
}
