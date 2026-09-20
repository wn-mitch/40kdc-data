import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";

import { familyRole, SEMANTIC_ROLES, validateFingerprint } from "./contracts.js";
import { getAbilityCoverage, getCurrentCoverage, type AbilityCoverage, type SourceFragmentView } from "./coverage.js";
import { bumpWorkbenchRevision, getWorkbenchRevision, insertSpan, invalidateAbilityEvidence, invalidateStampRevision, invalidateWholeReview, parseStoredFragments, RESTATES_ACTIVE_ANNOTATION, withTransaction } from "./db.js";
import { resolveAbilityContext, type AbilityContext } from "./context.js";
import { abilityReadiness, currentReadiness, type Readiness } from "./readiness.js";
import { applySourceAtomUndo, assertSourceAtomUndo, sourceAtomsForAbility } from "./atoms.js";
import { applyOntologyUndo, assertOntologyUndo } from "./ontology.js";
import { recordCandidateSuggestion } from "./ontology-store.js";
import { ROUND5C_RELATION_TYPES } from "./relations.js";
import { applyStamps, createEscalation } from "./stamps.js";

/** An API-shaped failure. The local bridge returns `status` verbatim. */
export class WorkbenchError extends Error {
  readonly status: number;

  constructor(status: 404 | 409 | 422, message: string) {
    super(message);
    this.name = "WorkbenchError";
    this.status = status;
  }
}

/** A source-bound confirmed semantic occurrence. */
export type AnnotationView = {
  id: number;
  span_id: number;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  role: string;
  family_id: string;
  family_version: number;
  parameters: Record<string, unknown>;
  origin: string;
  confirmed_by: string;
  authority_kind: "human" | "stamp";
  rule_authorized_by: string | null;
};

/** A machine, retrieval, or manual proposal that is not a Golden annotation. */
export type ProposalView = {
  id: number;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  role: string;
  family_id: string | null;
  family_version: number | null;
  parameters: Record<string, unknown> | null;
  origin: string;
  reason: Record<string, unknown>;
  score: number | null;
  status: string;
};

/** One complete source version returned to the local review client. */
export type AbilityView = {
  id: number;
  current: boolean;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  review_evidence_hash: string;
  source_text: string;
  source_type: string | null;
  source_kind: string | null;
  name: string | null;
  fragments: SourceFragmentView[];
  annotations: AnnotationView[];
  proposals: ProposalView[];
  coverage: AbilityCoverage;
  progress: LeafProgress;
  atoms: ReturnType<typeof sourceAtomsForAbility>;
  /** The open composition escalation for this exact source version, once the whole source is checked. */
  composition_escalation_id: string | null;
  context: AbilityContext;
  review: {
    whole_context_checked: boolean;
    source_shape: string | null;
    cues: Record<string, unknown>;
    reviewed_by: string | null;
  };
};

/**
 * Display threshold for the dashboard's top leaf-histogram bucket. It is not a composition
 * gate: readiness (`readiness.ts`) requires every meaningful byte to be accounted for.
 */
export const COMPOSITION_READY_LEAF_FRACTION = 0.95;

/** What is known, reviewed, and still open on one ability: the gate for upward composition. */
export type LeafProgress = {
  leaves: Array<{ family_id: string; authority_kind: string; count: number }>;
  connective_bytes: number;
  pending_proposals: number;
  unresolved_proposals: number;
  open_leaf_gaps: number;
  residue_regions: number;
  residue_bytes: number;
  /** Mirrors `readiness.ready`: every meaningful byte reviewed and nothing still asking a human. */
  composition_ready: boolean;
  readiness: Readiness;
};

type ProgressCounts = { pending: number; unresolved: number; gaps: number; connective_bytes: number };

/** Per-ability open-work counts for every current ability (or one), in four grouped queries. */
function progressCounts(db: DatabaseSync, abilityVersionId?: number): Map<number, ProgressCounts> {
  const filter = abilityVersionId === undefined ? "abilities.current = 1" : "abilities.id = ?";
  const args = abilityVersionId === undefined ? [] : [abilityVersionId];
  const counts = new Map<number, ProgressCounts>();
  const entry = (id: number): ProgressCounts => {
    let value = counts.get(id);
    if (!value) counts.set(id, value = { pending: 0, unresolved: 0, gaps: 0, connective_bytes: 0 });
    return value;
  };
  for (const row of db.prepare(`
    SELECT abilities.id, proposals.status, proposals.role, count(*) AS total,
      sum(source_spans.end_byte - source_spans.start_byte) AS bytes
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE ${filter}
      AND ((proposals.status IN ('pending', 'unresolved') AND NOT ${RESTATES_ACTIVE_ANNOTATION})
        OR (proposals.status = 'accepted' AND proposals.role = 'CONNECTIVE'))
    GROUP BY abilities.id, proposals.status, proposals.role
  `).all(...args) as Array<{ id: number; status: string; role: string; total: number; bytes: number }>) {
    const value = entry(row.id);
    if (row.status === "pending") value.pending += Number(row.total);
    else if (row.status === "unresolved") value.unresolved += Number(row.total);
    else value.connective_bytes += Number(row.bytes);
  }
  for (const row of db.prepare(`
    SELECT abilities.id, count(*) AS total FROM gaps
    JOIN abilities ON abilities.id = gaps.ability_version_id
    WHERE ${filter} AND gaps.type = 'LEAF_GAP' AND gaps.status = 'open'
    GROUP BY abilities.id
  `).all(...args) as Array<{ id: number; total: number }>) entry(row.id).gaps = Number(row.total);
  return counts;
}

function leafProgress(coverage: AbilityCoverage, annotations: readonly AnnotationView[], counts: ProgressCounts | undefined, readiness: Readiness): LeafProgress {
  const open = counts ?? { pending: 0, unresolved: 0, gaps: 0, connective_bytes: 0 };
  const leaves = new Map<string, { family_id: string; authority_kind: string; count: number }>();
  for (const annotation of annotations) {
    if (annotation.role === "CONNECTIVE") continue;
    const key = `${annotation.family_id}\u0000${annotation.authority_kind}`;
    const leaf = leaves.get(key) ?? { family_id: annotation.family_id, authority_kind: annotation.authority_kind, count: 0 };
    leaf.count += 1;
    leaves.set(key, leaf);
  }
  return {
    leaves: [...leaves.values()].sort((left, right) => left.family_id.localeCompare(right.family_id) || left.authority_kind.localeCompare(right.authority_kind)),
    connective_bytes: open.connective_bytes,
    pending_proposals: open.pending,
    unresolved_proposals: open.unresolved,
    open_leaf_gaps: open.gaps,
    residue_regions: coverage.residue.length,
    residue_bytes: coverage.residue.reduce((total, region) => total + region.end_byte - region.start_byte, 0),
    composition_ready: readiness.ready,
    readiness,
  };
}

/** Payload for the separate, whole-ability review action. */
export type ReviewAbilityBody = {
  source_hash: string;
  reviewer: string;
  whole_context_checked: boolean;
  expected_review_hash?: string;
  source_shape?: string;
  cues?: Record<string, unknown>;
};

export type AnnotationDecisionAction = "confirm" | "correct" | "reject" | "novel" | "ambiguous" | "confirm-connective" | "resolve-stamp-gap";

/** A single source-bound decision, including every byte-level identity guard. */
export type AnnotationDecision = {
  action: AnnotationDecisionAction;
  proposal_id?: number;
  supersedes_annotation_id?: number;
  ability_version_id: number;
  source_hash: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  role: string;
  family_id?: string;
  family_version?: number;
  parameters?: Record<string, unknown>;
  allow_overlap?: boolean;
  /** For confirm-connective: the typed composition relation the reviewer chose for this join. */
  relation?: string;
};

/** Atomic review-batch payload. Every decision is applied or none is. */
export type ApplyAnnotationBatchBody = {
  reviewer: string;
  decisions: AnnotationDecision[];
};

/** Payload for a reviewer-scoped reversal batch. */
export type UndoBatchBody = { reviewer: string };

type JsonRecord = Record<string, unknown>;
type AbilityRow = {
  id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  source_text: string;
  source_type: string | null;
  source_kind: string | null;
  name: string | null;
  fragments_json: string;
  current: number;
};
type AnnotationRow = {
  id: number;
  span_id: number;
  start_byte: number;
  end_byte: number;
  role: string;
  fingerprint_id: string;
};
type ProposalRow = {
  id: number;
  span_id: number;
  ability_version_id: number;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  role: string;
  fingerprint_id: string | null;
  family_id: string | null;
  family_version: number | null;
  parameters_json: string | null;
  origin: string;
  status: string;
};
type ParsedDecision = AnnotationDecision;

const semanticRoleSet = new Set<string>(SEMANTIC_ROLES);
const proposalRoleSet = new Set<string>([...SEMANTIC_ROLES, "CONNECTIVE", "UNRESOLVED"]);

function invalid(message: string): never {
  throw new WorkbenchError(422, message);
}

function conflict(message: string): never {
  throw new WorkbenchError(409, message);
}

function missing(message: string): never {
  throw new WorkbenchError(404, message);
}

function asObject(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be a JSON object.`);
  return value as JsonRecord;
}

function asNonblankString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} must be a nonblank string.`);
  return value;
}

function asInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(`${label} must be an integer.`);
  return value;
}

function parseJsonObject(serialized: string, label: string): Record<string, unknown> {
  try {
    return asObject(JSON.parse(serialized), label);
  } catch (error) {
    if (error instanceof WorkbenchError) throw error;
    throw new Error(`${label} contains invalid persisted JSON.`);
  }
}

function requireAbility(db: DatabaseSync, abilityVersionId: number): AbilityRow {
  const ability = db.prepare(`
    SELECT id, faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, fragments_json, current
    FROM abilities WHERE id = ?
  `).get(abilityVersionId) as AbilityRow | undefined;
  if (!ability) missing(`Unknown ability version ${abilityVersionId}.`);
  return ability;
}

