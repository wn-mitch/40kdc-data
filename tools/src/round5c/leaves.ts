import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { currentFamilyVersion, exactSpan, validateFingerprint } from "./contracts.js";
import { getCurrentCoverage, type AbilityCoverage, type UncoveredInterval } from "./coverage.js";
import { bumpWorkbenchRevision, insertSpan, invalidateWholeReview, RESTATES_ACTIVE_ANNOTATION, withTransaction } from "./db.js";
import { normalizedProjection, normalizedSurface } from "./matching.js";
import { candidateChunks, ftsQuery, matchesAt } from "./retrieval.js";
import { describerGaps } from "./leaf-describer-audit.js";
import { surfaceWarnings } from "./surface-lint.js";

/**
 * Leaf surfaces: one decision per spelling. A row says "this normalized source wording means
 * this fingerprint" for the whole corpus; applying it annotates every current occurrence that
 * is not already decided otherwise. Different spellings of one meaning are several rows on one
 * fingerprint, so the fingerprint is the leaf and its surfaces are how GW writes it.
 */


/** Uncovered wording that joins leaves without meaning anything itself. */
const GLUE = new Set(["and", "as well"]);
const EDGE_PUNCTUATION = /^[\s\p{P}]+|[\s\p{P}]+$/gu;
const LEADING_GLUE = new RegExp(`^(?:${[...GLUE].join("|")})(?=[\\s\\p{P}])`, "iu");
const TRAILING_GLUE = new RegExp(`(?<=[\\s\\p{P}])(?:${[...GLUE].join("|")})$`, "iu");

/** Uncovered wording without edge punctuation or edge joining words: the part a leaf would name. */
function runText(text: string): string {
  let current = text.replace(EDGE_PUNCTUATION, "");
  for (;;) {
    const next = current.replace(LEADING_GLUE, "").replace(TRAILING_GLUE, "").replace(EDGE_PUNCTUATION, "");
    if (next === current) return current;
    current = next;
  }
}

export class LeafError extends Error {
  readonly status: number;

  constructor(status: 404 | 409 | 422, message: string) {
    super(message);
    this.name = "LeafError";
    this.status = status;
  }
}

/** The surface key of source wording: normalized, without edge punctuation. */
export function leafSurface(text: string): string {
  return normalizedSurface(text.replace(EDGE_PUNCTUATION, ""));
}

/** Uncovered runs that still need a leaf: everything except punctuation and glue words. */
export function untiledRuns(coverage: AbilityCoverage): UncoveredInterval[] {
  return coverage.uncovered.filter((run) => {
    const surface = leafSurface(runText(run.text));
    return surface.length > 0 && !GLUE.has(surface);
  });
}

export type SurfaceRow = { id: number; normalized_surface: string; fingerprint_id: string; status: string; batch_id: string };

type Fingerprint = { id: string; family_id: string; family_version: number; role: string; parameters: Record<string, unknown> };

export type ApplyReport = {
  applied: number;
  already: number;
  blocked: Array<{ ability_version_id: number; faction_id: string; ability_id: string; exact_text: string; reason: "OTHER_LEAF_HERE" | "REJECTED_HERE" }>;
};

function fingerprintRow(db: DatabaseSync, id: string): Fingerprint {
  const row = db.prepare(`
    SELECT fingerprints.id, fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json, semantic_families.role
    FROM fingerprints JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version
    WHERE fingerprints.id = ?
  `).get(id) as { id: string; family_id: string; family_version: number; parameters_json: string; role: string } | undefined;
  if (!row) throw new LeafError(404, `Unknown fingerprint ${id}.`);
  return { id: row.id, family_id: row.family_id, family_version: row.family_version, role: row.role, parameters: JSON.parse(row.parameters_json) as Record<string, unknown> };
}

function newBatch(db: DatabaseSync, reviewer: string, metadata: Record<string, unknown> = {}): string {
  const id = `batch_${randomUUID()}`;
  db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at, metadata_json) VALUES (?, 'review', ?, ?, ?)")
    .run(id, reviewer, new Date().toISOString(), JSON.stringify(metadata));
  return id;
}

function addMember(db: DatabaseSync, batchId: string, kind: string, id: number | string): void {
  db.prepare("INSERT OR IGNORE INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)").run(batchId, kind, String(id));
}

type Occurrence = { ability_version_id: number; faction_id: string; ability_id: string; fragment: string; start_byte: number; end_byte: number; exact_text: string };

