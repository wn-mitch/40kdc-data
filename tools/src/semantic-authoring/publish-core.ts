import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { hashJson } from "../round4/hash.js";
import { coreTargetKeywords, keywordIndex, liftWarlord } from "./core-keywords.js";

/**
 * The core half of a publication: approved entries whose leaves set core fields (a stratagem's
 * target_restrictions) rewrite the faction's core stratagems.json in the same guarded write as
 * its abilities.json. The keywords are canonicalised to the units' own spellings here.
 */

export type CoreRow = { id: string; ability_id: string; core: { target_restrictions: Record<string, unknown> | Array<Record<string, unknown>> } | null };

/** One core stratagems.json a publication rewrites. */
export type CoreFile = {
  file: string;
  relativePath: string;
  beforeHash: string;
  afterHash: string;
  afterText: string;
  records: Array<Record<string, unknown>>;
};

export type CoreProjection = CoreFile & {
  diff: Array<{ entry_id: string; ability_id: string; fields: Array<{ field: string; before: unknown; after: unknown }> }>;
  /**
   * Other factions' core stratagems.json holding a changed record. Core stratagems are replicated
   * byte-identical across factions (integrity.ts COLLISION_POLICIES), so each copy takes the
   * publishing faction's updated record; a write to one copy alone would fail validation.
   */
  replicas: CoreFile[];
};

/** The core fields a publication writes, as recorded in its manifest. */
export type CoreManifest = { destination: string; relative_path: string; before_hash: string; after_hash: string; after_text: string };

export class CorePublicationError extends Error {}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** A faction's core stratagems.json; shared core's (`_core`) sits at the top of data/core. */
export function coreStratagemFile(dataRoot: string, factionId: string): string {
  return factionId === "_core" ? join(dataRoot, "core", "stratagems.json") : join(dataRoot, "core", factionId, "stratagems.json");
}

/**
 * Leaf-form target_restrictions (uppercase phrases) in the form core stores; several named targets
 * each so. The Warlord arrives as the compiled `warlord` field and passes through. An entry compiled
 * with WARLORD among its keywords predates that field: it is refused, not rewritten, so the
 * published target is always the one a reviewer approved; recompile and re-approve it.
 */
export function canonicalTarget(target: Record<string, unknown> | Array<Record<string, unknown>>, index: ReadonlyMap<string, string>): Record<string, unknown> | Array<Record<string, unknown>> {
  if (Array.isArray(target)) return target.map((item) => canonicalTarget(item, index) as Record<string, unknown>);
  const { required_keywords, required_keywords_any, excluded_keywords, ...rest } = target;
  for (const list of [required_keywords, required_keywords_any, excluded_keywords]) {
    if (Array.isArray(list) && liftWarlord(list as string[]).warlord) {
      throw new Error("WARLORD in the target's keywords is the Warlord, not a keyword; recompile this entry so its target carries warlord, and re-approve it.");
    }
  }
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
    let target: Record<string, unknown> | Array<Record<string, unknown>>;
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
  const changed = new Map(changing.map((row) => {
    const record = records.find((candidate) => (candidate.ability_id ?? candidate.id) === row.ability_id)!;
    return [record.id, record] as const;
  }));
  const replicas = factionId === "_core" ? [] : replicaFiles(dataRoot, factionId, changed);
  return { file, relativePath, beforeHash: sha256(beforeText), afterHash: sha256(afterText), afterText, records, diff, replicas };
}

/** Every other faction's core stratagems.json that holds a changed record, rewritten with the publishing faction's copy. */
function replicaFiles(dataRoot: string, factionId: string, changed: ReadonlyMap<unknown, Record<string, unknown>>): CoreFile[] {
  const coreRoot = join(dataRoot, "core");
  const out: CoreFile[] = [];
  for (const entry of readdirSync(coreRoot, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
    if (entry === factionId) continue;
    const file = coreStratagemFile(dataRoot, entry);
    if (!existsSync(file)) continue;
    const beforeText = readFileSync(file, "utf8");
    const records = JSON.parse(beforeText) as Array<Record<string, unknown>>;
    if (!Array.isArray(records) || !records.some((record) => changed.has(record.id))) continue;
    const updated = records.map((record) => changed.get(record.id) ?? record);
    const afterText = `${JSON.stringify(updated, null, 2)}\n`;
    if (afterText === beforeText) continue;
    out.push({ file, relativePath: relative(dataRoot, file).split(sep).join("/"), beforeHash: sha256(beforeText), afterHash: sha256(afterText), afterText, records: updated });
  }
  return out;
}

/** The manifest block for a core projection. */
export function coreManifest(projection: CoreFile | null): CoreManifest | undefined {
  return projection ? { destination: projection.file, relative_path: projection.relativePath, before_hash: projection.beforeHash, after_hash: projection.afterHash, after_text: projection.afterText } : undefined;
}

/** The manifest blocks for the replicated copies a core projection also rewrites. */
export function coreReplicaManifests(projection: CoreProjection | null): CoreManifest[] {
  return (projection?.replicas ?? []).map((replica) => coreManifest(replica)!);
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