function requireCurrentAbility(db: DatabaseSync, abilityVersionId: number, sourceHash: string): AbilityRow {
  const ability = requireAbility(db, abilityVersionId);
  if (ability.current !== 1 || ability.source_hash !== sourceHash) {
    conflict("This ability source version is stale. Reload before applying review decisions.");
  }
  return ability;
}

function parseDecision(value: unknown, index: number): ParsedDecision {
  const input = asObject(value, `decisions[${index}]`);
  const action = asNonblankString(input.action, `decisions[${index}].action`);
  if (!["confirm", "correct", "reject", "novel", "ambiguous", "confirm-connective", "resolve-stamp-gap"].includes(action)) {
    invalid(`decisions[${index}].action is not supported.`);
  }
  const role = asNonblankString(input.role, `decisions[${index}].role`);
  if (!proposalRoleSet.has(role)) invalid(`decisions[${index}].role is not a reviewed or unconfirmed role.`);
  const proposalId = input.proposal_id === undefined ? undefined : asInteger(input.proposal_id, `decisions[${index}].proposal_id`);
  if (proposalId !== undefined && proposalId < 1) invalid(`decisions[${index}].proposal_id must be positive.`);
  const supersedesAnnotationId = input.supersedes_annotation_id === undefined
    ? undefined
    : asInteger(input.supersedes_annotation_id, `decisions[${index}].supersedes_annotation_id`);
  if (supersedesAnnotationId !== undefined && supersedesAnnotationId < 1) {
    invalid(`decisions[${index}].supersedes_annotation_id must be positive.`);
  }
  if (supersedesAnnotationId !== undefined && action !== "correct" && action !== "resolve-stamp-gap") {
    invalid("supersedes_annotation_id is only valid for a correction.");
  }
  const familyVersion = input.family_version === undefined ? undefined : asInteger(input.family_version, `decisions[${index}].family_version`);
  if (familyVersion !== undefined && familyVersion < 1) invalid(`decisions[${index}].family_version must be positive.`);
  const parameters = input.parameters === undefined ? undefined : asObject(input.parameters, `decisions[${index}].parameters`);
  if (input.allow_overlap !== undefined && typeof input.allow_overlap !== "boolean") {
    invalid(`decisions[${index}].allow_overlap must be boolean when supplied.`);
  }
  const relation = input.relation === undefined ? undefined : asNonblankString(input.relation, `decisions[${index}].relation`);
  if (relation !== undefined && action !== "confirm-connective") invalid("relation is only valid when confirming a connective.");
  if (relation !== undefined && !(ROUND5C_RELATION_TYPES as readonly string[]).includes(relation)) {
    invalid(`decisions[${index}].relation is not a Round 5C relation type.`);
  }
  return {
    action: action as AnnotationDecisionAction,
    proposal_id: proposalId,
    supersedes_annotation_id: supersedesAnnotationId,
    ability_version_id: asInteger(input.ability_version_id, `decisions[${index}].ability_version_id`),
    source_hash: asNonblankString(input.source_hash, `decisions[${index}].source_hash`),
    fragment: asNonblankString(input.fragment, `decisions[${index}].fragment`),
    start_byte: asInteger(input.start_byte, `decisions[${index}].start_byte`),
    end_byte: asInteger(input.end_byte, `decisions[${index}].end_byte`),
    exact_text: asNonblankString(input.exact_text, `decisions[${index}].exact_text`),
    role,
    family_id: input.family_id === undefined ? undefined : asNonblankString(input.family_id, `decisions[${index}].family_id`),
    family_version: familyVersion,
    parameters,
    allow_overlap: input.allow_overlap as boolean | undefined,
    relation,
  };
}

function parseBatchBody(body: unknown): { reviewer: string; decisions: ParsedDecision[] } {
  const input = asObject(body, "batch body");
  const reviewer = asNonblankString(input.reviewer, "reviewer");
  if (!Array.isArray(input.decisions) || input.decisions.length === 0) invalid("decisions must be a nonempty array.");
  return { reviewer, decisions: input.decisions.map(parseDecision) };
}

function parseReviewBody(body: unknown): ReviewAbilityBody {
  const input = asObject(body, "review body");
  const sourceHash = asNonblankString(input.source_hash, "source_hash");
  const reviewer = asNonblankString(input.reviewer, "reviewer");
  if (typeof input.whole_context_checked !== "boolean") invalid("whole_context_checked must be boolean.");
  const sourceShape = input.source_shape === undefined ? undefined : asNonblankString(input.source_shape, "source_shape");
  if (sourceShape !== undefined && sourceShape.trim().length > 256) invalid("source_shape is limited to 256 characters.");
  const cues = input.cues === undefined ? undefined : asObject(input.cues, "cues");
  const expectedReviewHash = input.expected_review_hash === undefined
    ? undefined
    : asNonblankString(input.expected_review_hash, "expected_review_hash");
  return {
    source_hash: sourceHash,
    reviewer,
    whole_context_checked: input.whole_context_checked,
    source_shape: sourceShape,
    cues,
    expected_review_hash: expectedReviewHash,
  };
}

function addMember(db: DatabaseSync, batchId: string, entityKind: string, entityId: number | string): void {
  db.prepare(`
    INSERT OR IGNORE INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, ?, ?)
  `).run(batchId, entityKind, String(entityId));
}

function proposalForDecision(db: DatabaseSync, proposalId: number | undefined): ProposalRow | null {
  if (proposalId === undefined) return null;
  const proposal = db.prepare(`
    SELECT proposals.id, proposals.span_id, source_spans.ability_version_id, source_spans.fragment,
      source_spans.start_byte, source_spans.end_byte, source_spans.exact_text, proposals.role,
      proposals.fingerprint_id, fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json,
      proposals.origin, proposals.status
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    LEFT JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id
    WHERE proposals.id = ?
  `).get(proposalId) as ProposalRow | undefined;
  if (!proposal) conflict(`Proposal ${proposalId} no longer exists.`);
  return proposal;
}

function assertProposalMatchesDecision(proposal: ProposalRow, decision: ParsedDecision): void {
  if (proposal.ability_version_id !== decision.ability_version_id) {
    conflict("The proposal belongs to a different ability.");
  }
  if (proposal.status !== "pending" && proposal.status !== "unresolved") {
    conflict("This proposal has already been decided or superseded.");
  }
  if (decision.action === "confirm-connective") {
    if (proposal.role !== "CONNECTIVE" || proposal.status !== "pending") {
      conflict("Only a pending CONNECTIVE proposal can be confirmed as a connective.");
    }
  } else if (proposal.role === "CONNECTIVE" && decision.action !== "reject") {
    invalid("CONNECTIVE proposals can only be confirmed as connectives or rejected.");
  }
  if (decision.action === "correct") {
    if (proposal.fragment !== decision.fragment ||
      proposal.start_byte >= decision.end_byte || decision.start_byte >= proposal.end_byte) {
      conflict("A corrected proposal must overlap its original span in the same fragment.");
    }
  } else if (
    proposal.fragment !== decision.fragment ||
    proposal.start_byte !== decision.start_byte ||
    proposal.end_byte !== decision.end_byte ||
    proposal.exact_text !== decision.exact_text
  ) {
    conflict("The proposal no longer matches the requested source span.");
  }
}

function activeAnnotationsOverlapping(
  db: DatabaseSync,
  abilityVersionId: number,
  startByte: number,
  endByte: number,
): AnnotationRow[] {
  return db.prepare(`
    SELECT annotations.id, annotations.span_id, source_spans.start_byte, source_spans.end_byte,
      semantic_families.role, annotations.fingerprint_id
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id
      AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active'
      AND source_spans.ability_version_id = ?
      AND source_spans.start_byte < ?
      AND ? < source_spans.end_byte
    ORDER BY source_spans.start_byte, source_spans.end_byte, annotations.id
  `).all(abilityVersionId, endByte, startByte) as AnnotationRow[];
}

function correctionTarget(
  db: DatabaseSync,
  decision: ParsedDecision,
): AnnotationRow | null {
  if (decision.supersedes_annotation_id === undefined) return null;
  const target = db.prepare(`
    SELECT annotations.id, annotations.span_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte,
      semantic_families.role, annotations.fingerprint_id, annotations.status, source_spans.ability_version_id
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id
      AND semantic_families.version = fingerprints.family_version
    WHERE annotations.id = ?
  `).get(decision.supersedes_annotation_id) as (AnnotationRow & {
    fragment: string;
    status: string;
    ability_version_id: number;
  }) | undefined;
  if (!target || target.ability_version_id !== decision.ability_version_id) {
    conflict("The annotation selected for correction does not belong to this source version.");
  }
  if (target.status !== "active") {
    conflict("The annotation selected for correction is no longer active.");
  }
  if (
    target.fragment !== decision.fragment ||
    target.start_byte >= decision.end_byte ||
    decision.start_byte >= target.end_byte
  ) {
    conflict("The annotation selected for correction does not match the corrected source span.");
  }
  return target;
}

function contains(first: { start_byte: number; end_byte: number }, second: { start_byte: number; end_byte: number }): boolean {
  return first.start_byte <= second.start_byte && first.end_byte >= second.end_byte;
}

