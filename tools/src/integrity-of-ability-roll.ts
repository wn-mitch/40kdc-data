/**
 * A roll a named ability makes is written `roll: { of_ability: <id> }` in an effect or condition. The id
 * must be an ability record id, in any enrichment dir, or a core ability. Run as part of
 * `checkReferentialIntegrity` (integrity.ts), with the set of ids that function already collected.
 */

import { readFileSync } from "node:fs";
import { glob } from "glob";
import { basename, dirname, resolve } from "node:path";
import type { ValidationResult } from "./validate.js";

/** Every `of_ability` id a `roll` object names, at any depth of a record. */
export function ofAbilityRollIds(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) ofAbilityRollIds(item, found);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const roll = record.roll;
    if (roll !== null && typeof roll === "object" && typeof (roll as { of_ability?: unknown }).of_ability === "string") {
      found.push((roll as { of_ability: string }).of_ability);
    }
    for (const child of Object.values(record)) ofAbilityRollIds(child, found);
  }
  return found;
}

/** The `of_ability` ids in `records` that no known ability id resolves, with the index of their record. */
export function unresolvedOfAbilityRolls(records: readonly unknown[], knownIds: ReadonlySet<string>): Array<{ index: number; id: string }> {
  const missing: Array<{ index: number; id: string }> = [];
  records.forEach((record, index) => {
    for (const id of ofAbilityRollIds(record)) if (!knownIds.has(id)) missing.push({ index, id });
  });
  return missing;
}

export async function checkOfAbilityRollRefs(root: string, result: ValidationResult, knownIds: ReadonlySet<string>): Promise<void> {
  const files = await glob("enrichment/*/abilities.json", { cwd: root, absolute: true });
  for (const file of files.sort()) {
    const dir = basename(dirname(file));
    if (dir.startsWith("_") && dir !== "_core") continue;
    const records = JSON.parse(readFileSync(resolve(file), "utf8")) as unknown[];
    const used = records.filter((record) => ofAbilityRollIds(record).length > 0);
    if (used.length === 0) continue;
    result.totalFiles++;
    const byRecord = new Map<number, string[]>();
    for (const item of unresolvedOfAbilityRolls(records, knownIds)) byRecord.set(item.index, [...(byRecord.get(item.index) ?? []), item.id]);
    result.totalItems += used.length;
    result.failed += byRecord.size;
    result.passed += used.length - byRecord.size;
    for (const [index, ids] of byRecord) {
      result.errors.push({
        file,
        index,
        errors: ids.map((id) => ({ path: `/${index}/effect`, message: `roll of_ability "${id}" names no ability record or core ability` })),
      });
    }
  }
}
