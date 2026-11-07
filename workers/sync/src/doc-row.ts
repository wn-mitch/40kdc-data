/**
 * D1 access for a doc-bound DocRoom's backing row. Two fences keep a live room
 * and snapshot PUTs from overwriting each other:
 *
 *  - the LEASE (`live_until`, migration 0005): claimed in the statement the
 *    room loads the doc from, renewed while the room is active, cleared at
 *    shutdown. PUT /docs/:id writes only while it is NULL or expired.
 *  - the VERSION (`updated_at`): every room write is conditional on the
 *    version the room last read or wrote, so a write that reached the row
 *    anyway (an expired lease during a long outage) is detected rather than
 *    overwritten. `version` null means the room predates version tracking;
 *    its next write is unconditional and starts tracking.
 */

export interface LiveRow {
  kind: string;
  name: string;
  payload: string;
  updated_at: number;
}

/** Claim the lease and read the doc in one statement. Null: no such row. */
export function claimLease(db: D1Database, docId: string, until: number): Promise<LiveRow | null> {
  return db
    .prepare(
      "UPDATE documents SET live_until = ? WHERE id = ? RETURNING kind, name, payload, updated_at",
    )
    .bind(until, docId)
    .first<LiveRow>();
}

/** Write the room's doc and renew the lease if the row is still at `version`.
 *  Returns the new version, or null when the row changed or is gone. */
export async function persistRow(
  db: D1Database,
  docId: string,
  doc: string | null,
  until: number,
  version: number | null,
): Promise<number | null> {
  const row = await db
    .prepare(
      "UPDATE documents SET payload = ?, updated_at = MAX(?, updated_at + 1), live_until = ? " +
        "WHERE id = ? AND (? IS NULL OR updated_at = ?) RETURNING updated_at",
    )
    .bind(doc, Date.now(), until, docId, version, version)
    .first<{ updated_at: number }>();
  return row?.updated_at ?? null;
}

/** Renew the lease if the row is still at `version`. Returns the row's
 *  version, or null when the row changed or is gone. */
export async function renewLease(
  db: D1Database,
  docId: string,
  until: number,
  version: number | null,
): Promise<number | null> {
  const row = await db
    .prepare(
      "UPDATE documents SET live_until = ? WHERE id = ? AND (? IS NULL OR updated_at = ?) RETURNING updated_at",
    )
    .bind(until, docId, version, version)
    .first<{ updated_at: number }>();
  return row?.updated_at ?? null;
}

/** Drop the lease at shutdown. Best effort: an uncleared lease expires. */
export async function clearLease(db: D1Database, docId: string): Promise<void> {
  try {
    await db.prepare("UPDATE documents SET live_until = NULL WHERE id = ?").bind(docId).run();
  } catch {
    /* the lease expires on its own */
  }
}
