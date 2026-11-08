/**
 * Two name checks on ability records, run as part of `checkReferentialIntegrity` (integrity.ts):
 *  - a `targeting` effect's `modifier.ability` must name an ability record (any enrichment dir, or
 *    the shared core pool), and its `modifier.stratagem` a stratagem (a faction's stratagems.json
 *    or the Core Stratagems in core/stratagems.json);
 *  - every keyword in a record's curated `applies_to`, and in a core Stratagem's
 *    `target_restrictions`, must be one units can carry, by the same keyword index the
 *    semantic-authoring path splits TARGET wording against.
 */

import { existsSync, readFileSync } from "node:fs";
import { glob } from "glob";
import { basename, dirname, resolve } from "node:path";
import type { ValidationResult } from "./validate.js";
import { keywordIndex, keywordKey } from "./semantic-authoring/core-keywords.js";

const PREDICATE_KEYS = ["all_of", "any_of", "none_of", "not_all_of"] as const;
const TARGET_KEYWORD_KEYS = ["required_keywords", "required_keywords_any", "excluded_keywords"] as const;

export type TargetingRef = { kind: "ability" | "stratagem"; id: string };

/** Every ability or stratagem id a `targeting` effect names, at any depth of a record. */
export function targetingRefs(value: unknown, found: TargetingRef[] = []): TargetingRef[] {
  if (Array.isArray(value)) {
    for (const item of value) targetingRefs(item, found);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "targeting" && record.modifier !== null && typeof record.modifier === "object") {
      const modifier = record.modifier as Record<string, unknown>;
      if (typeof modifier.ability === "string") found.push({ kind: "ability", id: modifier.ability });
      if (typeof modifier.stratagem === "string") found.push({ kind: "stratagem", id: modifier.stratagem });
    }
    for (const child of Object.values(record)) targetingRefs(child, found);
  }
  return found;
}

/** Every keyword a record's `applies_to` predicate names, with the predicate key it sits under. */
export function appliesToKeywords(record: unknown): Array<{ key: string; keyword: string }> {
  const appliesTo = (record as { applies_to?: unknown } | null)?.applies_to;
  if (appliesTo === null || typeof appliesTo !== "object") return [];
  return PREDICATE_KEYS.flatMap((key) => {
    const listed = (appliesTo as Record<string, unknown>)[key];
    return Array.isArray(listed) ? listed.filter((k): k is string => typeof k === "string").map((keyword) => ({ key, keyword })) : [];
  });
}

/** Every keyword a Stratagem's target restrictions name, one target or several, with its path. */
export function stratagemTargetKeywords(stratagem: unknown): Array<{ path: string; keyword: string }> {
  const restrictions = (stratagem as { target_restrictions?: unknown } | null)?.target_restrictions;
  const targets = Array.isArray(restrictions) ? restrictions : restrictions ? [restrictions] : [];
  return targets.flatMap((target, i) => TARGET_KEYWORD_KEYS.flatMap((key) => {
    const listed = (target as Record<string, unknown> | null)?.[key];
    const at = Array.isArray(restrictions) ? `target_restrictions/${i}/${key}` : `target_restrictions/${key}`;
    return Array.isArray(listed) ? listed.filter((k): k is string => typeof k === "string").map((keyword) => ({ path: at, keyword })) : [];
  }));
}

/** Faction stratagems.json files plus the Core Stratagems, skipping `_`-prefixed dirs. */
async function stratagemFiles(root: string): Promise<string[]> {
  const files = await glob("core/{stratagems.json,*/stratagems.json}", { cwd: root, absolute: true });
  return files.filter((file) => !basename(dirname(file)).startsWith("_")).sort();
}

/**
 * The keyword index, or null when a units, detachments or abilities file it reads is unreadable:
 * schema validation reports that file, and keywords cannot be judged against a partial index.
 */
