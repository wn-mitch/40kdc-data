import type { DatabaseSync } from "node:sqlite";

import { exactSpan, LEAF_ROLES } from "./contracts.js";
import { parseStoredFragments, RESTATES_ACTIVE_ANNOTATION } from "./db.js";
import {
  normalized, overlapDiagnostics, overlapLength, partitionExclusive, subtractIntervals, totalLength,
  type Interval, type OverlapDiagnostic, type PartitionLayer, type TaggedInterval,
} from "./partition.js";

/** A source-native byte interval. All offsets are UTF-8 byte offsets. */
export type ByteInterval = {
  start_byte: number;
  end_byte: number;
};

/** One source fragment as persisted with an ability version. */
export type SourceFragmentView = ByteInterval & {
  fragment: string;
  text: string;
};

/** A meaningful, unpainted source interval suitable for direct review. */
export type UncoveredInterval = ByteInterval & {
  fragment: string;
  text: string;
};

/** Byte totals for one exclusive coverage layer. */
export type PartitionBytes = Record<PartitionLayer | "residue", number>;

/**
 * Coverage keeps confirmed and proposed semantic paint separate, and reports two metrics:
 * `leaf_fraction` (reviewed semantic bytes / meaningful non-connective bytes, historical) and
 * `accounted_fraction` (reviewed leaf ∪ accepted structural ∪ accepted connective bytes /
 * all meaningful bytes). Pending and unresolved claims own queue work, never coverage.
 */
export type AbilityCoverage = {
  leaf_fraction: number;
  human_leaf_fraction: number;
  stamp_leaf_fraction: number;
  proposal_fraction: number;
  accounted_fraction: number;
  leaf_bytes: { numerator: number; denominator: number };
  accounted_bytes: { numerator: number; denominator: number };
  /** Exclusive byte partition leaf → structural → connective → pending → unresolved → residue. */
  partition: PartitionBytes;
  /** Every overlap among authoritative layers; unsanctioned entries block whole-context review. */
  overlaps: OverlapDiagnostic[];
  whole_reviewed: boolean;
  /** Meaningful non-connective source no reviewed leaf paints. */
  uncovered: UncoveredInterval[];
  /** Meaningful source no reviewed leaf, accepted structural atom, or accepted connective accounts for. */
  unaccounted: UncoveredInterval[];
  /**
   * Unaccounted source no pending or unresolved claim covers: the part of the ability nothing in
   * the workbench is already asking a human about. This is what Luna is sent in residue mode.
   */
  residue: UncoveredInterval[];
};

type AbilitySource = {
  id: number;
  source_text: string;
  fragments_json: string;
};

type SpanRow = {
  ability_version_id: number;
  id: number;
  start_byte: number;
  end_byte: number;
  authority_kind?: "human" | "stamp";
  stamp_supported?: number;
  contained_by_annotation_id?: number | null;
};

type CoverageIndexes = {
  confirmed: Map<number, TaggedInterval[]>;
  human: Map<number, Interval[]>;
  stamp: Map<number, Interval[]>;
  proposed: Map<number, Interval[]>;
  pending: Map<number, Interval[]>;
  unresolved: Map<number, Interval[]>;
  connective: Map<number, TaggedInterval[]>;
  structural: Map<number, TaggedInterval[]>;
};

const semanticRoles = LEAF_ROLES;
const whitespace = /\s/u;
const punctuation = /\p{P}/u;

function pushInterval<T extends Interval>(index: Map<number, T[]>, abilityId: number, interval: T): void {
  const existing = index.get(abilityId);
  if (existing) existing.push(interval);
  else index.set(abilityId, [interval]);
}

/** SQL predicate over `annotations`: the row currently carries semantic authority. */
const EFFECTIVE_ANNOTATION = "(annotations.status = 'active')";

/**
 * SQL predicate over `source_atom_reviews`: the structural review is active and, when it is a
 * reviewed qualifier inside a semantic span, its parent annotation still has authority.
 */
export const EFFECTIVE_STRUCTURAL_REVIEW = `(
  source_atom_reviews.status = 'active'
  AND (
    source_atom_reviews.contained_by_annotation_id IS NULL
    OR EXISTS (
      SELECT 1 FROM annotations
      WHERE annotations.id = source_atom_reviews.contained_by_annotation_id
        AND annotations.status = 'active' AND ${EFFECTIVE_ANNOTATION}
    )
  )
)`;

