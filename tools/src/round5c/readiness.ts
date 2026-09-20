import type { DatabaseSync } from "node:sqlite";

import { getAbilityCoverage, getCurrentCoverage, type AbilityCoverage } from "./coverage.js";
import { RESTATES_ACTIVE_ANNOTATION } from "./db.js";

/** Why an ability is not yet ready for a whole-context check and composition. */
export type ReadinessReasonCode =
  | "NO_MEANINGFUL_SOURCE"
  | "UNACCOUNTED_SOURCE"
  | "PENDING_CLAIMS"
  | "UNRESOLVED_CLAIMS"
  | "OPEN_LEAF_GAPS"
  | "NO_REVIEWED_LEAF"
  | "UNSANCTIONED_OVERLAP"
  | "UNSUPPORTED_STRUCTURE"
  | "DRAFT_EXISTS";

export type ReadinessReason = { code: ReadinessReasonCode; count: number; message: string };

/**
 * One ability's composition readiness. `ready` means every meaningful byte is accounted for by
 * reviewed authority and nothing is still asking a human; it does not include the separate
 * explicit `whole_context_checked` decision, which `composition_eligible` adds.
 */
export type Readiness = {
  ability_version_id: number;
  ready: boolean;
  whole_context_checked: boolean;
  composition_eligible: boolean;
  accounted_fraction: number;
  leaf_fraction: number;
  unaccounted_bytes: number;
  residue_bytes: number;
  pending: number;
  unresolved: number;
  open_leaf_gaps: number;
  active_leaves: number;
  unsanctioned_overlaps: number;
  unsupported_structure: number;
  has_draft: boolean;
  reasons: ReadinessReason[];
};

type Counts = {
  pending: number; unresolved: number; gaps: number; leaves: number; unsupported: number; draft: boolean;
};

function countRows(db: DatabaseSync, sql: string, args: readonly number[], apply: (entry: Counts, total: number) => void, counts: Map<number, Counts>): void {
  for (const row of db.prepare(sql).all(...args) as Array<{ id: number; total: number }>) {
    let entry = counts.get(row.id);
    if (!entry) counts.set(row.id, entry = { pending: 0, unresolved: 0, gaps: 0, leaves: 0, unsupported: 0, draft: false });
    apply(entry, Number(row.total));
  }
}

function loadCounts(db: DatabaseSync, abilityVersionId?: number): Map<number, Counts> {
  const filter = abilityVersionId === undefined ? "abilities.current = 1" : "abilities.id = ?";
  const args = abilityVersionId === undefined ? [] : [abilityVersionId];
  const counts = new Map<number, Counts>();
  countRows(db, `
    SELECT abilities.id, count(*) AS total FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE ${filter} AND proposals.status = 'pending' AND NOT ${RESTATES_ACTIVE_ANNOTATION}
    GROUP BY abilities.id
  `, args, (entry, total) => { entry.pending += total; }, counts);
  countRows(db, `
    SELECT abilities.id, count(*) AS total FROM source_atom_proposals
    JOIN source_spans ON source_spans.id = source_atom_proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE ${filter} AND source_atom_proposals.status = 'pending'
    GROUP BY abilities.id
  `, args, (entry, total) => { entry.pending += total; }, counts);
  countRows(db, `
    SELECT abilities.id, count(*) AS total FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE ${filter} AND proposals.status = 'unresolved'
    GROUP BY abilities.id
  `, args, (entry, total) => { entry.unresolved = total; }, counts);
  countRows(db, `
    SELECT abilities.id, count(*) AS total FROM gaps
    JOIN abilities ON abilities.id = gaps.ability_version_id
    WHERE ${filter} AND gaps.type = 'LEAF_GAP' AND gaps.status = 'open'
    GROUP BY abilities.id
  `, args, (entry, total) => { entry.gaps = total; }, counts);
  countRows(db, `
    SELECT abilities.id, count(*) AS total FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE ${filter} AND annotations.status = 'active'
      AND (annotations.authority_kind = 'human' OR EXISTS (
        SELECT 1 FROM stamp_applications
        JOIN stamps ON stamps.id = stamp_applications.stamp_id AND stamps.revision = stamp_applications.stamp_revision
        WHERE stamp_applications.annotation_id = annotations.id
          AND stamp_applications.status = 'active' AND stamps.status = 'approved'
      ))
    GROUP BY abilities.id
  `, args, (entry, total) => { entry.leaves = total; }, counts);
  countRows(db, `
    SELECT abilities.id, count(*) AS total FROM source_atom_reviews
    JOIN source_spans ON source_spans.id = source_atom_reviews.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE ${filter} AND source_atom_reviews.status = 'active'
      AND source_atom_reviews.contained_by_annotation_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM annotations
        WHERE annotations.id = source_atom_reviews.contained_by_annotation_id AND annotations.status = 'active'
      )
    GROUP BY abilities.id
  `, args, (entry, total) => { entry.unsupported = total; }, counts);
  countRows(db, `
    SELECT abilities.id, count(*) AS total FROM assembly_drafts
    JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
    JOIN abilities ON abilities.id = stamp_applications.ability_version_id
    WHERE ${filter} AND assembly_drafts.status <> 'stale'
    GROUP BY abilities.id
  `, args, (entry, total) => { entry.draft = total > 0; }, counts);
  return counts;
}