/** Every current occurrence of a surface: the lexical scan plus pending proposals with that exact wording. */
export function surfaceOccurrences(db: DatabaseSync, surface: string, abilityVersionIds?: ReadonlySet<number>): Occurrence[] {
  const found = new Map<string, Occurrence>();
  const add = (occurrence: Occurrence) => {
    if (abilityVersionIds && !abilityVersionIds.has(occurrence.ability_version_id)) return;
    found.set(`${occurrence.ability_version_id}:${occurrence.fragment}:${occurrence.start_byte}:${occurrence.end_byte}`, occurrence);
  };
  const query = ftsQuery(surface);
  if (query) {
    for (const chunk of candidateChunks(db, query)) {
      const projection = normalizedProjection(exactSpan(chunk.source_text, chunk.start_byte, chunk.end_byte));
      for (const match of matchesAt(projection, surface)) {
        const start = chunk.start_byte + match.start_byte;
        const end = chunk.start_byte + match.end_byte;
        add({ ability_version_id: chunk.ability_version_id, faction_id: chunk.faction_id, ability_id: chunk.ability_id, fragment: chunk.fragment, start_byte: start, end_byte: end, exact_text: exactSpan(chunk.source_text, start, end) });
      }
    }
  }
  const proposals = db.prepare(`
    SELECT abilities.id AS ability_version_id, abilities.faction_id, abilities.ability_id, source_spans.fragment,
      source_spans.start_byte, source_spans.end_byte, source_spans.exact_text
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND proposals.status IN ('pending', 'unresolved')
  `).all() as Occurrence[];
  // Pending wording the lexical scan cannot see (for example across a clause break) still counts.
  for (const proposal of proposals) if (normalizedSurface(proposal.exact_text) === surface) add(proposal);
  return [...found.values()].sort((left, right) => left.ability_version_id - right.ability_version_id || left.start_byte - right.start_byte);
}

/**
 * Annotate every current occurrence of one active surface that nothing contradicts. An
 * occurrence already carrying this leaf is left alone; one overlapping a different active leaf,
 * or where a human rejected this meaning, is reported and not written.
 */
function applySurface(db: DatabaseSync, surface: SurfaceRow, reviewer: string, batchId: string, abilityVersionIds?: ReadonlySet<number>): ApplyReport & { touched: Set<number> } {
  const fingerprint = fingerprintRow(db, surface.fingerprint_id);
  const report: ApplyReport & { touched: Set<number> } = { applied: 0, already: 0, blocked: [], touched: new Set() };
  const overlapping = db.prepare(`
    SELECT annotations.id, annotations.origin, annotations.fingerprint_id, source_spans.start_byte, source_spans.end_byte
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.status = 'active' AND source_spans.ability_version_id = ? AND source_spans.fragment = ?
      AND source_spans.start_byte < ? AND ? < source_spans.end_byte
  `);
  const refused = db.prepare(`
    SELECT 1 FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE source_spans.ability_version_id = ? AND source_spans.fragment = ? AND source_spans.start_byte = ? AND source_spans.end_byte = ?
      AND proposals.fingerprint_id = ? AND proposals.status IN ('rejected', 'corrected')
    LIMIT 1
  `);
  const pendingHere = db.prepare(`
    SELECT proposals.id, proposals.status FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE source_spans.ability_version_id = ? AND source_spans.fragment = ? AND source_spans.start_byte = ? AND source_spans.end_byte = ?
      AND proposals.fingerprint_id = ? AND proposals.status IN ('pending', 'unresolved')
  `);
  const insert = db.prepare(`
    INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, created_at)
    VALUES (?, ?, 'active', 'leaf-surface', 'human', ?, ?, NULL, ?)
  `);
  const now = new Date().toISOString();
  for (const occurrence of surfaceOccurrences(db, surface.normalized_surface, abilityVersionIds)) {
    const args = [occurrence.ability_version_id, occurrence.fragment, occurrence.end_byte, occurrence.start_byte] as const;
    let others = overlapping.all(...args) as Array<{ id: number; origin: string; fingerprint_id: string; start_byte: number; end_byte: number }>;
    if (others.some((other) => other.fingerprint_id === fingerprint.id && other.start_byte === occurrence.start_byte && other.end_byte === occurrence.end_byte)) {
      report.already += 1;
      continue;
    }
    const blocked = (reason: ApplyReport["blocked"][number]["reason"]) => report.blocked.push({
      ability_version_id: occurrence.ability_version_id, faction_id: occurrence.faction_id, ability_id: occurrence.ability_id, exact_text: occurrence.exact_text, reason,
    });
    // Longer wording wins: a leaf another surface decision made strictly inside this occurrence
    // (for example "weapons … have [X]" inside "melee weapons … have [X]") gives way to it.
    const inside = others.filter((other) => other.origin === "leaf-surface"
      && other.start_byte >= occurrence.start_byte && other.end_byte <= occurrence.end_byte
      && other.end_byte - other.start_byte < occurrence.end_byte - occurrence.start_byte);
    if (inside.length === others.length && inside.length > 0) {
      for (const other of inside) {
        db.prepare("UPDATE annotations SET status = 'superseded' WHERE id = ? AND status = 'active'").run(other.id);
        addMember(db, batchId, "annotation-superseded-by-surface", other.id);
      }
      others = [];
    }
    if (others.length > 0) { blocked("OTHER_LEAF_HERE"); continue; }
    if (refused.get(occurrence.ability_version_id, occurrence.fragment, occurrence.start_byte, occurrence.end_byte, fingerprint.id)) { blocked("REJECTED_HERE"); continue; }
    const spanId = insertSpan(db, occurrence.ability_version_id, occurrence.fragment, occurrence.start_byte, occurrence.end_byte, occurrence.exact_text);
    const annotation = insert.run(spanId, fingerprint.id, reviewer, batchId, now);
    addMember(db, batchId, "annotation", Number(annotation.lastInsertRowid));
    for (const proposal of pendingHere.all(occurrence.ability_version_id, occurrence.fragment, occurrence.start_byte, occurrence.end_byte, fingerprint.id) as Array<{ id: number; status: string }>) {
      db.prepare("UPDATE proposals SET status = 'accepted' WHERE id = ?").run(proposal.id);
      addMember(db, batchId, proposal.status === "unresolved" ? "proposal-accepted-unresolved" : "proposal-accepted", proposal.id);
    }
    report.applied += 1;
    report.touched.add(occurrence.ability_version_id);
  }
  return report;
}

