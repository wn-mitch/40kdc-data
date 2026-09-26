import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { hashJson } from "../round4/hash.js";
import { coreTargetKeywords, keywordIndex } from "./core-keywords.js";

/**
 * The core half of a publication: approved entries whose leaves set core fields (a stratagem's
 * target_restrictions) rewrite the faction's core stratagems.json in the same guarded write as
 * its abilities.json. The keywords are canonicalised to the units' own spellings here.
 */

export type CoreRow = { id: string; ability_id: string; core: { target_restrictions: Record<string, unknown> } | null };

export type CoreProjection = {
  file: string;
  relativePath: string;
  beforeHash: string;
  afterHash: string;
  afterText: string;
  records: Array<Record<string, unknown>>;
  diff: Array<{ entry_id: string; ability_id: string; fields: Array<{ field: string; before: unknown; after: unknown }> }>;
};

/** The core fields a publication writes, as recorded in its manifest. */
export type CoreManifest = { destination: string; relative_path: string; before_hash: string; after_hash: string; after_text: string };

export class CorePublicationError extends Error {}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function coreStratagemFile(dataRoot: string, factionId: string): string {
  return join(dataRoot, "core", factionId, "stratagems.json");
}

/** Leaf-form target_restrictions (uppercase phrases) in the form core stores. */
export function canonicalTarget(target: Record<string, unknown>, index: ReadonlyMap<string, string>): Record<string, unknown> {
  const { required_keywords, required_keywords_any, excluded_keywords, ...rest } = target;
  const phrases = (required_keywords_any ?? required_keywords ?? []) as string[];
  const keywords = coreTargetKeywords(phrases, required_keywords_any ? "any" : "all", (excluded_keywords ?? []) as string[], index);
  // Keyword fields first, as the authored record lists them.
  return { ...keywords, ...rest };
}

export function projectCore(dataRoot: string, factionId: string, rows: readonly CoreRow[]): CoreProjection | null {
  const changing = rows.filter((row) => row.core);
  if (changing.length === 0) return null;
  const file = coreStratagemFile(dataRoot, factionId);
  if (!existsSync(file)) throw new CorePublicationError(`${factionId} has no core stratagems.json for the stratagem targets being published.`);
  const beforeText = readFileSync(file, "utf8");
  const records = JSON.parse(beforeText) as Array<Record<string, unknown>>;
  if (!Array.isArray(records)) throw new CorePublicationError(`${factionId}/stratagems.json is not an array.`);
  const index = keywordIndex(dataRoot);
  const diff: CoreProjection["diff"] = [];
  for (const row of changing) {
    const matches = records.map((record, position) => ({ record, position })).filter(({ record }) => (record.ability_id ?? record.id) === row.ability_id);
    if (matches.length !== 1) {
      throw new CorePublicationError(matches.length === 0
        ? `Stratagem ${factionId}/${row.ability_id} is missing from core stratagems.json.`
        : `Stratagem ${factionId}/${row.ability_id} is ambiguous in core stratagems.json.`);
    }
    const { record, position } = matches[0]!;
    let target: Record<string, unknown>;
    try {
      target = canonicalTarget(row.core!.target_restrictions, index);
    } catch (error) {
      throw new CorePublicationError(`${row.ability_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const before = record.target_restrictions ?? null;
    records[position] = { ...record, target_restrictions: target };
    if (hashJson(before) !== hashJson(target)) diff.push({ entry_id: row.id, ability_id: row.ability_id, fields: [{ field: "core.target_restrictions", before, after: target }] });
  }
  const afterText = `${JSON.stringify(records, null, 2)}\n`;
  const relativePath = relative(dataRoot, file).split(sep).join("/");
  return { file, relativePath, beforeHash: sha256(beforeText), afterHash: sha256(afterText), afterText, records, diff };
}

/** The manifest block for a core projection. */
export function coreManifest(projection: CoreProjection | null): CoreManifest | undefined {
  return projection ? { destination: projection.file, relative_path: projection.relativePath, before_hash: projection.beforeHash, after_hash: projection.afterHash, after_text: projection.afterText } : undefined;
}

/** What the core file holds now, for reconciling an interrupted publication. */
export function observedCoreHash(manifest: CoreManifest | undefined): string | null {
  if (!manifest) return null;
  try {
    return sha256(readFileSync(manifest.destination));
  } catch (error) {
    return hashJson({ destination_unavailable: error instanceof Error ? error.message : String(error) });
  }
}
