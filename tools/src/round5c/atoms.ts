import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { insertStructuralProposal } from "./atoms-store.js";
import { assertReviewer, requireHuman, TRUSTED_ANNOTATION, type Actor } from "./authority.js";
import { LEAF_ROLES } from "./contracts.js";
import {
  bumpWorkbenchRevision, insertSpan, invalidateWholeReview, withTransaction,
} from "./db.js";
import { CONNECTIVE_KINDS } from "./luna-schema.js";
import { STRUCTURAL_KINDS, type StructuralKind } from "./schema-ext.js";

const LEAF_ROLE_SQL_LIST = LEAF_ROLES.map((role) => `'${role}'`).join(", ");

/**
 * Structural source authority: participant, selector, usage, and binding constituents. A human
 * accepts, corrects, or rejects each exact-span proposal; only an accepted review accounts for
 * source bytes, and never as a semantic family or fingerprint.
 */

/** An API-shaped failure. The local bridge returns `status` verbatim. */
export class SourceAtomError extends Error {
  readonly status: number;

  constructor(status: 404 | 409 | 422, message: string) {
    super(message);
    this.name = "SourceAtomError";
    this.status = status;
  }
}

const invalid = (message: string): never => { throw new SourceAtomError(422, message); };
const conflict = (message: string): never => { throw new SourceAtomError(409, message); };

