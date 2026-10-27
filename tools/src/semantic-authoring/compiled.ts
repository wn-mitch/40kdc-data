import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import { reviewedConnectives } from "./connective-rows.js";
import { NAME_FRAGMENT } from "./contracts.js";
import type { Mechanics } from "./entries.js";

/**
 * Compiled entries: the DSL mechanics a composition shape produced for one source version,
 * pinned to the exact reviewed leaves it was compiled from. Only `approved` rows publish.
 */

export const COMPILED_SCHEMA = `
CREATE TABLE IF NOT EXISTS compiled_entries (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  ability_version_id INTEGER NOT NULL,
  shape_signature TEXT NOT NULL CHECK(length(trim(shape_signature)) > 0),
  mechanics_json TEXT NOT NULL CHECK(json_valid(mechanics_json)),
  core_json TEXT CHECK(core_json IS NULL OR json_valid(core_json)),
  inputs_hash TEXT NOT NULL CHECK(length(inputs_hash) = 64),
  status TEXT NOT NULL CHECK(status IN ('approved', 'rejected', 'retracted')),
  batch_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS compiled_entries_one_approved
  ON compiled_entries(ability_version_id) WHERE status = 'approved';
`;

export const COMPILED_TABLES = ["compiled_entries"] as const;

/** Older workbenches predate core patches (a stratagem's target); add the column in place. */
export function upgradeCompiledCore(db: DatabaseSync): void {
  const columns = new Set((db.prepare("PRAGMA table_info(compiled_entries)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has("core_json")) db.exec("ALTER TABLE compiled_entries ADD COLUMN core_json TEXT CHECK(core_json IS NULL OR json_valid(core_json))");
}

/** What an approval pins: the entry's mechanics, plus the core patch when the leaves make one. */
export function compiledIdentity(mechanics: Mechanics, core: unknown): unknown {
  return core ? { mechanics, core } : mechanics;
}

/**
 * Identity of everything a compilation read: the source version, its active leaves (exact
 * bytes, fingerprint and authority) and the reviewed connectives it consumes. Any leaf, authority,
 * connective or source change yields a different hash, so an approval never survives a row's
 * authority changing under it.
 */
export function compilationInputsHash(db: DatabaseSync, abilityVersionId: number): string {
  const ability = db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(abilityVersionId) as { source_hash: string } | undefined;
  if (!ability) throw new RangeError(`Unknown ability version ${abilityVersionId}.`);
  const leaves = db.prepare(`
    SELECT source_spans.fragment, source_spans.start_byte, source_spans.end_byte, annotations.fingerprint_id, annotations.authority_kind
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.status = 'active' AND source_spans.ability_version_id = ?
    ORDER BY source_spans.fragment = '${NAME_FRAGMENT}', source_spans.start_byte, source_spans.end_byte, source_spans.fragment, annotations.fingerprint_id, annotations.authority_kind
  `).all(abilityVersionId);
  return inputsHash(db, abilityVersionId, ability.source_hash, leaves);
}

type InputLeaf = { fragment: string; start_byte: number; end_byte: number; fingerprint_id: string; authority_kind: string };

/**
 * The inputs hash a source version had at `asOf`, undoing only family-version migrations: each
 * active leaf a migration re-issued after `asOf` reads as the fingerprint it superseded (followed
 * back through successive migrations), every other leaf as it stands. An approval recorded at
 * `asOf` under this hash judged the same leaves in their earlier family versions.
 */
export function preMigrationInputsHash(db: DatabaseSync, abilityVersionId: number, asOf: string): string {
  const ability = db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(abilityVersionId) as { source_hash: string } | undefined;
  if (!ability) throw new RangeError(`Unknown ability version ${abilityVersionId}.`);
  const rows = db.prepare(`
    SELECT annotations.id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte, annotations.fingerprint_id, annotations.authority_kind
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.status = 'active' AND source_spans.ability_version_id = ?
  `).all(abilityVersionId) as Array<InputLeaf & { id: number }>;
  const migrated = db.prepare(`
    SELECT previous.id, previous.fingerprint_id FROM annotations AS current
    JOIN annotation_batches ON annotation_batches.id = current.batch_id
    JOIN annotations AS previous ON previous.id = current.supersedes_id
    WHERE current.id = ? AND annotation_batches.operation = 'migration-family-versions' AND current.created_at > ?
  `);
  const leaves = rows.map(({ id, fragment, start_byte, end_byte, fingerprint_id, authority_kind }) => {
    let at = id;
    let fingerprint = fingerprint_id;
    for (let previous = migrated.get(at, asOf) as { id: number; fingerprint_id: string } | undefined; previous; previous = migrated.get(at, asOf) as typeof previous) {
      at = previous.id;
      fingerprint = previous.fingerprint_id;
    }
    return { fragment, start_byte, end_byte, fingerprint_id: fingerprint, authority_kind };
  });
  // The same order compilationInputsHash's query gives.
  const key = (leaf: InputLeaf): Array<number | string> => [leaf.fragment === NAME_FRAGMENT ? 1 : 0, leaf.start_byte, leaf.end_byte, leaf.fragment, leaf.fingerprint_id, leaf.authority_kind];
  leaves.sort((left, right) => {
    const a = key(left), b = key(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
    return 0;
  });
  return inputsHash(db, abilityVersionId, ability.source_hash, leaves);
}

function inputsHash(db: DatabaseSync, abilityVersionId: number, sourceHash: string, leaves: unknown[]): string {
  // The reviewed connectives compilation reads (connective-rows.ts) join the identity only when there
  // are any, so a source without one keeps the hash its approvals were recorded under.
  const connectives = reviewedConnectives(db, [abilityVersionId])
    .map(({ fragment, start_byte, end_byte, relation }) => ({ fragment, start_byte, end_byte, relation }));
  return hashJson({ source_hash: sourceHash, leaves, ...(connectives.length > 0 ? { connectives } : {}) });
}

export type CompiledEntryRow = {
  id: string;
  ability_version_id: number;
  shape_signature: string;
  mechanics: Mechanics;
  /** Fields for the core record (a stratagem's target_restrictions), or null. */
  core: { target_restrictions: Record<string, unknown> | Array<Record<string, unknown>> } | null;
  inputs_hash: string;
  status: string;
};

export function getCompiledEntry(db: DatabaseSync, id: string): CompiledEntryRow | null {
  const row = db.prepare(`
    SELECT id, ability_version_id, shape_signature, mechanics_json, core_json, inputs_hash, status
    FROM compiled_entries WHERE id = ?
  `).get(id) as (Omit<CompiledEntryRow, "mechanics" | "core"> & { mechanics_json: string; core_json: string | null }) | undefined;
  if (!row) return null;
  const { mechanics_json, core_json, ...rest } = row;
  return { ...rest, mechanics: JSON.parse(mechanics_json) as Mechanics, core: core_json ? JSON.parse(core_json) as CompiledEntryRow["core"] : null };
}
