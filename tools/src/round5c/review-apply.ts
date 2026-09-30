import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { humanActor } from "./authority.js";
import { applyAnnotationBatch, markPilotReviewed } from "./review.js";
import { confirmSurface } from "./leaves.js";

/**
 * Will's decisions, made in conversation, applied as his own. Each decision names a proposal
 * and what Will said about it; the proposal's bytes and source identity are filled in from the
 * database, so a decision file only carries the judgement.
 *
 * `confirm` takes the proposal's label as it stands; `correct` gives the family and parameters
 * (and optionally new bytes as `exact_text`, found within the proposal's or annotation's fragment); `reject`,
 * `novel` and `ambiguous` record the refusal or the gap. `connective` confirms a connective.
 */

export type ChatDecision = {
  /** The proposal decided, or (with `annotation_id`) a row Will confirms or corrects. */
  proposal_id?: number;
  annotation_id?: number;
  /** For `add` (a leaf nobody proposed) and `gap`: the source version it belongs to. */
  ability_version_id?: number;
  /** For `gap`: the kind of gap and what it is, in Will's words. */
  gap_type?: "DSL_GAP" | "SOURCE_AMBIGUITY" | "RELATION_GAP" | "COMPOSITION_GAP";
  description?: string;
  /** A leaf of another role contained in (or containing) an existing one, approved as such. */
  allow_overlap?: boolean;
  action: "confirm" | "correct" | "reject" | "novel" | "ambiguous" | "connective" | "add" | "gap" | "surface";
  role?: string;
  family_id?: string;
  family_version?: number;
  parameters?: Record<string, unknown>;
  /** New wording for a correction, located inside the proposal's fragment. */
  exact_text?: string;
};

export type ChatReview = { reviewer: string; decisions: ChatDecision[]; pilot_reviewed?: number[] };

type ProposalRow = {
  id: number; ability_version_id: number; source_hash: string; fragment: string; start_byte: number; end_byte: number;
  exact_text: string; role: string; family_id: string | null; family_version: number | null; parameters_json: string | null;
  source_text: string; fragments_json: string;
};

function located(row: ProposalRow, text: string): { start_byte: number; end_byte: number } {
  const fragment = (JSON.parse(row.fragments_json) as Array<{ fragment: string; start_byte: number; end_byte: number }>).find((item) => item.fragment === row.fragment)!;
  const bytes = Buffer.from(row.source_text, "utf8");
  const scope = bytes.subarray(fragment.start_byte, fragment.end_byte).toString("utf8");
  const index = scope.indexOf(text);
  if (index < 0 || scope.indexOf(text, index + 1) >= 0) throw new Error(`"${text}" must occur exactly once in fragment ${row.fragment} of row ${row.id}.`);
  const start = fragment.start_byte + Buffer.byteLength(scope.slice(0, index), "utf8");
  return { start_byte: start, end_byte: start + Buffer.byteLength(text, "utf8") };
}

/**
 * A decision on an existing row: `confirm` takes a machine row as it stands (it is promoted);
 * `correct` replaces any row's meaning with the family and parameters given (it is superseded).
 */
function annotationDecision(db: DatabaseSync, item: ChatDecision): Record<string, unknown> {
  const annotationId = item.annotation_id!;
  const row = db.prepare(`
    SELECT annotations.authority_kind, source_spans.ability_version_id, abilities.source_hash, source_spans.fragment, source_spans.start_byte,
      source_spans.end_byte, source_spans.exact_text, semantic_families.role, fingerprints.family_id, fingerprints.family_version, fingerprints.parameters_json,
      abilities.source_text, abilities.fragments_json
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version
    WHERE annotations.id = ? AND annotations.status = 'active'
  `).get(annotationId) as (Omit<ProposalRow, "id"> & { authority_kind: string }) | undefined;
  if (!row) throw new Error(`No active annotation ${annotationId}.`);
  const base = {
    ability_version_id: row.ability_version_id, source_hash: row.source_hash, fragment: row.fragment,
    start_byte: row.start_byte, end_byte: row.end_byte, exact_text: row.exact_text,
  };
  if (item.action === "correct") {
    // New wording (widened or narrowed) must still overlap the row it replaces.
    const bytes = item.exact_text ? { ...located({ ...row, id: annotationId }, item.exact_text), exact_text: item.exact_text } : {};
    return {
      ...base, ...bytes, action: "correct", supersedes_annotation_id: annotationId, role: item.role ?? row.role,
      family_id: item.family_id ?? row.family_id, ...(item.family_id ? {} : { family_version: row.family_version }),
      parameters: item.parameters ?? JSON.parse(row.parameters_json!) as Record<string, unknown>,
    };
  }
  if (item.action !== "confirm") throw new Error(`An existing row can be confirmed or corrected, not ${item.action}.`);
  if (row.authority_kind !== "machine") throw new Error(`Annotation ${annotationId} is already trusted.`);
  return { ...base, action: "confirm", role: row.role, family_id: row.family_id, family_version: row.family_version, parameters: JSON.parse(row.parameters_json!) as Record<string, unknown> };
}

