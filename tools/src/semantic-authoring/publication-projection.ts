import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { relative, sep } from "node:path";

import { openProjectionChecker, type ProjectionChecker, type StagedWrite } from "../mfm/apply.js";
import type { GameVersion } from "../mfm/dataslate.js";
import { hashJson } from "../round4/hash.js";
import { sourceDigest } from "../source-digest.js";
import { compilationInputsHash } from "./compiled.js";
import type { ValidationResult } from "../validate.js";
import { abilityFilePath, canonicalDataRoot, checkEntry, entryWithMechanics, semanticAuthoringDataRoot, type Mechanics } from "./entries.js";
import { CorePublicationError, projectCore, type CoreProjection, type CoreRow } from "./publish-core.js";

/**
 * What publishing compiled records would write: each record grafted onto its authored entry in
 * the faction's abilities.json, and its stratagem target onto core stratagems.json. Publication
 * (`publish.ts`) and the compile gates (`pipeline-8b-gates.ts`) both project through here, so a
 * gate judges the bytes publication would validate.
 */

const OPTIONAL_MECHANICS_FIELDS = ["behavior", "optional", "trigger", "usage", "applies_to"] as const;
const DIFF_FIELDS = ["effect", "scope", ...OPTIONAL_MECHANICS_FIELDS, "source_digest", "game_version"] as const;

export class PublicationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PublicationError";
    this.status = status;
  }
}

export type PublicationDiff = {
  entry_id: string;
  ability_id: string;
  fields: Array<{ field: string; before: unknown; after: unknown }>;
};

/** One compiled record as publication writes it. */
export type ProjectedRecord = CoreRow & { mechanics: Mechanics; source_digest: string };

/**
 * The dataslate publication stamps: a published record whose `source_digest` is the digest of
 * the dump prose read now (`digests`, by ability id) is verified against that dump and takes
 * its `gameVersion`. Any other record keeps the `game_version` it had.
 */
export type PublicationStamp = { gameVersion: GameVersion; digests: ReadonlyMap<string, string> };

export type RecordProjection = {
  dataRoot: string;
  file: string;
  relativePath: string;
  beforeText: string;
  afterText: string;
  entries: Array<Record<string, unknown>>;
  diff: PublicationDiff[];
  core: CoreProjection | null;
};

export function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublicationError(409, message);
  return value as Record<string, unknown>;
}

export function relativeAbilityPath(dataRoot: string, file: string): string {
  const path = relative(dataRoot, file).split(sep).join("/");
  if (!path || path.startsWith("../") || path === "..") throw new PublicationError(422, "Publication destination escapes the configured data root.");
  return path;
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): Array<{ field: string; before: unknown; after: unknown }> {
  return DIFF_FIELDS.flatMap((field) => hashJson(before[field] ?? null) === hashJson(after[field] ?? null)
    ? []
    : [{ field, before: before[field] ?? null, after: after[field] ?? null }]);
}

/** Replace each record's authored entry in the faction's abilities.json, and project its core target. */
export function projectRecords(dataRoot: string, factionId: string, records: readonly ProjectedRecord[], stamp?: PublicationStamp): RecordProjection {
  const file = abilityFilePath(dataRoot, factionId);
  const beforeText = readFileSync(file, "utf8");
  const parsed: unknown = JSON.parse(beforeText);
  if (!Array.isArray(parsed)) throw new PublicationError(409, `${factionId}/abilities.json is not an array.`);
  const entries = parsed.map((value, index) => record(value, `Ability entry ${index} is malformed.`));
  const diff: PublicationDiff[] = [];

  for (const row of records) {
    const matches = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.ability_id === row.ability_id);
    if (matches.length !== 1) {
      throw new PublicationError(409, matches.length === 0
        ? `Ability ${factionId}/${row.ability_id} is missing from the destination.`
        : `Ability ${factionId}/${row.ability_id} is ambiguous in the destination.`);
    }
    const { entry: current, index } = matches[0]!;
    // Approving a shape shows the authored entry beside the compiled one, so replacing an
    // authored effect is the reviewed outcome, not an accident to guard against here.
    const proposed: Record<string, unknown> = { ...entryWithMechanics(current, row.mechanics), source_digest: row.source_digest };
    if (stamp && stamp.digests.get(row.ability_id) === row.source_digest) proposed.game_version = { ...stamp.gameVersion };
    const check = checkEntry(proposed);
    if (check.errors.length > 0) {
      throw new PublicationError(409, `Compiled entry ${row.id} fails the ability schema or canonical form: ${check.errors.join("; ")}`);
    }
    entries[index] = proposed;
    diff.push({ entry_id: row.id, ability_id: row.ability_id, fields: changedFields(current, proposed) });
  }

  let core: CoreProjection | null;
  try {
    core = projectCore(dataRoot, factionId, records);
  } catch (error) {
    if (error instanceof CorePublicationError) throw new PublicationError(409, error.message);
    throw error;
  }
  for (const item of core?.diff ?? []) {
    const existing = diff.find((entry) => entry.entry_id === item.entry_id);
    if (existing) existing.fields.push(...item.fields);
    else diff.push(item);
  }
  return { dataRoot, file, relativePath: relativeAbilityPath(dataRoot, file), beforeText, afterText: `${JSON.stringify(entries, null, 2)}\n`, entries, diff, core };
}

