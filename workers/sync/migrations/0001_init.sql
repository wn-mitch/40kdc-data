-- Cloud-synced documents (patron feature). `payload` is canonical JSON text;
-- `kind` discriminates the consuming app. `owner` is the entitlement token's
-- sub: a Patreon user id or "key:<label>" (everyone holding that access key
-- shares the namespace — keys are personally distributed).
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('list', 'team-plan', 'sb-save')),
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX documents_owner ON documents (owner, kind, updated_at DESC);

-- Shortlinks: a patron-minted code anyone can resolve to a stored snapshot.
-- Codes use the spoken-friendly alphabet (no 0/O/1/I/L), 8 chars.
CREATE TABLE shortlinks (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('list', 'team-plan', 'sb-save')),
  payload TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX shortlinks_owner ON shortlinks (owner);