/** A leaf nobody proposed: its wording is located in the ability's source (exactly once). */
function addDecision(db: DatabaseSync, item: ChatDecision): Record<string, unknown> {
  const ability = db.prepare("SELECT id, source_hash, source_text, fragments_json FROM abilities WHERE id = ?").get(item.ability_version_id!) as
    { id: number; source_hash: string; source_text: string; fragments_json: string } | undefined;
  if (!ability || !item.exact_text || !item.family_id || !item.role) throw new Error("add needs ability_version_id, exact_text, role and family_id.");
  const fragments = JSON.parse(ability.fragments_json) as Array<{ fragment: string; start_byte: number; end_byte: number }>;
  const hits = fragments.flatMap((fragment) => {
    const scope = Buffer.from(ability.source_text, "utf8").subarray(fragment.start_byte, fragment.end_byte).toString("utf8");
    const index = scope.indexOf(item.exact_text!);
    return index < 0 || scope.indexOf(item.exact_text!, index + 1) >= 0 ? [] : [{ fragment: fragment.fragment, start: fragment.start_byte + Buffer.byteLength(scope.slice(0, index), "utf8") }];
  });
  if (hits.length !== 1) throw new Error(`"${item.exact_text}" must occur exactly once in ability ${item.ability_version_id}.`);
  return {
    action: "confirm", ability_version_id: ability.id, source_hash: ability.source_hash, fragment: hits[0]!.fragment,
    start_byte: hits[0]!.start, end_byte: hits[0]!.start + Buffer.byteLength(item.exact_text, "utf8"), exact_text: item.exact_text,
    role: item.role, family_id: item.family_id, ...(item.family_version ? { family_version: item.family_version } : {}), parameters: item.parameters ?? {},
    ...(item.allow_overlap ? { allow_overlap: true } : {}),
  };
}

/** Turn one conversational decision into the review batch's full decision shape. */
function decision(db: DatabaseSync, item: ChatDecision): Record<string, unknown> {
  if (item.action === "add") return addDecision(db, item);
  if (item.annotation_id !== undefined) return annotationDecision(db, item);
  if (item.proposal_id === undefined) throw new Error("A decision names a proposal_id or an annotation_id.");
  const row = db.prepare(`
    SELECT proposals.id, source_spans.ability_version_id, abilities.source_hash, source_spans.fragment, source_spans.start_byte,
      source_spans.end_byte, source_spans.exact_text, proposals.role, fingerprints.family_id, fingerprints.family_version,
      fingerprints.parameters_json, abilities.source_text, abilities.fragments_json
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id JOIN abilities ON abilities.id = source_spans.ability_version_id
    LEFT JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id WHERE proposals.id = ?
  `).get(item.proposal_id) as ProposalRow | undefined;
  if (!row) throw new Error(`Unknown proposal ${item.proposal_id}.`);
  const bytes = item.exact_text ? { ...located(row, item.exact_text), exact_text: item.exact_text } : { start_byte: row.start_byte, end_byte: row.end_byte, exact_text: row.exact_text };
  const base = { proposal_id: row.id, ability_version_id: row.ability_version_id, source_hash: row.source_hash, fragment: row.fragment, ...bytes, ...(item.allow_overlap ? { allow_overlap: true } : {}) };
  if (item.action === "connective") return { ...base, action: "confirm-connective", role: "CONNECTIVE" };
  if (item.action === "reject" || item.action === "novel" || item.action === "ambiguous") {
    return { ...base, action: item.action, role: item.role ?? (row.role === "UNRESOLVED" ? "EFFECT" : row.role) };
  }
  const family = item.family_id ?? row.family_id;
  if (!family) throw new Error(`Proposal ${row.id} has no family; say which one.`);
  return {
    ...base, action: item.action, role: item.role ?? row.role, family_id: family,
    family_version: item.family_version ?? (item.family_id ? undefined : row.family_version ?? undefined),
    parameters: item.parameters ?? (row.parameters_json ? JSON.parse(row.parameters_json) as Record<string, unknown> : {}),
  };
}

