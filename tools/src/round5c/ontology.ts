import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { REVIEWED_FAMILY_REGISTRY, reviewedFamily, validateFingerprint } from "./contracts.js";
import { bumpWorkbenchRevision, getWorkbenchRevision, invalidateWholeReview, withTransaction } from "./db.js";

/**
 * The provisional family ontology: NOVEL source forms grouped into candidates with per-
 * occurrence evidence. A candidate is a hypothesis, never a reviewed family. Human judgment
 * records support or counterexamples for one occurrence at a time; mapping to an existing
 * reviewed family only re-enters supported occurrences as pending proposals; a genuinely new
 * family is an ontology stop that requires a maintainer code change.
 */

export class OntologyError extends Error {
  readonly status: number;

  constructor(status: 404 | 409 | 422, message: string) {
    super(message);
    this.name = "OntologyError";
    this.status = status;
  }
}

const invalid = (message: string): never => { throw new OntologyError(422, message); };
const conflict = (message: string): never => { throw new OntologyError(409, message); };

export const HUMAN_VERDICTS = ["supports", "counterexample", "insufficient"] as const;
export type HumanVerdict = typeof HUMAN_VERDICTS[number];
export type Verdict = HumanVerdict | "suggested";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be a JSON object.`);
  return value as JsonRecord;
}

function text(value: unknown, label: string, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid(`${label} must be a nonblank string of at most ${max} characters.`);
  return (value as string).trim();
}

function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid(`${label} must be a positive integer.`);
  return value as number;
}

function requireRevision(db: DatabaseSync, expected: unknown): void {
  const revision = typeof expected === "number" && Number.isSafeInteger(expected) ? expected : invalid("expected_revision must be an integer.");
  if (getWorkbenchRevision(db) !== revision) conflict("The workbench changed since this candidate was loaded; reload before deciding.");
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

type CandidateRow = {
  id: number; role: string; label: string; distinction: string; parameter_hints_json: string; signature: string;
  state: "open" | "mapped" | "dismissed"; created_from_model_run_id: number | null;
  mapped_family_id: string | null; mapped_family_version: number | null; created_at: string; updated_at: string;
};

type EvidenceRow = {
  id: number; candidate_id: number; span_id: number; source_hash: string; proposal_id: number | null; verdict: Verdict;
  explanation: string | null; model_run_id: number | null; reviewer: string | null; batch_id: string | null;
  supersedes_evidence_id: number | null; revoked_at: string | null; created_at: string;
};

function candidateRow(db: DatabaseSync, id: number): CandidateRow {
  const row = db.prepare("SELECT * FROM family_candidates WHERE id = ?").get(id) as CandidateRow | undefined;
  if (!row) throw new OntologyError(404, `Unknown family candidate ${id}.`);
  return row;
}

/** One source occurrence of a candidate with its effective (latest unrevoked) verdict. */
export type CandidateOccurrence = {
  span_id: number;
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  /** False once the source version is retired or its hash changed; stale evidence never counts. */
  current: boolean;
  proposal_id: number | null;
  proposal_status: string | null;
  effective: { evidence_id: number; verdict: Verdict; reviewer: string | null; explanation: string | null };
  history: Array<{ evidence_id: number; verdict: Verdict; reviewer: string | null; explanation: string | null; revoked: boolean; created_at: string; model_run_id: number | null }>;
};

function occurrences(db: DatabaseSync, candidateId: number): CandidateOccurrence[] {
  const rows = db.prepare(`
    SELECT family_candidate_evidence.*, source_spans.ability_version_id, source_spans.fragment, source_spans.start_byte,
      source_spans.end_byte, source_spans.exact_text, abilities.faction_id, abilities.ability_id,
      abilities.current AS ability_current, abilities.source_hash AS ability_hash, proposals.status AS proposal_status
    FROM family_candidate_evidence
    JOIN source_spans ON source_spans.id = family_candidate_evidence.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    LEFT JOIN proposals ON proposals.id = family_candidate_evidence.proposal_id
    WHERE family_candidate_evidence.candidate_id = ?
    ORDER BY abilities.faction_id, abilities.ability_id, source_spans.start_byte, family_candidate_evidence.id
  `).all(candidateId) as Array<EvidenceRow & {
    ability_version_id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string;
    faction_id: string; ability_id: string; ability_current: number; ability_hash: string; proposal_status: string | null;
  }>;
  const bySpan = new Map<number, typeof rows>();
  for (const row of rows) {
    const group = bySpan.get(row.span_id);
    if (group) group.push(row);
    else bySpan.set(row.span_id, [row]);
  }
  return [...bySpan.values()].flatMap((group): CandidateOccurrence[] => {
    const live = group.filter((row) => row.revoked_at === null);
    const effective = [...live].reverse().find((row) => row.verdict !== "suggested") ?? live.find((row) => row.verdict === "suggested");
    if (!effective) return [];
    const first = group[0]!;
    const suggestion = group.find((row) => row.verdict === "suggested");
    return [{
      span_id: first.span_id,
      ability_version_id: first.ability_version_id,
      faction_id: first.faction_id,
      ability_id: first.ability_id,
      source_hash: first.source_hash,
      fragment: first.fragment,
      start_byte: first.start_byte,
      end_byte: first.end_byte,
      exact_text: first.exact_text,
      current: first.ability_current === 1 && first.ability_hash === first.source_hash,
      proposal_id: suggestion?.proposal_id ?? null,
      proposal_status: suggestion?.proposal_status ?? null,
      effective: { evidence_id: effective.id, verdict: effective.verdict, reviewer: effective.reviewer, explanation: effective.explanation },
      history: group.map((row) => ({
        evidence_id: row.id, verdict: row.verdict, reviewer: row.reviewer, explanation: row.explanation,
        revoked: row.revoked_at !== null, created_at: row.created_at, model_run_id: row.model_run_id,
      })),
    }];
  });
}

export type CandidateSummary = {
  id: number;
  role: string;
  label: string;
  distinction: string;
  parameter_hints: string[];
  state: CandidateRow["state"];
  mapped_family: { id: string; version: number } | null;
  created_from_model_run_id: number | null;
  /** Counts over current occurrences only; stale evidence is reported separately. */
  current: Record<Verdict, number>;
  stale: number;
  factions: string[];
};

function summarize(row: CandidateRow, items: readonly CandidateOccurrence[]): CandidateSummary {
  const current: Record<Verdict, number> = { suggested: 0, supports: 0, counterexample: 0, insufficient: 0 };
  for (const item of items) if (item.current) current[item.effective.verdict] += 1;
  return {
    id: row.id,
    role: row.role,
    label: row.label,
    distinction: row.distinction,
    parameter_hints: JSON.parse(row.parameter_hints_json) as string[],
    state: row.state,
    mapped_family: row.mapped_family_id === null ? null : { id: row.mapped_family_id, version: row.mapped_family_version! },
    created_from_model_run_id: row.created_from_model_run_id,
    current,
    stale: items.filter((item) => !item.current).length,
    factions: [...new Set(items.filter((item) => item.current).map((item) => item.faction_id))].sort(),
  };
}

/** Every candidate, optionally limited to those with current evidence in one faction. */
export function getOntology(db: DatabaseSync, options: { faction?: string } = {}): { candidates: CandidateSummary[]; revision: number } {
  const rows = db.prepare("SELECT * FROM family_candidates ORDER BY state = 'open' DESC, id").all() as CandidateRow[];
  const candidates = rows.map((row) => summarize(row, occurrences(db, row.id)))
    .filter((candidate) => !options.faction || candidate.factions.includes(options.faction));
  return { candidates, revision: getWorkbenchRevision(db) };
}

/** The explicit, code-level path that promotes a candidate into a new reviewed family. */
export const NEW_FAMILY_STEPS = [
  "Add the family to REVIEWED_FAMILY_REGISTRY in tools/src/round5c/contracts.ts with its role, label, and parameter schema.",
  "Extend normalizeFingerprintParameters and validateFamilySource for any source-qualified parameters.",
  "Re-run initializeWorkbench so seedReviewedFamilies records the new family; registry drift is rejected.",
  "Only if the mechanic needs a new DSL shape: change the Ability DSL schema and the TS, Rust, Python, and Go describers with conformance cases.",
  "Then map this candidate to the new family and review each re-entered occurrence.",
] as const;

/** One candidate with every occurrence, its history, and the promotion paths it can take. */
export function getFamilyCandidate(db: DatabaseSync, id: number): CandidateSummary & {
  occurrences: CandidateOccurrence[];
  revision: number;
  promotion: { existing_families: Array<{ id: string; version: number; label: string }>; new_family_steps: readonly string[] };
} {
  const row = candidateRow(db, id);
  const items = occurrences(db, id);
  return {
    ...summarize(row, items),
    occurrences: items,
    revision: getWorkbenchRevision(db),
    promotion: {
      existing_families: REVIEWED_FAMILY_REGISTRY.filter((family) => family.role === row.role)
        .map((family) => ({ id: family.id, version: family.version, label: family.label })),
      new_family_steps: NEW_FAMILY_STEPS,
    },
  };
}

/**
 * Record a human verdict for one occurrence. It appends a row that supersedes the prior
 * effective verdict; undo revokes it so the prior verdict reappears. Stale sources refuse.
 */
export function judgeCandidate(db: DatabaseSync, candidateId: number, body: unknown): { batch_id: string; evidence_id: number } {
  const input = record(body, "body");
  const evidenceId = positive(input.evidence_id, "evidence_id");
  const verdict = text(input.verdict, "verdict", 32);
  if (!(HUMAN_VERDICTS as readonly string[]).includes(verdict)) invalid(`verdict must be one of ${HUMAN_VERDICTS.join(", ")}.`);
  const explanation = text(input.explanation, "explanation");
  const reviewer = text(input.reviewer, "reviewer", 100);
  return withTransaction(db, () => {
    requireRevision(db, input.expected_revision);
    candidateRow(db, candidateId);
    const target = db.prepare("SELECT * FROM family_candidate_evidence WHERE id = ? AND candidate_id = ?").get(evidenceId, candidateId) as EvidenceRow | undefined;
    if (!target) throw new OntologyError(404, `Evidence ${evidenceId} does not belong to candidate ${candidateId}.`);
    const occurrence = occurrences(db, candidateId).find((item) => item.span_id === target.span_id);
    if (!occurrence) conflict("This occurrence has no live evidence left to judge.");
    if (!occurrence!.current) conflict("This occurrence's source changed; judge only current source.");
    const batchId = createBatch(db, reviewer, { kind: "candidate-judgment", candidate_id: candidateId });
    const inserted = Number(db.prepare(`
      INSERT INTO family_candidate_evidence (
        candidate_id, span_id, source_hash, proposal_id, verdict, explanation, model_run_id, reviewer, batch_id,
        supersedes_evidence_id, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)
    `).run(candidateId, target.span_id, occurrence!.source_hash, occurrence!.proposal_id, verdict, explanation, reviewer, batchId,
      occurrence!.effective.evidence_id, new Date().toISOString()).lastInsertRowid);
    addMember(db, batchId, "candidate-judgment", inserted);
    db.prepare("UPDATE family_candidates SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), candidateId);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, evidence_id: inserted };
  });
}

/** Dismiss or reopen a candidate without losing any evidence. */
export function setCandidateState(db: DatabaseSync, candidateId: number, body: unknown): { batch_id: string; state: string } {
  const input = record(body, "body");
  const state = text(input.state, "state", 16);
  if (state !== "open" && state !== "dismissed") invalid("state must be open or dismissed.");
  const reviewer = text(input.reviewer, "reviewer", 100);
  return withTransaction(db, () => {
    requireRevision(db, input.expected_revision);
    const row = candidateRow(db, candidateId);
    if (row.state === "mapped") conflict("A mapped candidate cannot change state; undo its mapping batch first.");
    if (row.state === state) conflict(`The candidate is already ${state}.`);
    const batchId = createBatch(db, reviewer, { kind: "candidate-state", candidate_id: candidateId, prior_state: row.state });
    db.prepare("UPDATE family_candidates SET state = ?, updated_at = ? WHERE id = ?").run(state, new Date().toISOString(), candidateId);
    addMember(db, batchId, "candidate-state", candidateId);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, state };
  });
}

/**
 * Map a candidate to an existing, role-compatible reviewed family. Only selected, current,
 * human-supported occurrences re-enter as pending fingerprinted proposals for individual human
 * confirmation; nothing is confirmed and the original linked gaps stay open.
 */
export function mapCandidate(db: DatabaseSync, candidateId: number, body: unknown): { batch_id: string; proposals: number[] } {
  const input = record(body, "body");
  const familyId = text(input.family_id, "family_id", 64);
  const familyVersion = positive(input.family_version, "family_version");
  const reviewer = text(input.reviewer, "reviewer", 100);
  if (!Array.isArray(input.occurrences) || input.occurrences.length === 0) invalid("occurrences must be a nonempty array.");
  const requested = (input.occurrences as unknown[]).map((value, index) => {
    const occurrence = record(value, `occurrences[${index}]`);
    return { proposal_id: positive(occurrence.proposal_id, `occurrences[${index}].proposal_id`), parameters: record(occurrence.parameters, `occurrences[${index}].parameters`) };
  });
  if (new Set(requested.map((item) => item.proposal_id)).size !== requested.length) invalid("occurrences repeat a proposal.");
  let family: ReturnType<typeof reviewedFamily>;
  try {
    family = reviewedFamily(familyId, familyVersion);
  } catch {
    return conflict(`${familyId}@${familyVersion} is not a reviewed family. A new family needs a maintainer code change first.`);
  }
  return withTransaction(db, () => {
    requireRevision(db, input.expected_revision);
    const row = candidateRow(db, candidateId);
    if (row.state !== "open") conflict(`Only an open candidate can be mapped; this one is ${row.state}.`);
    if (family.role !== row.role) invalid(`${familyId} is a ${family.role} family; this candidate is ${row.role}.`);
    const items = occurrences(db, candidateId);
    const batchId = createBatch(db, reviewer, { kind: "candidate-map", candidate_id: candidateId, family_id: familyId, family_version: familyVersion });
    const created: number[] = [];
    const touched = new Set<number>();
    const now = new Date().toISOString();
    for (const occurrence of requested) {
      const item = items.find((candidate) => candidate.proposal_id === occurrence.proposal_id);
      if (!item) invalid(`Proposal ${occurrence.proposal_id} is not an occurrence of this candidate.`);
      if (!item!.current) conflict(`Proposal ${occurrence.proposal_id}'s source changed; map only current source.`);
      if (item!.effective.verdict !== "supports") conflict(`Proposal ${occurrence.proposal_id} has no current human "supports" verdict.`);
      let fingerprintId: string;
      try {
        fingerprintId = validateFingerprint(db, familyId, occurrence.parameters, familyVersion, item!.exact_text);
      } catch (error) {
        return invalid(error instanceof Error ? error.message : "Parameters do not satisfy the family.");
      }
      const pending = db.prepare(`
        SELECT 1 FROM proposals WHERE span_id = ? AND fingerprint_id = ? AND status = 'pending' LIMIT 1
      `).get(item!.span_id, fingerprintId);
      if (pending) conflict(`A pending proposal already offers this fingerprint for proposal ${occurrence.proposal_id}'s span.`);
      const proposalId = Number(db.prepare(`
        INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
        VALUES (?, ?, ?, 'candidate-map', NULL, 'pending', ?, NULL, ?)
      `).run(item!.span_id, fingerprintId, row.role, JSON.stringify({
        type: "candidate-map", candidate_id: candidateId, original_proposal_id: occurrence.proposal_id, batch_id: batchId,
      }), now).lastInsertRowid);
      created.push(proposalId);
      touched.add(item!.ability_version_id);
      addMember(db, batchId, "mapped-proposal-created", proposalId);
    }
    db.prepare(`
      UPDATE family_candidates SET state = 'mapped', mapped_family_id = ?, mapped_family_version = ?, updated_at = ? WHERE id = ?
    `).run(familyId, familyVersion, now, candidateId);
    addMember(db, batchId, "candidate-mapped", candidateId);
    invalidateWholeReview(db, touched);
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, proposals: created };
  });
}

