/**
 * A leader attachment's `eligible_bodyguard_keywords` clause must be met by at least one unit, run
 * as part of `checkReferentialIntegrity` (integrity.ts). A unit qualifies only by carrying every
 * keyword in the clause, so alternatives ("an Eradicator Squad or a Sternguard Veteran Squad")
 * written into one clause match no unit and silently drop every bodyguard they name.
 */

import { readFileSync } from "node:fs";
import { glob } from "glob";
import type { ValidationResult } from "./validate.js";

type Unit = { keywords?: unknown; faction_keywords?: unknown };
type Attachment = { leader_id?: unknown; eligible_bodyguard_keywords?: unknown };

function readArray<T>(file: string): T[] {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return []; // unreadable: reported by schema validation
  }
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** Every unit's keywords and faction keywords, lower-cased, across all factions. */
export async function unitKeywordSets(root: string): Promise<Set<string>[]> {
  const sets: Set<string>[] = [];
  for (const file of await glob("core/*/units.json", { cwd: root, absolute: true })) {
    for (const unit of readArray<Unit>(file)) {
      sets.push(new Set([...strings(unit.keywords), ...strings(unit.faction_keywords)].map((keyword) => keyword.toLowerCase())));
    }
  }
  return sets;
}

/** Whether some unit carries every keyword of `clause`. */
export function clauseSatisfiable(clause: readonly string[], units: readonly Set<string>[]): boolean {
  return units.some((own) => clause.every((keyword) => own.has(keyword.toLowerCase())));
}

export async function checkLeaderKeywordClauses(root: string, result: ValidationResult): Promise<void> {
  const units = await unitKeywordSets(root);
  const files = await glob("core/*/leader-attachments.json", { cwd: root, absolute: true });
  for (const file of files.sort()) {
    const records = readArray<Attachment>(file);
    let fileCounted = false;
    records.forEach((record, index) => {
      const clause = strings(record.eligible_bodyguard_keywords);
      // Only records with a keyword clause are counted.
      if (clause.length === 0) return;
      if (!fileCounted) {
        result.totalFiles++;
        fileCounted = true;
      }
      result.totalItems++;
      if (clauseSatisfiable(clause, units)) {
        result.passed++;
        return;
      }
      result.failed++;
      result.errors.push({
        file,
        index,
        errors: [{
          path: `/${index}/eligible_bodyguard_keywords`,
          message: `leader "${String(record.leader_id)}": no unit carries all of ${clause.join(", ")}; alternatives belong in eligible_bodyguard_ids`,
        }],
      });
    });
  }
}
