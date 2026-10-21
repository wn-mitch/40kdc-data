import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { humanActor } from "./authority.js";
import { applyAnnotationBatch, markPilotReviewed } from "./review.js";
import { confirmSurface, leafSurface, moveSurface, retireSurface } from "./leaves.js";
import { confirmConnectiveSpan, confirmConnectiveSurface } from "./connective-surfaces.js";
import { confirmOperator, type OperatorSlot } from "./leaf-operators.js";
import { NAME_FRAGMENT } from "./compile-name.js";
import { approveShape, rejectShapeMembers } from "./shapes.js";
import { exactSpan } from "./contracts.js";

/**
 * Will's decisions, made in conversation, applied as his own. Each decision names a proposal
 * and what Will said about it; the proposal's bytes and source identity are filled in from the
 * database, so a decision file only carries the judgement.
 *
 * `confirm` takes the proposal's label as it stands; `correct` gives the family and parameters
 * (and optionally new bytes as `exact_text`, found within the proposal's or annotation's fragment); `reject`,
 * `novel` and `ambiguous` record the refusal or the gap. `connective` confirms a connective.
 * `add` with `fragment: "NAME"` locates its wording in the record's name (a psyker level printed in the name).
 * `approve-shape` approves the compiled entries of the listed members of one shape (`signature`,
 * `ability_version_ids`) for publication, refusing any member publication would reject;
 * `reject-shape` refuses them until their leaves change.
 */

export type ChatDecision = {
  /** The proposal decided, or (with `annotation_id`) a row Will confirms or corrects. */
  proposal_id?: number;
  annotation_id?: number;
  /** An existing source span may be named for `add`; its bytes and wording are checked against the record. */
  span_id?: number;
  /** For `add` with an explicit occurrence, the UTF-8 byte start (paired with `end_byte`). */
  start_byte?: number;
  ability_version_id?: number;
  /** Optional explicit persisted source hash; required when documenting a historical authorization packet. */
  source_hash?: string;
  /** For `gap`: the kind of gap and what it is, in Will's words. */
  gap_type?: "DSL_GAP" | "SOURCE_AMBIGUITY" | "RELATION_GAP" | "COMPOSITION_GAP";
  description?: string;
  /** For `add`: the source fragment; `NAME` locates the record name, and body fragments use their persisted names. */
  fragment?: string;
  /** A leaf of another role contained in (or containing) an existing one, approved as such. */
  allow_overlap?: boolean;
  /** For `correct` of an annotation: same-role leaves inside the new wording that it absorbs (one list, one leaf). */
  merges_annotation_ids?: number[];
  action: "confirm" | "correct" | "retire" | "reject" | "novel" | "ambiguous" | "connective" | "add" | "gap" | "surface" | "retire-surface" | "connective-surface" | "add-connective" | "operator" | "move-surface" | "approve-shape" | "reject-shape";
  /** For `approve-shape` / `reject-shape`: the shape signature the members compile to. */
  signature?: string;
  /** For `approve-shape` / `reject-shape`: the source versions decided. */
  ability_version_ids?: number[];
  /** For `add` with an explicit occurrence, the UTF-8 byte end (paired with `start_byte`). */
  end_byte?: number;
  /** For `connective-surface`: the composition relation the joiner expresses, if any. */
  relation?: string;
  role?: string;
  family_id?: string;
  family_version?: number;
  parameters?: Record<string, unknown>;
  /** Historical source authorization: only valid for current=0 with exact persisted source_hash. */
  historical?: boolean;
  /** New wording for a correction, located inside the proposal's fragment. */
  exact_text?: string;
  /** For `surface`: the occurrence context the decision holds in (surface-scope.ts); absent means everywhere.
   * `retire-surface` and `move-surface` name the active surface by its wording in `exact_text`. */
  scope?: Record<string, unknown>;
  /** For `operator`: wording with {slot}s, each slot's spellings and their parameter values, and
   * the parameters every spelling shares (leaf-operators.ts). */
  template?: string;
  slots?: Record<string, OperatorSlot>;
  fixed?: Record<string, unknown>;
  combinations?: Array<Record<string, string>>;
};

/** The reviewer a drafted decisions file carries until a person signs it with their own name. */
export const UNSIGNED_REVIEWER = "<reviewer>";

export type ChatReview = { reviewer: string; decisions: ChatDecision[]; pilot_reviewed?: number[] };

type ProposalRow = {
  id: number; ability_version_id: number; source_hash: string; fragment: string; start_byte: number; end_byte: number;
  exact_text: string; role: string; family_id: string | null; family_version: number | null; parameters_json: string | null;
  source_text: string; fragments_json: string; name: string | null;
};

