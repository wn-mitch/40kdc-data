-- Live-room lease for doc-bound rooms. A room claims it in the same UPDATE
-- it hydrates from, renews it while active, and clears it on shutdown; a
-- snapshot PUT only writes while it is NULL or expired, so a PUT can never
-- land after a room loaded the doc. Expiry (room TTL + slack) frees the lease
-- of a room that died without clearing it. A later table rebuild (e.g. to
-- widen the kind CHECK) must carry this column like the share tokens.
ALTER TABLE documents ADD COLUMN live_until INTEGER;
