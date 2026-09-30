import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { HUMAN_REVIEWERS, isMachineReviewer, propagatedAuthority, type Authority } from "./authority.js";
import { leafSurfaceKey } from "./matching.js";

/**
 * One-time migration that gives every semantic row an evidence-backed authority. Before it, every
 * annotation read `authority_kind = 'human'` whoever wrote it, so pipeline and pilot confirmations
 * counted as Will's. Classification follows the row's own evidence, never a blanket rule:
 *
 * - a row a family-version migration wrote inherits the authority of the row it supersedes;
 * - a row a pipeline or model reviewer wrote is `machine`;
 * - a row a surface propagated (`origin = 'leaf-surface'`) is `derived` when the surface in force
 *   when it was written was founded by a human, `machine` otherwise, and links that surface;
 * - any other row by a human reviewer name is `human`;
 * - anything else is `machine` and listed under `flagged` in the audit.
 *
 * A surface is `human` when its founding batch was a human reviewer's, or (for surfaces the
 * `migration-leaf-surfaces` backfill created) when a direct human decision on that wording exists.
 * Machine batches never decide proposals: their proposal and structural decisions return to
 * pending so Will reviews them. The audit lands in the migration batch's metadata.
 */

type BatchRow = { id: string; operation: string; reviewer: string };
type AnnotationRow = {
  id: number; span_id: number; fingerprint_id: string; status: string; origin: string; authority_kind: string | null;
  confirmed_by: string; batch_id: string; supersedes_id: number | null; created_at: string; exact_text: string;
};
type SurfaceRow = { id: number; normalized_surface: string; fingerprint_id: string; status: string; batch_id: string; created_at: string };

type Classified = { authority: Authority; surface_id: number | null; flag?: string };

export type AuthorityAudit = {
  annotations: Array<{ reviewer: string; operation: string; origin: string; authority: Authority; active: number; total: number }>;
  surfaces: Array<{ id: number; surface: string; status: string; authority: "human" | "machine"; evidence: string; authorizing_annotation_id: number | null }>;
  flagged: Array<{ annotation_id: number; reason: string }>;
  reverted: { proposals: number; atom_proposals: number; atom_reviews: number };
};

const PROPOSAL_REVERT: Record<string, { expected: string; restore: string }> = {
  "proposal-accepted": { expected: "accepted", restore: "pending" },
  "proposal-accepted-unresolved": { expected: "accepted", restore: "unresolved" },
  "proposal-rejected": { expected: "rejected", restore: "pending" },
  "proposal-rejected-unresolved": { expected: "rejected", restore: "unresolved" },
  "proposal-corrected": { expected: "corrected", restore: "pending" },
  "proposal-corrected-unresolved": { expected: "corrected", restore: "unresolved" },
  "connective-accepted": { expected: "accepted", restore: "pending" },
};
const ATOM_REVERT: Record<string, string> = { "atom-accepted": "accepted", "atom-corrected": "corrected", "atom-rejected": "rejected" };

function tableSql(db: DatabaseSync, name: string): string | undefined {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql: string } | undefined)?.sql;
}

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

/** Whether this database still predates recorded authority. */
export function needsAuthorityMigration(db: DatabaseSync): boolean {
  const sql = tableSql(db, "annotations");
  return sql !== undefined && !sql.includes("'derived'");
}

