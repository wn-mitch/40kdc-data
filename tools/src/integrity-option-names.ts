/**
 * An ability record's `option_names` names the options of its one choice effect, so the record
 * must hold exactly one `choice` node with one name per option, and no two options share a name.
 */

import { existsSync, readFileSync } from "node:fs";
import { glob } from "glob";
import { basename, dirname } from "node:path";
import type { ValidationResult } from "./validate.js";

/** The option count of every `choice` node in a tree. */
function choiceOptionCounts(node: unknown, out: number[] = []): number[] {
  if (Array.isArray(node)) {
    for (const item of node) choiceOptionCounts(item, out);
  } else if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.type === "choice") out.push(Array.isArray(record.options) ? record.options.length : 0);
    for (const value of Object.values(record)) choiceOptionCounts(value, out);
  }
  return out;
}

/** The problem with one record's `option_names`, or null when it has none or they fit its choice. */
export function optionNamesError(row: Record<string, unknown>): string | null {
  const names = row.option_names;
  if (names === undefined) return null;
  if (!Array.isArray(names)) return "option_names is not a list";
  const counts = choiceOptionCounts(row.effect);
  if (counts.length !== 1) return `option_names needs exactly one choice effect; the record has ${counts.length}`;
  if (names.length !== counts[0]) return `option_names gives ${names.length} names for a choice of ${counts[0]} options`;
  if (new Set(names).size !== names.length) return "option_names repeats a name";
  return null;
}

/** Adds one error per ability record whose `option_names` does not fit its choice. */
export async function checkOptionNames(root: string, result: ValidationResult): Promise<void> {
  const files = (await glob("enrichment/*/abilities.json", { cwd: root, absolute: true })).sort();
  for (const file of files) {
    const dir = basename(dirname(file));
    if (dir.startsWith("_") && dir !== "_core") continue;
    if (!existsSync(file)) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // unreadable file: reported by schema validation
    }
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, index) => {
      if (row === null || typeof row !== "object") return;
      const message = optionNamesError(row as Record<string, unknown>);
      if (message) result.errors.push({ file, index, errors: [{ path: `/${index}/option_names`, message }] });
    });
  }
}