function validateOverlap(
  db: DatabaseSync,
  decision: ParsedDecision,
  correctedAnnotation: AnnotationRow | null,
): void {
  const structural = db.prepare(`
    SELECT 1 FROM source_atom_reviews JOIN source_spans ON source_spans.id = source_atom_reviews.span_id
    WHERE source_atom_reviews.status = 'active' AND source_spans.ability_version_id = ? AND source_spans.fragment = ?
      AND source_spans.start_byte < ? AND ? < source_spans.end_byte
      AND (? IS NULL OR source_atom_reviews.contained_by_annotation_id IS NOT ?)
    LIMIT 1
  `).get(decision.ability_version_id, decision.fragment, decision.end_byte, decision.start_byte, correctedAnnotation?.id ?? null, correctedAnnotation?.id ?? null);
  if (structural) {
    conflict("A reviewed structural constituent already accounts for these bytes; undo or correct it before painting a leaf over it.");
  }
  const overlaps = activeAnnotationsOverlapping(db, decision.ability_version_id, decision.start_byte, decision.end_byte);
  for (const annotation of overlaps) {
    if (correctedAnnotation?.id === annotation.id) continue;
    if (annotation.role === decision.role) {
      conflict("An active annotation with the same role already overlaps this source span; correct its boundary instead.");
    }
    if (
      !decision.allow_overlap ||
      !contains(decision, annotation) && !contains(annotation, decision)
    ) {
      conflict("Overlapping annotations require distinct roles plus explicit containment approval.");
    }
  }
}

function sourceSpanForDecision(db: DatabaseSync, decision: ParsedDecision): number {
  if (decision.start_byte < 0 || decision.end_byte <= decision.start_byte) {
    invalid("Source span byte offsets must be ordered and non-negative.");
  }
  try {
    return insertSpan(
      db,
      decision.ability_version_id,
      decision.fragment,
      decision.start_byte,
      decision.end_byte,
      decision.exact_text,
    );
  } catch (error) {
    if (error instanceof WorkbenchError) throw error;
    invalid(error instanceof Error ? error.message : "Source span is invalid.");
  }
}

function fingerprintForDecision(db: DatabaseSync, decision: ParsedDecision): { id: string; role: string } {
  if (!decision.family_id || !decision.parameters) {
    invalid(`${decision.action} requires family_id and parameters.`);
  }
  const version = decision.family_version ?? 1;
  let fingerprintId: string;
  let role: string;
  try {
    fingerprintId = validateFingerprint(db, decision.family_id, decision.parameters, version, decision.exact_text);
    role = familyRole(decision.family_id, version);
  } catch (error) {
    invalid(error instanceof Error ? error.message : "Fingerprint parameters are invalid.");
  }
  if (!semanticRoleSet.has(decision.role) || role !== decision.role) {
    invalid("The selected role must be the reviewed family's canonical role.");
  }
  return { id: fingerprintId, role };
}

function proposalFingerprint(db: DatabaseSync, proposal: ProposalRow, decision: ParsedDecision): { id: string; role: string } {
  if (decision.action === "correct") return fingerprintForDecision(db, decision);
  if (!proposal.fingerprint_id || !proposal.family_id || proposal.family_version === null || proposal.parameters_json === null) {
    return fingerprintForDecision(db, decision);
  }
  if (proposal.role !== decision.role) conflict("The selected role conflicts with the proposal.");
  if (decision.family_id !== undefined || decision.family_version !== undefined || decision.parameters !== undefined) {
    const requested = fingerprintForDecision(db, decision);
    if (requested.id !== proposal.fingerprint_id) conflict("The selected fingerprint conflicts with the proposal.");
  }
  return { id: proposal.fingerprint_id, role: proposal.role };
}

function annotationForDecision(
  db: DatabaseSync,
  spanId: number,
  fingerprintId: string,
  reviewer: string,
  batchId: string,
  origin: string,
  correctedAnnotation: AnnotationRow | null,
  createdAt: string,
): number {
  const inserted = db.prepare(`
    INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, created_at)
    VALUES (?, ?, 'active', ?, 'human', ?, ?, ?, ?)
  `).run(
    spanId,
    fingerprintId,
    origin,
    reviewer,
    batchId,
    correctedAnnotation?.id ?? null,
    createdAt,
  );
  if (correctedAnnotation) {
    const changed = db.prepare("UPDATE annotations SET status = 'superseded' WHERE id = ? AND status = 'active'")
      .run(correctedAnnotation.id);
    if (changed.changes !== 1) conflict("The annotation selected for correction changed before the batch was applied.");
  }
  return Number(inserted.lastInsertRowid);
}

function updateProposal(
  db: DatabaseSync,
  proposal: ProposalRow,
  status: "accepted" | "rejected" | "corrected",
): void {
  const update = db.prepare("UPDATE proposals SET status = ? WHERE id = ? AND status = ?")
    .run(status, proposal.id, proposal.status);
  if (update.changes !== 1) conflict("This proposal changed before the batch could be applied.");
}

function createUnconfirmedProposal(
  db: DatabaseSync,
  spanId: number,
  decision: ParsedDecision,
  origin: string,
  createdAt: string,
): number {
  const reason = JSON.stringify({
    kind: decision.action,
    requested_family_id: decision.family_id ?? null,
    requested_family_version: decision.family_version ?? null,
    requested_parameters: decision.parameters ?? null,
  });
  const proposal = db.prepare(`
    INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
    VALUES (?, NULL, ?, ?, NULL, 'unresolved', ?, NULL, ?)
  `).run(spanId, decision.action === "ambiguous" ? "UNRESOLVED" : decision.role, origin, reason, createdAt);
  return Number(proposal.lastInsertRowid);
}

function createLeafGap(
  db: DatabaseSync,
  abilityVersionId: number,
  decision: ParsedDecision,
  batchId: string,
  proposalId: number,
): number {
  const gap = db.prepare(`
    INSERT INTO gaps (ability_version_id, type, status, description, batch_id, proposal_id)
    VALUES (?, 'LEAF_GAP', 'open', ?, ?, ?)
  `).run(
    abilityVersionId,
    `Unresolved source span ${decision.fragment}:${decision.start_byte}-${decision.end_byte}.`,
    batchId,
    proposalId,
  );
  return Number(gap.lastInsertRowid);
}

function resolveLinkedLeafGaps(db: DatabaseSync, proposalId: number, batchId: string): void {
  const gaps = db.prepare(`
    SELECT id, status
    FROM gaps
    WHERE proposal_id = ? AND type = 'LEAF_GAP'
    ORDER BY id
  `).all(proposalId) as Array<{ id: number; status: string }>;
  for (const gap of gaps) {
    if (gap.status !== "open") {
      conflict("The proposal's linked leaf gap was already resolved or changed.");
    }
    const update = db.prepare("UPDATE gaps SET status = 'resolved' WHERE id = ? AND status = 'open'").run(gap.id);
    if (update.changes !== 1) conflict("The proposal's linked leaf gap changed before resolution.");
    addMember(db, batchId, "gap-resolved", gap.id);
  }
}

type AbilityReviewRow = {
  whole_context_checked: number;
  source_shape: string | null;
  cues_json: string;
  reviewed_by: string | null;
};

function reviewView(row: AbilityReviewRow | undefined): AbilityView["review"] {
  return {
    whole_context_checked: row?.whole_context_checked === 1,
    source_shape: row?.source_shape ?? null,
    cues: row ? parseJsonObject(row.cues_json, "review cues") : {},
    reviewed_by: row?.reviewed_by ?? null,
  };
}

function reviewEvidenceHash(row: AbilityReviewRow | undefined): string {
  return hashJson({ exists: row !== undefined, ...reviewView(row) });
}

function abilityView(db: DatabaseSync, ability: AbilityRow): AbilityView {
  const annotations = db.prepare(`
    SELECT annotations.id, annotations.span_id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte,
      source_spans.exact_text, semantic_families.role, fingerprints.family_id, fingerprints.family_version,
      fingerprints.parameters_json, annotations.origin, annotations.confirmed_by, annotations.authority_kind
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id
      AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active' AND source_spans.ability_version_id = ?
    ORDER BY source_spans.start_byte, source_spans.end_byte, annotations.id
  `).all(ability.id) as unknown as Array<AnnotationView & { parameters_json: string }>;
  const proposals = db.prepare(`
    SELECT proposals.id, source_spans.fragment, source_spans.start_byte, source_spans.end_byte, source_spans.exact_text,
      proposals.role, fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json,
      proposals.origin, proposals.reason_json, proposals.score, proposals.status
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    LEFT JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id
    WHERE source_spans.ability_version_id = ?
      AND proposals.status IN ('pending', 'unresolved')
      AND NOT ${RESTATES_ACTIVE_ANNOTATION}
    ORDER BY source_spans.start_byte, source_spans.end_byte, proposals.id
  `).all(ability.id) as unknown as Array<ProposalView & { parameters_json: string | null; reason_json: string }>;
  const review = db.prepare(`
    SELECT whole_context_checked, source_shape, cues_json, reviewed_by
    FROM ability_reviews WHERE ability_version_id = ?
  `).get(ability.id) as AbilityReviewRow | undefined;

  const coverage = getAbilityCoverage(db, ability.id);
  const annotationViews = annotations.map(({ parameters_json, ...annotation }) => ({
    ...annotation,
    parameters: parseJsonObject(parameters_json, "annotation parameters"),
    rule_authorized_by: annotation.authority_kind === "stamp" ? annotation.confirmed_by : null,
  }));
  return {
    id: ability.id,
    current: ability.current === 1,
    faction_id: ability.faction_id,
    ability_id: ability.ability_id,
    source_hash: ability.source_hash,
    review_evidence_hash: reviewEvidenceHash(review),
    source_text: ability.source_text,
    source_type: ability.source_type,
    source_kind: ability.source_kind,
    name: ability.name,
    fragments: parseStoredFragments(ability.fragments_json),
    annotations: annotationViews,
    proposals: proposals.map(({ parameters_json, reason_json, ...proposal }) => ({
      ...proposal,
      family_id: proposal.family_id ?? null,
      family_version: proposal.family_version ?? null,
      parameters: parameters_json === null ? null : parseJsonObject(parameters_json, "proposal parameters"),
      reason: parseJsonObject(reason_json, "proposal reason"),
    })),
    coverage,
    atoms: sourceAtomsForAbility(db, ability.id),
    composition_escalation_id: (db.prepare(`
      SELECT escalations.id FROM escalations
      JOIN escalation_members ON escalation_members.escalation_id = escalations.id
      WHERE escalations.reason_code = 'COMPOSITION_GAP' AND escalations.state = 'open'
        AND escalation_members.status = 'active' AND escalation_members.ability_version_id = ?
        AND escalation_members.source_hash = ?
      ORDER BY escalations.id LIMIT 1
    `).get(ability.id, ability.source_hash) as { id: string } | undefined)?.id ?? null,
    progress: leafProgress(coverage, annotationViews, progressCounts(db, ability.id).get(ability.id), abilityReadiness(db, ability.id)),
    context: resolveAbilityContext(ability.faction_id, ability.ability_id),
    review: reviewView(review),
  };
}