function classify(db: DatabaseSync): { annotations: Map<number, Classified>; surfaces: Map<number, AuthorityAudit["surfaces"][number]>; batches: Map<string, BatchRow>; rows: AnnotationRow[] } {
  const batches = new Map((db.prepare("SELECT id, operation, reviewer FROM annotation_batches").all() as BatchRow[]).map((row) => [row.id, row]));
  const hasAuthority = columns(db, "annotations").has("authority_kind");
  const rows = db.prepare(`
    SELECT annotations.id, annotations.span_id, annotations.fingerprint_id, annotations.status, annotations.origin,
      ${hasAuthority ? "annotations.authority_kind" : "NULL AS authority_kind"}, annotations.confirmed_by, annotations.batch_id,
      annotations.supersedes_id, annotations.created_at, source_spans.exact_text
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id ORDER BY annotations.id
  `).all() as AnnotationRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const surfaceRows = tableSql(db, "leaf_surfaces")
    ? db.prepare("SELECT id, normalized_surface, fingerprint_id, status, batch_id, created_at FROM leaf_surfaces ORDER BY id").all() as SurfaceRow[]
    : [];

  const reviewerOf = (batchId: string): string => batches.get(batchId)?.reviewer ?? "";
  const operationOf = (batchId: string): string => batches.get(batchId)?.operation ?? "";
  const isMigration = (row: AnnotationRow): boolean => operationOf(row.batch_id).startsWith("migration-");

  // Direct human decisions (not surface propagation), followed back through migration copies.
  const rootOf = (row: AnnotationRow): AnnotationRow => {
    let current = row;
    for (let depth = 0; depth < 64 && isMigration(current) && current.supersedes_id !== null; depth += 1) {
      const previous = byId.get(current.supersedes_id);
      if (!previous) break;
      current = previous;
    }
    return current;
  };
  const directHuman = new Map<string, number>();
  for (const row of rows) {
    const root = rootOf(row);
    if (root.origin === "leaf-surface" || isMigration(root)) continue;
    const reviewer = reviewerOf(root.batch_id);
    if (!HUMAN_REVIEWERS.has(reviewer)) continue;
    const key = leafSurfaceKey(row.exact_text);
    if (key && !directHuman.has(key)) directHuman.set(key, root.id);
  }

  const surfaces = new Map<number, AuthorityAudit["surfaces"][number]>();
  for (const surface of surfaceRows) {
    const reviewer = reviewerOf(surface.batch_id);
    const operation = operationOf(surface.batch_id);
    let authority: "human" | "machine" = "machine";
    let evidence: string;
    let authorizing: number | null = null;
    if (isMachineReviewer(reviewer)) evidence = `founded by machine reviewer ${reviewer}`;
    else if (HUMAN_REVIEWERS.has(reviewer) && !operation.startsWith("migration-")) {
      authority = "human";
      evidence = `founded by ${reviewer} (${operation})`;
    } else if (operation === "migration-leaf-surfaces" && directHuman.has(surface.normalized_surface)) {
      authority = "human";
      authorizing = directHuman.get(surface.normalized_surface)!;
      evidence = `backfilled from human annotation ${authorizing}`;
    } else evidence = `founded by ${reviewer || "unknown"} (${operation || "unknown"}) with no direct human decision on this wording`;
    surfaces.set(surface.id, { id: surface.id, surface: surface.normalized_surface, status: surface.status, authority, evidence, authorizing_annotation_id: authorizing });
  }
  const surfacesByKey = new Map<string, SurfaceRow[]>();
  for (const surface of surfaceRows) {
    const list = surfacesByKey.get(surface.normalized_surface) ?? [];
    list.push(surface);
    surfacesByKey.set(surface.normalized_surface, list);
  }
  /** The surface for this wording in force when the row was written (latest created at or before it). */
  const surfaceFor = (row: AnnotationRow): SurfaceRow | undefined => {
    const candidates = surfacesByKey.get(leafSurfaceKey(row.exact_text)) ?? [];
    const before = candidates.filter((surface) => surface.created_at <= row.created_at);
    return (before.length > 0 ? before : candidates).at(-1);
  };

  const memo = new Map<number, Classified>();
  const classifyRow = (row: AnnotationRow, depth = 0): Classified => {
    const cached = memo.get(row.id);
    if (cached) return cached;
    let result: Classified;
    const reviewer = reviewerOf(row.batch_id);
    if (isMigration(row) && row.supersedes_id !== null && byId.has(row.supersedes_id) && depth < 64) {
      result = { ...classifyRow(byId.get(row.supersedes_id)!, depth + 1) };
    } else if (row.origin === "leaf-surface") {
      const surface = surfaceFor(row);
      if (!surface) result = { authority: "machine", surface_id: null, flag: "surface-propagated row with no matching surface" };
      else if (isMachineReviewer(reviewer)) result = { authority: "machine", surface_id: surface.id };
      else result = { authority: propagatedAuthority(surfaces.get(surface.id)!.authority), surface_id: surface.id };
    } else if (isMachineReviewer(reviewer)) result = { authority: "machine", surface_id: null };
    else if (HUMAN_REVIEWERS.has(reviewer)) result = { authority: "human", surface_id: null };
    else result = { authority: "machine", surface_id: null, flag: `written by ${reviewer || "unknown"} (${operationOf(row.batch_id) || "unknown"}) with no human evidence` };
    memo.set(row.id, result);
    return result;
  };
  for (const row of rows) classifyRow(row);
  return { annotations: memo, surfaces, batches, rows };
}