/**
 * The files one publication writes: the faction's abilities.json, its core stratagems.json when targets
 * change, and each other faction's replicated copy of a changed stratagem (`replicaTexts` in the order of
 * `core.replicas`; the projection's own bytes when omitted).
 */
export function stagedWrites(
  projection: Pick<RecordProjection, "file" | "entries" | "core">, abilitiesText: string, coreText: string | undefined,
  replicaTexts: readonly string[] | undefined = projection.core?.replicas.map((replica) => replica.afterText),
): StagedWrite[] {
  const writes: StagedWrite[] = [{ path: projection.file, value: projection.entries as unknown, text: abilitiesText }];
  if (projection.core && coreText !== undefined) {
    writes.push({ path: projection.core.file, value: projection.core.records, text: coreText });
    projection.core.replicas.forEach((replica, position) => {
      const text = replicaTexts?.[position];
      if (text !== undefined) writes.push({ path: replica.file, value: replica.records, text });
    });
  }
  return writes;
}

/** One validation failure as `file[index] path: message`. */
function failureLines(result: ValidationResult): string[] {
  return result.errors.flatMap((error) => error.errors.map((item) => `${error.file}[${error.index}] ${item.path}: ${item.message}`));
}

/** A checker over the semantic-authoring data root, for {@link compiledPublicationErrors}. */
export function openPublicationChecker(): ProjectionChecker {
  return openProjectionChecker({ label: "semantic-authoring gate", dataRoot: canonicalDataRoot(semanticAuthoringDataRoot()) });
}

export type CompiledRecord = { ability_id: string; mechanics: Mechanics; core: CoreRow["core"]; source_text: string };
export type FactionRecord = CompiledRecord & { faction_id: string };

/**
 * Why publishing this one compiled record would be refused: the projection's own refusal
 * (destination entry missing or ambiguous, schema or canonical form, core target), else every
 * schema and referential-integrity failure of the projected dataset, the checks
 * `prepare-publication` runs. Empty when publication would accept it, either alone or in one
 * batch with `companions` (records that depend on each other, such as a stance and the rules
 * that name its options, publish together). The errors reported are those of the record alone.
 */
export async function compiledPublicationErrors(
  checker: ProjectionChecker,
  factionId: string,
  compiled: CompiledRecord,
  companions: readonly CompiledRecord[] = [],
): Promise<string[]> {
  const alone = await projectedErrors(checker, factionId, [compiled]);
  if (alone.length === 0) return [];
  // One record per destination entry; a later companion (a fresh compile) replaces an earlier
  // one (its approved entry).
  const others = [...new Map(companions.filter((record) => record.ability_id !== compiled.ability_id).map((record) => [record.ability_id, record])).values()];
  if (others.length === 0) return alone;
  return (await projectedErrors(checker, factionId, [compiled, ...others])).length === 0 ? [] : alone;
}

async function projectedErrors(checker: ProjectionChecker, factionId: string, records: readonly CompiledRecord[]): Promise<string[]> {
  const dataRoot = canonicalDataRoot(semanticAuthoringDataRoot());
  let projection: RecordProjection;
  try {
    projection = projectRecords(dataRoot, factionId, records.map((record) => ({
      id: record.ability_id, ability_id: record.ability_id, mechanics: record.mechanics, core: record.core, source_digest: sourceDigest(record.source_text),
    })));
  } catch (error) {
    if (error instanceof PublicationError) return [error.message];
    throw error;
  }
  const result = await checker.validate(stagedWrites(projection, projection.afterText, projection.core?.afterText));
  return result.failed === 0 ? [] : [...failureLines(result.schema), ...failureLines(result.integrity)];
}

/**
 * The faction's approved entries that are still current and unchanged since approval: what
 * publication of the faction would write alongside a newly approved member.
 */
export function approvedCompanions(db: DatabaseSync, factionId: string): CompiledRecord[] {
  const rows = db.prepare(`
    SELECT compiled_entries.ability_version_id, compiled_entries.inputs_hash, compiled_entries.mechanics_json, compiled_entries.core_json,
      abilities.ability_id, abilities.source_text
    FROM compiled_entries JOIN abilities ON abilities.id = compiled_entries.ability_version_id
    WHERE compiled_entries.status = 'approved' AND abilities.current = 1 AND abilities.faction_id = ?
  `).all(factionId) as Array<{ ability_version_id: number; inputs_hash: string; mechanics_json: string; core_json: string | null; ability_id: string; source_text: string }>;
  return rows.filter((row) => compilationInputsHash(db, row.ability_version_id) === row.inputs_hash).map((row) => ({
    ability_id: row.ability_id, mechanics: JSON.parse(row.mechanics_json), core: row.core_json ? JSON.parse(row.core_json) : null, source_text: row.source_text,
  }));
}
