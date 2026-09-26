import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expectedWindow } from "./restriction-families.js";

/**
 * Restriction leaves that describe what the core records already hold (a stratagem's phases, an
 * enhancement's eligible bearers). Compiling them writes nothing; these checks compare the leaf
 * with the core record and return the disagreements, which block approval of the member.
 */

export type CoreCheck =
  | { kind: "use-window"; parameters: Record<string, unknown> }
  | { kind: "bearer-eligibility"; parameters: Record<string, unknown> };

type CoreRecord = Record<string, unknown>;

const cache = new Map<string, Map<string, CoreRecord>>();

/** Core records of one kind across every faction directory, keyed by ability id. */
function coreRecords(dataRoot: string, file: "stratagems.json" | "enhancements.json"): Map<string, CoreRecord> {
  const key = `${dataRoot}\u0000${file}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const records = new Map<string, CoreRecord>();
  const core = join(dataRoot, "core");
  if (existsSync(core)) {
    for (const faction of readdirSync(core)) {
      const path = join(core, faction, file);
      if (!existsSync(path)) continue;
      for (const record of JSON.parse(readFileSync(path, "utf8")) as CoreRecord[]) {
        records.set(String(record.ability_id ?? record.id), record);
      }
    }
  }
  cache.set(key, records);
  return records;
}

const upper = (value: unknown) => String(value).toUpperCase();

function eligibilityProblem(record: CoreRecord, parameters: Record<string, unknown>): string | null {
  const words = (parameters.keywords as string[]).map(upper);
  const groups = Array.isArray(record.keyword_restriction_groups)
    ? (record.keyword_restriction_groups as unknown[][]).map((group) => group.map(upper))
    : Array.isArray(record.keyword_restrictions) ? [(record.keyword_restrictions as unknown[]).map(upper)] : [];
  if (groups.length === 0) return "the core enhancement names no eligible keywords";
  // Core adds the army's faction keyword the wording leaves out, so each named keyword must be
  // present, not the lists equal.
  if (parameters.match === "all") {
    return groups.length === 1 && words.every((word) => groups[0]!.includes(word)) ? null : `core requires ${groups.map((group) => group.join(" + ")).join(" or ")}`;
  }
  const matched = words.every((word) => groups.some((group) => group.includes(word))) && groups.every((group) => words.some((word) => group.includes(word)));
  return matched ? null : `core allows ${groups.map((group) => group.join(" + ")).join(" or ")}`;
}

/** Disagreements between restriction leaves and the core record for one ability. */
export function coreCheckErrors(dataRoot: string, abilityId: string, checks: readonly CoreCheck[]): string[] {
  const errors: string[] = [];
  for (const check of checks) {
    if (check.kind === "use-window") {
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
      const problem = eligibilityProblem(record, check.parameters);
      if (problem) errors.push(`Eligible bearers read as ${(check.parameters.keywords as string[]).join(check.parameters.match === "any" ? " or " : " + ")}, but ${problem}.`);
    }
  }
  return errors;
}