function activeSurface(db: DatabaseSync, surface: string): SurfaceRow | undefined {
  return db.prepare("SELECT id, normalized_surface, fingerprint_id, status, batch_id FROM leaf_surfaces WHERE normalized_surface = ? AND status = 'active'").get(surface) as SurfaceRow | undefined;
}

function insertSurface(db: DatabaseSync, surface: string, fingerprintId: string, batchId: string): SurfaceRow {
  const inserted = db.prepare("INSERT INTO leaf_surfaces (normalized_surface, fingerprint_id, status, batch_id, created_at) VALUES (?, ?, 'active', ?, ?)")
    .run(surface, fingerprintId, batchId, new Date().toISOString());
  addMember(db, batchId, "leaf-surface-created", Number(inserted.lastInsertRowid));
  return { id: Number(inserted.lastInsertRowid), normalized_surface: surface, fingerprint_id: fingerprintId, status: "active", batch_id: batchId };
}

function finish(db: DatabaseSync, touched: Iterable<number>): void {
  invalidateWholeReview(db, touched);
  bumpWorkbenchRevision(db);
}

function body(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new LeafError(422, "Expected a JSON object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new LeafError(422, `${label} is required.`);
  return value;
}

function meaning(db: DatabaseSync, input: Record<string, unknown>, exactText: string): Fingerprint {
  const familyId = text(input.family_id, "family_id");
  const version = input.family_version === undefined ? currentFamilyVersion(familyId) : Number(input.family_version);
  if (!input.parameters || typeof input.parameters !== "object" || Array.isArray(input.parameters)) throw new LeafError(422, "parameters must be an object.");
  try {
    return fingerprintRow(db, validateFingerprint(db, familyId, input.parameters as Record<string, unknown>, version, exactText));
  } catch (error) {
    if (error instanceof LeafError) throw error;
    throw new LeafError(422, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Decide that source wording means one leaf everywhere, then apply it corpus-wide. The wording
 * is taken exactly from a source occurrence so parameter snippets can be checked against it.
 */
export function confirmSurface(db: DatabaseSync, value: unknown): ApplyReport & { batch_id: string; surface_id: number } {
  const input = body(value);
  const reviewer = text(input.reviewer, "reviewer");
  const exactText = text(input.exact_text, "exact_text");
  const surface = leafSurface(exactText);
  if (!surface || GLUE.has(surface)) throw new LeafError(422, "A leaf needs wording beyond punctuation and joining words.");
  return withTransaction(db, () => {
    const fingerprint = meaning(db, input, exactText.replace(EDGE_PUNCTUATION, ""));
    const existing = activeSurface(db, surface);
    if (existing && existing.fingerprint_id !== fingerprint.id) {
      const current = fingerprintRow(db, existing.fingerprint_id);
      throw new LeafError(409, `"${surface}" already means ${current.family_id} ${JSON.stringify(current.parameters)}; move it to change its meaning.`);
    }
    const batchId = newBatch(db, reviewer, { action: "confirm-surface", surface });
    const row = existing ?? insertSurface(db, surface, fingerprint.id, batchId);
    const report = applySurface(db, row, reviewer, batchId);
    finish(db, report.touched);
    const { touched: _touched, ...result } = report;
    return { ...result, batch_id: batchId, surface_id: row.id };
  });
}

/** Re-apply active surfaces, for example after a source refresh brings in new text. */
export function applyLeafSurfaces(db: DatabaseSync, value: unknown): ApplyReport & { batch_id: string } {
  const input = body(value);
  const reviewer = text(input.reviewer, "reviewer");
  const ids = input.surface_ids === undefined ? null : new Set((input.surface_ids as unknown[]).map(Number));
  return withTransaction(db, () => {
    const batchId = newBatch(db, reviewer, { action: "apply-surfaces" });
    const total: ApplyReport = { applied: 0, already: 0, blocked: [] };
    const touched = new Set<number>();
    const rows = db.prepare("SELECT id, normalized_surface, fingerprint_id, status, batch_id FROM leaf_surfaces WHERE status = 'active' ORDER BY id").all() as SurfaceRow[];
    for (const row of rows) {
      if (ids && !ids.has(row.id)) continue;
      const report = applySurface(db, row, reviewer, batchId);
      total.applied += report.applied;
      total.already += report.already;
      total.blocked.push(...report.blocked);
      for (const id of report.touched) touched.add(id);
    }
    finish(db, touched);
    return { ...total, batch_id: batchId };
  });
}

/** Supersede active annotations of one fingerprint on the given spans with another fingerprint. */
function repoint(db: DatabaseSync, batchId: string, reviewer: string, from: string, to: string, surface?: string): Set<number> {
  const rows = db.prepare(`
    SELECT annotations.id, annotations.span_id, source_spans.exact_text, source_spans.ability_version_id
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.fingerprint_id = ? AND annotations.status = 'active'
  `).all(from) as Array<{ id: number; span_id: number; exact_text: string; ability_version_id: number }>;
  const touched = new Set<number>();
  const now = new Date().toISOString();
  for (const row of rows) {
    if (surface !== undefined && leafSurface(row.exact_text) !== surface) continue;
    db.prepare("UPDATE annotations SET status = 'superseded' WHERE id = ?").run(row.id);
    const inserted = db.prepare(`
      INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, created_at)
      VALUES (?, ?, 'active', 'leaf-surface', 'human', ?, ?, ?, ?)
    `).run(row.span_id, to, reviewer, batchId, row.id, now);
    addMember(db, batchId, "annotation", Number(inserted.lastInsertRowid));
    touched.add(row.ability_version_id);
  }
  return touched;
}

function retire(db: DatabaseSync, batchId: string, row: SurfaceRow): void {
  db.prepare("UPDATE leaf_surfaces SET status = 'retired' WHERE id = ? AND status = 'active'").run(row.id);
  addMember(db, batchId, "leaf-surface-retired", row.id);
}

/**
 * Give one surface a different meaning: retire it, record the new one, and move every active
 * annotation with that wording from the old leaf to the new one.
 */
export function moveSurface(db: DatabaseSync, value: unknown): ApplyReport & { batch_id: string; surface_id: number } {
  const input = body(value);
  const reviewer = text(input.reviewer, "reviewer");
  const surfaceId = Number(input.surface_id);
  return withTransaction(db, () => {
    const row = db.prepare("SELECT id, normalized_surface, fingerprint_id, status, batch_id FROM leaf_surfaces WHERE id = ?").get(surfaceId) as SurfaceRow | undefined;
    if (!row || row.status !== "active") throw new LeafError(404, `No active surface ${surfaceId}.`);
    const sample = db.prepare(`
      SELECT source_spans.exact_text FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
      WHERE annotations.fingerprint_id = ? AND annotations.status = 'active'
    `).all(row.fingerprint_id).map((item) => (item as { exact_text: string }).exact_text).find((item) => leafSurface(item) === row.normalized_surface);
    const target = meaning(db, input, (sample ?? row.normalized_surface).replace(EDGE_PUNCTUATION, ""));
    if (target.id === row.fingerprint_id) throw new LeafError(422, "The surface already has that meaning.");
    if (target.role !== fingerprintRow(db, row.fingerprint_id).role) throw new LeafError(422, "Moving a surface cannot change its role; retire it and confirm it again instead.");
    const batchId = newBatch(db, reviewer, { action: "move-surface", surface: row.normalized_surface });
    retire(db, batchId, row);
    const created = insertSurface(db, row.normalized_surface, target.id, batchId);
    const touched = repoint(db, batchId, reviewer, row.fingerprint_id, target.id, row.normalized_surface);
    const report = applySurface(db, created, reviewer, batchId);
    for (const id of report.touched) touched.add(id);
    finish(db, touched);
    const { touched: _touched, ...result } = report;
    return { ...result, batch_id: batchId, surface_id: created.id };
  });
}

/** Two fingerprints mean the same thing: move every surface and annotation of `from` onto `to`. */
export function mergeFingerprints(db: DatabaseSync, value: unknown): { batch_id: string; surfaces: number; annotations: number } {
  const input = body(value);
  const reviewer = text(input.reviewer, "reviewer");
  const from = fingerprintRow(db, text(input.from_fingerprint_id, "from_fingerprint_id"));
  const to = fingerprintRow(db, text(input.to_fingerprint_id, "to_fingerprint_id"));
  if (from.id === to.id) throw new LeafError(422, "Choose two different leaves to merge.");
  if (from.role !== to.role) throw new LeafError(422, "Only leaves with the same role can be merged.");
  return withTransaction(db, () => {
    const batchId = newBatch(db, reviewer, { action: "merge", from: from.id, to: to.id });
    const surfaces = db.prepare("SELECT id, normalized_surface, fingerprint_id, status, batch_id FROM leaf_surfaces WHERE fingerprint_id = ? AND status = 'active'").all(from.id) as SurfaceRow[];
    for (const row of surfaces) {
      retire(db, batchId, row);
      insertSurface(db, row.normalized_surface, to.id, batchId);
    }
    const touched = repoint(db, batchId, reviewer, from.id, to.id);
    for (const proposal of db.prepare("SELECT id FROM proposals WHERE fingerprint_id = ? AND status IN ('pending', 'unresolved')").all(from.id) as Array<{ id: number }>) {
      db.prepare("UPDATE proposals SET fingerprint_id = ? WHERE id = ?").run(to.id, proposal.id);
      addMember(db, batchId, "proposal-repointed", proposal.id);
    }
    // The merged-away leaf stops accepting decisions; undo restores it.
    db.prepare("UPDATE fingerprints SET status = 'superseded' WHERE id = ? AND status = 'active'").run(from.id);
    addMember(db, batchId, "fingerprint-superseded", from.id);
    finish(db, touched);
    return { batch_id: batchId, surfaces: surfaces.length, annotations: [...touched].length };
  });
}

/** Stop applying a surface. Annotations it already made stay; undo their batch to remove them. */
export function retireSurface(db: DatabaseSync, value: unknown): { batch_id: string } {
  const input = body(value);
  const reviewer = text(input.reviewer, "reviewer");
  const surfaceId = Number(input.surface_id);
  return withTransaction(db, () => {
    const row = db.prepare("SELECT id, normalized_surface, fingerprint_id, status, batch_id FROM leaf_surfaces WHERE id = ?").get(surfaceId) as SurfaceRow | undefined;
    if (!row || row.status !== "active") throw new LeafError(404, `No active surface ${surfaceId}.`);
    const batchId = newBatch(db, reviewer, { action: "retire-surface", surface: row.normalized_surface });
    retire(db, batchId, row);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId };
  });
}

/** Refuse an undo whose surface rows were changed by a later decision. */
export function assertLeafUndo(db: DatabaseSync, batchId: string, members: ReadonlyArray<{ entity_kind: string; entity_id: string }>): void {
  const merge = mergeMetadata(db, batchId);
  for (const member of members) {
    if (member.entity_kind === "annotation-superseded-by-surface") {
      const row = db.prepare("SELECT status FROM annotations WHERE id = ?").get(Number(member.entity_id)) as { status: string } | undefined;
      if (row?.status !== "superseded") throw new LeafError(409, "This batch cannot restore a shorter leaf that was later changed.");
    }
    if (member.entity_kind === "proposal-repointed" && merge) {
      const row = db.prepare("SELECT fingerprint_id FROM proposals WHERE id = ?").get(Number(member.entity_id)) as { fingerprint_id: string | null } | undefined;
      if (row?.fingerprint_id !== merge.to) throw new LeafError(409, "This merge cannot be undone because a merged proposal was later changed.");
    }
  }
  const status = db.prepare("SELECT normalized_surface, status FROM leaf_surfaces WHERE id = ?");
  for (const member of members) {
    if (member.entity_kind !== "leaf-surface-created" && member.entity_kind !== "leaf-surface-retired") continue;
    const row = status.get(Number(member.entity_id)) as { normalized_surface: string; status: string } | undefined;
    const expected = member.entity_kind === "leaf-surface-created" ? "active" : "retired";
    if (!row || row.status !== expected) throw new LeafError(409, "This batch cannot be undone because one of its surfaces was later changed.");
  }
}

function mergeMetadata(db: DatabaseSync, batchId: string): { from: string; to: string } | null {
  const row = db.prepare("SELECT metadata_json FROM annotation_batches WHERE id = ?").get(batchId) as { metadata_json: string } | undefined;
  const metadata = row ? JSON.parse(row.metadata_json) as { action?: string; from?: string; to?: string } : {};
  return metadata.action === "merge" && metadata.from && metadata.to ? { from: metadata.from, to: metadata.to } : null;
}

/** Reverse surface rows: created ones retire, retired ones return (created ones first, so a move swaps back). */
export function applyLeafUndo(db: DatabaseSync, batchId: string, reversalId: string, members: ReadonlyArray<{ entity_kind: string; entity_id: string }>): void {
  for (const member of members.filter((item) => item.entity_kind === "annotation-superseded-by-surface")) {
    db.prepare("UPDATE annotations SET status = 'active' WHERE id = ? AND status = 'superseded'").run(Number(member.entity_id));
    addMember(db, reversalId, "annotation-restored", member.entity_id);
  }
  const merge = mergeMetadata(db, batchId);
  if (merge) {
    for (const member of members.filter((item) => item.entity_kind === "proposal-repointed")) {
      db.prepare("UPDATE proposals SET fingerprint_id = ? WHERE id = ? AND fingerprint_id = ?").run(merge.from, Number(member.entity_id), merge.to);
    }
    db.prepare("UPDATE fingerprints SET status = 'active' WHERE id = ? AND status = 'superseded'").run(merge.from);
  }
  for (const member of members.filter((item) => item.entity_kind === "leaf-surface-created")) {
    db.prepare("UPDATE leaf_surfaces SET status = 'retired' WHERE id = ? AND status = 'active'").run(Number(member.entity_id));
    addMember(db, reversalId, "leaf-surface-retired", member.entity_id);
  }
  for (const member of members.filter((item) => item.entity_kind === "leaf-surface-retired")) {
    const row = db.prepare("SELECT normalized_surface FROM leaf_surfaces WHERE id = ?").get(Number(member.entity_id)) as { normalized_surface: string };
    if (activeSurface(db, row.normalized_surface)) throw new LeafError(409, `"${row.normalized_surface}" has a newer meaning; undo that decision first.`);
    db.prepare("UPDATE leaf_surfaces SET status = 'active' WHERE id = ?").run(Number(member.entity_id));
    addMember(db, reversalId, "leaf-surface-restored", member.entity_id);
  }
}

export type BoardSurface = { surface_id: number | null; surface: string; sample_text: string; annotations: number; pending: number; sources: number; warnings?: string[] };
export type BoardLeaf = {
  fingerprint_id: string; family_id: string; family_version: number; role: string; parameters: Record<string, unknown>;
  retired_version: boolean; surfaces: BoardSurface[];
  /** Parameter values of this leaf that its English does not show (from the describer audit). */
  describer_gaps?: string[];
};
export type LeafBoard = {
  leaves: BoardLeaf[];
  /** Pending proposals with no meaning yet, grouped by wording. */
  unlabeled: Array<{ surface: string; sample_text: string; occurrences: number; sample_ability_version_id: number }>;
  /** Uncovered wording, ranked by how many sources become fully tiled once it is a leaf. */
  untiled: Array<{ surface: string; sample_text: string; occurrences: number; unlocks: number; sample_ability_version_id: number }>;
  totals: { current_sources: number; tiled_sources: number; sources_with_leaves: number };
};

const UNTILED_LIMIT = 60;

/** Everything the Leaves page shows, in a fixed number of corpus passes. */
export function leafBoard(db: DatabaseSync, options: { factionId?: string } = {}): LeafBoard {
  const faction = options.factionId?.trim() || null;
  const leaves = new Map<string, BoardLeaf>();
  const leaf = (row: { fingerprint_id: string; family_id: string; family_version: number; role: string; parameters_json: string; family_status: string }): BoardLeaf => {
    let entry = leaves.get(row.fingerprint_id);
    if (!entry) leaves.set(row.fingerprint_id, entry = {
      fingerprint_id: row.fingerprint_id, family_id: row.family_id, family_version: row.family_version, role: row.role,
      parameters: JSON.parse(row.parameters_json) as Record<string, unknown>, retired_version: row.family_status !== "active", surfaces: [],
    });
    return entry;
  };
  const surfaceEntry = (entry: BoardLeaf, surface: string, sample: string): BoardSurface => {
    let found = entry.surfaces.find((item) => item.surface === surface);
    if (!found) entry.surfaces.push(found = { surface_id: null, surface, sample_text: sample, annotations: 0, pending: 0, sources: 0 });
    return found;
  };
  const fingerprintColumns = `fingerprints.id AS fingerprint_id, fingerprints.family_id, fingerprints.family_version,
    semantic_families.role, fingerprints.parameters_json, semantic_families.status AS family_status`;
  const fingerprintJoin = `JOIN fingerprints ON fingerprints.id = X.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version`;
  type Row = { fingerprint_id: string; family_id: string; family_version: number; role: string; parameters_json: string; family_status: string; exact_text: string; ability_version_id: number };
  const sourcesBySurface = new Map<string, Set<number>>();
  const countSource = (key: string, id: number) => {
    const set = sourcesBySurface.get(key) ?? new Set<number>();
    set.add(id);
    sourcesBySurface.set(key, set);
  };
  for (const row of db.prepare(`
    SELECT ${fingerprintColumns}, source_spans.exact_text, abilities.id AS ability_version_id
    FROM annotations ${fingerprintJoin.replaceAll("X.", "annotations.")}
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE annotations.status = 'active' AND abilities.current = 1 AND (? IS NULL OR abilities.faction_id = ?)
  `).all(faction, faction) as Row[]) {
    const surface = leafSurface(row.exact_text);
    surfaceEntry(leaf(row), surface, row.exact_text).annotations += 1;
    countSource(`${row.fingerprint_id}\u0000${surface}`, row.ability_version_id);
  }
  for (const row of db.prepare(`
    SELECT ${fingerprintColumns}, source_spans.exact_text, abilities.id AS ability_version_id
    FROM proposals ${fingerprintJoin.replaceAll("X.", "proposals.")}
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE proposals.status IN ('pending', 'unresolved') AND abilities.current = 1 AND (? IS NULL OR abilities.faction_id = ?)
      AND fingerprints.status = 'active' AND NOT ${RESTATES_ACTIVE_ANNOTATION}
  `).all(faction, faction) as Row[]) {
    const surface = leafSurface(row.exact_text);
    surfaceEntry(leaf(row), surface, row.exact_text).pending += 1;
    countSource(`${row.fingerprint_id}\u0000${surface}`, row.ability_version_id);
  }
  for (const row of db.prepare(`
    SELECT leaf_surfaces.id, leaf_surfaces.normalized_surface, ${fingerprintColumns}
    FROM leaf_surfaces ${fingerprintJoin.replaceAll("X.", "leaf_surfaces.")}
    WHERE leaf_surfaces.status = 'active'
  `).all() as Array<Omit<Row, "exact_text" | "ability_version_id"> & { id: number; normalized_surface: string }>) {
    if (faction !== null && !leaves.has(row.fingerprint_id)) continue;
    surfaceEntry(leaf(row), row.normalized_surface, row.normalized_surface).surface_id = row.id;
  }
  for (const entry of leaves.values()) {
    for (const surface of entry.surfaces) surface.sources = sourcesBySurface.get(`${entry.fingerprint_id}\u0000${surface.surface}`)?.size ?? 0;
    entry.surfaces.sort((left, right) => right.sources - left.sources || left.surface.localeCompare(right.surface));
  }

  const unlabeled = new Map<string, { surface: string; sample_text: string; occurrences: number; sample_ability_version_id: number }>();
  for (const row of db.prepare(`
    SELECT source_spans.exact_text, abilities.id AS ability_version_id
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE proposals.fingerprint_id IS NULL AND proposals.role <> 'CONNECTIVE' AND proposals.status IN ('pending', 'unresolved')
      AND abilities.current = 1 AND (? IS NULL OR abilities.faction_id = ?)
  `).all(faction, faction) as Array<{ exact_text: string; ability_version_id: number }>) {
    const surface = leafSurface(row.exact_text);
    if (!surface) continue;
    const entry = unlabeled.get(surface) ?? { surface, sample_text: row.exact_text, occurrences: 0, sample_ability_version_id: row.ability_version_id };
    entry.occurrences += 1;
    unlabeled.set(surface, entry);
  }

  const factions = new Map((db.prepare("SELECT id, faction_id FROM abilities WHERE current = 1").all() as Array<{ id: number; faction_id: string }>).map((row) => [row.id, row.faction_id]));
  const untiled = new Map<string, { surface: string; sample_text: string; occurrences: number; unlocks: number; sample_ability_version_id: number }>();
  let tiled = 0;
  let withLeaves = 0;
  let current = 0;
  for (const [id, coverage] of getCurrentCoverage(db)) {
    if (faction !== null && factions.get(id) !== faction) continue;
    current += 1;
    const hasLeaf = coverage.leaf_bytes.numerator > 0;
    if (hasLeaf) withLeaves += 1;
    const runs = untiledRuns(coverage);
    if (runs.length === 0 && hasLeaf) tiled += 1;
    const distinct = new Set(runs.map((run) => leafSurface(runText(run.text))));
    for (const run of runs) {
      const sample = runText(run.text);
      const surface = leafSurface(sample);
      const entry = untiled.get(surface) ?? { surface, sample_text: sample, occurrences: 0, unlocks: 0, sample_ability_version_id: id };
      entry.occurrences += 1;
      untiled.set(surface, entry);
    }
    if (hasLeaf && distinct.size === 1) untiled.get([...distinct][0]!)!.unlocks += 1;
  }
  for (const entry of leaves.values()) {
    if (!entry.retired_version) entry.describer_gaps = describerGaps(entry.family_id, entry.parameters);
    for (const item of entry.surfaces) item.warnings = surfaceWarnings(item.sample_text, entry.role, entry.family_id, entry.parameters);
  }
  return {
    leaves: [...leaves.values()].sort((left, right) => left.role.localeCompare(right.role) || left.family_id.localeCompare(right.family_id)
      || right.surfaces.reduce((total, item) => total + item.sources, 0) - left.surfaces.reduce((total, item) => total + item.sources, 0)),
    unlabeled: [...unlabeled.values()].filter((entry) => entry.occurrences > 1).sort((left, right) => right.occurrences - left.occurrences).slice(0, UNTILED_LIMIT),
    untiled: [...untiled.values()].sort((left, right) => right.unlocks - left.unlocks || right.occurrences - left.occurrences).slice(0, UNTILED_LIMIT),
    totals: { current_sources: current, tiled_sources: tiled, sources_with_leaves: withLeaves },
  };
}

/**
 * Once per database, turn each spelling reviewers already confirmed into a surface decision.
 * A spelling confirmed with two different meanings is left undecided and shows on the board
 * under both leaves. Nothing is applied here; the board's pending counts show what applying adds.
 */
export function backfillLeafSurfaces(db: DatabaseSync): { created: number; conflicting: number } {
  return withTransaction(db, () => {
    if (db.prepare("SELECT 1 FROM annotation_batches WHERE operation = 'migration-leaf-surfaces'").get()) return { created: 0, conflicting: 0 };
    const meanings = new Map<string, Set<string>>();
    for (const row of db.prepare(`
      SELECT source_spans.exact_text, annotations.fingerprint_id
      FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
      JOIN abilities ON abilities.id = source_spans.ability_version_id
      JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
      JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version
      WHERE annotations.status = 'active' AND abilities.current = 1
        AND fingerprints.status = 'active' AND semantic_families.status = 'active'
    `).all() as Array<{ exact_text: string; fingerprint_id: string }>) {
      const surface = leafSurface(row.exact_text);
      if (!surface || GLUE.has(surface)) continue;
      const set = meanings.get(surface) ?? new Set<string>();
      set.add(row.fingerprint_id);
      meanings.set(surface, set);
    }
    const batchId = `migration_${randomUUID()}`;
    db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES (?, 'migration-leaf-surfaces', 'system', ?)").run(batchId, new Date().toISOString());
    let created = 0;
    let conflicting = 0;
    for (const [surface, fingerprints] of [...meanings].sort(([left], [right]) => left.localeCompare(right))) {
      if (fingerprints.size !== 1) { conflicting += 1; continue; }
      if (activeSurface(db, surface)) continue;
      insertSurface(db, surface, [...fingerprints][0]!, batchId);
      created += 1;
    }
    if (created > 0) bumpWorkbenchRevision(db);
    return { created, conflicting };
  });
}
