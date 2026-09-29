import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { exactSpan, seedReviewedFamilies } from "./contracts.js";
import { upgradeFamilyVersions } from "./family-versions.js";
import { backfillFamilyCandidates } from "./ontology-store.js";
import { COMPILED_SCHEMA, COMPILED_TABLES, upgradeCompiledCore } from "./compiled.js";
import { LEAF_PROPOSAL_KINDS_MARKER, LEAF_PROPOSALS_SCHEMA, LEAVES_SCHEMA, LEAVES_TABLES } from "./leaves-schema.js";
import { normalizedSurface } from "./matching.js";
import { EXTENSION_SCHEMA, EXTENSION_TABLES } from "./schema-ext.js";
export { exactSpan } from "./contracts.js";
type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new (path: string): DatabaseType };

const initialized = new WeakSet<DatabaseSync>();
const transactionDepth = new WeakMap<DatabaseSync, number>();
const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultDatabasePath = resolve(repositoryRoot, "_private", "round5c", "workbench.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS abilities (
  id INTEGER PRIMARY KEY,
  faction_id TEXT NOT NULL CHECK(length(trim(faction_id)) > 0),
  ability_id TEXT NOT NULL CHECK(length(trim(ability_id)) > 0),
  source_hash TEXT NOT NULL CHECK(length(source_hash) = 64),
  source_text TEXT NOT NULL CHECK(length(source_text) > 0),
  source_type TEXT,
  source_kind TEXT,
  name TEXT,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  fragments_json TEXT NOT NULL CHECK(json_valid(fragments_json)),
  current INTEGER NOT NULL DEFAULT 0 CHECK(current IN (0, 1)),
  UNIQUE(faction_id, ability_id, source_hash)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS abilities_current_identity
  ON abilities(faction_id, ability_id) WHERE current = 1;
CREATE INDEX IF NOT EXISTS abilities_current_lookup
  ON abilities(current, faction_id, ability_id);

CREATE TABLE IF NOT EXISTS semantic_families (
  id TEXT NOT NULL CHECK(length(trim(id)) > 0),
  version INTEGER NOT NULL CHECK(version > 0),
  role TEXT NOT NULL CHECK(role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION', 'COMBINATOR', 'RESTRICTION')),
  parameter_schema_json TEXT NOT NULL CHECK(json_valid(parameter_schema_json)),
  status TEXT NOT NULL CHECK(status IN ('active', 'deprecated')),
  PRIMARY KEY(id, version)
) STRICT;

CREATE TABLE IF NOT EXISTS fingerprints (
  id TEXT PRIMARY KEY CHECK(id = 'fp_' || canonical_hash),
  family_id TEXT NOT NULL,
  family_version INTEGER NOT NULL,
  parameters_json TEXT NOT NULL CHECK(json_valid(parameters_json)),
  canonical_hash TEXT NOT NULL UNIQUE CHECK(length(canonical_hash) = 64),
  legacy_fingerprint_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('active', 'deprecated', 'superseded')),
  FOREIGN KEY(family_id, family_version) REFERENCES semantic_families(id, version)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS fingerprints_family_lookup
  ON fingerprints(family_id, family_version, status);

CREATE TABLE IF NOT EXISTS source_spans (
  id INTEGER PRIMARY KEY,
  ability_version_id INTEGER NOT NULL,
  fragment TEXT NOT NULL CHECK(length(trim(fragment)) > 0),
  start_byte INTEGER NOT NULL CHECK(start_byte >= 0),
  end_byte INTEGER NOT NULL CHECK(end_byte > start_byte),
  exact_text TEXT NOT NULL CHECK(length(exact_text) > 0),
  -- normalizedSurface(exact_text) (matching.ts), computed once at insert since it isn't a SQL
  -- expression, so surfaceOccurrences (leaves.ts) can look up "every proposal with this surface"
  -- by an indexed equality instead of scanning every current pending/unresolved proposal and
  -- normalizing each one in JS -- the corpus-wide cost that stalled the deterministic confirm pass.
  -- Nullable only so an existing database can add the column without a full rebuild; insertSpan
  -- always populates it, and a migration backfills every row that predates the column.
  normalized_surface TEXT,
  UNIQUE(ability_version_id, start_byte, end_byte, fragment),
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS source_spans_ability_lookup
  ON source_spans(ability_version_id, start_byte, end_byte);
CREATE INDEX IF NOT EXISTS source_spans_normalized_surface_lookup
  ON source_spans(normalized_surface);

CREATE TABLE IF NOT EXISTS model_runs (
  id INTEGER PRIMARY KEY,
  model TEXT NOT NULL CHECK(length(trim(model)) > 0),
  model_version TEXT NOT NULL CHECK(length(trim(model_version)) > 0),
  prompt_version TEXT NOT NULL CHECK(length(trim(prompt_version)) > 0),
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 64),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  output_json TEXT CHECK(output_json IS NULL OR json_valid(output_json)),
  latency_ms INTEGER CHECK(latency_ms IS NULL OR latency_ms >= 0),
  cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd >= 0),
  status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS annotation_batches (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  operation TEXT NOT NULL CHECK(length(trim(operation)) > 0),
  reviewer TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  reversed_batch_id TEXT,
  FOREIGN KEY(reversed_batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  span_id INTEGER NOT NULL,
  fingerprint_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION', 'COMBINATOR', 'RESTRICTION', 'RESOURCE', 'CONNECTIVE', 'UNRESOLVED')),
  origin TEXT NOT NULL CHECK(length(trim(origin)) > 0),
  model_run_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected', 'corrected', 'superseded', 'unresolved')),
  reason_json TEXT NOT NULL CHECK(json_valid(reason_json)),
  score REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(fingerprint_id) REFERENCES fingerprints(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(model_run_id) REFERENCES model_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS proposals_status_origin_lookup
  ON proposals(status, origin, span_id);

CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY,
  span_id INTEGER NOT NULL,
  fingerprint_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'retracted', 'superseded')),
  origin TEXT NOT NULL CHECK(length(trim(origin)) > 0),
  authority_kind TEXT NOT NULL DEFAULT 'human' CHECK(authority_kind IN ('human', 'stamp')),
  confirmed_by TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  supersedes_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(fingerprint_id) REFERENCES fingerprints(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(supersedes_id) REFERENCES annotations(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS annotations_active_span_fingerprint_lookup
  ON annotations(span_id, fingerprint_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS candidate_judgments (
  id INTEGER PRIMARY KEY,
  candidate_id TEXT NOT NULL CHECK(length(trim(candidate_id)) > 0),
  queried_fingerprint_id TEXT NOT NULL CHECK(length(trim(queried_fingerprint_id)) > 0),
  verdict TEXT NOT NULL CHECK(verdict IN ('exact-match', 'related-variant', 'different-family', 'irrelevant', 'ambiguous', 'reviewed')),
  source_artifact_hash TEXT NOT NULL CHECK(length(source_artifact_hash) = 64),
  source_row_json TEXT NOT NULL CHECK(json_valid(source_row_json)),
  batch_id TEXT,
  UNIQUE(candidate_id, queried_fingerprint_id, source_artifact_hash),
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS candidate_judgments_candidate_query_lookup
  ON candidate_judgments(candidate_id, queried_fingerprint_id);

CREATE TABLE IF NOT EXISTS batch_members (
  batch_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK(length(trim(entity_kind)) > 0),
  entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) > 0),
  PRIMARY KEY(batch_id, entity_kind, entity_id),
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS ability_reviews (
  ability_version_id INTEGER PRIMARY KEY,
  whole_context_checked INTEGER NOT NULL DEFAULT 0 CHECK(whole_context_checked IN (0, 1)),
  source_shape TEXT CHECK(source_shape IS NULL OR length(trim(source_shape)) BETWEEN 1 AND 256),
  cues_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(cues_json)),
  reviewed_by TEXT,
  reviewed_at TEXT,
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS gaps (
  id INTEGER PRIMARY KEY,
  ability_version_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('LEAF_GAP', 'RELATION_GAP', 'COMPOSITION_GAP', 'DSL_GAP')),
  status TEXT NOT NULL CHECK(status IN ('open', 'resolved')),
  description TEXT NOT NULL CHECK(length(trim(description)) > 0),
  batch_id TEXT,
  proposal_id INTEGER,
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(proposal_id) REFERENCES proposals(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS gaps_type_status_lookup ON gaps(type, status, ability_version_id);


CREATE TABLE IF NOT EXISTS source_chunks (
  id INTEGER PRIMARY KEY,
  ability_version_id INTEGER NOT NULL,
  fragment TEXT NOT NULL CHECK(length(trim(fragment)) > 0),
  start_byte INTEGER NOT NULL CHECK(start_byte >= 0),
  end_byte INTEGER NOT NULL CHECK(end_byte > start_byte),
  normalized_text TEXT NOT NULL CHECK(length(normalized_text) > 0),
  context_key TEXT NOT NULL CHECK(length(context_key) > 0),
  UNIQUE(ability_version_id, fragment, start_byte, end_byte),
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS source_chunks_version_context_lookup
  ON source_chunks(ability_version_id, context_key, fragment, start_byte);

CREATE VIRTUAL TABLE IF NOT EXISTS source_chunks_fts USING fts5(
  normalized_text,
  context_key,
  content='source_chunks',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS source_chunks_ai AFTER INSERT ON source_chunks BEGIN
  INSERT INTO source_chunks_fts(rowid, normalized_text, context_key)
  VALUES (new.id, new.normalized_text, new.context_key);
END;

CREATE TRIGGER IF NOT EXISTS source_chunks_ad AFTER DELETE ON source_chunks BEGIN
  INSERT INTO source_chunks_fts(source_chunks_fts, rowid, normalized_text, context_key)
  VALUES ('delete', old.id, old.normalized_text, old.context_key);
END;

CREATE TRIGGER IF NOT EXISTS source_chunks_au AFTER UPDATE OF normalized_text, context_key ON source_chunks BEGIN
  INSERT INTO source_chunks_fts(source_chunks_fts, rowid, normalized_text, context_key)
  VALUES ('delete', old.id, old.normalized_text, old.context_key);
  INSERT INTO source_chunks_fts(rowid, normalized_text, context_key)
  VALUES (new.id, new.normalized_text, new.context_key);
END;

CREATE TABLE IF NOT EXISTS workbench_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL CHECK(revision >= 0)
) STRICT;
INSERT OR IGNORE INTO workbench_state(singleton, revision) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS publication_batches (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  preview_hash TEXT NOT NULL CHECK(length(preview_hash) = 64),
  faction_id TEXT NOT NULL CHECK(length(trim(faction_id)) > 0),
  state TEXT NOT NULL CHECK(state IN ('prepared', 'publishing', 'published', 'failed')),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS publication_batches_state_lookup
  ON publication_batches(state, created_at, id);
`;

/** Execute a synchronous callback atomically, including nested workbench operations. */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  const depth = transactionDepth.get(db) ?? 0;
  const savepoint = `round5c_transaction_${depth}`;
  if (depth === 0) db.exec("BEGIN IMMEDIATE");
  else db.exec(`SAVEPOINT ${savepoint}`);
  transactionDepth.set(db, depth + 1);

  try {
    const result = fn();
    if (depth === 0) db.exec("COMMIT");
    else db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    try {
      if (depth === 0) db.exec("ROLLBACK");
      else {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
    } catch {
      // Preserve the original failure; a failed transaction may already be closed.
    }
    throw error;
  } finally {
    if (depth === 0) transactionDepth.delete(db);
    else transactionDepth.set(db, depth);
  }
}

/**
 * SQL predicate: this pending proposal restates an active annotation, the same fingerprint on the
 * same exact bytes. Such a proposal is not a decision anyone needs to make, so every review
 * surface treats it as resolved. It stays a derived condition rather than a status write, so
 * undoing the annotation makes the proposal reviewable again.
 */
export const RESTATES_ACTIVE_ANNOTATION = `EXISTS (
  SELECT 1 FROM annotations AS restated
  JOIN source_spans AS restated_span ON restated_span.id = restated.span_id
  WHERE restated.status = 'active'
    AND restated.fingerprint_id = proposals.fingerprint_id
    AND restated_span.ability_version_id = source_spans.ability_version_id
    AND restated_span.fragment = source_spans.fragment
    AND restated_span.start_byte = source_spans.start_byte
    AND restated_span.end_byte = source_spans.end_byte
)`;

/** Increment the shared browser-visible revision inside the caller's transaction. */
export function bumpWorkbenchRevision(db: DatabaseSync): number {
  const changed = db.prepare("UPDATE workbench_state SET revision = revision + 1 WHERE singleton = 1").run();
  if (changed.changes !== 1) throw new Error("Workbench revision singleton is missing.");
  const row = db.prepare("SELECT revision FROM workbench_state WHERE singleton = 1").get() as { revision: number };
  return row.revision;
}

export function getWorkbenchRevision(db: DatabaseSync): number {
  const row = db.prepare("SELECT revision FROM workbench_state WHERE singleton = 1").get() as { revision: number } | undefined;
  if (!row) throw new Error("Workbench revision singleton is missing.");
  return row.revision;
}

function upgradeAnnotationAuthority(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(annotations)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "authority_kind")) {
    db.exec("ALTER TABLE annotations ADD COLUMN authority_kind TEXT NOT NULL DEFAULT 'human' CHECK(authority_kind IN ('human', 'stamp'))");
  }
}

/** Clear a whole-context check after any reviewed-source change. */
export function invalidateWholeReview(db: DatabaseSync, abilityVersionIds: Iterable<number>): void {
  const review = db.prepare("UPDATE ability_reviews SET whole_context_checked = 0 WHERE ability_version_id = ?");
  for (const abilityVersionId of new Set(abilityVersionIds)) review.run(abilityVersionId);
}

/**
 * Add and backfill `source_spans.normalized_surface` for a database predating it. A simple
 * `ALTER TABLE ADD COLUMN` suffices here — unlike the CHECK-constraint migrations above, this
 * column carries no constraint SQLite can't add in place, so no table rebuild is needed. The
 * backfill computes `normalizedSurface(exact_text)` (a JS function, not a SQL expression) once
 * per existing row in one transaction.
 */
function upgradeSourceSpanNormalizedSurface(db: DatabaseSync): void {
  // Must run before `db.exec(SCHEMA)`: SCHEMA's own `CREATE INDEX ... ON source_spans
  // (normalized_surface)` fails outright on a pre-existing source_spans table that doesn't have
  // the column yet (`CREATE TABLE IF NOT EXISTS` is a no-op there). A genuinely fresh database has
  // no source_spans table at all at this point; SCHEMA creates it with the column already, so
  // there's nothing to migrate.
  if (!tableExists(db, "source_spans")) return;
  const columns = db.prepare("PRAGMA table_info(source_spans)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "normalized_surface")) {
    db.exec("ALTER TABLE source_spans ADD COLUMN normalized_surface TEXT");
  }
  const stale = db.prepare("SELECT id, exact_text FROM source_spans WHERE normalized_surface IS NULL").all() as Array<{ id: number; exact_text: string }>;
  if (stale.length === 0) return;
  const update = db.prepare("UPDATE source_spans SET normalized_surface = ? WHERE id = ?");
  withTransaction(db, () => {
    for (const row of stale) update.run(normalizedSurface(row.exact_text), row.id);
  });
}

function upgradeAnnotationBatchMetadata(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(annotation_batches)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "metadata_json")) {
    db.exec("ALTER TABLE annotation_batches ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))");
  }
}

function upgradeSourceShape(db: DatabaseSync): void {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ability_reviews'").get() as { sql: string };
  if (!existing.sql.includes("source_shape IN (")) return;
  db.exec(`
    CREATE TABLE ability_reviews_new (
      ability_version_id INTEGER PRIMARY KEY,
      whole_context_checked INTEGER NOT NULL DEFAULT 0 CHECK(whole_context_checked IN (0, 1)),
      source_shape TEXT CHECK(source_shape IS NULL OR length(trim(source_shape)) BETWEEN 1 AND 256),
      cues_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(cues_json)),
      reviewed_by TEXT,
      reviewed_at TEXT,
      FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT
    ) STRICT;
    INSERT INTO ability_reviews_new SELECT * FROM ability_reviews;
    DROP TABLE ability_reviews;
    ALTER TABLE ability_reviews_new RENAME TO ability_reviews;
  `);
}

function upgradeGapProposalLink(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(gaps)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "proposal_id")) {
    db.exec("ALTER TABLE gaps ADD COLUMN proposal_id INTEGER REFERENCES proposals(id) ON UPDATE RESTRICT ON DELETE RESTRICT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS gaps_proposal_lookup ON gaps(proposal_id) WHERE proposal_id IS NOT NULL");

  const gaps = db.prepare(`
    SELECT id, ability_version_id, description
    FROM gaps
    WHERE type = 'LEAF_GAP' AND proposal_id IS NULL
  `).all() as Array<{ id: number; ability_version_id: number; description: string }>;
  const byDescription = db.prepare(`
    SELECT proposals.id
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE source_spans.ability_version_id = ?
      AND proposals.model_run_id IS NOT NULL
      AND proposals.status IN ('pending', 'unresolved')
      AND json_extract(proposals.reason_json, '$.description') = ?
  `);
  const byLegacySpan = db.prepare(`
    SELECT proposals.id
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE source_spans.ability_version_id = ?
      AND source_spans.fragment = ?
      AND source_spans.start_byte = ?
      AND source_spans.end_byte = ?
      AND proposals.status = 'unresolved'
    ORDER BY proposals.id
  `);
  const link = db.prepare("UPDATE gaps SET proposal_id = ? WHERE id = ? AND proposal_id IS NULL");
  for (const gap of gaps) {
    let candidates = byDescription.all(gap.ability_version_id, gap.description) as Array<{ id: number }>;
    if (candidates.length !== 1) {
      const legacy = /^Unresolved source span (.+):(\d+)-(\d+)\.$/.exec(gap.description);
      if (legacy) {
        candidates = byLegacySpan.all(
          gap.ability_version_id,
          legacy[1],
          Number(legacy[2]),
          Number(legacy[3]),
        ) as Array<{ id: number }>;
      }
    }
    if (candidates.length === 1) link.run(candidates[0]!.id, gap.id);
  }
  const modelGaps = db.prepare(`
    SELECT id, ability_version_id, description FROM gaps
    WHERE type = 'LEAF_GAP' AND batch_id IS NULL AND proposal_id IS NULL
      AND description NOT LIKE 'Complete ability exceeds%'
    ORDER BY id
  `).all() as Array<{ id: number; ability_version_id: number; description: string }>;
  const modelProposals = db.prepare(`
    SELECT proposals.id, source_spans.ability_version_id, proposals.reason_json
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE proposals.origin = 'luna'
      AND NOT EXISTS (SELECT 1 FROM gaps WHERE gaps.proposal_id = proposals.id)
    ORDER BY proposals.id
  `).all() as Array<{ id: number; ability_version_id: number; reason_json: string }>;
  const expectedDescription = (serialized: string): string | null => {
    const reason = JSON.parse(serialized) as { type?: string; span_status?: string; description?: string | null };
    if (reason.type === "unresolved-region") return reason.description ?? null;
    if (reason.type !== "semantic-span") return null;
    if (reason.span_status === "NOVEL") return reason.description ?? "Luna marked this source span as a novel semantic leaf.";
    if (reason.span_status === "UNRESOLVED") return reason.description ?? "Luna marked this semantic source span unresolved.";
    return null;
  };
  const unlinkedByAbility = new Map<number, typeof modelGaps>();
  for (const gap of modelGaps) {
    const group = unlinkedByAbility.get(gap.ability_version_id) ?? [];
    group.push(gap);
    unlinkedByAbility.set(gap.ability_version_id, group);
  }
  for (const [abilityId, group] of unlinkedByAbility) {
    const candidates = modelProposals
      .filter((proposal) => proposal.ability_version_id === abilityId)
      .map((proposal) => ({ id: proposal.id, description: expectedDescription(proposal.reason_json) }))
      .filter((proposal): proposal is { id: number; description: string } => proposal.description !== null);
    // Model import inserts each gap directly after its proposal. Only a full, exact
    // ordered match can recover a legacy link; ambiguous groups remain unlinked.
    if (candidates.length !== group.length || group.some((gap, index) => gap.description !== candidates[index]!.description)) continue;
    for (const [index, gap] of group.entries()) link.run(candidates[index]!.id, gap.id);
  }
}

/**
 * Tables whose every row change advances `workbench_state.data_epoch`. Triggers, not call sites,
 * own this counter: a derived-state cache keyed on it cannot be defeated by a writer that forgets
 * to bump the browser revision. All persisted tables are listed, so readers need not track which
 * tables a given computation happens to read.
 */
const EPOCH_TABLES = [
  "abilities", "semantic_families", "fingerprints", "source_spans", "model_runs", "annotation_batches",
  "proposals", "annotations", "candidate_judgments", "batch_members", "ability_reviews", "gaps",
  "source_chunks", "publication_batches",
  ...EXTENSION_TABLES, ...COMPILED_TABLES, ...LEAVES_TABLES,
] as const;

function upgradeDataEpoch(db: DatabaseSync): void {
  const columns = new Set((db.prepare("PRAGMA table_info(workbench_state)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has("data_epoch")) db.exec("ALTER TABLE workbench_state ADD COLUMN data_epoch INTEGER NOT NULL DEFAULT 0 CHECK(data_epoch >= 0)");
  if (!columns.has("instance_id")) db.exec("ALTER TABLE workbench_state ADD COLUMN instance_id TEXT");
  db.prepare("UPDATE workbench_state SET instance_id = ? WHERE singleton = 1 AND instance_id IS NULL").run(randomUUID());
  for (const table of EPOCH_TABLES) {
    for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_epoch_${event.toLowerCase()} AFTER ${event} ON ${table}
        BEGIN UPDATE workbench_state SET data_epoch = data_epoch + 1 WHERE singleton = 1; END`);
    }
  }
}

const ONTOLOGY_BACKFILL_VERSION = 1;

/** Attach pre-existing NOVEL proposals to provisional candidates once per database. */
function upgradeOntologyBackfill(db: DatabaseSync): void {
  const columns = new Set((db.prepare("PRAGMA table_info(workbench_state)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has("ontology_backfill_version")) {
    db.exec("ALTER TABLE workbench_state ADD COLUMN ontology_backfill_version INTEGER NOT NULL DEFAULT 0");
  }
  const row = db.prepare("SELECT ontology_backfill_version FROM workbench_state WHERE singleton = 1").get() as { ontology_backfill_version: number };
  if (row.ontology_backfill_version >= ONTOLOGY_BACKFILL_VERSION) return;
  backfillFamilyCandidates(db);
  db.prepare("UPDATE workbench_state SET ontology_backfill_version = ? WHERE singleton = 1").run(ONTOLOGY_BACKFILL_VERSION);
}

/** Tables of the retired stamp, assembly, and escalation pipeline, dropped in dependency order. */
const RETIRED_TABLES = [
  "escalation_members", "escalations", "stamp_audit_decisions", "assembly_drafts",
  "stamp_applications", "stamp_evidence", "stamps",
] as const;

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

/**
 * Retire the stamp pipeline once per database. Annotations an approved leaf stamp derived become
 * ordinary active annotations (origin `migrated-stamp`); annotations of any other stamp were never
 * effective and are retracted. The approved leaf definitions are kept in the migration batch's
 * metadata so their literal surfaces survive the dropped `stamps` table.
 */
function upgradeRetireStamps(db: DatabaseSync): void {
  if (!tableExists(db, "stamps")) return;
  const hasApplications = tableExists(db, "stamp_applications");
  const approvedLeafStamps = (db.prepare(`
    SELECT id, revision, definition_json FROM stamps WHERE kind = 'leaf' AND status = 'approved' ORDER BY id, revision
  `).all() as Array<{ id: string; revision: number; definition_json: string }>)
    .map((row) => ({ id: row.id, revision: row.revision, definition: JSON.parse(row.definition_json) as unknown }));
  const supported = new Set(hasApplications
    ? (db.prepare(`
      SELECT DISTINCT stamp_applications.annotation_id AS id
      FROM stamp_applications
      JOIN stamps ON stamps.id = stamp_applications.stamp_id AND stamps.revision = stamp_applications.stamp_revision
      WHERE stamp_applications.annotation_id IS NOT NULL
        AND stamp_applications.status = 'active' AND stamps.status = 'approved'
    `).all() as Array<{ id: number }>).map((row) => row.id)
    : []);
  const derived = db.prepare(`
    SELECT id FROM annotations WHERE authority_kind = 'stamp' AND status = 'active' ORDER BY id
  `).all() as Array<{ id: number }>;
  const batchId = `migration_${randomUUID()}`;
  db.prepare(`
    INSERT INTO annotation_batches (id, operation, reviewer, created_at, metadata_json)
    VALUES (?, 'migration-retire-stamps', 'system', ?, ?)
  `).run(batchId, new Date().toISOString(), JSON.stringify({ approved_leaf_stamps: approvedLeafStamps }));
  const member = db.prepare("INSERT INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)");
  const keep = db.prepare("UPDATE annotations SET authority_kind = 'human', origin = 'migrated-stamp' WHERE id = ? AND status = 'active'");
  const retract = db.prepare("UPDATE annotations SET status = 'retracted' WHERE id = ? AND status = 'active'");
  for (const { id } of derived) {
    if (supported.has(id)) {
      keep.run(id);
      member.run(batchId, "annotation-migrated", String(id));
    } else {
      retract.run(id);
      member.run(batchId, "annotation-retracted", String(id));
    }
  }
  for (const table of RETIRED_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
}

/** Identity of the persisted state: stable across connections, advanced by any table write. */
export function getDataEpoch(db: DatabaseSync): { instance_id: string; data_epoch: number } {
  const row = db.prepare("SELECT instance_id, data_epoch FROM workbench_state WHERE singleton = 1").get() as { instance_id: string | null; data_epoch: number } | undefined;
  if (!row?.instance_id) throw new Error("Workbench data epoch is missing.");
  return { instance_id: row.instance_id, data_epoch: row.data_epoch };
}

/** Create every private workbench table, index, FTS index, and reviewed family. */
/**
 * Allow every leaf role (combinators, restrictions) on semantic families. SQLite cannot alter a CHECK, so the table is
 * rebuilt with foreign keys off (fingerprints reference it) and checked before committing.
 * This must run outside a transaction, where the foreign_keys pragma takes effect.
 */
function upgradeLeafRoles(db: DatabaseSync): void {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'semantic_families'").get() as { sql: string } | undefined;
  if (!existing || existing.sql.includes("'RESTRICTION'")) return;
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        CREATE TABLE semantic_families_new (
          id TEXT NOT NULL CHECK(length(trim(id)) > 0),
          version INTEGER NOT NULL CHECK(version > 0),
          role TEXT NOT NULL CHECK(role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION', 'COMBINATOR', 'RESTRICTION')),
          parameter_schema_json TEXT NOT NULL CHECK(json_valid(parameter_schema_json)),
          status TEXT NOT NULL CHECK(status IN ('active', 'deprecated')),
          PRIMARY KEY(id, version)
        ) STRICT;
        INSERT INTO semantic_families_new (id, version, role, parameter_schema_json, status)
          SELECT id, version, role, parameter_schema_json, status FROM semantic_families;
        DROP TABLE semantic_families;
        ALTER TABLE semantic_families_new RENAME TO semantic_families;
      `);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length > 0) throw new Error(`Rebuilding semantic_families broke ${violations.length} foreign key reference(s).`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Allow every leaf role (combinators, restrictions) on proposals, mirroring `upgradeLeafRoles`
 * for `semantic_families`. Without this, `importLuna` cannot insert a RESTRICTION- or
 * COMBINATOR-role proposal at all: the old CHECK predates those two roles and SQLite rejects the
 * insert outright. SQLite cannot alter a CHECK, so the table is rebuilt with foreign keys off
 * (both `gaps.proposal_id` referencing it and its own `span_id`/`fingerprint_id`/`model_run_id`
 * references) and checked before committing. This must run outside a transaction, where the
 * foreign_keys pragma takes effect.
 */
function upgradeProposalRoles(db: DatabaseSync): void {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'proposals'").get() as { sql: string } | undefined;
  if (!existing || existing.sql.includes("'RESTRICTION'")) return;
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        CREATE TABLE proposals_new (
          id INTEGER PRIMARY KEY,
          span_id INTEGER NOT NULL,
          fingerprint_id TEXT,
          role TEXT NOT NULL CHECK(role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION', 'COMBINATOR', 'RESTRICTION', 'RESOURCE', 'CONNECTIVE', 'UNRESOLVED')),
          origin TEXT NOT NULL CHECK(length(trim(origin)) > 0),
          model_run_id INTEGER,
          status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected', 'corrected', 'superseded', 'unresolved')),
          reason_json TEXT NOT NULL CHECK(json_valid(reason_json)),
          score REAL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          FOREIGN KEY(fingerprint_id) REFERENCES fingerprints(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          FOREIGN KEY(model_run_id) REFERENCES model_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT
        ) STRICT;
        INSERT INTO proposals_new (id, span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
          SELECT id, span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at FROM proposals;
        DROP TABLE proposals;
        ALTER TABLE proposals_new RENAME TO proposals;
        CREATE INDEX IF NOT EXISTS proposals_status_origin_lookup ON proposals(status, origin, span_id);
      `);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length > 0) throw new Error(`Rebuilding proposals broke ${violations.length} foreign key reference(s).`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Allow every leaf role on `family_candidates`, mirroring `upgradeLeafRoles`/`upgradeProposalRoles`.
 * Without this, `recordCandidateSuggestion` cannot track a RESTRICTION- or COMBINATOR-role NOVEL
 * hypothesis as a vocabulary candidate: the old CHECK predates those two roles. Rebuilt with
 * foreign keys off (its own references to `model_runs`/`semantic_families`, plus the incoming
 * `family_candidate_evidence.candidate_id` reference) and checked before committing, outside a
 * transaction, where the foreign_keys pragma takes effect.
 */
function upgradeFamilyCandidateRoles(db: DatabaseSync): void {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'family_candidates'").get() as { sql: string } | undefined;
  if (!existing || existing.sql.includes("'RESTRICTION'")) return;
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        CREATE TABLE family_candidates_new (
          id INTEGER PRIMARY KEY,
          role TEXT NOT NULL CHECK(role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION', 'COMBINATOR', 'RESTRICTION')),
          label TEXT NOT NULL CHECK(length(trim(label)) > 0),
          distinction TEXT NOT NULL CHECK(length(trim(distinction)) > 0),
          parameter_hints_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(parameter_hints_json) AND json_type(parameter_hints_json) = 'array'),
          signature TEXT NOT NULL UNIQUE CHECK(length(signature) = 64),
          state TEXT NOT NULL CHECK(state IN ('open', 'mapped', 'dismissed')),
          created_from_model_run_id INTEGER,
          mapped_family_id TEXT,
          mapped_family_version INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK((state = 'mapped') = (mapped_family_id IS NOT NULL AND mapped_family_version IS NOT NULL)),
          FOREIGN KEY(created_from_model_run_id) REFERENCES model_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          FOREIGN KEY(mapped_family_id, mapped_family_version) REFERENCES semantic_families(id, version)
            ON UPDATE RESTRICT ON DELETE RESTRICT
        ) STRICT;
        INSERT INTO family_candidates_new (id, role, label, distinction, parameter_hints_json, signature, state, created_from_model_run_id, mapped_family_id, mapped_family_version, created_at, updated_at)
          SELECT id, role, label, distinction, parameter_hints_json, signature, state, created_from_model_run_id, mapped_family_id, mapped_family_version, created_at, updated_at FROM family_candidates;
        DROP TABLE family_candidates;
        ALTER TABLE family_candidates_new RENAME TO family_candidates;
        CREATE INDEX IF NOT EXISTS family_candidates_state_role ON family_candidates(state, role, id);
      `);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length > 0) throw new Error(`Rebuilding family_candidates broke ${violations.length} foreign key reference(s).`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/** Drop a leaf_proposals table whose kind CHECK predates the current kinds; the schema recreates it. */
function upgradeLeafProposals(db: DatabaseSync): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'leaf_proposals'").get() as { sql: string } | undefined;
  if (row && !row.sql.includes(LEAF_PROPOSAL_KINDS_MARKER)) db.exec("DROP TABLE leaf_proposals");
}

export function initializeWorkbench(db: DatabaseSync): void {
  if (initialized.has(db)) return;
  db.exec("PRAGMA busy_timeout = 3000");
  upgradeLeafRoles(db);
  upgradeProposalRoles(db);
  upgradeFamilyCandidateRoles(db);
  upgradeSourceSpanNormalizedSurface(db);
  db.exec("PRAGMA foreign_keys = ON");
  withTransaction(db, () => {
    db.exec(SCHEMA);
    db.exec(EXTENSION_SCHEMA);
    db.exec(COMPILED_SCHEMA);
    upgradeCompiledCore(db);
    db.exec(LEAVES_SCHEMA);
    upgradeLeafProposals(db);
    db.exec(LEAF_PROPOSALS_SCHEMA);
    upgradeSourceShape(db);
    upgradeAnnotationAuthority(db);
    upgradeAnnotationBatchMetadata(db);
    upgradeGapProposalLink(db);
    upgradeRetireStamps(db);
    seedReviewedFamilies(db);
    upgradeFamilyVersions(db);
    upgradeDataEpoch(db);
    upgradeOntologyBackfill(db);
  });
  initialized.add(db);
}

/**
 * Keep a copy of a database that still has the retired stamp tables before its one-way
 * migration. The copy sits beside the database and is never overwritten.
 */
function backupBeforeStampRetirement(db: DatabaseSync, databasePath: string): void {
  if (!tableExists(db, "stamps")) return;
  const backup = `${databasePath}.pre5e`;
  if (existsSync(backup)) return;
  db.prepare("VACUUM INTO ?").run(backup);
}

/** Open the ignored local workbench and initialize its schema on first use. */
export function openWorkbench(path?: string): DatabaseSync {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isSafeInteger(major) || major < 24) {
    throw new Error("Round 5C local tooling requires Node.js 24 or newer for node:sqlite.");
  }

  const databasePath = path ?? process.env.ROUND5C_DB ?? defaultDatabasePath;
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  try {
    // WAL lets page reads continue while another connection writes; the default rollback
    // journal blocks every reader for the length of each write transaction.
    if (databasePath !== ":memory:") {
      try {
        db.exec("PRAGMA journal_mode = WAL");
      } catch {
        // Another connection holds the file; it stays in its current mode until next open.
      }
    }
    if (databasePath !== ":memory:") backupBeforeStampRetirement(db, databasePath);
    initializeWorkbench(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}


type StoredFragment = {
  fragment: string;
  start_byte: number;
  end_byte: number;
  text: string;
};

export function parseStoredFragments(serialized: string): StoredFragment[] {
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed)) throw new Error("Ability fragments are not an array.");
  return parsed.map((fragment) => {
    if (
      fragment === null ||
      typeof fragment !== "object" ||
      Array.isArray(fragment) ||
      typeof (fragment as Record<string, unknown>).fragment !== "string" ||
      !Number.isSafeInteger((fragment as Record<string, unknown>).start_byte) ||
      !Number.isSafeInteger((fragment as Record<string, unknown>).end_byte) ||
      typeof (fragment as Record<string, unknown>).text !== "string"
    ) {
      throw new Error("Ability fragments have an invalid persisted shape.");
    }
    return fragment as StoredFragment;
  });
}

/** Insert or recover one source-bound span after exact source and fragment validation. */
export function insertSpan(
  db: DatabaseSync,
  abilityVersionId: number,
  fragment: string,
  startByte: number,
  endByte: number,
  exactText: string,
): number {
  const abilityStatement = db.prepare("SELECT source_text, fragments_json FROM abilities WHERE id = ?");
  const ability = abilityStatement.get(abilityVersionId) as
    | { source_text: string; fragments_json: string }
    | undefined;
  if (!ability) throw new RangeError(`Unknown ability version ${abilityVersionId}.`);

  const sourceText = exactSpan(ability.source_text, startByte, endByte);
  if (sourceText !== exactText) throw new TypeError("Span text does not exactly match the persisted source bytes.");
  const sourceFragment = parseStoredFragments(ability.fragments_json).find(
    (item) => item.fragment === fragment && startByte >= item.start_byte && endByte <= item.end_byte,
  );
  if (!sourceFragment) throw new RangeError("Source span must be wholly contained in one declared source fragment.");
  if (
    exactSpan(ability.source_text, sourceFragment.start_byte, sourceFragment.end_byte) !== sourceFragment.text
  ) {
    throw new Error("Persisted source fragment bytes do not match the ability source.");
  }


  const insert = db.prepare(
    "INSERT OR IGNORE INTO source_spans (ability_version_id, fragment, start_byte, end_byte, exact_text, normalized_surface) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const select = db.prepare(
    "SELECT id, exact_text FROM source_spans WHERE ability_version_id = ? AND start_byte = ? AND end_byte = ? AND fragment = ?",
  );
  {
    insert.run(abilityVersionId, fragment, startByte, endByte, exactText, normalizedSurface(exactText));
    const span = select.get(abilityVersionId, startByte, endByte, fragment) as
      | { id: number; exact_text: string }
      | undefined;
    if (!span || span.exact_text !== exactText) {
      throw new Error("Conflicting source span already occupies these byte offsets.");
    }
    return span.id;
  }
}