function loadCoverageIndexes(db: DatabaseSync, currentOnly: boolean, abilityId?: number): CoverageIndexes {
  const filter = currentOnly ? "AND abilities.current = 1" : "";
  const idFilter = abilityId === undefined ? "" : "AND source_spans.ability_version_id = ?";
  const args = abilityId === undefined ? [] : [abilityId];
  const indexes: CoverageIndexes = {
    confirmed: new Map(), human: new Map(), stamp: new Map(), proposed: new Map(),
    pending: new Map(), unresolved: new Map(), connective: new Map(), structural: new Map(),
  };

  const confirmedRows = db.prepare(`
    SELECT source_spans.ability_version_id, annotations.id, source_spans.start_byte, source_spans.end_byte,
      annotations.authority_kind,
      CASE WHEN annotations.authority_kind = 'stamp' THEN 1 ELSE 0 END AS stamp_supported
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id
      AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active'
      AND semantic_families.role IN ('EFFECT', 'DURATION', 'EVENT', 'CONDITION', 'COMBINATOR', 'RESTRICTION')
      AND ${EFFECTIVE_ANNOTATION}
      ${filter} ${idFilter}
  `).all(...args) as SpanRow[];
  for (const row of confirmedRows) {
    const interval = { start: row.start_byte, end: row.end_byte };
    pushInterval(indexes.confirmed, row.ability_version_id, { ...interval, id: row.id });
    if (row.authority_kind === "human") pushInterval(indexes.human, row.ability_version_id, interval);
    if (row.stamp_supported === 1) pushInterval(indexes.stamp, row.ability_version_id, interval);
  }

  const proposalRows = db.prepare(`
    SELECT source_spans.ability_version_id, proposals.id, source_spans.start_byte, source_spans.end_byte,
      proposals.status, proposals.role
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE ((proposals.status = 'pending' AND NOT ${RESTATES_ACTIVE_ANNOTATION})
      OR proposals.status = 'unresolved'
      OR (proposals.status = 'accepted' AND proposals.role = 'CONNECTIVE'))
      ${filter} ${idFilter}
  `).all(...args) as Array<SpanRow & { status: string; role: string }>;
  for (const row of proposalRows) {
    const interval = { start: row.start_byte, end: row.end_byte };
    if (row.status === "accepted") {
      pushInterval(indexes.connective, row.ability_version_id, { ...interval, id: row.id });
    } else if (row.status === "unresolved") {
      pushInterval(indexes.unresolved, row.ability_version_id, interval);
    } else {
      pushInterval(indexes.pending, row.ability_version_id, interval);
      if ((semanticRoles as readonly string[]).includes(row.role)) pushInterval(indexes.proposed, row.ability_version_id, interval);
    }
  }

  const pendingAtomRows = db.prepare(`
    SELECT source_spans.ability_version_id, source_atom_proposals.id, source_spans.start_byte, source_spans.end_byte
    FROM source_atom_proposals
    JOIN source_spans ON source_spans.id = source_atom_proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE source_atom_proposals.status = 'pending'
      ${filter} ${idFilter}
  `).all(...args) as SpanRow[];
  for (const row of pendingAtomRows) {
    pushInterval(indexes.pending, row.ability_version_id, { start: row.start_byte, end: row.end_byte });
  }

  const structuralRows = db.prepare(`
    SELECT source_spans.ability_version_id, source_atom_reviews.id, source_spans.start_byte, source_spans.end_byte,
      source_atom_reviews.contained_by_annotation_id
    FROM source_atom_reviews
    JOIN source_spans ON source_spans.id = source_atom_reviews.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE ${EFFECTIVE_STRUCTURAL_REVIEW}
      ${filter} ${idFilter}
  `).all(...args) as SpanRow[];
  for (const row of structuralRows) {
    pushInterval(indexes.structural, row.ability_version_id, {
      start: row.start_byte,
      end: row.end_byte,
      id: row.id,
      sanctioned_by: row.contained_by_annotation_id == null ? undefined : new Set([row.contained_by_annotation_id]),
    });
  }
  return indexes;
}

function meaningfulIntervals(source: string): Interval[] {
  const intervals: Interval[] = [];
  let offset = 0;
  for (const character of source) {
    const width = Buffer.byteLength(character, "utf8");
    if (!whitespace.test(character) && !punctuation.test(character)) {
      intervals.push({ start: offset, end: offset + width });
    }
    offset += width;
  }
  return normalized(intervals);
}

function intervalFragment(fragments: readonly SourceFragmentView[], start: number, end: number): string {
  const fragment = fragments.find((candidate) => start >= candidate.start_byte && end <= candidate.end_byte);
  if (!fragment) throw new Error("Coverage interval crosses a persisted source fragment boundary.");
  return fragment.fragment;
}
function groupUncovered(source: string, fragments: readonly SourceFragmentView[], intervals: readonly Interval[]): UncoveredInterval[] {
  const grouped: Array<Interval & { fragment: string }> = [];
  for (const interval of intervals) {
    const fragment = intervalFragment(fragments, interval.start, interval.end);
    const previous = grouped.at(-1);
    const separator = previous && interval.start > previous.end ? exactSpan(source, previous.end, interval.start) : "";
    if (previous?.fragment === fragment && !/[.!?;:\n\p{L}\p{N}]/u.test(separator)) {
      previous.end = interval.end;
    } else {
      grouped.push({ ...interval, fragment });
    }
  }
  return grouped.map(({ start, end, fragment }) => ({
    start_byte: start,
    end_byte: end,
    fragment,
    text: exactSpan(source, start, end),
  }));
}


