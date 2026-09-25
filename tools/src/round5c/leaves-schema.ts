/** DDL for leaf surfaces, kept free of imports so the database module can load it first. */
export const LEAVES_SCHEMA = `
CREATE TABLE IF NOT EXISTS leaf_surfaces (
  id INTEGER PRIMARY KEY,
  normalized_surface TEXT NOT NULL CHECK(length(trim(normalized_surface)) > 0),
  fingerprint_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'retired')),
  batch_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(fingerprint_id) REFERENCES fingerprints(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS leaf_surfaces_one_meaning
  ON leaf_surfaces(normalized_surface) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS leaf_surfaces_fingerprint_lookup ON leaf_surfaces(fingerprint_id, status);
`;

export const LEAVES_TABLES = ["leaf_surfaces"] as const;
