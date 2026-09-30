/** DDL for leaf surfaces, kept free of imports so the database module can load it first. */
export const LEAVES_SCHEMA = `
CREATE TABLE IF NOT EXISTS leaf_surfaces (
  id INTEGER PRIMARY KEY,
  normalized_surface TEXT NOT NULL CHECK(length(trim(normalized_surface)) > 0),
  fingerprint_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'retired')),
  -- human: founded by Will's decision; machine: founded by a model or pipeline (authority.ts).
  authority_kind TEXT NOT NULL CHECK(authority_kind IN ('human', 'machine')),
  -- The human annotation a backfilled surface was founded on, when it was not a direct decision.
  authorizing_annotation_id INTEGER,
  batch_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Where the decision holds (surface-scope.ts); NULL: an unscoped surface, applied everywhere.
  scope_json TEXT CHECK(scope_json IS NULL OR json_valid(scope_json)),
  FOREIGN KEY(fingerprint_id) REFERENCES fingerprints(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(authorizing_annotation_id) REFERENCES annotations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS leaf_surfaces_one_meaning
  ON leaf_surfaces(normalized_surface) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS leaf_surfaces_fingerprint_lookup ON leaf_surfaces(fingerprint_id, status);
`;

export const LEAVES_TABLES = ["leaf_surfaces"] as const;

/**
 * Leaf proposals and the sentence vectors behind them. These are derived, rebuildable state:
 * outside the data epoch, so a proposal run never invalidates coverage caches or the review.
 */
export const LEAF_PROPOSALS_SCHEMA = `
CREATE TABLE IF NOT EXISTS span_signals (
  id INTEGER PRIMARY KEY,
  span_id INTEGER NOT NULL,
  -- Which signal: jev-family, jev-parameters, deepseek, knn, exact-surface, prefill, ...
  source TEXT NOT NULL CHECK(length(trim(source)) > 0),
  family_id TEXT,
  family_version INTEGER,
  rank INTEGER,
  score REAL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  model_run_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;
CREATE INDEX IF NOT EXISTS span_signals_span ON span_signals(span_id, source);

CREATE TABLE IF NOT EXISTS text_embeddings (
  model TEXT NOT NULL,
  text_hash TEXT NOT NULL CHECK(length(text_hash) = 64),
  vector BLOB NOT NULL,
  PRIMARY KEY(model, text_hash)
) STRICT;

CREATE TABLE IF NOT EXISTS leaf_proposal_runs (
  id INTEGER PRIMARY KEY,
  model TEXT NOT NULL,
  settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
  status TEXT NOT NULL CHECK(status IN ('running', 'finished', 'failed')),
  counts_json TEXT CHECK(counts_json IS NULL OR json_valid(counts_json)),
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS leaf_proposals (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES leaf_proposal_runs(id) ON DELETE CASCADE,
  cluster INTEGER NOT NULL,
  surface TEXT NOT NULL,
  sample_text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('direct', 'decomposition', 'partial', 'llm', 'new-family', 'unlabelled')),
  pieces_json TEXT NOT NULL CHECK(json_valid(pieces_json) AND json_type(pieces_json) = 'array'),
  confidence REAL NOT NULL,
  occurrences INTEGER NOT NULL,
  closes INTEGER NOT NULL,
  dropped_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(dropped_json)),
  status TEXT NOT NULL CHECK(status IN ('open', 'dismissed')),
  model_run_id INTEGER,
  UNIQUE(run_id, surface)
) STRICT;

CREATE INDEX IF NOT EXISTS leaf_proposals_run_cluster ON leaf_proposals(run_id, cluster);
`;

/**
 * Proposals are rebuildable, so a table created under an older kind list is dropped and made
 * again rather than migrated. Runs are kept; the next run refills the proposals.
 */
export const LEAF_PROPOSAL_KINDS_MARKER = "'partial'";