type Member = { entity_kind: string; entity_id: string };
const ONTOLOGY_KINDS = new Set(["candidate-judgment", "candidate-suggestion", "candidate-state", "candidate-mapped", "mapped-proposal-created"]);

/** Refuse to undo ontology decisions that later decisions depend on. */
export function assertOntologyUndo(db: DatabaseSync, batchId: string, members: readonly Member[]): void {
  for (const member of members) {
    if (!ONTOLOGY_KINDS.has(member.entity_kind)) continue;
    const id = Number(member.entity_id);
    if (member.entity_kind === "candidate-judgment" || member.entity_kind === "candidate-suggestion") {
      const row = db.prepare("SELECT candidate_id, span_id, revoked_at FROM family_candidate_evidence WHERE id = ?").get(id) as { candidate_id: number; span_id: number; revoked_at: string | null } | undefined;
      if (!row || row.revoked_at !== null) conflict("This batch's candidate evidence was already revoked.");
      const later = db.prepare(`
        SELECT 1 FROM family_candidate_evidence
        WHERE candidate_id = ? AND span_id = ? AND id > ? AND revoked_at IS NULL AND verdict <> 'suggested' LIMIT 1
      `).get(row!.candidate_id, row!.span_id, id);
      if (later) conflict("A later verdict on this occurrence depends on this one; undo that first.");
    } else if (member.entity_kind === "mapped-proposal-created") {
      const row = db.prepare("SELECT status FROM proposals WHERE id = ?").get(id) as { status: string } | undefined;
      if (!row || row.status !== "pending") conflict("A mapped proposal from this batch was already decided; undo that decision first.");
    } else {
      const row = db.prepare("SELECT state FROM family_candidates WHERE id = ?").get(id) as { state: string } | undefined;
      const metadata = JSON.parse((db.prepare("SELECT metadata_json FROM annotation_batches WHERE id = ?").get(batchId) as { metadata_json: string }).metadata_json) as { prior_state?: string };
      const expected = member.entity_kind === "candidate-mapped" ? "mapped" : metadata.prior_state === "open" ? "dismissed" : "open";
      if (!row || row.state !== expected) conflict("This candidate's state changed after this batch.");
    }
  }
}