function readableKeywordIndex(root: string): ReadonlyMap<string, string> | null {
  if (!existsSync(resolve(root, "core"))) return new Map();
  try {
    return keywordIndex(root);
  } catch {
    return null;
  }
}

/** Stratagem ids: every faction's stratagems.json plus the Core Stratagems. */
async function stratagemIds(root: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const file of await stratagemFiles(root)) {
    try {
      for (const s of JSON.parse(readFileSync(file, "utf8")) as Array<{ id?: unknown }>) if (typeof s.id === "string") ids.add(s.id);
    } catch {
      // unreadable: reported by schema validation
    }
  }
  return ids;
}

export async function checkTargetingAndAppliesToRefs(root: string, result: ValidationResult, abilityIds: ReadonlySet<string>): Promise<void> {
  const stratagems = await stratagemIds(root);
  const keywords = readableKeywordIndex(root);
  const files = await glob("enrichment/*/abilities.json", { cwd: root, absolute: true });
  for (const file of files.sort()) {
    const dir = basename(dirname(file));
    if (dir.startsWith("_") && dir !== "_core") continue;
    let records: Array<{ ability_id?: unknown; effect?: unknown }>;
    try {
      records = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // unreadable: reported by schema validation
    }
    if (!Array.isArray(records)) continue;
    let fileCounted = false;
    records.forEach((record, index) => {
      const refs = targetingRefs(record.effect);
      const named = keywords ? appliesToKeywords(record) : [];
      // Only records that name something here are counted, so unrelated records leave the totals unchanged.
      if (refs.length === 0 && named.length === 0) return;
      if (!fileCounted) {
        result.totalFiles++;
        fileCounted = true;
      }
      result.totalItems++;
      const errors: Array<{ path: string; message: string }> = [];
      for (const { kind, id } of refs) {
        if (kind === "ability" ? abilityIds.has(id) : stratagems.has(id)) continue;
        errors.push({
          path: `/${index}/effect`,
          message: kind === "ability"
            ? `ability "${String(record.ability_id)}": targeting ability "${id}" names no ability record or core ability`
            : `ability "${String(record.ability_id)}": targeting stratagem "${id}" names no faction or Core Stratagem`,
        });
      }
      for (const { key, keyword } of named) {
        if (keywords?.has(keywordKey(keyword))) continue;
        errors.push({
          path: `/${index}/applies_to/${key}`,
          message: `ability "${String(record.ability_id)}": applies_to keyword "${keyword}" is carried by no unit and granted by no detachment or ability`,
        });
      }
      if (errors.length === 0) {
        result.passed++;
        return;
      }
      result.failed++;
      result.errors.push({ file, index, errors });
    });
  }
}

/** A Stratagem's target keywords must be ones units can carry (or gain from a rule). */
export async function checkStratagemTargetKeywords(root: string, result: ValidationResult): Promise<void> {
  const keywords = readableKeywordIndex(root);
  if (!keywords) return;
  for (const file of await stratagemFiles(root)) {
    let stratagems: Array<{ id?: unknown }>;
    try {
      stratagems = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // unreadable: reported by schema validation
    }
    if (!Array.isArray(stratagems)) continue;
    let fileCounted = false;
    stratagems.forEach((stratagem, index) => {
      const named = stratagemTargetKeywords(stratagem);
      // Only Stratagems whose target names a keyword are counted.
      if (named.length === 0) return;
      if (!fileCounted) {
        result.totalFiles++;
        fileCounted = true;
      }
      result.totalItems++;
      const errors = named.filter(({ keyword }) => !keywords.has(keywordKey(keyword))).map(({ path, keyword }) => ({
        path: `/${index}/${path}`,
        message: `stratagem "${String(stratagem.id)}": target keyword "${keyword}" is carried by no unit and granted by no detachment or ability`,
      }));
      if (errors.length === 0) {
        result.passed++;
        return;
      }
      result.failed++;
      result.errors.push({ file, index, errors });
    });
  }
}