/** Current source factions for an exact sidebar filter. */
export function getFactions(db: DatabaseSync): string[] {
  return (db.prepare("SELECT DISTINCT faction_id FROM abilities WHERE current = 1 ORDER BY faction_id").all() as Array<{ faction_id: string }>)
    .map((row) => row.faction_id);
}

/** Return at most 15 complete current abilities after an opaque source-version cursor. */
export function getAbilities(
  db: DatabaseSync,
  options: { limit?: number; cursor?: string; query?: string; factionId?: string; reviewState?: "pending" | "reviewed" } = {},
): { items: AbilityView[]; next_cursor: string | null } {
  const limit = options.limit ?? 12;
  if (!Number.isSafeInteger(limit) || limit < 10 || limit > 15) invalid("Ability page size must be an integer from 10 through 15.");
  const query = options.query?.trim() ?? "";
  if (query.length > 100) invalid("Ability search is limited to 100 characters.");
  const factionId = options.factionId?.trim() || null;
  if (factionId && factionId.length > 100) invalid("Faction filter is limited to 100 characters.");
  const reviewState = options.reviewState ?? "pending";
  if (reviewState !== "pending" && reviewState !== "reviewed") invalid("Review state must be pending or reviewed.");
  const scope = hashJson({ query, factionId, reviewState });
  const search = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  let after = 0;
  if (options.cursor !== undefined) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
      const cursor = asObject(parsed, "cursor");
      after = asInteger(cursor.after, "cursor.after");
      if (after < 0 || cursor.scope !== scope || Buffer.from(JSON.stringify({ after, scope }), "utf8").toString("base64url") !== options.cursor) {
        invalid("cursor is malformed.");
      }
    } catch (error) {
      if (error instanceof WorkbenchError) throw error;
      invalid("cursor is malformed.");
    }
  }
  const rows = db.prepare(`
    SELECT id, faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, fragments_json, current
    FROM abilities WHERE current = 1 AND id > ?
      AND (? IS NULL OR faction_id = ?)
      AND ${reviewState === "reviewed" ? "" : "NOT "}EXISTS (
        SELECT 1 FROM ability_reviews
        WHERE ability_reviews.ability_version_id = abilities.id
          AND ability_reviews.whole_context_checked = 1
      )
      ${reviewState === "pending" ? `AND NOT EXISTS (
        SELECT 1 FROM assembly_drafts
        JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
        WHERE stamp_applications.ability_version_id = abilities.id
          AND assembly_drafts.status = 'accepted'
          AND stamp_applications.status = 'active'
      )` : ""}
      AND (name LIKE ? ESCAPE '\\' OR ability_id LIKE ? ESCAPE '\\' OR faction_id LIKE ? ESCAPE '\\')
    ORDER BY id LIMIT ?
  `).all(after, factionId, factionId, search, search, search, limit + 1) as AbilityRow[];
  const page = rows.slice(0, limit);
  return {
    items: page.map((ability) => abilityView(db, ability)),
    next_cursor: rows.length > limit
      ? Buffer.from(JSON.stringify({ after: page.at(-1)!.id, scope }), "utf8").toString("base64url")
      : null,
  };
}

/** Return one complete source version. Historical versions remain readable but never list as live work. */
export function getAbility(db: DatabaseSync, abilityVersionId: number): AbilityView {
  if (!Number.isSafeInteger(abilityVersionId) || abilityVersionId < 1) invalid("Ability version id must be positive.");
  return abilityView(db, requireAbility(db, abilityVersionId));
}

/** Record the separate whole-context review action for a current source version. */
export function reviewAbility(db: DatabaseSync, abilityVersionId: number, body: unknown): AbilityView {
  if (!Number.isSafeInteger(abilityVersionId) || abilityVersionId < 1) invalid("Ability version id must be positive.");
  const review = parseReviewBody(body);
  return withTransaction(db, () => {
    const ability = requireCurrentAbility(db, abilityVersionId, review.source_hash);
    const existing = db.prepare(`
      SELECT whole_context_checked, source_shape, cues_json, reviewed_by
      FROM ability_reviews WHERE ability_version_id = ?
    `).get(ability.id) as AbilityReviewRow | undefined;
    if (
      review.expected_review_hash !== undefined
      && review.expected_review_hash !== reviewEvidenceHash(existing)
    ) conflict("Ability review changed; reload updated evidence before saving.");
    db.prepare(`
      INSERT INTO ability_reviews (ability_version_id, whole_context_checked, source_shape, cues_json, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ability_version_id) DO UPDATE SET
        whole_context_checked = excluded.whole_context_checked,
        source_shape = excluded.source_shape,
        cues_json = excluded.cues_json,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at
    `).run(
      ability.id,
      review.whole_context_checked ? 1 : 0,
      review.source_shape ?? existing?.source_shape ?? null,
      JSON.stringify(review.cues ?? (existing ? parseJsonObject(existing.cues_json, "review cues") : {})),
      review.reviewer,
      new Date().toISOString(),
    );
    if (review.whole_context_checked) {
      const readiness = abilityReadiness(db, ability.id);
      if (readiness.ready) {
        createEscalation(db, "COMPOSITION_GAP", {
          source_form_hash: hashJson({ ability_version_id: ability.id, source_hash: ability.source_hash }),
          question: "Compose these confirmed leaves into a complete-source rule without losing conditions, timing, targets, or relations.",
        }, [{ ability_version_id: ability.id, source_hash: ability.source_hash }]);
      }
    }
    if (!review.whole_context_checked) invalidateWholeReview(db, [ability.id]);
    bumpWorkbenchRevision(db);
    return abilityView(db, ability);
  });
}

function proposalTransitionMember(
  outcome: "accepted" | "rejected" | "corrected",
  previousStatus: string,
): string {
  return `proposal-${outcome}${previousStatus === "unresolved" ? "-unresolved" : ""}`;
}

/**
 * Close a novel leaf gap whose original proposal an approved stamp later superseded. Ordinary
 * corrections refuse superseded proposals, and stamps never close gaps, so this explicit human
 * decision chooses the reviewed family, supersedes the stamp annotation at the same span, marks
 * the original proposal corrected, and resolves its gap. Undo restores every part of it.
 */
function resolveStampGap(
  db: DatabaseSync,
  batchId: string,
  reviewer: string,
  decision: ParsedDecision,
  proposal: ProposalRow | null,
  spanId: number,
  createdAt: string,
): void {
  if (!proposal) invalid("resolve-stamp-gap requires proposal_id.");
  if (decision.supersedes_annotation_id === undefined) invalid("resolve-stamp-gap requires supersedes_annotation_id.");
  if (proposal.ability_version_id !== decision.ability_version_id || proposal.span_id !== spanId) {
    conflict("The original proposal does not match the requested source span.");
  }
  if (proposal.status !== "superseded") conflict("Only a proposal superseded by an approved stamp can be resolved this way.");
  const gap = db.prepare("SELECT 1 FROM gaps WHERE proposal_id = ? AND type = 'LEAF_GAP' AND status = 'open' LIMIT 1").get(proposal.id);
  if (!gap) conflict("The proposal has no open linked leaf gap to resolve.");
  const stamped = db.prepare(`
    SELECT annotations.id, annotations.span_id, source_spans.start_byte, source_spans.end_byte,
      semantic_families.role, annotations.fingerprint_id
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version
    WHERE annotations.id = ? AND annotations.status = 'active' AND annotations.authority_kind = 'stamp'
      AND annotations.span_id = ?
      AND EXISTS (
        SELECT 1 FROM stamp_applications JOIN stamps ON stamps.id = stamp_applications.stamp_id AND stamps.revision = stamp_applications.stamp_revision
        WHERE stamp_applications.annotation_id = annotations.id AND stamp_applications.status = 'active' AND stamps.status = 'approved'
      )
  `).get(decision.supersedes_annotation_id, spanId) as AnnotationRow | undefined;
  if (!stamped) conflict("supersedes_annotation_id must be the active, supported stamp annotation on this exact span.");
  const fingerprint = fingerprintForDecision(db, decision);
  const update = db.prepare("UPDATE proposals SET status = 'corrected' WHERE id = ? AND status = 'superseded'").run(proposal.id);
  if (update.changes !== 1) conflict("The original proposal changed before the batch was applied.");
  addMember(db, batchId, "proposal-corrected-superseded", proposal.id);
  resolveLinkedLeafGaps(db, proposal.id, batchId);
  const annotationId = annotationForDecision(db, spanId, fingerprint.id, reviewer, batchId, "manual-stamp-gap", stamped, createdAt);
  addMember(db, batchId, "annotation", annotationId);
}