function coverageFor(ability: AbilitySource, indexes: CoverageIndexes, wholeReviewed: boolean): AbilityCoverage {
  const id = ability.id;
  const fragments = parseStoredFragments(ability.fragments_json);
  const meaningful = meaningfulIntervals(ability.source_text);
  const leafTagged = indexes.confirmed.get(id) ?? [];
  const structuralTagged = indexes.structural.get(id) ?? [];
  const connectiveTagged = indexes.connective.get(id) ?? [];
  const confirmedIntervals = normalized(leafTagged);
  const structuralIntervals = normalized(structuralTagged);
  const connectiveIntervals = normalized(connectiveTagged);
  const proposedIntervals = normalized(indexes.proposed.get(id) ?? []);
  const humanIntervals = normalized(indexes.human.get(id) ?? []);
  const stampIntervals = normalized(indexes.stamp.get(id) ?? []);
  const reviewable = subtractIntervals(meaningful, connectiveIntervals);
  const denominator = totalLength(reviewable);
  const leafNumerator = overlapLength(reviewable, confirmedIntervals);
  const uncoveredIntervals = subtractIntervals(reviewable, confirmedIntervals);
  const partition = partitionExclusive(meaningful, {
    leaf: confirmedIntervals,
    structural: structuralIntervals,
    connective: connectiveIntervals,
    pending: indexes.pending.get(id) ?? [],
    unresolved: indexes.unresolved.get(id) ?? [],
  });
  const meaningfulBytes = totalLength(meaningful);
  const accountedBytes = totalLength(partition.leaf) + totalLength(partition.structural) + totalLength(partition.connective);
  const unaccounted = subtractIntervals(subtractIntervals(uncoveredIntervals, structuralIntervals), connectiveIntervals);
  const fraction = (value: number): number => denominator === 0 ? 0 : value / denominator;

  return {
    leaf_fraction: fraction(leafNumerator),
    human_leaf_fraction: fraction(overlapLength(reviewable, humanIntervals)),
    stamp_leaf_fraction: fraction(overlapLength(reviewable, stampIntervals)),
    proposal_fraction: fraction(overlapLength(reviewable, proposedIntervals)),
    accounted_fraction: meaningfulBytes === 0 ? 0 : accountedBytes / meaningfulBytes,
    leaf_bytes: { numerator: leafNumerator, denominator },
    accounted_bytes: { numerator: accountedBytes, denominator: meaningfulBytes },
    partition: {
      leaf: totalLength(partition.leaf),
      structural: totalLength(partition.structural),
      connective: totalLength(partition.connective),
      pending: totalLength(partition.pending),
      unresolved: totalLength(partition.unresolved),
      residue: totalLength(partition.residue),
    },
    overlaps: overlapDiagnostics({ leaf: leafTagged, structural: structuralTagged, connective: connectiveTagged }),
    whole_reviewed: wholeReviewed,
    uncovered: groupUncovered(ability.source_text, fragments, uncoveredIntervals),
    unaccounted: groupUncovered(ability.source_text, fragments, unaccounted),
    residue: groupUncovered(ability.source_text, fragments, partition.residue),
  };
}

function wholeReviewStates(db: DatabaseSync, currentOnly: boolean, abilityId?: number): Map<number, boolean> {
  const filter = currentOnly ? "AND abilities.current = 1" : "";
  const idFilter = abilityId === undefined ? "" : "AND abilities.id = ?";
  const args = abilityId === undefined ? [] : [abilityId];
  const rows = db.prepare(`
    SELECT abilities.id, COALESCE(ability_reviews.whole_context_checked, 0) AS whole_context_checked
    FROM abilities
    LEFT JOIN ability_reviews ON ability_reviews.ability_version_id = abilities.id
    WHERE 1 = 1 ${filter} ${idFilter}
  `).all(...args) as Array<{ id: number; whole_context_checked: number }>;
  return new Map(rows.map((row) => [row.id, row.whole_context_checked === 1]));
}

/** Calculate source-byte coverage for one persisted ability version. */
export function getAbilityCoverage(db: DatabaseSync, abilityVersionId: number): AbilityCoverage {
  const ability = db.prepare(
    "SELECT id, source_text, fragments_json FROM abilities WHERE id = ?",
  ).get(abilityVersionId) as AbilitySource | undefined;
  if (!ability) throw new RangeError(`Unknown ability version ${abilityVersionId}.`);
  const indexes = loadCoverageIndexes(db, false, abilityVersionId);
  const wholeReviewed = wholeReviewStates(db, false, abilityVersionId).get(abilityVersionId) ?? false;
  return coverageFor(ability, indexes, wholeReviewed);
}

/** Calculate coverage for every current source version without N+1 database queries. */
export function getCurrentCoverage(db: DatabaseSync): Map<number, AbilityCoverage> {
  const abilities = db.prepare(
    "SELECT id, source_text, fragments_json FROM abilities WHERE current = 1 ORDER BY id",
  ).all() as AbilitySource[];
  const indexes = loadCoverageIndexes(db, true);
  const wholeReviewed = wholeReviewStates(db, true);
  return new Map(abilities.map((ability) => [
    ability.id,
    coverageFor(ability, indexes, wholeReviewed.get(ability.id) ?? false),
  ]));
}

/** Canonical roles that may contribute to leaf or proposal coverage. */
export const COVERAGE_SEMANTIC_ROLES = semanticRoles;