/** Reverse ontology decisions in a batch; returns the ability versions whose proposals changed. */
export function applyOntologyUndo(db: DatabaseSync, batchId: string, reversalId: string, members: readonly Member[]): Set<number> {
  const touched = new Set<number>();
  const now = new Date().toISOString();
  for (const member of members) {
    if (!ONTOLOGY_KINDS.has(member.entity_kind)) continue;
    const id = Number(member.entity_id);
    if (member.entity_kind === "candidate-judgment" || member.entity_kind === "candidate-suggestion") {
      db.prepare("UPDATE family_candidate_evidence SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now, id);
      addMember(db, reversalId, "candidate-evidence-revoked", id);
    } else if (member.entity_kind === "mapped-proposal-created") {
      db.prepare("UPDATE proposals SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(id);
      const ability = db.prepare("SELECT source_spans.ability_version_id FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id WHERE proposals.id = ?").get(id) as { ability_version_id: number };
      touched.add(ability.ability_version_id);
      addMember(db, reversalId, "mapped-proposal-retracted", id);
    } else if (member.entity_kind === "candidate-mapped") {
      db.prepare("UPDATE family_candidates SET state = 'open', mapped_family_id = NULL, mapped_family_version = NULL, updated_at = ? WHERE id = ?").run(now, id);
      addMember(db, reversalId, "candidate-unmapped", id);
    } else {
      const metadata = JSON.parse((db.prepare("SELECT metadata_json FROM annotation_batches WHERE id = ?").get(batchId) as { metadata_json: string }).metadata_json) as { prior_state?: string };
      db.prepare("UPDATE family_candidates SET state = ?, updated_at = ? WHERE id = ?").run(metadata.prior_state ?? "open", now, id);
      addMember(db, reversalId, "candidate-state-restored", id);
    }
  }
  return touched;
}