/** Apply Will's conversational review: one batch per decision, so one bad decision stops only itself. */
export function applyChatReview(db: DatabaseSync, review: ChatReview): { applied: Array<{ proposal_id?: number; annotation_id?: number; ability_version_id?: number; batch_id: string }>; failed: Array<{ proposal_id?: number; annotation_id?: number; error: string }>; pilot_reviewed: number[] } {
  const actor = humanActor(review.reviewer, "review-apply");
  const applied: Array<{ proposal_id?: number; annotation_id?: number; ability_version_id?: number; batch_id: string }> = [];
  const failed: Array<{ proposal_id?: number; annotation_id?: number; error: string }> = [];
  for (const item of review.decisions) {
    try {
      if (item.action === "surface") {
        // One wording, one meaning, everywhere it occurs (a human surface; its copies are derived).
        const report = confirmSurface(db, { reviewer: actor.reviewer, exact_text: item.exact_text, family_id: item.family_id, ...(item.family_version ? { family_version: item.family_version } : {}), parameters: item.parameters ?? {} }, actor);
        applied.push({ batch_id: report.batch_id, surface: { applied: report.applied, already: report.already, blocked: report.blocked.length } } as never);
        continue;
      }
      if (item.action === "gap") {
        applied.push({ ability_version_id: item.ability_version_id, batch_id: recordGap(db, item, actor.reviewer) });
        continue;
      }
      const full = decision(db, item);
      if (full.family_version === undefined) delete full.family_version;
      applied.push({ proposal_id: item.proposal_id, annotation_id: item.annotation_id, batch_id: applyAnnotationBatch(db, { reviewer: actor.reviewer, decisions: [full] }, actor).batch_id });
    } catch (error) {
      failed.push({ proposal_id: item.proposal_id, annotation_id: item.annotation_id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const marked: number[] = [];
  for (const id of review.pilot_reviewed ?? []) {
    const ability = db.prepare("SELECT source_hash FROM abilities WHERE id = ?").get(id) as { source_hash: string } | undefined;
    if (!ability) continue;
    markPilotReviewed(db, id, { reviewer: actor.reviewer, source_hash: ability.source_hash }, actor);
    marked.push(id);
  }
  return { applied, failed, pilot_reviewed: marked };
}

/** A gap Will names: vocabulary the DSL lacks, or source that says two things. Open until resolved. */
function recordGap(db: DatabaseSync, item: ChatDecision, reviewer: string): string {
  if (!item.ability_version_id || !item.gap_type || !item.description?.trim()) throw new Error("gap needs ability_version_id, gap_type and description.");
  const batchId = `gap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at, metadata_json) VALUES (?, 'review', ?, ?, '{}')").run(batchId, reviewer, new Date().toISOString());
  const gap = db.prepare("INSERT INTO gaps (ability_version_id, type, status, description, batch_id) VALUES (?, ?, 'open', ?, ?)").run(item.ability_version_id, item.gap_type, item.description.trim(), batchId);
  db.prepare("INSERT INTO batch_members (batch_id, entity_kind, entity_id) VALUES (?, 'gap-created', ?)").run(batchId, String(gap.lastInsertRowid));
  return batchId;
}

export function applyChatReviewFile(db: DatabaseSync, path: string): ReturnType<typeof applyChatReview> {
  return applyChatReview(db, JSON.parse(readFileSync(path, "utf8")) as ChatReview);
}