/** Atomically apply source-bound annotation and unconfirmed-region decisions. */
export function applyAnnotationBatch(
  db: DatabaseSync,
  body: unknown,
): { batch_id: string; applied: number } {
  const batch = parseBatchBody(body);
  return withTransaction(db, () => {
    const batchId = `batch_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES (?, 'review', ?, ?)
    `).run(batchId, batch.reviewer, createdAt);
    const touchedAbilities = new Set<number>();
    for (const decision of batch.decisions) {
      requireCurrentAbility(db, decision.ability_version_id, decision.source_hash);
      const spanId = sourceSpanForDecision(db, decision);
      const proposal = proposalForDecision(db, decision.proposal_id);
      touchedAbilities.add(decision.ability_version_id);
      if (decision.action === "resolve-stamp-gap") {
        resolveStampGap(db, batchId, batch.reviewer, decision, proposal, spanId, createdAt);
        continue;
      }
      if (proposal) assertProposalMatchesDecision(proposal, decision);

      if (decision.action === "confirm-connective") {
        if (!proposal || decision.role !== "CONNECTIVE") {
          invalid("confirm-connective requires the exact pending CONNECTIVE proposal.");
        }
        if (decision.family_id !== undefined || decision.family_version !== undefined || decision.parameters !== undefined) {
          invalid("CONNECTIVE confirmations do not accept a semantic fingerprint.");
        }
        updateProposal(db, proposal, "accepted");
        if (decision.relation !== undefined) {
          db.prepare("UPDATE proposals SET reason_json = json_set(reason_json, '$.reviewed_relation', ?) WHERE id = ?").run(decision.relation, proposal.id);
        }
        addMember(db, batchId, "connective-accepted", proposal.id);
        continue;
      }

      if (decision.action === "reject") {
        if (!proposal) invalid("reject requires proposal_id.");
        updateProposal(db, proposal, "rejected");
        addMember(db, batchId, proposalTransitionMember("rejected", proposal.status), proposal.id);
        resolveLinkedLeafGaps(db, proposal.id, batchId);
        continue;
      }

      if (decision.action === "novel" || decision.action === "ambiguous") {
        if (proposal) {
          const outcome = decision.action === "novel" ? "corrected" : "rejected";
          updateProposal(db, proposal, outcome);
          addMember(db, batchId, proposalTransitionMember(outcome, proposal.status), proposal.id);
          resolveLinkedLeafGaps(db, proposal.id, batchId);
        }
        const unconfirmed = createUnconfirmedProposal(db, spanId, decision, "manual", createdAt);
        const gap = createLeafGap(db, decision.ability_version_id, decision, batchId, unconfirmed);
        addMember(db, batchId, "proposal-created", unconfirmed);
        addMember(db, batchId, "gap-created", gap);
        if (decision.action === "novel") {
          const suggestion = recordCandidateSuggestion(db, {
            role: decision.role,
            exact_text: decision.exact_text,
            span_id: spanId,
            source_hash: decision.source_hash,
            proposal_id: unconfirmed,
            model_run_id: null,
          });
          if (suggestion) addMember(db, batchId, "candidate-suggestion", suggestion.evidence_id);
        }
        continue;
      }

      if (decision.action === "correct" && !proposal && decision.supersedes_annotation_id === undefined) {
        invalid("Correcting a confirmed annotation requires supersedes_annotation_id.");
      }
      let fingerprint: { id: string; role: string };
      if (proposal) fingerprint = proposalFingerprint(db, proposal, decision);
      else fingerprint = fingerprintForDecision(db, decision);
      if (fingerprint.role !== decision.role) invalid("The annotation role does not match its fingerprint.");

      const corrected = decision.action === "correct" ? correctionTarget(db, decision) : null;
      validateOverlap(db, decision, corrected);

      if (proposal) {
        const outcome = decision.action === "confirm" ? "accepted" : "corrected";
        updateProposal(db, proposal, outcome);
        addMember(db, batchId, proposalTransitionMember(outcome, proposal.status), proposal.id);
        resolveLinkedLeafGaps(db, proposal.id, batchId);
      }
      const annotationId = annotationForDecision(
        db,
        spanId,
        fingerprint.id,
        batch.reviewer,
        batchId,
        proposal?.origin ?? (decision.action === "correct" ? "manual-correction" : "manual"),
        corrected,
        createdAt,
      );
      addMember(db, batchId, "annotation", annotationId);
    }
    invalidateAbilityEvidence(db, touchedAbilities, "HUMAN_DECISION_CHANGED");
    applyStamps(db, { ability_version_ids: [...touchedAbilities], bump_revision: false });
    invalidateWholeReview(db, touchedAbilities);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, applied: batch.decisions.length };
  });
}

function parseUndoBody(body: unknown): UndoBatchBody {
  const input = asObject(body, "undo body");
  return { reviewer: asNonblankString(input.reviewer, "reviewer") };
}

type BatchMember = { entity_kind: string; entity_id: string };
type UndoAnnotation = { id: number; span_id: number; supersedes_id: number | null; status: string; ability_version_id: number };

function numericMemberId(member: BatchMember): number {
  const value = Number(member.entity_id);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Persisted batch member has an invalid id.");
  return value;
}

function currentAnnotationForUndo(db: DatabaseSync, annotationId: number): UndoAnnotation {
  const annotation = db.prepare(`
    SELECT annotations.id, annotations.span_id, annotations.supersedes_id, annotations.status, source_spans.ability_version_id
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.id = ?
  `).get(annotationId) as UndoAnnotation | undefined;
  if (!annotation) conflict("An annotation in this batch no longer exists.");
  if (annotation.status !== "active") conflict("This batch cannot be undone because one of its annotations was later changed.");
  return annotation;
}

const PROPOSAL_UNDO_TRANSITIONS: Record<string, { expected: string; restore: string }> = {
  "proposal-accepted": { expected: "accepted", restore: "pending" },
  "proposal-accepted-unresolved": { expected: "accepted", restore: "unresolved" },
  "proposal-rejected": { expected: "rejected", restore: "pending" },
  "proposal-rejected-unresolved": { expected: "rejected", restore: "unresolved" },
  "proposal-corrected": { expected: "corrected", restore: "pending" },
  "proposal-corrected-unresolved": { expected: "corrected", restore: "unresolved" },
  "connective-accepted": { expected: "accepted", restore: "pending" },
  "proposal-corrected-superseded": { expected: "corrected", restore: "superseded" },
};

function assertProposalStatus(db: DatabaseSync, proposalId: number, expected: string): void {
  const row = db.prepare("SELECT status FROM proposals WHERE id = ?").get(proposalId) as { status: string } | undefined;
  if (!row || row.status !== expected) conflict("This batch cannot be undone because one of its proposals was later changed.");
}

function abilityVersionForProposal(db: DatabaseSync, proposalId: number): number {
  const row = db.prepare(`
    SELECT source_spans.ability_version_id
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
    WHERE proposals.id = ?
  `).get(proposalId) as { ability_version_id: number } | undefined;
  if (!row) conflict("A proposal in this batch no longer exists.");
  return row.ability_version_id;
}

function stampRevisionMember(members: BatchMember[], kind: string): { stampId: string; revision: number } {
  const matching = members.filter((member) => member.entity_kind === kind);
  if (matching.length !== 1) conflict("The stamp batch has malformed authority history.");
  const serialized = matching[0]!.entity_id;
  const separator = serialized.lastIndexOf("@");
  const stampId = serialized.slice(0, separator);
  const revision = Number(serialized.slice(separator + 1));
  if (separator < 1 || !stampId || !Number.isSafeInteger(revision) || revision < 1) conflict("The stamp batch has malformed authority history.");
  return { stampId, revision };
}

function undoStampBatch(
  db: DatabaseSync,
  batchId: string,
  operation: "stamp-approval" | "stamp-suspension" | "stamp-rejection",
  reviewer: string,
  members: BatchMember[],
): { batch_id: string; reversed_batch_id: string } {
  const memberKind = operation === "stamp-approval" ? "stamp-approved" : operation === "stamp-suspension" ? "stamp-suspended" : "stamp-rejected";
  const { stampId, revision } = stampRevisionMember(members, memberKind);
  const stamp = db.prepare("SELECT status FROM stamps WHERE id = ? AND revision = ?").get(stampId, revision) as { status: string } | undefined;
  const expected = operation === "stamp-approval" ? "approved" : operation === "stamp-suspension" ? "suspended" : "rejected";
  if (!stamp || stamp.status !== expected) conflict("This stamp batch cannot be undone because later authority decisions changed it.");
  if (operation !== "stamp-approval") {
    const head = db.prepare("SELECT max(revision) AS revision FROM stamps WHERE id = ?").get(stampId) as { revision: number | null };
    if (head.revision !== revision) conflict("This stamp batch cannot be undone after a newer revision decision.");
  }
  if (operation === "stamp-suspension") {
    const approved = db.prepare("SELECT 1 FROM stamps WHERE id = ? AND status = 'approved' AND revision <> ?").get(stampId, revision);
    if (approved) conflict("This suspension cannot be undone while another revision is approved.");
  }
  const reversalId = `undo_${randomUUID()}`;
  db.prepare(`
    INSERT INTO annotation_batches (id, operation, reviewer, created_at, reversed_batch_id)
    VALUES (?, 'undo', ?, ?, ?)
  `).run(reversalId, reviewer, new Date().toISOString(), batchId);
  if (operation === "stamp-approval") {
    db.prepare("UPDATE stamps SET status = 'suspended', updated_at = ? WHERE id = ? AND revision = ? AND status = 'approved'").run(new Date().toISOString(), stampId, revision);
    invalidateStampRevision(db, stampId, revision, "STAMP_APPROVAL_UNDONE");
    applyStamps(db, { bump_revision: false });
    addMember(db, reversalId, "stamp-suspended", `${stampId}@${revision}`);
  } else if (operation === "stamp-suspension") {
    db.prepare("UPDATE stamps SET status = 'approved', updated_at = ? WHERE id = ? AND revision = ? AND status = 'suspended'").run(new Date().toISOString(), stampId, revision);
    applyStamps(db, { bump_revision: false });
    addMember(db, reversalId, "stamp-restored", `${stampId}@${revision}`);
  } else {
    db.prepare("UPDATE stamps SET status = 'proposed', updated_at = ? WHERE id = ? AND revision = ? AND status = 'rejected'").run(new Date().toISOString(), stampId, revision);
    addMember(db, reversalId, "stamp-proposal-restored", `${stampId}@${revision}`);
  }
  bumpWorkbenchRevision(db);
  return { batch_id: batchId, reversed_batch_id: reversalId };
}

