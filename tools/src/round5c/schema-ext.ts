/**
 * DDL for structural source constituents and the provisional family ontology. Kept free of
 * imports so `db.ts` can append it to the workbench schema without an import cycle.
 */

/** Structural constituent kinds. They are never semantic families and never get fingerprints. */
export const STRUCTURAL_KINDS = ["participant", "selector", "usage", "binding"] as const;
export type StructuralKind = typeof STRUCTURAL_KINDS[number];

const kinds = STRUCTURAL_KINDS.map((kind) => `'${kind}'`).join(", ");

export const EXTENSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS source_atom_proposals (
  id INTEGER PRIMARY KEY,
  span_id INTEGER NOT NULL,
  model_run_id INTEGER,
  origin TEXT NOT NULL CHECK(length(trim(origin)) > 0),
  kind TEXT NOT NULL CHECK(kind IN (${kinds})),
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'corrected', 'rejected')),
  description TEXT NOT NULL CHECK(length(trim(description)) > 0),
  parent_proposal_id INTEGER,
  reason_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(reason_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(model_run_id) REFERENCES model_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(parent_proposal_id) REFERENCES proposals(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS source_atom_proposals_status_span
  ON source_atom_proposals(status, span_id);
CREATE UNIQUE INDEX IF NOT EXISTS source_atom_proposals_one_pending
  ON source_atom_proposals(span_id, kind) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS source_atom_reviews (
  id INTEGER PRIMARY KEY,
  proposal_id INTEGER NOT NULL,
  span_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (${kinds})),
  decision TEXT NOT NULL CHECK(decision IN ('accept', 'correct')),
  status TEXT NOT NULL CHECK(status IN ('active', 'retracted')),
  batch_id TEXT NOT NULL,
  reviewer TEXT NOT NULL CHECK(length(trim(reviewer)) > 0),
  contained_by_annotation_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(proposal_id) REFERENCES source_atom_proposals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(contained_by_annotation_id) REFERENCES annotations(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS source_atom_reviews_one_active
  ON source_atom_reviews(span_id, kind) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS source_atom_reviews_proposal
  ON source_atom_reviews(proposal_id, status);

CREATE TABLE IF NOT EXISTS family_candidates (
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

CREATE INDEX IF NOT EXISTS family_candidates_state_role
  ON family_candidates(state, role, id);

CREATE TABLE IF NOT EXISTS family_candidate_evidence (
  id INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL,
  span_id INTEGER NOT NULL,
  source_hash TEXT NOT NULL CHECK(length(source_hash) = 64),
  proposal_id INTEGER,
  verdict TEXT NOT NULL CHECK(verdict IN ('suggested', 'supports', 'counterexample', 'insufficient')),
  explanation TEXT,
  model_run_id INTEGER,
  reviewer TEXT,
  batch_id TEXT,
  supersedes_evidence_id INTEGER,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  CHECK(verdict = 'suggested' OR (reviewer IS NOT NULL AND batch_id IS NOT NULL AND length(trim(coalesce(explanation, ''))) > 0)),
  FOREIGN KEY(candidate_id) REFERENCES family_candidates(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(proposal_id) REFERENCES proposals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(model_run_id) REFERENCES model_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(supersedes_evidence_id) REFERENCES family_candidate_evidence(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS family_candidate_evidence_one_suggestion
  ON family_candidate_evidence(candidate_id, span_id) WHERE verdict = 'suggested' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS family_candidate_evidence_candidate
  ON family_candidate_evidence(candidate_id, span_id, revoked_at, id);
`;

/** Tables added by this extension; each advances the data epoch like every other table. */
export const EXTENSION_TABLES = [
  "source_atom_proposals", "source_atom_reviews", "family_candidates", "family_candidate_evidence",
] as const;
