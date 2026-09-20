import type { DatabaseSync } from "node:sqlite";

import type { StructuralKind } from "./schema-ext.js";

/** One pending structural constituent suggestion; it is never reviewed authority on its own. */
export type StructuralProposalInput = {
  span_id: number;
  model_run_id: number | null;
  origin: string;
  kind: StructuralKind;
  description: string;
  parent_proposal_id: number | null;
  reason: Record<string, unknown>;
  created_at: string;
};

/** Insert a pending structural proposal; a second pending claim of the same span and kind is refused. */
export function insertStructuralProposal(db: DatabaseSync, input: StructuralProposalInput): number {
  const existing = db.prepare(`
    SELECT id FROM source_atom_proposals WHERE span_id = ? AND kind = ? AND status = 'pending'
  `).get(input.span_id, input.kind) as { id: number } | undefined;
  if (existing) throw new Error(`A pending ${input.kind} proposal already claims this exact source span.`);
  const inserted = db.prepare(`
    INSERT INTO source_atom_proposals (span_id, model_run_id, origin, kind, status, description, parent_proposal_id, reason_json, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    input.span_id,
    input.model_run_id,
    input.origin,
    input.kind,
    input.description,
    input.parent_proposal_id,
    JSON.stringify(input.reason),
    input.created_at,
  );
  return Number(inserted.lastInsertRowid);
}
