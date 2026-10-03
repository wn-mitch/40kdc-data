import type { DatabaseSync } from "node:sqlite";

import { assertReviewer, requireHuman, type Actor } from "./authority.js";
import { bumpWorkbenchRevision, insertSpan, invalidateWholeReview, withTransaction } from "./db.js";
import { addMember, newBatch, occurrenceContext, type AbilityContext } from "./leaves.js";
import { CONNECTIVE_RELATION_TYPES } from "./review.js";
import { inScope, parseScope } from "./surface-scope.js";

/**
 * A joining wording ("and", "from your army", "While a") decided as a connective wherever it
 * occurs between leaves: Will's decision that the words carry no meaning of their own there, so
 * the source they occupy is accounted for. Leaf surfaces drop joining words at their edges, so a
 * connective is found by its own scan of the exact wording (case, spacing, markdown emphasis and
 * apostrophe style folded), within each fragment.
 *
 * An occurrence is a connective only where it joins: a trusted leaf ends right before it or starts
 * right after it (nothing but spaces and punctuation between). One any trusted leaf overlaps is
 * skipped (a joiner inside a leaf is part of that leaf), as is one an accepted connective already
 * covers; one next to no leaf yet is left for when its neighbours are decided. Each new connective is an accepted
 * CONNECTIVE proposal recorded as `connective-accepted` in the batch, so undoing the batch sends
 * it back to pending like any reviewed connective.
 */

export type ConnectiveSurfaceReport = { batch_id: string; applied: number; already: number; inside_leaf: number; no_neighbour: number; out_of_scope: number };

/** Only spaces, punctuation and emphasis between two byte offsets of a text. */
function adjacent(bytes: Buffer, from: number, to: number): boolean {
  return from <= to && !/[\p{L}\p{N}]/u.test(bytes.subarray(from, to).toString("utf8"));
}

/** The wording as a pattern: whole words, emphasis and spacing free, either apostrophe. */
function pattern(wording: string): RegExp {
  const words = wording.replace(/\*+/gu, "").trim().split(/\s+/u).map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/['’]/gu, "['’]"));
  return new RegExp(`(?<![\\p{L}\\p{N}])\\**${words.join("\\**\\s+\\**")}\\**(?![\\p{L}\\p{N}])`, "giu");
}

export function confirmConnectiveSurface(db: DatabaseSync, value: { reviewer: string; exact_text: string; scope?: unknown; relation?: string }, actor: Actor): ConnectiveSurfaceReport {
  requireHuman(actor, "decide a connective");
  assertReviewer(actor, value.reviewer);
  const wording = value.exact_text?.trim();
  if (!wording) throw new Error("A connective surface needs exact_text.");
  if (value.relation !== undefined && !CONNECTIVE_RELATION_TYPES.includes(value.relation)) throw new Error(`"${value.relation}" is not a known relation type.`);
  const scope = parseScope(value.scope);
  const find = pattern(wording);
  return withTransaction(db, () => {
    const batchId = newBatch(db, actor.reviewer, { action: "connective-surface", wording, scope: scope ?? null, relation: value.relation ?? null });
    const report: ConnectiveSurfaceReport = { batch_id: batchId, applied: 0, already: 0, inside_leaf: 0, no_neighbour: 0, out_of_scope: 0 };
    const leavesOf = db.prepare(`
      SELECT source_spans.fragment, source_spans.start_byte, source_spans.end_byte FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
      WHERE annotations.status = 'active' AND annotations.authority_kind != 'machine' AND source_spans.ability_version_id = ?`);
    const leafHere = db.prepare(`
      SELECT 1 FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
      WHERE annotations.status = 'active' AND annotations.authority_kind != 'machine'
        AND source_spans.ability_version_id = ? AND source_spans.fragment = ? AND source_spans.start_byte < ? AND ? < source_spans.end_byte LIMIT 1`);
    const connectiveHere = db.prepare(`
      SELECT 1 FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
      WHERE proposals.role = 'CONNECTIVE' AND proposals.status = 'accepted'
        AND source_spans.ability_version_id = ? AND source_spans.fragment = ? AND source_spans.start_byte < ? AND ? < source_spans.end_byte LIMIT 1`);
    const insert = db.prepare(`
      INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
      VALUES (?, NULL, 'CONNECTIVE', 'connective-surface', NULL, 'accepted', ?, NULL, ?)`);
    const now = new Date().toISOString();
    const touched = new Set<number>();
    const abilities = db.prepare("SELECT id, source_text, source_type, fragments_json FROM abilities WHERE current = 1").all() as Array<AbilityContext & { id: number }>;
    for (const ability of abilities) {
      const bytes = Buffer.from(ability.source_text, "utf8");
      const leaves = leavesOf.all(ability.id) as Array<{ fragment: string; start_byte: number; end_byte: number }>;
      if (leaves.length === 0) continue;
      for (const fragment of JSON.parse(ability.fragments_json) as Array<{ fragment: string; start_byte: number; end_byte: number }>) {
        const textOf = bytes.subarray(fragment.start_byte, fragment.end_byte).toString("utf8");
        for (const match of textOf.matchAll(find)) {
          // Emphasis markers at the edges are punctuation, not part of the joining words.
          const exact = match[0].replace(/^\*+|\*+$/gu, "");
          const lead = match[0].length - match[0].replace(/^\*+/u, "").length;
          const start = fragment.start_byte + Buffer.byteLength(textOf.slice(0, match.index! + lead), "utf8");
          const end = start + Buffer.byteLength(exact, "utf8");
          const occurrence = { fragment: fragment.fragment, start_byte: start, end_byte: end };
          if (!inScope(scope, occurrenceContext(ability, occurrence))) { report.out_of_scope += 1; continue; }
          if (leafHere.get(ability.id, fragment.fragment, end, start)) { report.inside_leaf += 1; continue; }
          if (connectiveHere.get(ability.id, fragment.fragment, end, start)) { report.already += 1; continue; }
          const joins = leaves.some((leaf) => leaf.fragment === fragment.fragment
            && (adjacent(bytes, leaf.end_byte, start) || adjacent(bytes, end, leaf.start_byte)));
          if (!joins) { report.no_neighbour += 1; continue; }
          const spanId = insertSpan(db, ability.id, fragment.fragment, start, end, exact);
          const row = insert.run(spanId, JSON.stringify({ connective_surface: wording, ...(value.relation ? { reviewed_relation: value.relation } : {}) }), now);
          addMember(db, batchId, "connective-accepted", Number(row.lastInsertRowid));
          touched.add(ability.id);
          report.applied += 1;
        }
      }
    }
    invalidateWholeReview(db, touched);
    bumpWorkbenchRevision(db);
    return report;
  });
}