type JsonRecord = Record<string, unknown>;
type Interval = { fragment: string; start_byte: number; end_byte: number };

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be a JSON object.`);
  return value as JsonRecord;
}

function text(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid(`${label} must be a nonblank string of at most ${max} characters.`);
  return value as string;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) invalid(`${label} must be an integer of at least ${minimum}.`);
  return value as number;
}

function addMember(db: DatabaseSync, batchId: string, kind: string, id: number): void {
  db.prepare("INSERT OR IGNORE INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)").run(batchId, kind, String(id));
}

function createBatch(db: DatabaseSync, reviewer: string, metadata: JsonRecord): string {
  const batchId = `batch_${randomUUID()}`;
  db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at, metadata_json) VALUES (?, 'review', ?, ?, ?)")
    .run(batchId, reviewer, new Date().toISOString(), JSON.stringify(metadata));
  return batchId;
}

function requireCurrent(db: DatabaseSync, abilityVersionId: number, sourceHash: string): void {
  const ability = db.prepare("SELECT current, source_hash FROM abilities WHERE id = ?").get(abilityVersionId) as { current: number; source_hash: string } | undefined;
  if (!ability) throw new SourceAtomError(404, `Unknown ability version ${abilityVersionId}.`);
  if (ability.current !== 1 || ability.source_hash !== sourceHash) conflict("This ability source version is stale. Reload before labeling source.");
}

function spanFor(db: DatabaseSync, abilityVersionId: number, interval: Interval, exactText: string): number {
  if (interval.end_byte <= interval.start_byte) invalid("Source span byte offsets must be ordered and non-empty.");
  try {
    return insertSpan(db, abilityVersionId, interval.fragment, interval.start_byte, interval.end_byte, exactText);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Source span is invalid.");
  }
}

type Occupant = { layer: "annotation" | "structural" | "connective"; id: number; span_id: number; start_byte: number; end_byte: number };

/** Every authoritative interval on the ability that overlaps `[start, end)` in one fragment. */
function authoritativeOverlaps(db: DatabaseSync, abilityVersionId: number, interval: Interval): Occupant[] {
  return db.prepare(`
    SELECT 'annotation' AS layer, annotations.id, source_spans.id AS span_id, source_spans.start_byte, source_spans.end_byte
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.status = 'active' AND ${TRUSTED_ANNOTATION} AND source_spans.ability_version_id = ? AND source_spans.fragment = ?
      AND source_spans.start_byte < ? AND ? < source_spans.end_byte
    UNION ALL
    SELECT 'structural', source_atom_reviews.id, source_spans.id, source_spans.start_byte, source_spans.end_byte
    FROM source_atom_reviews JOIN source_spans ON source_spans.id = source_atom_reviews.span_id
    WHERE source_atom_reviews.status = 'active' AND source_spans.ability_version_id = ? AND source_spans.fragment = ?
      AND source_spans.start_byte < ? AND ? < source_spans.end_byte
    UNION ALL
    SELECT 'connective', proposals.id, source_spans.id, source_spans.start_byte, source_spans.end_byte
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE proposals.role = 'CONNECTIVE' AND proposals.status = 'accepted'
      AND source_spans.ability_version_id = ? AND source_spans.fragment = ?
      AND source_spans.start_byte < ? AND ? < source_spans.end_byte
  `).all(
    abilityVersionId, interval.fragment, interval.end_byte, interval.start_byte,
    abilityVersionId, interval.fragment, interval.end_byte, interval.start_byte,
    abilityVersionId, interval.fragment, interval.end_byte, interval.start_byte,
  ) as Occupant[];
}

function parseInterval(input: JsonRecord, label: string): Interval {
  return {
    fragment: text(input.fragment, `${label}.fragment`, 64),
    start_byte: integer(input.start_byte, `${label}.start_byte`),
    end_byte: integer(input.end_byte, `${label}.end_byte`, 1),
  };
}

const PROPOSABLE = [...STRUCTURAL_KINDS, "CONNECTIVE", "UNRESOLVED"] as const;

/**
 * Record a manual, exact-span source claim for later review: a structural constituent, a
 * connective, or an unresolved region (with its linked leaf gap). It never paints bytes; a
 * separate human accept or confirm is always required. Undoable as a review batch.
 */
export function proposeSourceAtom(db: DatabaseSync, body: unknown): { batch_id: string; kind: string; proposal_id: number } {
  const input = record(body, "body");
  const abilityVersionId = integer(input.ability_version_id, "ability_version_id", 1);
  const sourceHash = text(input.source_hash, "source_hash", 64);
  const interval = parseInterval(input, "body");
  const exactText = text(input.exact_text, "exact_text", 4096);
  const kind = text(input.kind, "kind", 32);
  if (!(PROPOSABLE as readonly string[]).includes(kind)) invalid(`kind must be one of ${PROPOSABLE.join(", ")}.`);
  const description = text(input.description, "description");
  const reviewer = text(input.reviewer, "reviewer", 100);
  const connectiveKind = input.connective_kind === undefined ? "other" : text(input.connective_kind, "connective_kind", 32);
  if (kind === "CONNECTIVE" && !(CONNECTIVE_KINDS as readonly string[]).includes(connectiveKind)) {
    invalid(`connective_kind must be one of ${CONNECTIVE_KINDS.join(", ")}.`);
  }
  return withTransaction(db, () => {
    requireCurrent(db, abilityVersionId, sourceHash);
    const spanId = spanFor(db, abilityVersionId, interval, exactText);
    const overlaps = authoritativeOverlaps(db, abilityVersionId, interval);
    if (overlaps.length > 0) {
      conflict(`This span overlaps a reviewed ${overlaps[0]!.layer}; correct or undo that decision before labeling these bytes again.`);
    }
    const batchId = createBatch(db, reviewer, { kind: "source-atom-proposal" });
    const createdAt = new Date().toISOString();
    let proposalId: number;
    if (kind === "CONNECTIVE" || kind === "UNRESOLVED") {
      const unresolved = kind === "UNRESOLVED";
      const reason = unresolved
        ? { kind: "ambiguous", type: "manual-unresolved", description }
        : { type: "connective", connective_kind: connectiveKind, description };
      proposalId = Number(db.prepare(`
        INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
        VALUES (?, NULL, ?, 'manual', NULL, ?, ?, NULL, ?)
      `).run(spanId, kind, unresolved ? "unresolved" : "pending", JSON.stringify(reason), createdAt).lastInsertRowid);
      if (unresolved) {
        const gap = Number(db.prepare(`
          INSERT INTO gaps (ability_version_id, type, status, description, batch_id, proposal_id)
          VALUES (?, 'LEAF_GAP', 'open', ?, ?, ?)
        `).run(abilityVersionId, `Unresolved source span ${interval.fragment}:${interval.start_byte}-${interval.end_byte}.`, batchId, proposalId).lastInsertRowid);
        addMember(db, batchId, "proposal-created", proposalId);
        addMember(db, batchId, "gap-created", gap);
      } else {
        addMember(db, batchId, "connective-proposal-created", proposalId);
      }
    } else {
      try {
        proposalId = insertStructuralProposal(db, {
          span_id: spanId, model_run_id: null, origin: "manual", kind: kind as StructuralKind, description,
          parent_proposal_id: null, reason: { source: "manual" }, created_at: createdAt,
        });
      } catch (error) {
        return conflict(error instanceof Error ? error.message : "A pending structural proposal already claims this span.");
      }
      addMember(db, batchId, "atom-proposal-created", proposalId);
    }
    invalidateWholeReview(db, [abilityVersionId]);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, kind, proposal_id: proposalId };
  });
}

type AtomProposalRow = {
  id: number; span_id: number; kind: StructuralKind; status: string; parent_proposal_id: number | null;
  ability_version_id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string;
};

function atomProposal(db: DatabaseSync, id: number): AtomProposalRow {
  const row = db.prepare(`
    SELECT source_atom_proposals.id, source_atom_proposals.span_id, source_atom_proposals.kind, source_atom_proposals.status,
      source_atom_proposals.parent_proposal_id, source_spans.ability_version_id, source_spans.fragment,
      source_spans.start_byte, source_spans.end_byte, source_spans.exact_text
    FROM source_atom_proposals JOIN source_spans ON source_spans.id = source_atom_proposals.span_id
    WHERE source_atom_proposals.id = ?
  `).get(id) as AtomProposalRow | undefined;
  if (!row) throw new SourceAtomError(404, `Unknown structural proposal ${id}.`);
  return row;
}

function qualifierContains(reasonJson: string, interval: Interval): boolean {
  const reason = JSON.parse(reasonJson) as { qualifier_spans?: Array<{ start_byte: number; end_byte: number }> };
  return (reason.qualifier_spans ?? []).some((qualifier) => interval.start_byte >= qualifier.start_byte && interval.end_byte <= qualifier.end_byte);
}

/**
 * A structural span may overlap a semantic annotation only as a reviewed qualifier: wholly
 * inside a qualifier span of a decided proposal on that annotation's exact span, linked to it.
 */
function assertContainment(db: DatabaseSync, proposal: AtomProposalRow, interval: Interval, containerId: number | null, overlaps: Occupant[]): void {
  for (const occupant of overlaps) {
    if (occupant.layer === "annotation" && occupant.id === containerId) continue;
    conflict(`This structural span overlaps a reviewed ${occupant.layer} without an explicit, reviewed containment.`);
  }
  if (containerId === null) return;
  const container = overlaps.find((occupant) => occupant.layer === "annotation" && occupant.id === containerId);
  if (!container) {
    const exists = db.prepare(`
      SELECT annotations.status, source_spans.ability_version_id FROM annotations
      JOIN source_spans ON source_spans.id = annotations.span_id WHERE annotations.id = ?
    `).get(containerId) as { status: string; ability_version_id: number } | undefined;
    if (!exists || exists.ability_version_id !== proposal.ability_version_id) return invalid("contained_by_annotation_id must be an annotation on this source version.");
    if (exists.status !== "active") conflict("The parent annotation is no longer active.");
    invalid("The structural span does not lie inside its parent annotation.");
  }
  if (interval.start_byte < container!.start_byte || interval.end_byte > container!.end_byte) {
    invalid("A contained structural span must lie wholly inside its parent annotation.");
  }
  const parents = db.prepare(`
    SELECT id, reason_json FROM proposals
    WHERE span_id = ? AND status IN ('accepted', 'corrected') AND role IN (${LEAF_ROLE_SQL_LIST})
  `).all(container!.span_id) as Array<{ id: number; reason_json: string }>;
  const eligible = parents.filter((parent) => (proposal.parent_proposal_id === null || parent.id === proposal.parent_proposal_id)
    && qualifierContains(parent.reason_json, interval));
  if (eligible.length === 0) {
    invalid("A contained structural span must lie inside a qualifier span of the parent's reviewed semantic proposal.");
  }
}

type AtomDecision = {
  atom_proposal_id: number;
  action: "accept" | "correct" | "reject";
  source_hash: string;
  kind?: StructuralKind;
  interval?: Interval;
  exact_text?: string;
  contained_by_annotation_id: number | null;
};

function parseDecision(value: unknown, index: number): AtomDecision {
  const input = record(value, `decisions[${index}]`);
  const action = text(input.action, `decisions[${index}].action`, 16);
  if (action !== "accept" && action !== "correct" && action !== "reject") invalid(`decisions[${index}].action must be accept, correct, or reject.`);
  const kind = input.kind === undefined ? undefined : text(input.kind, `decisions[${index}].kind`, 32);
  if (kind !== undefined && !(STRUCTURAL_KINDS as readonly string[]).includes(kind)) invalid(`decisions[${index}].kind is not a structural kind.`);
  const hasInterval = input.start_byte !== undefined || input.end_byte !== undefined;
  if (action !== "correct" && (hasInterval || kind !== undefined)) invalid(`decisions[${index}] may change kind or bytes only with action correct.`);
  if (action === "correct" && !hasInterval && kind === undefined) invalid(`decisions[${index}] correct needs a new kind or byte interval.`);
  return {
    atom_proposal_id: integer(input.atom_proposal_id, `decisions[${index}].atom_proposal_id`, 1),
    action: action as AtomDecision["action"],
    source_hash: text(input.source_hash, `decisions[${index}].source_hash`, 64),
    kind: kind as StructuralKind | undefined,
    interval: hasInterval ? parseInterval(input, `decisions[${index}]`) : undefined,
    exact_text: hasInterval ? text(input.exact_text, `decisions[${index}].exact_text`, 4096) : undefined,
    contained_by_annotation_id: input.contained_by_annotation_id === undefined || input.contained_by_annotation_id === null
      ? null
      : integer(input.contained_by_annotation_id, `decisions[${index}].contained_by_annotation_id`, 1),
  };
}

/**
 * Atomically accept, correct, or reject structural proposals. Accepted and corrected
 * constituents become source-bound structural reviews that count toward `accounted_fraction`.
 */
export function applySourceAtomBatch(db: DatabaseSync, body: unknown, actor: Actor): { batch_id: string; applied: number } {
  requireHuman(actor, "decide structural constituents");
  const input = record(body, "body");
  const reviewer = text(input.reviewer, "reviewer", 100);
  assertReviewer(actor, reviewer);
  if (!Array.isArray(input.decisions) || input.decisions.length === 0) invalid("decisions must be a nonempty array.");
  const decisions = (input.decisions as unknown[]).map(parseDecision);
  return withTransaction(db, () => {
    const batchId = createBatch(db, reviewer, { kind: "source-atom-review" });
    const touched = new Set<number>();
    const createdAt = new Date().toISOString();
    for (const decision of decisions) {
      const proposal = atomProposal(db, decision.atom_proposal_id);
      requireCurrent(db, proposal.ability_version_id, decision.source_hash);
      if (proposal.status !== "pending") conflict(`Structural proposal ${proposal.id} was already decided.`);
      touched.add(proposal.ability_version_id);
      const outcome = decision.action === "accept" ? "accepted" : decision.action === "correct" ? "corrected" : "rejected";
      const updated = db.prepare("UPDATE source_atom_proposals SET status = ? WHERE id = ? AND status = 'pending'").run(outcome, proposal.id);
      if (updated.changes !== 1) conflict(`Structural proposal ${proposal.id} changed before the batch was applied.`);
      addMember(db, batchId, `atom-${outcome}`, proposal.id);
      if (decision.action === "reject") continue;

      const interval: Interval = decision.interval ?? { fragment: proposal.fragment, start_byte: proposal.start_byte, end_byte: proposal.end_byte };
      if (interval.fragment !== proposal.fragment || interval.start_byte >= proposal.end_byte || proposal.start_byte >= interval.end_byte) {
        conflict("A corrected structural span must overlap its original span in the same fragment.");
      }
      const spanId = decision.interval
        ? spanFor(db, proposal.ability_version_id, interval, decision.exact_text!)
        : proposal.span_id;
      const kind = decision.kind ?? proposal.kind;
      assertContainment(db, proposal, interval, decision.contained_by_annotation_id, authoritativeOverlaps(db, proposal.ability_version_id, interval));
      const review = Number(db.prepare(`
        INSERT INTO source_atom_reviews (proposal_id, span_id, kind, decision, status, batch_id, reviewer, contained_by_annotation_id, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `).run(proposal.id, spanId, kind, decision.action, batchId, reviewer, decision.contained_by_annotation_id, createdAt).lastInsertRowid);
      addMember(db, batchId, "atom-review", review);
    }
    invalidateWholeReview(db, touched);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, applied: decisions.length };
  });
}

type Member = { entity_kind: string; entity_id: string };

const ATOM_UNDO: Record<string, { table: "source_atom_proposals" | "source_atom_reviews" | "proposals"; expected: string; restore: string }> = {
  "atom-accepted": { table: "source_atom_proposals", expected: "accepted", restore: "pending" },
  "atom-corrected": { table: "source_atom_proposals", expected: "corrected", restore: "pending" },
  "atom-rejected": { table: "source_atom_proposals", expected: "rejected", restore: "pending" },
  "atom-proposal-created": { table: "source_atom_proposals", expected: "pending", restore: "rejected" },
  "atom-review": { table: "source_atom_reviews", expected: "active", restore: "retracted" },
  "connective-proposal-created": { table: "proposals", expected: "pending", restore: "rejected" },
};

function abilityOf(db: DatabaseSync, table: string, id: number): number {
  const spanColumn = `${table}.span_id`;
  const row = db.prepare(`SELECT source_spans.ability_version_id FROM ${table} JOIN source_spans ON source_spans.id = ${spanColumn} WHERE ${table}.id = ?`).get(id) as { ability_version_id: number } | undefined;
  if (!row) conflict("A structural decision in this batch no longer exists.");
  return row!.ability_version_id;
}

/** Refuse to undo a batch whose structural decisions were later changed. */
export function assertSourceAtomUndo(db: DatabaseSync, members: readonly Member[]): void {
  for (const member of members) {
    const transition = ATOM_UNDO[member.entity_kind];
    if (!transition) continue;
    const row = db.prepare(`SELECT status FROM ${transition.table} WHERE id = ?`).get(Number(member.entity_id)) as { status: string } | undefined;
    if (!row || row.status !== transition.expected) conflict("This batch cannot be undone because one of its source-structure decisions was later changed.");
  }
}

/** Reverse every structural decision in a batch; returns the ability versions it touched. */
export function applySourceAtomUndo(db: DatabaseSync, reversalId: string, members: readonly Member[]): Set<number> {
  const touched = new Set<number>();
  for (const member of members) {
    const transition = ATOM_UNDO[member.entity_kind];
    if (!transition) continue;
    const id = Number(member.entity_id);
    const changed = db.prepare(`UPDATE ${transition.table} SET status = ? WHERE id = ? AND status = ?`).run(transition.restore, id, transition.expected);
    if (changed.changes !== 1) conflict("A source-structure decision changed during undo.");
    addMember(db, reversalId, `${member.entity_kind}-reversed`, id);
    touched.add(abilityOf(db, transition.table, id));
  }
  return touched;
}

/** Structural constituents of one source version, for the review surface. */
export function sourceAtomsForAbility(db: DatabaseSync, abilityVersionId: number): {
  proposals: Array<AtomProposalRow & { origin: string; description: string; model_run_id: number | null }>;
  reviews: Array<{ id: number; proposal_id: number; kind: StructuralKind; fragment: string; start_byte: number; end_byte: number; exact_text: string; contained_by_annotation_id: number | null; supported: boolean; reviewer: string; batch_id: string }>;
} {
  const proposals = db.prepare(`
    SELECT source_atom_proposals.id, source_atom_proposals.span_id, source_atom_proposals.kind, source_atom_proposals.status,
      source_atom_proposals.parent_proposal_id, source_atom_proposals.origin, source_atom_proposals.description,
      source_atom_proposals.model_run_id, source_spans.ability_version_id, source_spans.fragment,
      source_spans.start_byte, source_spans.end_byte, source_spans.exact_text
    FROM source_atom_proposals JOIN source_spans ON source_spans.id = source_atom_proposals.span_id
    WHERE source_spans.ability_version_id = ? AND source_atom_proposals.status = 'pending'
    ORDER BY source_spans.start_byte, source_atom_proposals.id
  `).all(abilityVersionId) as Array<AtomProposalRow & { origin: string; description: string; model_run_id: number | null }>;
  const reviews = db.prepare(`
    SELECT source_atom_reviews.id, source_atom_reviews.proposal_id, source_atom_reviews.kind, source_spans.fragment,
      source_spans.start_byte, source_spans.end_byte, source_spans.exact_text, source_atom_reviews.contained_by_annotation_id,
      source_atom_reviews.reviewer, source_atom_reviews.batch_id,
      CASE WHEN source_atom_reviews.contained_by_annotation_id IS NULL OR EXISTS (
        SELECT 1 FROM annotations WHERE annotations.id = source_atom_reviews.contained_by_annotation_id AND annotations.status = 'active'
      ) THEN 1 ELSE 0 END AS supported
    FROM source_atom_reviews JOIN source_spans ON source_spans.id = source_atom_reviews.span_id
    WHERE source_spans.ability_version_id = ? AND source_atom_reviews.status = 'active'
    ORDER BY source_spans.start_byte, source_atom_reviews.id
  `).all(abilityVersionId) as Array<{ id: number; proposal_id: number; kind: StructuralKind; fragment: string; start_byte: number; end_byte: number; exact_text: string; contained_by_annotation_id: number | null; supported: number; reviewer: string; batch_id: string }>;
  return { proposals, reviews: reviews.map((review) => ({ ...review, supported: review.supported === 1 })) };
}