/** Append a reviewer-authorized reversal batch; never delete historical evidence. */
export function undoBatch(
  db: DatabaseSync,
  batchId: string,
  body: unknown,
): { batch_id: string; reversed_batch_id: string } {
  if (!batchId.trim()) invalid("batch id must be nonblank.");
  const undo = parseUndoBody(body);
  return withTransaction(db, () => {
    const original = db.prepare(`
      SELECT id, operation, reviewer
      FROM annotation_batches
      WHERE id = ?
    `).get(batchId) as { id: string; operation: string; reviewer: string } | undefined;
    if (!original) missing(`Unknown annotation batch ${batchId}.`);
    if (original.reviewer !== undo.reviewer) conflict("Only the original reviewer can undo this decision batch.");
    const alreadyReversed = db.prepare("SELECT id FROM annotation_batches WHERE reversed_batch_id = ?").get(batchId);
    if (alreadyReversed) conflict("This batch has already been reversed.");
    const members = db.prepare("SELECT entity_kind, entity_id FROM batch_members WHERE batch_id = ? ORDER BY entity_kind, entity_id")
      .all(batchId) as BatchMember[];
    if (original.operation === "stamp-approval" || original.operation === "stamp-suspension" || original.operation === "stamp-rejection") {
      return undoStampBatch(db, batchId, original.operation, undo.reviewer, members);
    }
    if (original.operation !== "review") conflict("This batch operation cannot be undone.");
    const annotationMembers = members.filter((member) => member.entity_kind === "annotation");
    const annotations = annotationMembers.map((member) => currentAnnotationForUndo(db, numericMemberId(member)));
    for (const annotation of annotations) {
      if (annotation.supersedes_id === null) continue;
      const previous = db.prepare("SELECT status FROM annotations WHERE id = ?").get(annotation.supersedes_id) as { status: string } | undefined;
      if (!previous || previous.status !== "superseded") {
        conflict("This batch cannot restore its superseded annotation because it was later changed.");
      }
    }
    assertSourceAtomUndo(db, members);
    assertOntologyUndo(db, batchId, members);
    for (const member of members) {
      const id = numericMemberId(member);
      const proposalTransition = PROPOSAL_UNDO_TRANSITIONS[member.entity_kind];
      if (proposalTransition) assertProposalStatus(db, id, proposalTransition.expected);
      if (member.entity_kind === "proposal-created") assertProposalStatus(db, id, "unresolved");
      if (member.entity_kind === "gap-created") {
        const gap = db.prepare("SELECT status FROM gaps WHERE id = ?").get(id) as { status: string } | undefined;
        if (!gap || gap.status !== "open") conflict("This batch cannot be undone because one of its gaps was later changed.");
      }
      if (member.entity_kind === "gap-resolved") {
        const gap = db.prepare("SELECT status FROM gaps WHERE id = ?").get(id) as { status: string } | undefined;
        if (!gap || gap.status !== "resolved") conflict("This batch cannot reopen a linked leaf gap that was later changed.");
      }
    }

    const reversalId = `undo_${randomUUID()}`;
    db.prepare(`
      INSERT INTO annotation_batches (id, operation, reviewer, created_at, reversed_batch_id)
      VALUES (?, 'undo', ?, ?, ?)
    `).run(reversalId, undo.reviewer, new Date().toISOString(), batchId);
    const touchedAbilities = new Set<number>();
    for (const annotation of annotations) {
      db.prepare("UPDATE annotations SET status = 'retracted' WHERE id = ? AND status = 'active'").run(annotation.id);
      addMember(db, reversalId, "annotation-retracted", annotation.id);
      touchedAbilities.add(annotation.ability_version_id);
      if (annotation.supersedes_id !== null) {
        const restored = db.prepare("UPDATE annotations SET status = 'active' WHERE id = ? AND status = 'superseded'")
          .run(annotation.supersedes_id);
        if (restored.changes !== 1) conflict("The superseded annotation changed during undo.");
        addMember(db, reversalId, "annotation-restored", annotation.supersedes_id);
      }
    }
    for (const member of members) {
      const id = numericMemberId(member);
      const proposalTransition = PROPOSAL_UNDO_TRANSITIONS[member.entity_kind];
      if (proposalTransition) {
        const restored = db.prepare("UPDATE proposals SET status = ? WHERE id = ? AND status = ?")
          .run(proposalTransition.restore, id, proposalTransition.expected);
        if (restored.changes !== 1) conflict("A proposal changed during undo.");
        if (member.entity_kind === "connective-accepted") {
          db.prepare("UPDATE proposals SET reason_json = json_remove(reason_json, '$.reviewed_relation') WHERE id = ?").run(id);
        }
        addMember(db, reversalId, member.entity_kind === "connective-accepted" ? "connective-restored" : "proposal-restored", id);
        touchedAbilities.add(abilityVersionForProposal(db, id));
      }
      if (member.entity_kind === "proposal-created") {
        const retracted = db.prepare("UPDATE proposals SET status = 'rejected' WHERE id = ? AND status = 'unresolved'").run(id);
        if (retracted.changes !== 1) conflict("An unresolved proposal changed during undo.");
        addMember(db, reversalId, "proposal-retracted", id);
        touchedAbilities.add(abilityVersionForProposal(db, id));
      }
      if (member.entity_kind === "gap-created") {
        db.prepare("UPDATE gaps SET status = 'resolved' WHERE id = ? AND status = 'open'").run(id);
        addMember(db, reversalId, "gap-resolved", id);
      }
      if (member.entity_kind === "gap-resolved") {
        const reopened = db.prepare("UPDATE gaps SET status = 'open' WHERE id = ? AND status = 'resolved'").run(id);
        if (reopened.changes !== 1) conflict("A linked leaf gap changed during undo.");
        addMember(db, reversalId, "gap-reopened", id);
      }
    }
    for (const id of applySourceAtomUndo(db, reversalId, members)) touchedAbilities.add(id);
    for (const id of applyOntologyUndo(db, batchId, reversalId, members)) touchedAbilities.add(id);
    invalidateAbilityEvidence(db, touchedAbilities, "HUMAN_UNDO_CHANGED");
    applyStamps(db, { ability_version_ids: [...touchedAbilities], bump_revision: false });
    invalidateWholeReview(db, touchedAbilities);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, reversed_batch_id: reversalId };
  });
}

function currentCount(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { total: number };
  return Number(row.total);
}