/**
 * One span decided as a connective in one record: Will's decision that this source (a designer's
 * note, a printed label) carries no rule meaning there, so it leaves the leaf denominator. The span
 * is named by its exact text, which must occur once in the record and overlap no trusted leaf or
 * accepted connective. Recorded like a connective surface's occurrence, so undo sends it back.
 */
export function confirmConnectiveSpan(db: DatabaseSync, value: { reviewer: string; ability_version_id: number; exact_text: string; relation?: string }, actor: Actor): { batch_id: string; span_id: number } {
  requireHuman(actor, "decide a connective");
  assertReviewer(actor, value.reviewer);
  const exact = value.exact_text;
  if (!exact?.trim()) throw new Error("A connective span needs exact_text.");
  if (value.relation !== undefined && !CONNECTIVE_RELATION_TYPES.includes(value.relation)) throw new Error(`"${value.relation}" is not a known relation type.`);
  const ability = db.prepare("SELECT id, source_text, fragments_json FROM abilities WHERE id = ? AND current = 1").get(value.ability_version_id) as
    { id: number; source_text: string; fragments_json: string } | undefined;
  if (!ability) throw new Error(`No current ability ${value.ability_version_id}.`);
  const bytes = Buffer.from(ability.source_text, "utf8");
  const hits = (JSON.parse(ability.fragments_json) as Array<{ fragment: string; start_byte: number; end_byte: number }>).flatMap((fragment) => {
    const text = bytes.subarray(fragment.start_byte, fragment.end_byte).toString("utf8");
    const index = text.indexOf(exact);
    return index < 0 || text.indexOf(exact, index + 1) >= 0 ? [] : [{ fragment: fragment.fragment, start: fragment.start_byte + Buffer.byteLength(text.slice(0, index), "utf8") }];
  });
  if (hits.length !== 1) throw new Error(`"${exact.slice(0, 60)}" must occur exactly once in ability ${value.ability_version_id}.`);
  const { fragment, start } = hits[0]!;
  const end = start + Buffer.byteLength(exact, "utf8");
  return withTransaction(db, () => {
    const overlapping = db.prepare(`
      SELECT 1 FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
      WHERE annotations.status = 'active' AND annotations.authority_kind != 'machine'
        AND source_spans.ability_version_id = ? AND source_spans.fragment = ? AND source_spans.start_byte < ? AND ? < source_spans.end_byte
      UNION ALL
      SELECT 1 FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
      WHERE proposals.role = 'CONNECTIVE' AND proposals.status = 'accepted'
        AND source_spans.ability_version_id = ? AND source_spans.fragment = ? AND source_spans.start_byte < ? AND ? < source_spans.end_byte
      LIMIT 1
    `).get(ability.id, fragment, end, start, ability.id, fragment, end, start);
    if (overlapping) throw new Error(`"${exact.slice(0, 60)}" overlaps a trusted leaf or connective in ability ${ability.id}.`);
    const batchId = newBatch(db, actor.reviewer, { action: "connective-span", ability_version_id: ability.id, relation: value.relation ?? null });
    const spanId = insertSpan(db, ability.id, fragment, start, end, exact);
    const row = db.prepare(`
      INSERT INTO proposals (span_id, fingerprint_id, role, origin, model_run_id, status, reason_json, score, created_at)
      VALUES (?, NULL, 'CONNECTIVE', 'connective-span', NULL, 'accepted', ?, NULL, ?)
    `).run(spanId, JSON.stringify({ connective_span: true, ...(value.relation ? { reviewed_relation: value.relation } : {}) }), new Date().toISOString());
    addMember(db, batchId, "connective-accepted", Number(row.lastInsertRowid));
    invalidateWholeReview(db, new Set([ability.id]));
    bumpWorkbenchRevision(db);
    return { batch_id: batchId, span_id: spanId };
  });
}
