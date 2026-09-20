import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { exactSpan, seedReviewedFamilies } from "./contracts.js";
import { backfillFamilyCandidates } from "./ontology-store.js";
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
  role TEXT NOT NULL CHECK(role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION')),
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
  UNIQUE(ability_version_id, start_byte, end_byte, fragment),
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS source_spans_ability_lookup
  ON source_spans(ability_version_id, start_byte, end_byte);

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
  role TEXT NOT NULL CHECK(role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION', 'RESOURCE', 'CONNECTIVE', 'UNRESOLVED')),
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

CREATE TABLE IF NOT EXISTS stamps (
  id TEXT NOT NULL CHECK(length(trim(id)) > 0),
  revision INTEGER NOT NULL CHECK(revision > 0),
  kind TEXT NOT NULL CHECK(kind IN ('leaf', 'composition')),
  status TEXT NOT NULL CHECK(status IN ('proposed', 'approved', 'rejected', 'suspended', 'superseded')),
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
  definition_hash TEXT NOT NULL CHECK(length(definition_hash) = 64),
  model_run_id INTEGER,
  challenge_run_id INTEGER,
  approval_batch_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(id, revision),
  FOREIGN KEY(model_run_id) REFERENCES model_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(challenge_run_id) REFERENCES model_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(approval_batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS stamps_one_approved_revision
  ON stamps(id) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS stamps_status_lookup ON stamps(status, kind, id, revision);

CREATE TABLE IF NOT EXISTS stamp_evidence (
  stamp_id TEXT NOT NULL,
  stamp_revision INTEGER NOT NULL,
  evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('positive', 'counterexample')),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  PRIMARY KEY(stamp_id, stamp_revision, evidence_kind, ordinal),
  FOREIGN KEY(stamp_id, stamp_revision) REFERENCES stamps(id, revision) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS stamp_applications (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  stamp_id TEXT NOT NULL,
  stamp_revision INTEGER NOT NULL,
  ability_version_id INTEGER NOT NULL,
  span_id INTEGER,
  annotation_id INTEGER,
  variant_id TEXT NOT NULL,
  inputs_hash TEXT NOT NULL CHECK(length(inputs_hash) = 64),
  bindings_json TEXT NOT NULL CHECK(json_valid(bindings_json)),
  dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json)),
  status TEXT NOT NULL CHECK(status IN ('active', 'blocked', 'stale')),
  reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(stamp_id, stamp_revision) REFERENCES stamps(id, revision) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(annotation_id) REFERENCES annotations(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS stamp_applications_rule_status_lookup
  ON stamp_applications(stamp_id, stamp_revision, status);
CREATE INDEX IF NOT EXISTS stamp_applications_ability_status_lookup
  ON stamp_applications(ability_version_id, status);
CREATE INDEX IF NOT EXISTS stamp_applications_annotation_lookup
  ON stamp_applications(annotation_id) WHERE annotation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stamp_audit_decisions (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  batch_id TEXT NOT NULL UNIQUE,
  stamp_id TEXT NOT NULL,
  stamp_revision INTEGER NOT NULL,
  application_id TEXT NOT NULL,
  ability_version_id INTEGER NOT NULL,
  source_hash TEXT NOT NULL CHECK(length(source_hash) = 64),
  dependency_hash TEXT NOT NULL CHECK(length(dependency_hash) = 64),
  verdict TEXT NOT NULL CHECK(verdict IN ('correct', 'incorrect', 'uncertain')),
  scope TEXT CHECK(scope IS NULL OR scope IN ('occurrence', 'rule')),
  created_at TEXT NOT NULL,
  CHECK((verdict = 'incorrect' AND scope IS NOT NULL) OR (verdict <> 'incorrect' AND scope IS NULL)),
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(stamp_id, stamp_revision) REFERENCES stamps(id, revision) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(application_id) REFERENCES stamp_applications(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS stamp_audit_decisions_rule_lookup
  ON stamp_audit_decisions(stamp_id, stamp_revision, created_at, id);
CREATE INDEX IF NOT EXISTS stamp_audit_decisions_application_lookup
  ON stamp_audit_decisions(application_id, created_at, id);

CREATE TABLE IF NOT EXISTS assembly_drafts (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  composition_application_id TEXT NOT NULL,
  graph_json TEXT NOT NULL CHECK(json_valid(graph_json)),
  mechanics_json TEXT CHECK(mechanics_json IS NULL OR json_valid(mechanics_json)),
  rendered_text TEXT,
  inputs_hash TEXT NOT NULL CHECK(length(inputs_hash) = 64),
  schema_hash TEXT NOT NULL CHECK(length(schema_hash) = 64),
  status TEXT NOT NULL CHECK(status IN ('proposed', 'accepted', 'blocked', 'stale')),
  verifier_run_id INTEGER,
  diagnostic_json TEXT NOT NULL CHECK(json_valid(diagnostic_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(composition_application_id) REFERENCES stamp_applications(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(verifier_run_id) REFERENCES model_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS assembly_drafts_status_lookup ON assembly_drafts(status, id);

CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  decision_key TEXT NOT NULL UNIQUE CHECK(length(decision_key) = 64),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('NEW_FORM', 'PARAMETER_BOUNDARY', 'CONFLICT', 'RELATION_GAP', 'COMPOSITION_GAP', 'DSL_GAP', 'SOURCE_AMBIGUITY', 'MODEL_ERROR', 'OVERSIZED', 'ENTITY_RESOLUTION')),
  question_json TEXT NOT NULL CHECK(json_valid(question_json)),
  options_json TEXT NOT NULL CHECK(json_valid(options_json)),
  state TEXT NOT NULL CHECK(state IN ('open', 'deferred', 'resolved')),
  decision_batch_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(decision_batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS escalations_state_reason_lookup ON escalations(state, reason_code, id);

CREATE TABLE IF NOT EXISTS escalation_members (
  escalation_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  ability_version_id INTEGER NOT NULL,
  source_hash TEXT NOT NULL CHECK(length(source_hash) = 64),
  evidence_hash TEXT NOT NULL CHECK(length(evidence_hash) = 64),
  span_id INTEGER,
  draft_id TEXT,
  gap_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active', 'stale')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(escalation_id, member_id),
  FOREIGN KEY(escalation_id) REFERENCES escalations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(draft_id) REFERENCES assembly_drafts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(gap_id) REFERENCES gaps(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS escalation_members_ability_lookup
  ON escalation_members(ability_version_id, status);

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

function staleCompositionDependencies(
  db: DatabaseSync,
  annotationIds: ReadonlySet<number>,
  reasonCode: string,
  now: string,
): { applications: number; drafts: number } {
  if (annotationIds.size === 0) return { applications: 0, drafts: 0 };
  const rows = db.prepare(`
    SELECT stamp_applications.id, stamp_applications.dependencies_json
    FROM stamp_applications
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    WHERE stamps.kind = 'composition' AND stamp_applications.status IN ('active', 'blocked')
  `).all() as Array<{ id: string; dependencies_json: string }>;
  const affected = rows.filter((row) => {
    const dependencies = JSON.parse(row.dependencies_json) as { leaf_annotation_ids?: unknown };
    return Array.isArray(dependencies.leaf_annotation_ids)
      && dependencies.leaf_annotation_ids.some((id) => typeof id === "number" && annotationIds.has(id));
  });
  let applications = 0;
  let drafts = 0;
  const staleApplication = db.prepare(
    "UPDATE stamp_applications SET status = 'stale', reason_code = ?, updated_at = ? WHERE id = ? AND status IN ('active', 'blocked')",
  );
  const staleDraft = db.prepare(
    "UPDATE assembly_drafts SET status = 'stale', diagnostic_json = ?, updated_at = ? WHERE composition_application_id = ? AND status <> 'stale'",
  );
  for (const row of affected) {
    applications += Number(staleApplication.run(reasonCode, now, row.id).changes);
    drafts += Number(staleDraft.run(JSON.stringify({ reason_code: reasonCode }), now, row.id).changes);
  }
  return { applications, drafts };
}

function staleEscalationsForInvalidDrafts(db: DatabaseSync): number {
  return Number(db.prepare(`
    UPDATE escalation_members
    SET status = 'stale'
    WHERE status = 'active' AND draft_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM assembly_drafts
        WHERE assembly_drafts.id = escalation_members.draft_id
          AND assembly_drafts.status = 'stale'
      )
  `).run().changes);
}

function restoreStampSupersededProposals(db: DatabaseSync, annotationIds: ReadonlySet<number>): number {
  if (annotationIds.size === 0) return 0;
  const proposals = new Map<number, {
    id: number;
    ability_version_id: number;
    fragment: string;
    start_byte: number;
    end_byte: number;
    role: string;
  }>();
  const candidates = db.prepare(`
    SELECT proposals.id, source_spans.ability_version_id, source_spans.fragment,
      source_spans.start_byte, source_spans.end_byte, proposals.role
    FROM annotations
    JOIN proposals ON proposals.span_id = annotations.span_id
      AND (proposals.fingerprint_id IS NULL OR proposals.fingerprint_id = annotations.fingerprint_id)
    JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE annotations.id = ? AND proposals.status = 'superseded'
  `);
  for (const annotationId of annotationIds) {
    for (const proposal of candidates.all(annotationId) as Array<{
      id: number;
      ability_version_id: number;
      fragment: string;
      start_byte: number;
      end_byte: number;
      role: string;
    }>) proposals.set(proposal.id, proposal);
  }

  const overlappingAuthority = db.prepare(`
    SELECT annotations.id
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id
      AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active'
      AND source_spans.ability_version_id = ? AND source_spans.fragment = ?
      AND source_spans.start_byte < ? AND ? < source_spans.end_byte
      AND semantic_families.role = ?
    ORDER BY annotations.id
  `);
  const latestTransition = db.prepare(`
    SELECT batch_members.entity_kind
    FROM batch_members
    JOIN annotation_batches ON annotation_batches.id = batch_members.batch_id
    WHERE batch_members.entity_id = ?
      AND batch_members.entity_kind IN (
        'stamp-proposal-superseded-pending',
        'stamp-proposal-superseded-unresolved'
      )
    ORDER BY annotation_batches.created_at DESC, annotation_batches.id DESC
    LIMIT 1
  `);
  let restored = 0;
  for (const proposal of proposals.values()) {
    const stillResolved = (overlappingAuthority.all(
      proposal.ability_version_id,
      proposal.fragment,
      proposal.end_byte,
      proposal.start_byte,
      proposal.role,
    ) as Array<{ id: number }>).some((annotation) => annotationHasEffectiveAuthority(db, annotation.id));
    if (stillResolved) continue;
    const transition = latestTransition.get(String(proposal.id)) as { entity_kind: string } | undefined;
    if (!transition) continue;
    const priorStatus = transition.entity_kind.endsWith("-unresolved") ? "unresolved" : "pending";
    restored += Number(db.prepare(
      "UPDATE proposals SET status = ? WHERE id = ? AND status = 'superseded'",
    ).run(priorStatus, proposal.id).changes);
  }
  return restored;
}

/** Retract derived rows whose approved application support is gone, then stale dependent composition. */
export function retractUnsupportedStampAnnotations(
  db: DatabaseSync,
  annotationIds?: Iterable<number>,
  reasonCode = "STAMP_SUPPORT_RETRACTED",
): { applications: number; drafts: number; annotations: number } {
  const selected = annotationIds ? new Set(annotationIds) : null;
  const rows = db.prepare(`
    SELECT id FROM annotations
    WHERE authority_kind = 'stamp' AND status = 'active'
    ORDER BY id
  `).all() as Array<{ id: number }>;
  const unsupported = rows.filter((row) => (!selected || selected.has(row.id)) && db.prepare(`
    SELECT 1 FROM stamp_applications
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    WHERE stamp_applications.annotation_id = ?
      AND stamp_applications.status = 'active' AND stamps.status = 'approved'
    LIMIT 1
  `).get(row.id) === undefined);
  let annotations = 0;
  const unsupportedIds = new Set(unsupported.map((row) => row.id));
  for (const row of unsupported) {
    annotations += Number(db.prepare(`
      UPDATE annotations SET status = 'retracted'
      WHERE id = ? AND authority_kind = 'stamp' AND status = 'active'
    `).run(row.id).changes);
  }
  restoreStampSupersededProposals(db, unsupportedIds);
  const cascade = staleCompositionDependencies(db, unsupportedIds, reasonCode, new Date().toISOString());
  staleEscalationsForInvalidDrafts(db);
  return { ...cascade, annotations };
}

/** Retract rule-derived authority and drafts whenever a source-bound dependency changes. */
export function invalidateAbilityEvidence(
  db: DatabaseSync,
  abilityVersionIds: Iterable<number>,
  reasonCode: string,
): { applications: number; drafts: number; annotations: number } {
  const ids = [...new Set(abilityVersionIds)];
  if (ids.length === 0) return { applications: 0, drafts: 0, annotations: 0 };
  const candidateAnnotations = new Set<number>();
  const annotationsForAbility = db.prepare(`
    SELECT annotations.id AS annotation_id
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE source_spans.ability_version_id = ?
      AND annotations.authority_kind = 'stamp' AND annotations.status = 'active'
  `);
  const staleApplication = db.prepare(
    "UPDATE stamp_applications SET status = 'stale', reason_code = ?, updated_at = ? WHERE ability_version_id = ? AND status IN ('active', 'blocked')",
  );
  const staleDraft = db.prepare(`
    UPDATE assembly_drafts SET status = 'stale', diagnostic_json = ?, updated_at = ?
    WHERE composition_application_id IN (
      SELECT id FROM stamp_applications WHERE ability_version_id = ?
    ) AND status <> 'stale'
  `);
  const staleMembers = db.prepare(`
    UPDATE escalation_members
    SET status = 'stale'
    WHERE ability_version_id = ? AND status = 'active'
      AND (
        NOT EXISTS (
          SELECT 1 FROM abilities
          WHERE abilities.id = escalation_members.ability_version_id
            AND abilities.current = 1
            AND abilities.source_hash = escalation_members.source_hash
        )
        OR (
          escalation_members.draft_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM assembly_drafts
            WHERE assembly_drafts.id = escalation_members.draft_id
              AND assembly_drafts.status = 'stale'
          )
        )
        OR (
          escalation_members.gap_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM gaps
            WHERE gaps.id = escalation_members.gap_id
              AND gaps.status <> 'open'
          )
        )
      )
  `);
  const now = new Date().toISOString();
  let applications = 0;
  let drafts = 0;
  for (const id of ids) {
    for (const row of annotationsForAbility.all(id) as Array<{ annotation_id: number }>) {
      candidateAnnotations.add(row.annotation_id);
    }
    applications += Number(staleApplication.run(reasonCode, now, id).changes);
    drafts += Number(staleDraft.run(JSON.stringify({ reason_code: reasonCode }), now, id).changes);
    staleMembers.run(id);
  }
  const retracted = retractUnsupportedStampAnnotations(db, candidateAnnotations, reasonCode);
  return {
    applications: applications + retracted.applications,
    drafts: drafts + retracted.drafts,
    annotations: retracted.annotations,
  };
}

/** Clear a whole-context check and stale its composition escalation after any reviewed-source change. */
export function invalidateWholeReview(db: DatabaseSync, abilityVersionIds: Iterable<number>): void {
  const review = db.prepare("UPDATE ability_reviews SET whole_context_checked = 0 WHERE ability_version_id = ?");
  const composition = db.prepare(`
    UPDATE escalation_members SET status = 'stale'
    WHERE ability_version_id = ? AND status = 'active' AND escalation_id IN (
      SELECT id FROM escalations WHERE reason_code = 'COMPOSITION_GAP'
    )
  `);
  for (const abilityVersionId of new Set(abilityVersionIds)) {
    review.run(abilityVersionId);
    composition.run(abilityVersionId);
  }
}

/** Invalidate one rule revision transitively while preserving human replacements. */
export function invalidateStampRevision(
  db: DatabaseSync,
  stampId: string,
  revision: number,
  reasonCode: string,
): { applications: number; drafts: number; annotations: number } {
  const now = new Date().toISOString();
  const candidates = db.prepare(`
    SELECT DISTINCT annotation_id FROM stamp_applications
    WHERE stamp_id = ? AND stamp_revision = ? AND annotation_id IS NOT NULL
  `).all(stampId, revision) as Array<{ annotation_id: number }>;
  let applications = Number(db.prepare(`
    UPDATE stamp_applications SET status = 'stale', reason_code = ?, updated_at = ?
    WHERE stamp_id = ? AND stamp_revision = ? AND status IN ('active', 'blocked')
  `).run(reasonCode, now, stampId, revision).changes);
  let drafts = Number(db.prepare(`
    UPDATE assembly_drafts SET status = 'stale', diagnostic_json = ?, updated_at = ?
    WHERE composition_application_id IN (
      SELECT id FROM stamp_applications WHERE stamp_id = ? AND stamp_revision = ?
    ) AND status <> 'stale'
  `).run(JSON.stringify({ reason_code: reasonCode }), now, stampId, revision).changes);
  const dependentDrafts = db.prepare(`
    SELECT assembly_drafts.id AS draft_id, assembly_drafts.composition_application_id,
      stamp_applications.dependencies_json
    FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    WHERE assembly_drafts.status <> 'stale'
  `).all() as Array<{ draft_id: string; composition_application_id: string; dependencies_json: string }>;
  for (const draft of dependentDrafts) {
    const dependencies = JSON.parse(draft.dependencies_json) as { equivalent_supports?: unknown };
    if (!Array.isArray(dependencies.equivalent_supports) || !dependencies.equivalent_supports.some((support) =>
      Boolean(support && typeof support === "object" && !Array.isArray(support)
        && "stamp_id" in support && support.stamp_id === stampId
        && "stamp_revision" in support && support.stamp_revision === revision))) continue;
    applications += Number(db.prepare(`
      UPDATE stamp_applications SET status = 'stale', reason_code = ?, updated_at = ?
      WHERE id = ? AND status IN ('active', 'blocked')
    `).run(reasonCode, now, draft.composition_application_id).changes);
    drafts += Number(db.prepare(`
      UPDATE assembly_drafts SET status = 'stale', diagnostic_json = ?, updated_at = ?
      WHERE id = ? AND status <> 'stale'
    `).run(JSON.stringify({ reason_code: reasonCode }), now, draft.draft_id).changes);
  }
  const retracted = retractUnsupportedStampAnnotations(
    db,
    candidates.map((candidate) => candidate.annotation_id),
    reasonCode,
  );
  applications += retracted.applications;
  drafts += retracted.drafts;
  return { applications, drafts, annotations: retracted.annotations };
}

/** Check whether an annotation can currently contribute semantic authority. */
export function annotationHasEffectiveAuthority(db: DatabaseSync, annotationId: number): boolean {
  const annotation = db.prepare("SELECT authority_kind, status FROM annotations WHERE id = ?").get(annotationId) as
    | { authority_kind: "human" | "stamp"; status: string }
    | undefined;
  if (!annotation || annotation.status !== "active") return false;
  if (annotation.authority_kind === "human") return true;
  return db.prepare(`
    SELECT 1 FROM stamp_applications
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE stamp_applications.annotation_id = ?
      AND stamp_applications.status = 'active'
      AND stamps.status = 'approved' AND abilities.current = 1
    LIMIT 1
  `).get(annotationId) !== undefined;
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
  "source_chunks", "stamps", "stamp_evidence", "stamp_applications", "stamp_audit_decisions",
  "assembly_drafts", "escalations", "escalation_members", "publication_batches",
  ...EXTENSION_TABLES,
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

/** Identity of the persisted state: stable across connections, advanced by any table write. */
export function getDataEpoch(db: DatabaseSync): { instance_id: string; data_epoch: number } {
  const row = db.prepare("SELECT instance_id, data_epoch FROM workbench_state WHERE singleton = 1").get() as { instance_id: string | null; data_epoch: number } | undefined;
  if (!row?.instance_id) throw new Error("Workbench data epoch is missing.");
  return { instance_id: row.instance_id, data_epoch: row.data_epoch };
}

/** Create every private workbench table, index, FTS index, and reviewed family. */
export function initializeWorkbench(db: DatabaseSync): void {
  if (initialized.has(db)) return;
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 3000");
  withTransaction(db, () => {
    db.exec(SCHEMA);
    db.exec(EXTENSION_SCHEMA);
    upgradeSourceShape(db);
    upgradeAnnotationAuthority(db);
    upgradeAnnotationBatchMetadata(db);
    upgradeGapProposalLink(db);
    seedReviewedFamilies(db);
    upgradeDataEpoch(db);
    upgradeOntologyBackfill(db);
  });
  initialized.add(db);
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
    "INSERT OR IGNORE INTO source_spans (ability_version_id, fragment, start_byte, end_byte, exact_text) VALUES (?, ?, ?, ?, ?)",
  );
  const select = db.prepare(
    "SELECT id, exact_text FROM source_spans WHERE ability_version_id = ? AND start_byte = ? AND end_byte = ? AND fragment = ?",
  );
  {
    insert.run(abilityVersionId, fragment, startByte, endByte, exactText);
    const span = select.get(abilityVersionId, startByte, endByte, fragment) as
      | { id: number; exact_text: string }
      | undefined;
    if (!span || span.exact_text !== exactText) {
      throw new Error("Conflicting source span already occupies these byte offsets.");
    }
    return span.id;
  }
}