/** Locates `text` exactly once in `scope`, whose first byte sits at `offset` in the record's bytes. */
function locateOnce(scope: string, offset: number, text: string, label: string): { start_byte: number; end_byte: number } {
  const index = scope.indexOf(text);
  if (index < 0 || scope.indexOf(text, index + 1) >= 0) throw new Error(`"${text}" must occur exactly once in ${label}.`);
  const start = offset + Buffer.byteLength(scope.slice(0, index), "utf8");
  return { start_byte: start, end_byte: start + Buffer.byteLength(text, "utf8") };
}

/** A NAME row's wording is located in the record's name bytes; a body row's in its declared fragment. */
function located(row: ProposalRow, text: string): { start_byte: number; end_byte: number } {
  if (row.fragment === NAME_FRAGMENT) {
    if (row.name === null) throw new Error(`Row ${row.id} is a NAME span on a record with no name.`);
    return locateOnce(row.name, 0, text, `the name of row ${row.id}`);
  }
  const fragment = (JSON.parse(row.fragments_json) as Array<{ fragment: string; start_byte: number; end_byte: number }>).find((item) => item.fragment === row.fragment)!;
  const bytes = Buffer.from(row.source_text, "utf8");
  const scope = bytes.subarray(fragment.start_byte, fragment.end_byte).toString("utf8");
  return locateOnce(scope, fragment.start_byte, text, `fragment ${row.fragment} of row ${row.id}`);
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
      abilities.source_text, abilities.fragments_json, abilities.name
    FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id AND semantic_families.version = fingerprints.family_version
    WHERE annotations.id = ? AND annotations.status = 'active'
  `).get(annotationId) as (Omit<ProposalRow, "id"> & { authority_kind: string }) | undefined;
  if (!row) throw new Error(`No active annotation ${annotationId}.`);
  const base = {
    ability_version_id: row.ability_version_id, source_hash: item.source_hash ?? row.source_hash, fragment: row.fragment,
    start_byte: row.start_byte, end_byte: row.end_byte, exact_text: row.exact_text,
    ...(item.historical ? { historical: true } : {}),
  };
  if (item.action === "retire") {
    return { ...base, action: "retire", supersedes_annotation_id: annotationId, role: row.role };
  }
  if (item.action === "correct") {
    // New wording (widened or narrowed) must still overlap the row it replaces.
    const bytes = item.exact_text ? { ...located({ ...row, id: annotationId }, item.exact_text), exact_text: item.exact_text } : {};
    return {
      ...base, ...bytes, action: "correct", supersedes_annotation_id: annotationId, role: item.role ?? row.role, ...(item.allow_overlap ? { allow_overlap: true } : {}),
      ...(item.merges_annotation_ids ? { merges_annotation_ids: item.merges_annotation_ids } : {}),
      family_id: item.family_id ?? row.family_id, ...(item.family_id ? {} : { family_version: row.family_version }),
      parameters: item.parameters ?? JSON.parse(row.parameters_json!) as Record<string, unknown>,
    };
  }
  if (item.action !== "confirm") throw new Error(`An existing row can be confirmed or corrected, not ${item.action}.`);
  if (row.authority_kind !== "machine") throw new Error(`Annotation ${annotationId} is already trusted.`);
  return { ...base, action: "confirm", role: row.role, family_id: row.family_id, family_version: row.family_version, parameters: JSON.parse(row.parameters_json!) as Record<string, unknown> };
}

/**
 * Add a leaf nobody proposed. Without an explicit occurrence, wording must occur exactly once.
 * With `span_id` (or `start_byte` + `end_byte`), the chosen source occurrence is authoritative only
 * after its record, fragment, UTF-8 bytes and exact text all match. This is how repeated wording is
 * reviewed without widening an enclosing span or silently choosing a sibling occurrence.
 */
function addDecision(db: DatabaseSync, item: ChatDecision): Record<string, unknown> {
  const ability = db.prepare("SELECT id, source_hash, source_text, fragments_json, name FROM abilities WHERE id = ?").get(item.ability_version_id!) as
    { id: number; source_hash: string; source_text: string; fragments_json: string; name: string | null } | undefined;
  if (!ability || !item.exact_text || !item.family_id || !item.role) throw new Error("add needs ability_version_id, exact_text, role and family_id.");
  if (item.source_hash !== undefined && item.source_hash !== ability.source_hash) throw new Error(`Ability ${ability.id} source hash does not match the requested authorization.`);

  const explicitOccurrence = item.span_id !== undefined || item.start_byte !== undefined || item.end_byte !== undefined;
  if (explicitOccurrence) {
    const spanId = item.span_id;
    if (spanId !== undefined) {
      if (!Number.isInteger(spanId) || spanId <= 0) throw new Error("add span_id must be a positive integer.");
    } else {
      const startByte = item.start_byte;
      const endByte = item.end_byte;
      if (!Number.isInteger(startByte) || !Number.isInteger(endByte)) throw new Error("add start_byte and end_byte must be supplied together.");
    }
    const rows = spanId !== undefined
      ? (db.prepare("SELECT id, fragment, start_byte, end_byte, exact_text FROM source_spans WHERE id = ? AND ability_version_id = ?").all(spanId, ability.id) as Array<{ id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string }>)
      : (db.prepare("SELECT id, fragment, start_byte, end_byte, exact_text FROM source_spans WHERE ability_version_id = ? AND start_byte = ? AND end_byte = ?").all(
        ability.id, item.start_byte!, item.end_byte!,
      ) as Array<{ id: number; fragment: string; start_byte: number; end_byte: number; exact_text: string }>);
    const matchingRows = item.fragment === undefined ? rows : rows.filter((candidate) => candidate.fragment === item.fragment);
    if (matchingRows.length !== 1) {
      throw new Error(matchingRows.length === 0
        ? `No source span ${item.span_id ?? `${item.start_byte}-${item.end_byte}`} belongs to ability ${ability.id}.`
        : `The requested source occurrence is ambiguous across ${matchingRows.length} source spans; supply span_id or fragment.`);
    }
    const row = matchingRows[0]!;
    if (item.fragment !== undefined && item.fragment !== row.fragment) throw new Error(`Source span ${row.id} is in ${row.fragment}, not ${item.fragment}.`);
    if (item.start_byte !== undefined && item.start_byte !== row.start_byte) throw new Error(`Source span ${row.id} starts at ${row.start_byte}, not ${item.start_byte}.`);
    if (item.end_byte !== undefined && item.end_byte !== row.end_byte) throw new Error(`Source span ${row.id} ends at ${row.end_byte}, not ${item.end_byte}.`);
    if (row.exact_text !== item.exact_text) throw new Error(`Source span ${row.id} text does not exactly match the requested wording.`);
    if (row.fragment === NAME_FRAGMENT) {
      if (ability.name === null) throw new Error(`Ability ${ability.id} has no name to hold a NAME span.`);
      if (Buffer.from(ability.name, "utf8").subarray(row.start_byte, row.end_byte).toString("utf8") !== row.exact_text) {
        throw new Error(`Source span ${row.id} is not an exact UTF-8 span of the record's name.`);
      }
    } else if (exactSpan(ability.source_text, row.start_byte, row.end_byte) !== row.exact_text) {
      throw new Error(`Source span ${row.id} is not an exact UTF-8 span of the record body.`);
    }
    return {
      action: "confirm", ability_version_id: ability.id, source_hash: ability.source_hash, fragment: row.fragment,
      start_byte: row.start_byte, end_byte: row.end_byte, exact_text: row.exact_text,
      role: item.role, family_id: item.family_id, ...(item.family_version ? { family_version: item.family_version } : {}), parameters: item.parameters ?? {},
      ...(item.historical ? { historical: true } : {}),
      ...(item.allow_overlap ? { allow_overlap: true } : {}),
    };
  }

  if (item.fragment === NAME_FRAGMENT) {
    if (ability.name === null) throw new Error(`Ability ${ability.id} has no name to hold a NAME span.`);
    const hit = locateOnce(ability.name, 0, item.exact_text, `the name of ability ${ability.id}`);
    return {
      action: "confirm", ability_version_id: ability.id, source_hash: ability.source_hash, fragment: NAME_FRAGMENT,
      start_byte: hit.start_byte, end_byte: hit.end_byte, exact_text: item.exact_text,
      role: item.role, family_id: item.family_id, ...(item.family_version ? { family_version: item.family_version } : {}), parameters: item.parameters ?? {},
      ...(item.historical ? { historical: true } : {}),
      ...(item.allow_overlap ? { allow_overlap: true } : {}),
    };
  }
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
    ...(item.historical ? { historical: true } : {}),
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
      fingerprints.parameters_json, abilities.source_text, abilities.fragments_json, abilities.name
    FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id JOIN abilities ON abilities.id = source_spans.ability_version_id
    LEFT JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id WHERE proposals.id = ?
  `).get(item.proposal_id) as ProposalRow | undefined;
  if (!row) throw new Error(`Unknown proposal ${item.proposal_id}.`);
  const bytes = item.exact_text ? { ...located(row, item.exact_text), exact_text: item.exact_text } : { start_byte: row.start_byte, end_byte: row.end_byte, exact_text: row.exact_text };
  const base = { proposal_id: row.id, ability_version_id: row.ability_version_id, source_hash: item.source_hash ?? row.source_hash, fragment: row.fragment, ...bytes, ...(item.allow_overlap ? { allow_overlap: true } : {}), ...(item.historical ? { historical: true } : {}) };
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
export async function applyChatReview(db: DatabaseSync, review: ChatReview): Promise<{ applied: Array<{ proposal_id?: number; annotation_id?: number; ability_version_id?: number; batch_id: string }>; failed: Array<{ proposal_id?: number; annotation_id?: number; error: string }>; pilot_reviewed: number[] }> {
  if (review.reviewer === UNSIGNED_REVIEWER) throw new Error("This decisions file is an unsigned draft; set reviewer to your own name before applying it.");
  const actor = humanActor(review.reviewer, "review-apply");
  const applied: Array<{ proposal_id?: number; annotation_id?: number; ability_version_id?: number; batch_id: string }> = [];
  const failed: Array<{ proposal_id?: number; annotation_id?: number; error: string }> = [];
  for (const item of review.decisions) {
    try {
      if (item.action === "surface") {
        // One wording, one meaning, everywhere it occurs (a human surface; its copies are derived).
        const report = confirmSurface(db, {
          reviewer: actor.reviewer, exact_text: item.exact_text, family_id: item.family_id, ...(item.family_version ? { family_version: item.family_version } : {}),
          parameters: item.parameters ?? {}, ...(item.scope ? { scope: item.scope } : {}),
        }, actor);
        applied.push({ batch_id: report.batch_id, surface: { id: report.surface_id, applied: report.applied, already: report.already, promoted: report.promoted, out_of_scope: report.out_of_scope, blocked: report.blocked.length } } as never);
        continue;
      }
      if (item.action === "operator") {
        // One worded operator whose slots each occurrence's own spelling fills.
        const report = confirmOperator(db, {
          reviewer: actor.reviewer, family_id: item.family_id, ...(item.family_version ? { family_version: item.family_version } : {}),
          template: item.template, slots: item.slots, fixed: item.fixed ?? {}, ...(item.scope ? { scope: item.scope } : {}), ...(item.combinations ? { combinations: item.combinations } : {}),
        }, actor);
        applied.push({ batch_id: report.batch_id, operator: report } as never);
        continue;
      }
      if (item.action === "add-connective") {
        // One span with no rule meaning in its record (a designer's note), out of the denominator.
        const report = confirmConnectiveSpan(db, {
          reviewer: actor.reviewer, ability_version_id: Number(item.ability_version_id), exact_text: String(item.exact_text ?? ""), relation: item.relation,
          ...(item.start_byte !== undefined ? { start_byte: Number(item.start_byte) } : {}),
        }, actor);
        applied.push({ ability_version_id: Number(item.ability_version_id), batch_id: report.batch_id } as never);
        continue;
      }
      if (item.action === "connective-surface") {
        // Joining words decided once: a connective wherever they occur between leaves, in scope.
        const report = confirmConnectiveSurface(db, { reviewer: actor.reviewer, exact_text: String(item.exact_text ?? ""), scope: item.scope, relation: item.relation }, actor);
        applied.push({ batch_id: report.batch_id, connective: report } as never);
        continue;
      }
      if (item.action === "move-surface") {
        // Give a decided wording a different meaning; its annotations move with it.
        const surface = leafSurface(String(item.exact_text ?? ""));
        const row = db.prepare("SELECT id FROM leaf_surfaces WHERE normalized_surface = ? AND status = 'active'").get(surface) as { id: number } | undefined;
        if (!row) throw new Error(`No active surface "${surface}".`);
        const report = moveSurface(db, {
          reviewer: actor.reviewer, surface_id: row.id, family_id: item.family_id, ...(item.family_version ? { family_version: item.family_version } : {}), parameters: item.parameters ?? {},
        }, actor);
        applied.push({ batch_id: report.batch_id, surface: { id: report.surface_id, applied: report.applied, already: report.already, blocked: report.blocked.length } } as never);
        continue;
      }
      if (item.action === "retire-surface") {
        // Stop applying a decided wording, so it can be decided again (for example under a new scope).
        const surface = leafSurface(String(item.exact_text ?? ""));
        const row = db.prepare("SELECT id FROM leaf_surfaces WHERE normalized_surface = ? AND status = 'active'").get(surface) as { id: number } | undefined;
        if (!row) throw new Error(`No active surface "${surface}".`);
        applied.push({ batch_id: retireSurface(db, { reviewer: actor.reviewer, surface_id: row.id }, actor).batch_id });
        continue;
      }
      if (item.action === "approve-shape" || item.action === "reject-shape") {
        // Publication approval of compiled entries; the shape module re-compiles and checks each member.
        const body = { reviewer: actor.reviewer, signature: item.signature, ability_version_ids: item.ability_version_ids };
        const report = item.action === "approve-shape" ? await approveShape(db, body, actor) : rejectShapeMembers(db, body, actor);
        applied.push({ batch_id: report.batch_id, shape: { signature: item.signature, recorded: report.recorded } } as never);
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