function revertMachineDecisions(db: DatabaseSync, batches: Map<string, BatchRow>, batchId: string): AuthorityAudit["reverted"] {
  const machineBatches = [...batches.values()].filter((batch) => isMachineReviewer(batch.reviewer)).map((batch) => batch.id);
  const reverted = { proposals: 0, atom_proposals: 0, atom_reviews: 0 };
  if (machineBatches.length === 0) return reverted;
  const member = db.prepare("INSERT OR IGNORE INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)");
  const members = db.prepare(`SELECT entity_kind, entity_id FROM batch_members WHERE batch_id IN (${machineBatches.map(() => "?").join(",")})`)
    .all(...machineBatches) as Array<{ entity_kind: string; entity_id: string }>;
  const hasAtoms = tableSql(db, "source_atom_proposals") !== undefined;
  for (const { entity_kind: kind, entity_id: id } of members) {
    const proposal = PROPOSAL_REVERT[kind];
    if (proposal) {
      const changed = db.prepare("UPDATE proposals SET status = ? WHERE id = ? AND status = ?").run(proposal.restore, Number(id), proposal.expected);
      if (changed.changes === 1) {
        if (kind === "connective-accepted") db.prepare("UPDATE proposals SET reason_json = json_remove(reason_json, '$.reviewed_relation') WHERE id = ?").run(Number(id));
        member.run(batchId, "proposal-returned-to-review", id);
        reverted.proposals += 1;
      }
      continue;
    }
    if (!hasAtoms) continue;
    const atom = ATOM_REVERT[kind];
    if (atom) {
      const changed = db.prepare("UPDATE source_atom_proposals SET status = 'pending' WHERE id = ? AND status = ?").run(Number(id), atom);
      if (changed.changes === 1) { member.run(batchId, "atom-proposal-returned-to-review", id); reverted.atom_proposals += 1; }
    } else if (kind === "atom-review") {
      const changed = db.prepare("UPDATE source_atom_reviews SET status = 'retracted' WHERE id = ? AND status = 'active'").run(Number(id));
      if (changed.changes === 1) { member.run(batchId, "atom-review-retracted", id); reverted.atom_reviews += 1; }
    }
  }
  return reverted;
}

const ANNOTATIONS_DDL = `
CREATE TABLE annotations_new (
  id INTEGER PRIMARY KEY,
  span_id INTEGER NOT NULL,
  fingerprint_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'retracted', 'superseded')),
  origin TEXT NOT NULL CHECK(length(trim(origin)) > 0),
  authority_kind TEXT NOT NULL CHECK(authority_kind IN ('human', 'derived', 'machine')),
  confirmed_by TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  supersedes_id INTEGER,
  derived_from_surface_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(span_id) REFERENCES source_spans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(fingerprint_id) REFERENCES fingerprints(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(supersedes_id) REFERENCES annotations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(derived_from_surface_id) REFERENCES leaf_surfaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT`;

const SURFACES_DDL = `
CREATE TABLE leaf_surfaces_new (
  id INTEGER PRIMARY KEY,
  normalized_surface TEXT NOT NULL CHECK(length(trim(normalized_surface)) > 0),
  fingerprint_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'retired')),
  authority_kind TEXT NOT NULL CHECK(authority_kind IN ('human', 'machine')),
  authorizing_annotation_id INTEGER,
  batch_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(fingerprint_id) REFERENCES fingerprints(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(authorizing_annotation_id) REFERENCES annotations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT`;

const GAPS_DDL = `
CREATE TABLE gaps_new (
  id INTEGER PRIMARY KEY,
  ability_version_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('LEAF_GAP', 'RELATION_GAP', 'COMPOSITION_GAP', 'DSL_GAP', 'SOURCE_AMBIGUITY')),
  status TEXT NOT NULL CHECK(status IN ('open', 'resolved')),
  description TEXT NOT NULL CHECK(length(trim(description)) > 0),
  batch_id TEXT,
  proposal_id INTEGER,
  FOREIGN KEY(ability_version_id) REFERENCES abilities(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES annotation_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(proposal_id) REFERENCES proposals(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT`;

/** Indexes the migration's rebuilt tables need; also run on fresh databases. */
export const AUTHORITY_INDEXES = `
CREATE INDEX IF NOT EXISTS annotations_active_span_fingerprint_lookup ON annotations(span_id, fingerprint_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS annotations_derived_from_surface ON annotations(derived_from_surface_id) WHERE derived_from_surface_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leaf_surfaces_one_meaning ON leaf_surfaces(normalized_surface) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS leaf_surfaces_fingerprint_lookup ON leaf_surfaces(fingerprint_id, status);
CREATE INDEX IF NOT EXISTS gaps_type_status_lookup ON gaps(type, status, ability_version_id);
CREATE INDEX IF NOT EXISTS gaps_proposal_lookup ON gaps(proposal_id) WHERE proposal_id IS NOT NULL;
`;

/**
 * Rebuild annotations, leaf_surfaces and gaps with recorded authority. Runs outside any
 * transaction (the foreign_keys pragma only takes effect there) and checks every foreign key
 * before committing. Returns the audit, or null when the database is already migrated.
 */
