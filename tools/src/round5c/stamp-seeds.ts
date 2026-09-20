import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import type { LeafStampVariant, StampDefinition } from "./contracts.js";
import { insertSpan, withTransaction } from "./db.js";
import { normalizedSurface } from "./matching.js";
import { applyAnnotationBatch } from "./review.js";
import { createEscalation, previewStamp, proposeLiteralStamp, StampError } from "./stamps.js";

/** Key a human seed by its normalized surface and exact fingerprint. */
export function seedKey(exactText: string, fingerprintId: string): string {
  return `${normalizedSurface(exactText)}\u0000${fingerprintId}`;
}

/**
 * The earliest active human annotation for each normalized surface and fingerprint on current
 * source, in one query. A family group with a seed can propose a literal stamp directly.
 */
export function stampSeedAnnotationIds(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare(`
    SELECT annotations.id, annotations.fingerprint_id, source_spans.exact_text
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE annotations.status = 'active' AND annotations.authority_kind = 'human' AND abilities.current = 1
    ORDER BY annotations.id
  `).all() as Array<{ id: number; fingerprint_id: string; exact_text: string }>;
  const seeds = new Map<string, number>();
  for (const row of rows) {
    const key = seedKey(row.exact_text, row.fingerprint_id);
    if (!seeds.has(key)) seeds.set(key, row.id);
  }
  return seeds;
}

/**
 * Confirm one selected pending occurrence and propose a literal leaf stamp seeded by exactly
 * that new human annotation, atomically. Approval still needs its own preview and decision.
 */
export function confirmAndProposeLiteralStamp(db: DatabaseSync, body: unknown): { batch_id: string; annotation_id: number; stamp_id: string; revision: number } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new StampError(422, "Expected {reviewer, decision}.");
  const input = body as { reviewer?: unknown; decision?: unknown; label?: unknown };
  if (typeof input.reviewer !== "string" || !input.reviewer.trim()) throw new StampError(422, "reviewer is required.");
  const decision = input.decision as Record<string, unknown> | undefined;
  if (!decision || decision.action !== "confirm" || typeof decision.proposal_id !== "number") {
    throw new StampError(422, "decision must be one confirm decision for a pending proposal.");
  }
  const reviewer = input.reviewer;
  return withTransaction(db, () => {
    const batch = applyAnnotationBatch(db, { reviewer, decisions: [decision] });
    const annotation = db.prepare("SELECT entity_id FROM batch_members WHERE batch_id = ? AND entity_kind = 'annotation'").get(batch.batch_id) as { entity_id: string } | undefined;
    if (!annotation) throw new StampError(409, "The confirmation produced no annotation.");
    const stamp = proposeLiteralStamp(db, {
      annotation_id: Number(annotation.entity_id),
      reviewer,
      ...(typeof input.label === "string" && input.label.trim() ? { label: input.label.trim() } : {}),
    });
    return { batch_id: batch.batch_id, annotation_id: Number(annotation.entity_id), ...stamp };
  });
}

/** The fixed reviewed output a family-constrained model rule must reproduce. */
export type RequiredOutput = { family_id: string; family_version: number; parameters: Record<string, unknown> };

const COUNTERCONTEXT_LIMIT = 10;

/**
 * Escalate a proposed literal leaf stamp that has no eligible corpus match to model rule
 * generalization, constrained to the literal's exact family, version, and parameters, with its
 * seed and bounded blocked countercontexts. Any model rule still needs challenge, preview, and
 * human approval.
 */
export function escalateLiteralStamp(db: DatabaseSync, stampId: string, revision: number): { escalation_id: string } {
  return withTransaction(db, () => {
    const row = db.prepare("SELECT kind, status, definition_json FROM stamps WHERE id = ? AND revision = ?").get(stampId, revision) as { kind: string; status: string; definition_json: string } | undefined;
    if (!row) throw new StampError(404, `Unknown stamp ${stampId}@${revision}.`);
    if (row.kind !== "leaf" || row.status !== "proposed") throw new StampError(409, "Only a proposed leaf stamp can be escalated to a model rule.");
    const definition = JSON.parse(row.definition_json) as StampDefinition;
    const outputs = (definition.variants as LeafStampVariant[]).map((variant) => variant.output);
    const first = outputs[0];
    if (!first || outputs.some((output) => output.family_id !== first.family_id || output.family_version !== first.family_version
      || hashJson(output.parameters) !== hashJson(first.parameters))) {
      throw new StampError(422, "Only a stamp with one fixed reviewed output can be escalated.");
    }
    const preview = previewStamp(db, stampId, revision);
    if (preview.totals.eligible > 0) throw new StampError(409, "This literal stamp already has eligible matches; preview and approve it instead.");
    const positives = db.prepare(`
      SELECT evidence_json FROM stamp_evidence WHERE stamp_id = ? AND stamp_revision = ? AND evidence_kind = 'positive' ORDER BY ordinal
    `).all(stampId, revision) as Array<{ evidence_json: string }>;
    const members = positives.map((item) => JSON.parse(item.evidence_json) as { synthetic?: boolean; ability_version_id: number; source_hash: string; fragment: string; start_byte: number; end_byte: number; exact_text: string })
      .filter((reference) => reference.synthetic !== true)
      .map((reference) => ({
        ability_version_id: reference.ability_version_id,
        source_hash: reference.source_hash,
        span_id: insertSpan(db, reference.ability_version_id, reference.fragment, reference.start_byte, reference.end_byte, reference.exact_text),
      }));
    if (members.length === 0) throw new StampError(422, "The stamp has no source-bound seed to escalate.");
    const required: RequiredOutput = { family_id: first.family_id, family_version: first.family_version, parameters: first.parameters as Record<string, unknown> };
    const escalationId = createEscalation(db, "PARAMETER_BOUNDARY", {
      path: "literal-stamp-generalization",
      stamp_id: stampId,
      revision,
      required_output: required,
      countercontexts: [...preview.counterexamples, ...preview.examples.filter((example) => example.status === "blocked")].slice(0, COUNTERCONTEXT_LIMIT),
      question: `The literal stamp matches no other source. Propose a ${required.family_id}@${required.family_version} leaf rule with exactly these parameters that generalizes safely, or explain why none exists.`,
    }, members);
    return { escalation_id: escalationId };
  });
}

/** Reject a model rule for a family-constrained escalation unless every output matches exactly. */
export function assertRequiredOutput(definition: StampDefinition, required: RequiredOutput): void {
  if (definition.kind !== "leaf") throw new TypeError("A family-constrained escalation needs a leaf rule.");
  for (const variant of definition.variants as LeafStampVariant[]) {
    if (variant.output.family_id !== required.family_id || variant.output.family_version !== required.family_version) {
      throw new TypeError(`The proposed rule outputs ${variant.output.family_id}@${variant.output.family_version}, not the required ${required.family_id}@${required.family_version}.`);
    }
    if (hashJson(variant.output.parameters) !== hashJson(required.parameters)) {
      throw new TypeError("The proposed rule changes the required reviewed parameters.");
    }
  }
}