/** Aggregate only current source versions; history is retained but never inflates live metrics. */
export function getDashboard(db: DatabaseSync): Record<string, unknown> {
  const currentCoverage = getCurrentCoverage(db);
  const allCoverage = [...currentCoverage.values()];
  let compositionReadyAbilities = 0;
  let accountedComplete = 0;
  for (const state of currentReadiness(db, currentCoverage).values()) {
    if (state.ready) compositionReadyAbilities += 1;
    if (state.unaccounted_bytes === 0 && state.accounted_fraction > 0) accountedComplete += 1;
  }
  const leafHistogram = { below_50: 0, from_50_to_75: 0, from_75_to_95: 0, at_least_95: 0 };
  let wholeReviewed = 0;
  let anyConfirmedCoverage = 0;
  for (const entry of allCoverage) {
    if (entry.leaf_fraction > 0) anyConfirmedCoverage += 1;
    if (entry.whole_reviewed) wholeReviewed += 1;
    if (entry.leaf_fraction < 0.5) leafHistogram.below_50 += 1;
    else if (entry.leaf_fraction < 0.75) leafHistogram.from_50_to_75 += 1;
    else if (entry.leaf_fraction < 0.95) leafHistogram.from_75_to_95 += 1;
    else leafHistogram.at_least_95 += 1;
  }
  const totalSourceRecords = allCoverage.length;
  const gapCounts: Record<"LEAF_GAP" | "RELATION_GAP" | "COMPOSITION_GAP" | "DSL_GAP", number> = {
    LEAF_GAP: 0,
    RELATION_GAP: 0,
    COMPOSITION_GAP: 0,
    DSL_GAP: 0,
  };
  const gapRows = db.prepare(`
    SELECT gaps.type, count(*) AS total FROM gaps
    JOIN abilities ON abilities.id = gaps.ability_version_id
    WHERE abilities.current = 1 AND gaps.status = 'open' GROUP BY gaps.type
  `).all() as Array<{ type: keyof typeof gapCounts; total: number }>;
  for (const row of gapRows) gapCounts[row.type] = Number(row.total);

  const originRows = db.prepare(`
    SELECT proposals.origin, proposals.status, count(*) AS total FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND proposals.status IN ('accepted', 'corrected')
    GROUP BY proposals.origin, proposals.status
  `).all() as Array<{ origin: string; status: "accepted" | "corrected"; total: number }>;
  const perOrigin: Record<string, { accepted: number; corrected: number }> = {};
  for (const row of originRows) {
    const entry = perOrigin[row.origin] ?? { accepted: 0, corrected: 0 };
    entry[row.status] = Number(row.total);
    perOrigin[row.origin] = entry;
  }

  const confirmedOccurrences = currentCount(db, `
    SELECT count(*) AS total FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND annotations.status = 'active'
      AND annotations.authority_kind = 'human'
  `);
  const derivedOccurrences = currentCount(db, `
    SELECT count(*) AS total FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND annotations.status = 'active'
      AND annotations.authority_kind = 'stamp'
      AND EXISTS (
        SELECT 1 FROM stamp_applications
        JOIN stamps ON stamps.id = stamp_applications.stamp_id
          AND stamps.revision = stamp_applications.stamp_revision
        WHERE stamp_applications.annotation_id = annotations.id
          AND stamp_applications.status = 'active' AND stamps.status = 'approved'
      )
  `);
  const pendingProposals = currentCount(db, `
    SELECT count(*) AS total FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND proposals.status = 'pending'
      AND proposals.role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION')
      AND NOT ${RESTATES_ACTIVE_ANNOTATION}
  `);
  const modelProposalRows = db.prepare(`
    SELECT proposals.status, count(*) AS total
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND proposals.model_run_id IS NOT NULL
    GROUP BY proposals.status
    ORDER BY proposals.status
  `).all() as Array<{ status: string; total: number }>;
  const modelProposals: Record<string, number> = {
    pending: 0,
    accepted: 0,
    corrected: 0,
    rejected: 0,
    unresolved: 0,
    superseded: 0,
  };
  for (const row of modelProposalRows) modelProposals[row.status] = Number(row.total);
  const modelProposalOccurrences = modelProposalRows.reduce((total, row) => total + Number(row.total), 0);
  const novelCount = currentCount(db, `
    SELECT count(*) AS total FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND proposals.status = 'unresolved'
  `);
  // Imports and deterministic stamp application are not decisions a reviewer made here.
  const humanDecisionBatches = currentCount(db, `
    SELECT count(*) AS total FROM annotation_batches
    WHERE operation <> 'stamp-application' AND operation NOT LIKE 'import-%'
  `);
  const importBatches = currentCount(db, `
    SELECT count(*) AS total FROM annotation_batches WHERE operation LIKE 'import-%'
  `);
  const lunaActiveAnnotations = currentCount(db, `
    SELECT count(*) AS total FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND annotations.status = 'active' AND annotations.origin = 'luna'
  `);

  const stampRows = db.prepare("SELECT status, count(*) AS total FROM stamps GROUP BY status").all() as Array<{ status: string; total: number }>;
  const stampCounts: Record<string, number> = { proposed: 0, approved: 0, rejected: 0, suspended: 0, superseded: 0 };
  for (const row of stampRows) stampCounts[row.status] = Number(row.total);
  const escalationRows = db.prepare(`
    SELECT escalations.state, count(DISTINCT escalations.id) AS groups,
      count(escalation_members.member_id) AS occurrences
    FROM escalations
    JOIN escalation_members ON escalation_members.escalation_id = escalations.id
      AND escalation_members.status = 'active'
    JOIN abilities ON abilities.id = escalation_members.ability_version_id
      AND abilities.current = 1
    GROUP BY escalations.state
  `).all() as Array<{ state: string; groups: number; occurrences: number }>;
  const escalations: Record<string, { groups: number; occurrences: number }> = {
    open: { groups: 0, occurrences: 0 },
    deferred: { groups: 0, occurrences: 0 },
    resolved: { groups: 0, occurrences: 0 },
  };
  for (const row of escalationRows) {
    escalations[row.state] = { groups: Number(row.groups), occurrences: Number(row.occurrences) };
  }
  // Distinct open escalations with at least one active current member, by reason. LEAF_GAP is a
  // gap row, not an escalation, and is counted separately.
  const openByReason: Record<string, number> = {};
  for (const row of db.prepare(`
    SELECT escalations.reason_code, count(DISTINCT escalations.id) AS total
    FROM escalations
    JOIN escalation_members ON escalation_members.escalation_id = escalations.id AND escalation_members.status = 'active'
    JOIN abilities ON abilities.id = escalation_members.ability_version_id AND abilities.current = 1
      AND abilities.source_hash = escalation_members.source_hash
    WHERE escalations.state = 'open'
    GROUP BY escalations.reason_code
  `).all() as Array<{ reason_code: string; total: number }>) openByReason[row.reason_code] = Number(row.total);
  const openLeafGaps = (db.prepare(`
    SELECT count(*) AS total FROM gaps JOIN abilities ON abilities.id = gaps.ability_version_id
    WHERE gaps.type = 'LEAF_GAP' AND gaps.status = 'open' AND abilities.current = 1
  `).get() as { total: number }).total;
  const draftRows = db.prepare(`
    SELECT assembly_drafts.status, count(*) AS total
    FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE abilities.current = 1
      AND (
        assembly_drafts.status = 'stale'
        OR (
          stamps.status = 'approved'
          AND stamp_applications.status IN ('active', 'blocked')
        )
      )
    GROUP BY assembly_drafts.status
  `).all() as Array<{ status: string; total: number }>;
  const drafts: Record<string, number> = { proposed: 0, accepted: 0, blocked: 0, stale: 0 };
  for (const row of draftRows) drafts[row.status] = Number(row.total);
  const auditActionRows = db.prepare(`
    SELECT verdict, count(*) AS total
    FROM stamp_audit_decisions
    GROUP BY verdict
  `).all() as Array<{ verdict: string; total: number }>;
  const auditActions: Record<string, number> = { correct: 0, incorrect: 0, uncertain: 0 };
  for (const row of auditActionRows) auditActions[row.verdict] = Number(row.total);
  const currentAuditRows = db.prepare(`
    SELECT stamp_audit_decisions.id, stamp_audit_decisions.application_id,
      stamp_audit_decisions.source_hash, stamp_audit_decisions.dependency_hash,
      stamp_audit_decisions.verdict, stamp_applications.status AS application_status,
      stamp_applications.dependencies_json, stamps.status AS stamp_status,
      abilities.current, abilities.source_hash AS current_source_hash
    FROM stamp_audit_decisions
    JOIN stamp_applications ON stamp_applications.id = stamp_audit_decisions.application_id
    JOIN stamps ON stamps.id = stamp_applications.stamp_id
      AND stamps.revision = stamp_applications.stamp_revision
    JOIN abilities ON abilities.id = stamp_audit_decisions.ability_version_id
    ORDER BY stamp_audit_decisions.application_id,
      stamp_audit_decisions.rowid DESC
  `).all() as Array<{
    id: string;
    application_id: string;
    source_hash: string;
    dependency_hash: string;
    verdict: string;
    application_status: string;
    dependencies_json: string;
    stamp_status: string;
    current: number;
    current_source_hash: string;
  }>;
  const latestCurrentAudits = new Map<string, typeof currentAuditRows[number]>();
  for (const row of currentAuditRows) {
    if (
      !latestCurrentAudits.has(row.application_id)
      && row.application_status === "active"
      && row.stamp_status === "approved"
      && row.current === 1
      && row.current_source_hash === row.source_hash
      && hashJson(JSON.parse(row.dependencies_json)) === row.dependency_hash
    ) latestCurrentAudits.set(row.application_id, row);
  }
  const audits: Record<string, number> = { correct: 0, incorrect: 0, uncertain: 0 };
  for (const row of latestCurrentAudits.values()) audits[row.verdict] += 1;

  const fingerprintRows = db.prepare(`
    SELECT annotations.id, fingerprints.family_id, fingerprints.family_version,
      fingerprints.parameters_json, annotation_batches.created_at
    FROM annotations
    JOIN annotation_batches ON annotation_batches.id = annotations.batch_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE annotations.status = 'active' AND abilities.current = 1
      AND annotations.authority_kind = 'human'
    ORDER BY annotation_batches.created_at, annotations.id
  `).all() as Array<{ id: number; family_id: string; family_version: number; parameters_json: string }>;
  const seenFamilies = new Set<string>();
  const seenParameterSchemas = new Set<string>();
  const fingerprintDiscovery = fingerprintRows.map((row, index) => {
    const family = `${row.family_id}@${row.family_version}`;
    const parameters = JSON.parse(row.parameters_json) as Record<string, unknown>;
    seenFamilies.add(family);
    seenParameterSchemas.add(`${family}:${Object.entries(parameters)
      .map(([key, value]) => `${key}:${typeof value === "object" ? "source" : typeof value}`)
      .sort().join(",")}`);
    return { review_order: index + 1, families: seenFamilies.size, parameter_schemas: seenParameterSchemas.size };
  });
  const shapeRows = db.prepare(`
    SELECT ability_reviews.source_shape FROM ability_reviews
    JOIN abilities ON abilities.id = ability_reviews.ability_version_id
    WHERE abilities.current = 1 AND ability_reviews.whole_context_checked = 1
      AND ability_reviews.source_shape IS NOT NULL
    ORDER BY ability_reviews.reviewed_at, ability_reviews.ability_version_id
  `).all() as Array<{ source_shape: string }>;
  const seenShapes = new Set<string>();
  const shapeDiscovery = shapeRows.map((row, index) => {
    seenShapes.add(row.source_shape);
    return { review_order: index + 1, source_shapes: seenShapes.size };
  });

  const average = (field: "leaf_fraction" | "human_leaf_fraction" | "stamp_leaf_fraction"): number | null =>
    totalSourceRecords === 0 ? null : allCoverage.reduce((total, entry) => total + entry[field], 0) / totalSourceRecords;
  const acceptedDrafts = drafts.accepted ?? 0;
  return {
    total_source_records: totalSourceRecords,
    abilities_with_confirmed_coverage: anyConfirmedCoverage,
    confirmed_occurrences: confirmedOccurrences,
    derived_occurrences: derivedOccurrences,
    pending_proposals: pendingProposals,
    novel_count: novelCount,
    leaf_histogram: leafHistogram,
    model_proposal_occurrences: modelProposalOccurrences,
    model_proposals: modelProposals,
    coverage: {
      provisional_abilities: totalSourceRecords - wholeReviewed,
      whole_reviewed_abilities: wholeReviewed,
      average_leaf_fraction: average("leaf_fraction"),
      average_human_leaf_fraction: average("human_leaf_fraction"),
      average_stamp_leaf_fraction: average("stamp_leaf_fraction"),
    },
    gap_counts: gapCounts,
    discovery: { fingerprint_by_review_order: fingerprintDiscovery, source_shape_by_review_order: shapeDiscovery },
    per_origin: perOrigin,
    active_stamps: stampCounts.approved ?? 0,
    stamps: stampCounts,
    escalations,
    open_escalations_by_reason: openByReason,
    open_leaf_gaps: Number(openLeafGaps),
    drafts,
    human_decisions: humanDecisionBatches,
    import_batches: importBatches,
    luna: { active_annotations: lunaActiveAnnotations },
    composition_ready_abilities: compositionReadyAbilities,
    fully_accounted_abilities: accountedComplete,
    audits,
    audit_actions: auditActions,
    accepted_complete_drafts: acceptedDrafts,
    accepted_complete_drafts_per_human_decision: humanDecisionBatches === 0 ? null : acceptedDrafts / humanDecisionBatches,
    human_actions_per_confirmed_occurrence: confirmedOccurrences === 0 ? null : humanDecisionBatches / confirmedOccurrences,
    confirmations_per_batch: humanDecisionBatches === 0 ? null : confirmedOccurrences / humanDecisionBatches,
  };
}