export function upgradeAuthority(db: DatabaseSync): AuthorityAudit | null {
  if (!needsAuthorityMigration(db)) return null;
  if (!columns(db, "annotation_batches").has("metadata_json")) {
    db.exec("ALTER TABLE annotation_batches ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))");
  }
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const { annotations, surfaces, batches, rows } = classify(db);
      const batchId = `migration_${randomUUID()}`;
      db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at, metadata_json) VALUES (?, 'migration-authority', 'system', ?, '{}')")
        .run(batchId, new Date().toISOString());
      const reverted = revertMachineDecisions(db, batches, batchId);

      db.exec(ANNOTATIONS_DDL);
      const insert = db.prepare(`
        INSERT INTO annotations_new (id, span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, derived_from_surface_id, created_at)
        SELECT id, span_id, fingerprint_id, status, origin, ?, confirmed_by, batch_id, supersedes_id, ?, created_at FROM annotations WHERE id = ?
      `);
      for (const row of rows) {
        const classified = annotations.get(row.id)!;
        insert.run(classified.authority, classified.surface_id, row.id);
      }
      db.exec("DROP TABLE annotations; ALTER TABLE annotations_new RENAME TO annotations;");

      if (tableSql(db, "leaf_surfaces")) {
        db.exec(SURFACES_DDL);
        const insertSurface = db.prepare(`
          INSERT INTO leaf_surfaces_new (id, normalized_surface, fingerprint_id, status, authority_kind, authorizing_annotation_id, batch_id, created_at)
          SELECT id, normalized_surface, fingerprint_id, status, ?, ?, batch_id, created_at FROM leaf_surfaces WHERE id = ?
        `);
        for (const surface of surfaces.values()) insertSurface.run(surface.authority, surface.authorizing_annotation_id, surface.id);
        db.exec("DROP TABLE leaf_surfaces; ALTER TABLE leaf_surfaces_new RENAME TO leaf_surfaces;");
      }

      if (tableSql(db, "gaps")) {
        const gapColumns = columns(db, "gaps");
        db.exec(GAPS_DDL);
        db.exec(`INSERT INTO gaps_new (id, ability_version_id, type, status, description, batch_id, proposal_id)
          SELECT id, ability_version_id, type, status, description, batch_id, ${gapColumns.has("proposal_id") ? "proposal_id" : "NULL"} FROM gaps`);
        db.exec("DROP TABLE gaps; ALTER TABLE gaps_new RENAME TO gaps;");
      }
      db.exec(AUTHORITY_INDEXES);

      const audit = buildAudit(rows, annotations, surfaces, batches, reverted);
      db.prepare("UPDATE annotation_batches SET metadata_json = ? WHERE id = ?").run(JSON.stringify({ authority_audit: audit }), batchId);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length > 0) throw new Error(`The authority migration broke ${violations.length} foreign key reference(s).`);
      db.exec("COMMIT");
      return audit;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function buildAudit(
  rows: AnnotationRow[], annotations: Map<number, Classified>, surfaces: Map<number, AuthorityAudit["surfaces"][number]>,
  batches: Map<string, BatchRow>, reverted: AuthorityAudit["reverted"],
): AuthorityAudit {
  const groups = new Map<string, AuthorityAudit["annotations"][number]>();
  const flagged: AuthorityAudit["flagged"] = [];
  for (const row of rows) {
    const batch = batches.get(row.batch_id);
    const classified = annotations.get(row.id)!;
    const key = [batch?.reviewer ?? "", batch?.operation ?? "", row.origin, classified.authority].join("\u0000");
    const group = groups.get(key) ?? { reviewer: batch?.reviewer ?? "", operation: batch?.operation ?? "", origin: row.origin, authority: classified.authority, active: 0, total: 0 };
    group.total += 1;
    if (row.status === "active") group.active += 1;
    groups.set(key, group);
    if (classified.flag && row.status === "active") flagged.push({ annotation_id: row.id, reason: classified.flag });
  }
  return {
    annotations: [...groups.values()].sort((left, right) => left.reviewer.localeCompare(right.reviewer) || left.operation.localeCompare(right.operation) || left.origin.localeCompare(right.origin) || left.authority.localeCompare(right.authority)),
    surfaces: [...surfaces.values()],
    flagged,
    reverted,
  };
}

/** The audit the authority migration recorded, if this database was migrated. */
export function authorityAudit(db: DatabaseSync): AuthorityAudit | null {
  const row = db.prepare("SELECT metadata_json FROM annotation_batches WHERE operation = 'migration-authority' ORDER BY created_at DESC LIMIT 1").get() as { metadata_json: string } | undefined;
  return row ? (JSON.parse(row.metadata_json) as { authority_audit: AuthorityAudit }).authority_audit : null;
}
