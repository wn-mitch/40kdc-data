import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import { LEAF_ROLES } from "./contracts.js";
import { normalizedSurface } from "./matching.js";

/**
 * Low-level persistence for provisional family candidates. This module must not import
 * `db.ts`: `initializeWorkbench` calls `backfillFamilyCandidates` from here.
 */

const LEAF_ROLE_SET = new Set<string>(LEAF_ROLES);

/** A NOVEL-leaf occurrence that suggests, but never establishes, a provisional family. */
export type CandidateSuggestion = {
  role: string;
  exact_text: string;
  label?: string | null;
  distinction?: string | null;
  parameter_hints?: readonly string[];
  span_id: number;
  source_hash: string;
  proposal_id: number;
  model_run_id: number | null;
};

/** Candidates group by reviewed role plus normalized source surface, never by model label. */
export function candidateSignature(role: string, exactText: string): string {
  return hashJson({ role, surface: normalizedSurface(exactText) });
}

/**
 * Attach one occurrence to its `open` (or existing) candidate as a `suggested` evidence row.
 * Idempotent per candidate and span. Never writes families, fingerprints, annotations, or DSL.
 */
export function recordCandidateSuggestion(db: DatabaseSync, suggestion: CandidateSuggestion): { candidate_id: number; evidence_id: number } | null {
  if (!LEAF_ROLE_SET.has(suggestion.role)) return null;
  const signature = candidateSignature(suggestion.role, suggestion.exact_text);
  const now = new Date().toISOString();
  const hints = [...new Set(suggestion.parameter_hints ?? [])].sort();
  db.prepare(`
    INSERT OR IGNORE INTO family_candidates (
      role, label, distinction, parameter_hints_json, signature, state, created_from_model_run_id,
      mapped_family_id, mapped_family_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?, NULL, NULL, ?, ?)
  `).run(
    suggestion.role,
    suggestion.label?.trim() || normalizedSurface(suggestion.exact_text),
    suggestion.distinction?.trim() || "Unreviewed novel source form; no distinction recorded.",
    JSON.stringify(hints),
    signature,
    suggestion.model_run_id,
    now,
    now,
  );
  const candidate = db.prepare("SELECT id, parameter_hints_json FROM family_candidates WHERE signature = ?")
    .get(signature) as { id: number; parameter_hints_json: string };
  const merged = [...new Set([...(JSON.parse(candidate.parameter_hints_json) as string[]), ...hints])].sort();
  if (merged.length !== (JSON.parse(candidate.parameter_hints_json) as string[]).length) {
    db.prepare("UPDATE family_candidates SET parameter_hints_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(merged), now, candidate.id);
  }
  db.prepare(`
    INSERT OR IGNORE INTO family_candidate_evidence (
      candidate_id, span_id, source_hash, proposal_id, verdict, explanation, model_run_id,
      reviewer, batch_id, supersedes_evidence_id, revoked_at, created_at
    ) VALUES (?, ?, ?, ?, 'suggested', NULL, ?, NULL, NULL, NULL, NULL, ?)
  `).run(candidate.id, suggestion.span_id, suggestion.source_hash, suggestion.proposal_id, suggestion.model_run_id, now);
  const evidence = db.prepare(`
    SELECT id FROM family_candidate_evidence
    WHERE candidate_id = ? AND span_id = ? AND verdict = 'suggested' AND revoked_at IS NULL
  `).get(candidate.id, suggestion.span_id) as { id: number };
  return { candidate_id: candidate.id, evidence_id: evidence.id };
}

/** Hypothesis fields a v2 Luna NOVEL span carries in its proposal reason. */
type NovelReason = {
  kind?: string;
  span_status?: string;
  hypothesis?: { label?: string; distinction?: string; parameters?: Array<{ name?: string }> };
};

/**
 * Attach every current NOVEL proposal that still has an open linked leaf gap to a candidate.
 * Covers Luna (`span_status = NOVEL`, pending) and manual (`kind = novel`, unresolved) forms.
 * `UNRESOLVED` spans are deliberately excluded: they get no guessed family.
 */
export function backfillFamilyCandidates(db: DatabaseSync): number {
  const rows = db.prepare(`
    SELECT proposals.id, proposals.span_id, proposals.role, proposals.model_run_id, proposals.reason_json,
      source_spans.exact_text, abilities.source_hash
    FROM gaps
    JOIN proposals ON proposals.id = gaps.proposal_id
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE gaps.type = 'LEAF_GAP' AND gaps.status = 'open' AND abilities.current = 1
      AND (
        (proposals.status = 'pending' AND json_extract(proposals.reason_json, '$.span_status') = 'NOVEL')
        OR (proposals.status = 'unresolved' AND json_extract(proposals.reason_json, '$.kind') = 'novel')
      )
    ORDER BY proposals.id
  `).all() as Array<{
    id: number; span_id: number; role: string; model_run_id: number | null; reason_json: string;
    exact_text: string; source_hash: string;
  }>;
  let recorded = 0;
  for (const row of rows) {
    const reason = JSON.parse(row.reason_json) as NovelReason;
    const candidateId = recordCandidateSuggestion(db, {
      role: row.role,
      exact_text: row.exact_text,
      label: reason.hypothesis?.label ?? null,
      distinction: reason.hypothesis?.distinction ?? null,
      parameter_hints: (reason.hypothesis?.parameters ?? []).map((parameter) => parameter.name ?? "").filter(Boolean),
      span_id: row.span_id,
      source_hash: row.source_hash,
      proposal_id: row.id,
      model_run_id: row.model_run_id,
    });
    if (candidateId !== null) recorded += 1;
  }
  return recorded;
}
