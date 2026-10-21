import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";

import { openProjectionChecker, type ProjectionChecker, type StagedWrite } from "../mfm/apply.js";
import { hashJson } from "../round4/hash.js";
import { sourceDigest } from "../source-digest.js";
import type { ValidationResult } from "../validate.js";
import { abilityFilePath, canonicalDataRoot, checkEntry, entryWithMechanics, semanticAuthoringDataRoot, type Mechanics } from "./entries.js";
import { CorePublicationError, projectCore, type CoreProjection, type CoreRow } from "./publish-core.js";

/**
 * What publishing compiled records would write: each record grafted onto its authored entry in
 * the faction's abilities.json, and its stratagem target onto core stratagems.json. Publication
 * (`publish.ts`) and the compile gates (`pipeline-8b-gates.ts`) both project through here, so a
 * gate judges the bytes publication would validate.
 */

const OPTIONAL_MECHANICS_FIELDS = ["behavior", "trigger", "usage", "applies_to"] as const;
const DIFF_FIELDS = ["effect", "scope", ...OPTIONAL_MECHANICS_FIELDS, "source_digest"] as const;

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
export function projectRecords(dataRoot: string, factionId: string, records: readonly ProjectedRecord[]): RecordProjection {
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
    const proposed = { ...entryWithMechanics(current, row.mechanics), source_digest: row.source_digest };
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

/** The files one publication writes: the faction's abilities.json, and its core stratagems.json when targets change. */
export function stagedWrites(projection: Pick<RecordProjection, "file" | "entries" | "core">, abilitiesText: string, coreText: string | undefined): StagedWrite[] {
  const writes: StagedWrite[] = [{ path: projection.file, value: projection.entries as unknown, text: abilitiesText }];
  if (projection.core && coreText !== undefined) writes.push({ path: projection.core.file, value: projection.core.records, text: coreText });
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

/**
 * Why publishing this one compiled record alone would be refused: the projection's own refusal
 * (destination entry missing or ambiguous, schema or canonical form, core target), else every
 * schema and referential-integrity failure of the projected dataset, the checks
 * `prepare-publication` runs. Empty when publication would accept it.
 */
export async function compiledPublicationErrors(
  checker: ProjectionChecker,
  factionId: string,
  compiled: { ability_id: string; mechanics: Mechanics; core: CoreRow["core"]; source_text: string },
): Promise<string[]> {
  const dataRoot = canonicalDataRoot(semanticAuthoringDataRoot());
  let projection: RecordProjection;
  try {
    projection = projectRecords(dataRoot, factionId, [{
      id: compiled.ability_id, ability_id: compiled.ability_id, mechanics: compiled.mechanics, core: compiled.core, source_digest: sourceDigest(compiled.source_text),
    }]);
  } catch (error) {
    if (error instanceof PublicationError) return [error.message];
    throw error;
  }
  const result = await checker.validate(stagedWrites(projection, projection.afterText, projection.core?.afterText));
  return result.failed === 0 ? [] : [...failureLines(result.schema), ...failureLines(result.integrity)];
}
