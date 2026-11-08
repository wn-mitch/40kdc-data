/**
 * Referential check for named ranges: every `{aura_of: <ability-id>}` in an ability record's DSL
 * (common.schema.json range-ref) names an ability id that an ability record defines. A named range
 * is the current aura range of that ability, so a dangling id has no distance to measure.
 */

import { existsSync, readFileSync } from "node:fs";
import { glob } from "glob";
import { basename, dirname } from "node:path";
import type { ValidationResult } from "./validate.js";

type Node = Record<string, unknown>;

function readRows(file: string): unknown[] {
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

/** Every `aura_of` string in a tree, with its JSON path under the record. */
function collectAuraRefs(node: unknown, path: string, out: Array<{ path: string; id: string }>): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectAuraRefs(v, `${path}/${i}`, out));
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Node)) {
    if (k === "aura_of" && typeof v === "string") out.push({ path: `${path}/aura_of`, id: v });
    else collectAuraRefs(v, `${path}/${k}`, out);
  }
}

/** Adds one error per ability record whose `aura_of` names no ability record. */
export async function checkAuraRangeRefs(root: string, result: ValidationResult): Promise<void> {
  const files = (await glob("enrichment/*/abilities.json", { cwd: root, absolute: true })).sort();
  const abilityFiles: Array<{ file: string; rows: unknown[] }> = [];
  const defined = new Set<string>();
  for (const file of files) {
    const dir = basename(dirname(file));
    if (dir.startsWith("_") && dir !== "_core") continue;
    let rows: unknown[];
    try {
      rows = readRows(file);
    } catch {
      continue; // unreadable file: reported by schema validation
    }
    abilityFiles.push({ file, rows });
    for (const row of rows) {
      const id = (row as Node | null)?.ability_id;
      if (typeof id === "string") defined.add(id);
    }
  }
  for (const { file, rows } of abilityFiles) {
    rows.forEach((row, index) => {
      const refs: Array<{ path: string; id: string }> = [];
      collectAuraRefs(row, `/${index}`, refs);
      const issues = refs
        .filter(({ id }) => !defined.has(id))
        .map(({ path, id }) => ({ path, message: `aura_of "${id}" names no ability record` }));
      if (issues.length === 0) return;
      result.failed++;
      result.errors.push({ file, index, errors: issues });
    });
  }
}