function readinessFor(abilityVersionId: number, coverage: AbilityCoverage, counts: Counts | undefined, wholeChecked: boolean): Readiness {
  const open = counts ?? { pending: 0, unresolved: 0, gaps: 0, leaves: 0, unsupported: 0, draft: false };
  // Meaningful bytes only; grouped display regions also span the whitespace between words.
  const unaccounted = coverage.accounted_bytes.denominator - coverage.accounted_bytes.numerator;
  const residue = coverage.partition.residue;
  const unsanctioned = coverage.overlaps.filter((overlap) => !overlap.sanctioned).length;
  const reasons: ReadinessReason[] = [];
  const add = (code: ReadinessReasonCode, count: number, message: string): void => {
    if (count > 0) reasons.push({ code, count, message });
  };
  if (coverage.accounted_bytes.denominator === 0) add("NO_MEANINGFUL_SOURCE", 1, "The source has no meaningful bytes to review.");
  add("UNACCOUNTED_SOURCE", unaccounted, `${unaccounted} meaningful source bytes have no reviewed leaf, structural constituent, or connective.`);
  add("PENDING_CLAIMS", open.pending, `${open.pending} pending proposals still need a human decision.`);
  add("UNRESOLVED_CLAIMS", open.unresolved, `${open.unresolved} unresolved source claims still need a human decision.`);
  add("OPEN_LEAF_GAPS", open.gaps, `${open.gaps} leaf gaps are still open.`);
  if (open.leaves === 0) add("NO_REVIEWED_LEAF", 1, "No reviewed semantic leaf exists; composition needs at least one.");
  add("UNSANCTIONED_OVERLAP", unsanctioned, `${unsanctioned} overlaps among reviewed source layers lack an explicit containment review.`);
  add("UNSUPPORTED_STRUCTURE", open.unsupported, `${open.unsupported} structural reviews point at a parent annotation that is no longer active.`);
  if (open.draft) add("DRAFT_EXISTS", 1, "A current assembly draft already exists for this source version.");
  const accountedAll = coverage.accounted_bytes.denominator > 0
    && coverage.accounted_bytes.numerator === coverage.accounted_bytes.denominator;
  const ready = reasons.length === 0 && accountedAll && residue === 0;
  return {
    ability_version_id: abilityVersionId,
    ready,
    whole_context_checked: wholeChecked,
    composition_eligible: ready && wholeChecked,
    accounted_fraction: coverage.accounted_fraction,
    leaf_fraction: coverage.leaf_fraction,
    unaccounted_bytes: unaccounted,
    residue_bytes: residue,
    pending: open.pending,
    unresolved: open.unresolved,
    open_leaf_gaps: open.gaps,
    active_leaves: open.leaves,
    unsanctioned_overlaps: unsanctioned,
    unsupported_structure: open.unsupported,
    has_draft: open.draft,
    reasons,
  };
}

/** Readiness of one ability version (current or historical). */
export function abilityReadiness(db: DatabaseSync, abilityVersionId: number): Readiness {
  const coverage = getAbilityCoverage(db, abilityVersionId);
  return readinessFor(abilityVersionId, coverage, loadCounts(db, abilityVersionId).get(abilityVersionId), coverage.whole_reviewed);
}

/** Readiness of every current ability, in a fixed number of grouped queries. */
export function currentReadiness(db: DatabaseSync, coverage: ReadonlyMap<number, AbilityCoverage> = getCurrentCoverage(db)): Map<number, Readiness> {
  const counts = loadCounts(db);
  return new Map([...coverage].map(([id, view]) => [id, readinessFor(id, view, counts.get(id), view.whole_reviewed)]));
}
