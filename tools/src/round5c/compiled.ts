import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
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

/**
 * Identity of everything a compilation read: the source version and its active leaves (exact
 * bytes and fingerprint). Any leaf change or source change yields a different hash.
 */
export function compilationInputsHash(db: DatabaseSync, abilityVersionId: number): string {
  const ability = db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(abilityVersionId) as { source_hash: string } | undefined;
  if (!ability) throw new RangeError(`Unknown ability version ${abilityVersionId}.`);
  const leaves = db.prepare(`
    SELECT source_spans.fragment, source_spans.start_byte, source_spans.end_byte, annotations.fingerprint_id
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.status = 'active' AND source_spans.ability_version_id = ?
    ORDER BY source_spans.start_byte, source_spans.end_byte, source_spans.fragment, annotations.fingerprint_id
  `).all(abilityVersionId);
  return hashJson({ source_hash: ability.source_hash, leaves });
}

export type CompiledEntryRow = {
  id: string;
  ability_version_id: number;
  shape_signature: string;
  mechanics: Mechanics;
  inputs_hash: string;
  status: string;
};

export function getCompiledEntry(db: DatabaseSync, id: string): CompiledEntryRow | null {
  const row = db.prepare(`
    SELECT id, ability_version_id, shape_signature, mechanics_json, inputs_hash, status
    FROM compiled_entries WHERE id = ?
  `).get(id) as (Omit<CompiledEntryRow, "mechanics"> & { mechanics_json: string }) | undefined;
  if (!row) return null;
  const { mechanics_json, ...rest } = row;
  return { ...rest, mechanics: JSON.parse(mechanics_json) as Mechanics };
}
