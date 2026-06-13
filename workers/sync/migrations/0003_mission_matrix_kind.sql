-- Admit Mission Matrix cloud saves (the WTC scoresheet) as a new `kind`.
-- SQLite can't widen a CHECK constraint in place, so rebuild both tables,
-- preserving every column, row, and index. (0002 added the share-token columns
-- to `documents`, so they're carried here too.)

CREATE TABLE documents_new (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('list', 'team-plan', 'sb-save', 'mission-matrix')),
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  editor_token TEXT,
  viewer_token TEXT
);
INSERT INTO documents_new (id, owner, kind, name, payload, created_at, updated_at, editor_token, viewer_token)
  SELECT id, owner, kind, name, payload, created_at, updated_at, editor_token, viewer_token FROM documents;
DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
CREATE INDEX documents_owner ON documents (owner, kind, updated_at DESC);

CREATE TABLE shortlinks_new (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('list', 'team-plan', 'sb-save', 'mission-matrix')),
  payload TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);
INSERT INTO shortlinks_new (code, kind, payload, owner, created_at, hits)
  SELECT code, kind, payload, owner, created_at, hits FROM shortlinks;
DROP TABLE shortlinks;
ALTER TABLE shortlinks_new RENAME TO shortlinks;
CREATE INDEX shortlinks_owner ON shortlinks (owner);