/** Build the versioned private current-state interchange; history remains canonical in SQLite. */
export function getPrivateExport(db: DatabaseSync): Record<string, unknown> {
  const annotations = db.prepare(`
    SELECT annotations.id, annotations.authority_kind, annotations.origin,
      annotations.confirmed_by, annotations.batch_id,
      abilities.id AS ability_version_id, abilities.faction_id, abilities.ability_id,
      abilities.source_hash, source_spans.fragment, source_spans.start_byte,
      source_spans.end_byte, source_spans.exact_text, fingerprints.family_id,
      fingerprints.family_version, fingerprints.parameters_json
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.status = 'active' AND abilities.current = 1
      AND (
        annotations.authority_kind = 'human'
        OR EXISTS (
          SELECT 1 FROM stamp_applications
          JOIN stamps ON stamps.id = stamp_applications.stamp_id
            AND stamps.revision = stamp_applications.stamp_revision
          WHERE stamp_applications.annotation_id = annotations.id
            AND stamp_applications.status = 'active'
            AND stamps.status = 'approved'
        )
      )
    ORDER BY abilities.faction_id, abilities.ability_id,
      source_spans.start_byte, source_spans.end_byte, annotations.id
  `).all() as Array<{
    id: number;
    authority_kind: "human" | "stamp";
    origin: string;
    confirmed_by: string;
    batch_id: string;
    ability_version_id: number;
    faction_id: string;
    ability_id: string;
    source_hash: string;
    fragment: string;
    start_byte: number;
    end_byte: number;
    exact_text: string;
    family_id: string;
    family_version: number;
    parameters_json: string;
  }>;
  const applicationRows = db.prepare(`
    SELECT stamp_applications.*, abilities.source_hash
    FROM stamp_applications
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE abilities.current = 1
    ORDER BY stamp_applications.stamp_id, stamp_applications.stamp_revision,
      stamp_applications.ability_version_id, stamp_applications.id
  `).all() as Array<Record<string, unknown> & {
    bindings_json: string;
    dependencies_json: string;
  }>;
  const applications = applicationRows.map(({ bindings_json, dependencies_json, ...application }) => ({
    ...application,
    bindings: JSON.parse(bindings_json) as unknown,
    dependencies: JSON.parse(dependencies_json) as unknown,
  }));
  const modelRuns = new Map((db.prepare(`
    SELECT id, model, model_version, prompt_version, input_hash, config_json,
      output_json, latency_ms, cost_usd, status, created_at
    FROM model_runs ORDER BY id
  `).all() as Array<Record<string, unknown> & {
    id: number;
    config_json: string;
    output_json: string | null;
  }>).map(({ config_json, output_json, ...run }) => [run.id, {
    ...run,
    config: JSON.parse(config_json) as unknown,
    output: output_json === null ? null : JSON.parse(output_json) as unknown,
  }]));
  const stampRows = db.prepare("SELECT * FROM stamps ORDER BY id, revision").all() as Array<Record<string, unknown> & {
    id: string;
    revision: number;
    definition_json: string;
    model_run_id: number | null;
    challenge_run_id: number | null;
    approval_batch_id: string | null;
  }>;
  const evidenceRows = db.prepare(`
    SELECT stamp_id, stamp_revision, evidence_kind, ordinal, evidence_json
    FROM stamp_evidence ORDER BY stamp_id, stamp_revision, evidence_kind, ordinal
  `).all() as Array<{
    stamp_id: string;
    stamp_revision: number;
    evidence_kind: "positive" | "counterexample";
    ordinal: number;
    evidence_json: string;
  }>;
  const stamps = stampRows.map(({ definition_json, ...stamp }) => ({
    ...stamp,
    definition: JSON.parse(definition_json) as unknown,
    positives: evidenceRows.filter((evidence) =>
      evidence.stamp_id === stamp.id
      && evidence.stamp_revision === stamp.revision
      && evidence.evidence_kind === "positive")
      .map((evidence) => JSON.parse(evidence.evidence_json) as unknown),
    counterexamples: evidenceRows.filter((evidence) =>
      evidence.stamp_id === stamp.id
      && evidence.stamp_revision === stamp.revision
      && evidence.evidence_kind === "counterexample")
      .map((evidence) => JSON.parse(evidence.evidence_json) as unknown),
    proposal_receipt: stamp.model_run_id === null ? null : modelRuns.get(stamp.model_run_id) ?? null,
    challenge_receipt: stamp.challenge_run_id === null ? null : modelRuns.get(stamp.challenge_run_id) ?? null,
  }));
  const draftRows = db.prepare(`
    SELECT assembly_drafts.*, stamp_applications.ability_version_id,
      abilities.faction_id, abilities.ability_id, abilities.source_hash
    FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE abilities.current = 1
    ORDER BY assembly_drafts.id
  `).all() as Array<Record<string, unknown> & {
    graph_json: string;
    mechanics_json: string | null;
    diagnostic_json: string;
    verifier_run_id: number | null;
  }>;
  const drafts = draftRows.map(({ graph_json, mechanics_json, diagnostic_json, ...draft }) => ({
    ...draft,
    graph: JSON.parse(graph_json) as unknown,
    mechanics: mechanics_json === null ? null : JSON.parse(mechanics_json) as unknown,
    diagnostic: JSON.parse(diagnostic_json) as unknown,
    verifier_receipt: draft.verifier_run_id === null ? null : modelRuns.get(draft.verifier_run_id) ?? null,
  }));
  const escalationRows = db.prepare("SELECT * FROM escalations ORDER BY id").all() as Array<Record<string, unknown> & {
    id: string;
    question_json: string;
    options_json: string;
    decision_batch_id: string | null;
  }>;
  const escalationMembers = db.prepare(`
    SELECT escalation_members.*, source_spans.fragment, source_spans.start_byte,
      source_spans.end_byte, source_spans.exact_text
    FROM escalation_members
    JOIN abilities ON abilities.id = escalation_members.ability_version_id
    LEFT JOIN source_spans ON source_spans.id = escalation_members.span_id
    WHERE escalation_members.status = 'active' AND abilities.current = 1
    ORDER BY escalation_members.escalation_id, escalation_members.member_id
  `).all() as Array<Record<string, unknown> & { escalation_id: string }>;
  const escalations = escalationRows.flatMap(({ question_json, options_json, ...escalation }) => {
    const members = escalationMembers.filter((candidate) => candidate.escalation_id === escalation.id);
    return members.length === 0 ? [] : [{
      ...escalation,
      question: JSON.parse(question_json) as unknown,
      options: JSON.parse(options_json) as unknown,
      members,
    }];
  });
  const audits = db.prepare(`
    SELECT stamp_audit_decisions.*
    FROM stamp_audit_decisions
    JOIN abilities ON abilities.id = stamp_audit_decisions.ability_version_id
      AND abilities.current = 1
      AND abilities.source_hash = stamp_audit_decisions.source_hash
    ORDER BY stamp_audit_decisions.created_at, stamp_audit_decisions.id
  `).all() as Array<Record<string, unknown> & { batch_id: string }>;
  const batchIds = new Set<string>();
  for (const annotation of annotations) batchIds.add(annotation.batch_id);
  for (const stamp of stampRows) if (stamp.approval_batch_id !== null) batchIds.add(stamp.approval_batch_id);
  for (const escalation of escalationRows) if (escalation.decision_batch_id !== null) batchIds.add(escalation.decision_batch_id);
  for (const audit of audits) batchIds.add(audit.batch_id);
  for (const row of db.prepare(`
    SELECT DISTINCT batch_id FROM batch_members
    WHERE entity_kind IN ('stamp-approved', 'stamp-suspended', 'stamp-rejected')
  `).all() as Array<{ batch_id: string }>) batchIds.add(row.batch_id);
  const decisionBatches = (db.prepare("SELECT * FROM annotation_batches ORDER BY created_at, id").all() as Array<Record<string, unknown> & {
    id: string;
    metadata_json: string;
  }>)
    .filter((decision) => batchIds.has(decision.id))
    .map(({ metadata_json, ...decision }) => ({
      ...decision,
      metadata: JSON.parse(metadata_json) as unknown,
      members: db.prepare(`
        SELECT entity_kind, entity_id FROM batch_members
        WHERE batch_id = ? ORDER BY entity_kind, entity_id
      `).all(decision.id),
    }));
  return {
    schema_version: 1,
    kind: "round5c-private-current-state",
    exported_at: new Date().toISOString(),
    workbench_revision: getWorkbenchRevision(db),
    annotations: annotations.map(({ parameters_json, confirmed_by, ...annotation }) => ({
      ...annotation,
      parameters: JSON.parse(parameters_json) as unknown,
      human_confirmed_by: annotation.authority_kind === "human" ? confirmed_by : null,
      rule_authorized_by: annotation.authority_kind === "stamp" ? confirmed_by : null,
    })),
    stamps,
    applications,
    drafts,
    escalations,
    audits,
    decision_batches: decisionBatches,
  };
}
