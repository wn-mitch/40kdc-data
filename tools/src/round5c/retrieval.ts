import type { DatabaseSync } from "node:sqlite";

import { exactSpan } from "./contracts.js";
import { bumpWorkbenchRevision, insertSpan, RESTATES_ACTIVE_ANNOTATION, withTransaction } from "./db.js";
import { getCurrentCoverage } from "./coverage.js";
import { normalizedProjection, normalizedSurface, type NormalizedProjection } from "./matching.js";

const RETRIEVAL_ALGORITHM = "round5c/lexical-fts5/v1";
const DEFAULT_PAGE_SIZE = 20;
/** Bound even scoped groups: identical spans can carry different surrounding conditions. */
export const GROUP_PAGE_LIMIT = 30;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 30;
const SAMPLE_LIMIT = 3;

type Prototype = {
  annotation_id: number;
  span_id: number;
  fingerprint_id: string;
  family_id: string;
  family_version: number;
  role: string;
  ability_version_id: number;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  source_hash: string;
  context_text: string | null;
};

export type ChunkMatch = {
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  source_text: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  normalized_text: string;
  bm25: number | null;
};


type CandidateOccurrence = {
  proposal_id: number;
  origin: string;
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  context: string;
  context_start: number;
  context_end: number;
  score: number | null;
  normalized_text: string;
  context_signature: string;
  fingerprint_id: string;
  family_id: string;
  family_version: number;
  role: string;
  parameters: Record<string, unknown>;
};

function familyGroupSignature(occurrence: CandidateOccurrence): string {
  return `${occurrence.normalized_text}\u0000${occurrence.fingerprint_id}`;
}

type Cursor = { score: number | null; signature: string; proposal_id: number };
export type FrontierRow = {
  proposal_id: number;
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  source_hash: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  reason_json: string;
};


function lexicalTokens(source: string): string[] {
  return [...new Set(source.match(/[\p{L}\p{N}]+/gu) ?? [])];
}

export function ftsQuery(surface: string): string | null {
  const tokens = lexicalTokens(surface);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

function contextOverlap(first: string, second: string): number {
  const firstTokens = new Set(lexicalTokens(first));
  const secondTokens = new Set(lexicalTokens(second));
  if (firstTokens.size === 0 || secondTokens.size === 0) return 0;
  let shared = 0;
  for (const token of firstTokens) if (secondTokens.has(token)) shared += 1;
  return shared / Math.max(firstTokens.size, secondTokens.size);
}

export function matchesAt(projection: NormalizedProjection, surface: string): Array<{ start_byte: number; end_byte: number }> {
  if (!surface || projection.text.length < surface.length) return [];
  const matches: Array<{ start_byte: number; end_byte: number }> = [];
  let from = 0;
  while (from < projection.text.length) {
    const index = projection.text.indexOf(surface, from);
    if (index < 0) break;
    const end = index + surface.length;
    const before = projection.text[index - 1] ?? "";
    const after = projection.text[end] ?? "";
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
      matches.push({ start_byte: projection.starts[index]!, end_byte: projection.ends[end - 1]! });
    }
    from = index + Math.max(surface.length, 1);
  }
  return matches;
}

function prototypeRows(db: DatabaseSync): Prototype[] {
  return db.prepare(`
    SELECT annotations.id AS annotation_id, source_spans.id AS span_id, annotations.fingerprint_id,
      fingerprints.family_id, fingerprints.family_version, semantic_families.role,
      abilities.id AS ability_version_id, source_spans.fragment, source_spans.start_byte,
      source_spans.end_byte, source_spans.exact_text, abilities.source_hash,
      (
        SELECT source_chunks.normalized_text
        FROM source_chunks
        WHERE source_chunks.ability_version_id = abilities.id
          AND source_chunks.fragment = source_spans.fragment
          AND source_chunks.start_byte <= source_spans.start_byte
          AND source_chunks.end_byte >= source_spans.end_byte
        ORDER BY source_chunks.start_byte, source_chunks.end_byte
        LIMIT 1
      ) AS context_text
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id
      AND semantic_families.version = fingerprints.family_version
    WHERE annotations.status = 'active' AND abilities.current = 1
      AND fingerprints.status = 'active' AND semantic_families.status = 'active'
    ORDER BY annotations.id
  `).all() as unknown as Prototype[];
}

export function candidateChunks(db: DatabaseSync, query: string): ChunkMatch[] {
  return db.prepare(`
    SELECT source_chunks.ability_version_id, abilities.faction_id, abilities.ability_id,
      abilities.source_hash, abilities.source_text, source_chunks.fragment,
      source_chunks.start_byte, source_chunks.end_byte, source_chunks.normalized_text,
      bm25(source_chunks_fts) AS bm25
    FROM source_chunks_fts
    JOIN source_chunks ON source_chunks.id = source_chunks_fts.rowid
    JOIN abilities ON abilities.id = source_chunks.ability_version_id
    WHERE source_chunks_fts MATCH ? AND abilities.current = 1
    ORDER BY bm25(source_chunks_fts), source_chunks.id
  `).all(query) as unknown as ChunkMatch[];
}

function existingDecision(
  db: DatabaseSync,
  abilityVersionId: number,
  fragment: string,
  startByte: number,
  endByte: number,
  role: string,
): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM source_spans
    WHERE source_spans.ability_version_id = ? AND source_spans.fragment = ?
      AND (
        EXISTS (
          SELECT 1 FROM annotations
          JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
          JOIN semantic_families ON semantic_families.id = fingerprints.family_id
            AND semantic_families.version = fingerprints.family_version
          WHERE annotations.span_id = source_spans.id
            AND annotations.status = 'active' AND semantic_families.role = ?
            AND source_spans.start_byte < ? AND ? < source_spans.end_byte
        )
        OR EXISTS (
          SELECT 1 FROM proposals
          WHERE proposals.span_id = source_spans.id
            AND proposals.status IN ('pending', 'rejected', 'corrected')
            AND source_spans.start_byte = ? AND source_spans.end_byte = ?
        )
      )
    LIMIT 1
  `).get(abilityVersionId, fragment, role, endByte, startByte, startByte, endByte) as { 1: number } | undefined;
  return row !== undefined;
}

function sourceContext(source: string, startByte: number, endByte: number): { text: string; start: number; end: number } {
  const bytes = Buffer.from(source, "utf8");
  const radius = 80;
  let beforeStart = Math.max(0, startByte - radius);
  let before = "";
  while (beforeStart < startByte) {
    try {
      before = exactSpan(source, beforeStart, startByte);
      break;
    } catch {
      beforeStart += 1;
    }
  }
  let afterEnd = Math.min(bytes.length, endByte + radius);
  let after = "";
  while (afterEnd > endByte) {
    try {
      after = exactSpan(source, endByte, afterEnd);
      break;
    } catch {
      afterEnd -= 1;
    }
  }
  const exact = exactSpan(source, startByte, endByte);
  return { text: `${before}${exact}${after}`, start: before.length, end: before.length + exact.length };
}

function proposalReason(prototype: Prototype, chunk: ChunkMatch, surface: string, score: number, overlap: number): string {
  return JSON.stringify({
    algorithm: RETRIEVAL_ALGORITHM,
    prototype_annotation_id: prototype.annotation_id,
    prototype_span_id: prototype.span_id,
    prototype_fingerprint_id: prototype.fingerprint_id,
    prototype_source_hash: prototype.source_hash,
    source_hash: chunk.source_hash,
    normalized_surface: surface,
    context_signature: chunk.normalized_text,
    match: "exact-normalized-surface",
    bm25: chunk.bm25,
    context_token_overlap: overlap,
    score,
  });
}

/**
 * Expand current human-confirmed source spans only through exact normalized lexical matches.
 * Every match remains a source-bound pending proposal; this function never confirms a candidate.
 */
export function proposeLexical(db: DatabaseSync): { created: number; existing: number } {
  return withTransaction(db, () => {
    let created = 0;
    let existing = 0;
    const insertProposal = db.prepare(`
      INSERT INTO proposals (span_id, fingerprint_id, role, origin, status, reason_json, score, created_at)
      VALUES (?, ?, ?, 'retrieval', 'pending', ?, ?, ?)
    `);
    const now = new Date().toISOString();

    // One scan per spelling and meaning: repeated confirmations of the same wording find the same matches.
    const scanned = new Set<string>();
    for (const prototype of prototypeRows(db)) {
      const surface = normalizedSurface(prototype.exact_text);
      const key = `${surface}\u0000${prototype.fingerprint_id}`;
      if (scanned.has(key)) continue;
      scanned.add(key);
      const query = ftsQuery(surface);
      if (!query) continue;
      const prototypeContext = prototype.context_text ?? surface;
      for (const chunk of candidateChunks(db, query)) {
        const chunkText = exactSpan(chunk.source_text, chunk.start_byte, chunk.end_byte);
        const projection = normalizedProjection(chunkText);
        for (const match of matchesAt(projection, surface)) {
          const startByte = chunk.start_byte + match.start_byte;
          const endByte = chunk.start_byte + match.end_byte;
          if (existingDecision(db, chunk.ability_version_id, chunk.fragment, startByte, endByte, prototype.role)) {
            existing += 1;
            continue;
          }
          const exactText = exactSpan(chunk.source_text, startByte, endByte);
          const overlap = contextOverlap(prototypeContext, chunk.normalized_text);
          const score = 1_000 + overlap * 100 + Math.max(0, -(chunk.bm25 ?? 0));
          const spanId = insertSpan(db, chunk.ability_version_id, chunk.fragment, startByte, endByte, exactText);
          insertProposal.run(
            spanId,
            prototype.fingerprint_id,
            prototype.role,
            proposalReason(prototype, chunk, surface, score, overlap),
            score,
            now,
          );
          created += 1;
        }
      }
    }
    // New pending proposals change Family Mode and the work queue for every open session.
    if (created > 0) bumpWorkbenchRevision(db);
    return { created, existing };
  });
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
      || typeof (parsed as Record<string, unknown>).signature !== "string"
      || !Number.isSafeInteger((parsed as Record<string, unknown>).proposal_id)
      || !(
        (parsed as Record<string, unknown>).score === null
        || (typeof (parsed as Record<string, unknown>).score === "number"
          && Number.isFinite((parsed as Record<string, unknown>).score))
      )
    ) throw new Error("Malformed cursor.");
    const cursor = parsed as Cursor;
    if (cursor.proposal_id < 1 || encodeCursor(cursor) !== value) throw new Error("Malformed cursor.");
    return cursor;
  } catch {
    throw new RangeError("Family candidate cursor is malformed.");
  }
}

function pageSize(limit: number | undefined, groupScoped: boolean): number {
  const max = groupScoped ? GROUP_PAGE_LIMIT : MAX_PAGE_SIZE;
  const value = limit ?? (groupScoped ? GROUP_PAGE_LIMIT : DEFAULT_PAGE_SIZE);
  if (!Number.isSafeInteger(value) || value < MIN_PAGE_SIZE || value > max) {
    throw new RangeError(`Family candidate page size must be an integer from ${MIN_PAGE_SIZE} through ${max}.`);
  }
  return value;
}

function candidateOccurrences(db: DatabaseSync, familyId: string): CandidateOccurrence[] {
  const rows = db.prepare(`
    SELECT proposals.id AS proposal_id, proposals.origin, abilities.id AS ability_version_id, abilities.faction_id,
      abilities.ability_id, abilities.source_hash, abilities.source_text, source_spans.fragment,
      source_spans.start_byte, source_spans.end_byte, source_spans.exact_text, proposals.score,
      fingerprints.id AS fingerprint_id, fingerprints.family_id, fingerprints.family_version,
      semantic_families.role, fingerprints.parameters_json,
      (
        SELECT source_chunks.normalized_text
        FROM source_chunks
        WHERE source_chunks.ability_version_id = abilities.id
          AND source_chunks.fragment = source_spans.fragment
          AND source_chunks.start_byte <= source_spans.start_byte
          AND source_chunks.end_byte >= source_spans.end_byte
        ORDER BY source_chunks.start_byte, source_chunks.end_byte
        LIMIT 1
      ) AS context_text
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id
    JOIN semantic_families ON semantic_families.id = fingerprints.family_id
      AND semantic_families.version = fingerprints.family_version
    WHERE proposals.status = 'pending'
      AND abilities.current = 1 AND fingerprints.family_id = ?
      AND NOT ${RESTATES_ACTIVE_ANNOTATION}
    ORDER BY proposals.id
  `).all(familyId) as Array<Omit<CandidateOccurrence, "normalized_text" | "context_signature" | "context" | "context_start" | "context_end" | "parameters"> & {
    source_text: string;
    context_text: string | null;
    parameters_json: string;
  }>;

  return rows.map((row) => {
    const context = sourceContext(row.source_text, row.start_byte, row.end_byte);
    const normalizedText = normalizedSurface(row.exact_text);
    const contextSignature = row.context_text ?? normalizedSurface(context.text);
    return {
      proposal_id: row.proposal_id,
      origin: row.origin,
      ability_version_id: row.ability_version_id,
      faction_id: row.faction_id,
      ability_id: row.ability_id,
      source_hash: row.source_hash,
      fragment: row.fragment,
      start_byte: row.start_byte,
      end_byte: row.end_byte,
      exact_text: row.exact_text,
      context: context.text,
      context_start: context.start,
      context_end: context.end,
      score: row.score,
      fingerprint_id: row.fingerprint_id,
      family_id: row.family_id,
      family_version: row.family_version,
      role: row.role,
      parameters: JSON.parse(row.parameters_json) as Record<string, unknown>,
      normalized_text: normalizedText,
      context_signature: contextSignature,
    };
  }).sort((first, second) => {
    const firstScore = first.score ?? Number.NEGATIVE_INFINITY;
    const secondScore = second.score ?? Number.NEGATIVE_INFINITY;
    if (firstScore !== secondScore) return secondScore - firstScore;
    const firstSignature = familyGroupSignature(first);
    const secondSignature = familyGroupSignature(second);
    if (firstSignature < secondSignature) return -1;
    if (firstSignature > secondSignature) return 1;
    return first.proposal_id - second.proposal_id;
  });
}
/**
 * Return a bounded, context-sensitive Family Mode page of pending fingerprinted proposals from
 * every origin (retrieval, imported seeds, Luna). `signature` narrows the page to one
 * `(normalized surface, fingerprint)` group; group counts always cover the whole family.
 */
export function retrieveFamilyCandidates(
  db: DatabaseSync,
  familyId: string,
  options: { limit?: number; cursor?: string; signature?: string; factionId?: string } = {},
): {
  groups: Array<{
    signature: string;
    count: number;
    context_count: number;
    samples: string[];
    /** An active human annotation with this exact surface and fingerprint, if one exists. */
    occurrences: Array<Omit<CandidateOccurrence, "normalized_text">>;
  }>;
  next_cursor: string | null;
  progress: { reviewed: number; total: number };
} {
  if (!familyId.trim()) throw new RangeError("Family id must be nonblank.");
  const limit = pageSize(options.limit, options.signature !== undefined);
  const cursor = decodeCursor(options.cursor);
  const all = candidateOccurrences(db, familyId).filter((occurrence) => !options.factionId || occurrence.faction_id === options.factionId);
  const signatures = new Map<string, CandidateOccurrence[]>();
  for (const occurrence of all) {
    const signature = familyGroupSignature(occurrence);
    const group = signatures.get(signature) ?? [];
    group.push(occurrence);
    signatures.set(signature, group);
  }
  const scoped = options.signature === undefined ? all : all.filter((occurrence) => familyGroupSignature(occurrence) === options.signature);
  const after = cursor === null
    ? scoped
    : scoped.filter((occurrence) => {
      const occurrenceScore = occurrence.score ?? Number.NEGATIVE_INFINITY;
      const cursorScore = cursor.score ?? Number.NEGATIVE_INFINITY;
      if (occurrenceScore < cursorScore) return true;
      if (occurrenceScore > cursorScore) return false;
      const signature = familyGroupSignature(occurrence);
      return signature > cursor.signature || (signature === cursor.signature && occurrence.proposal_id > cursor.proposal_id);
    });
  const page = after.slice(0, limit);
  const visible = new Map<string, CandidateOccurrence[]>();
  for (const occurrence of page) {
    const signature = familyGroupSignature(occurrence);
    const group = visible.get(signature) ?? [];
    group.push(occurrence);
    visible.set(signature, group);
  }
  const groups = [...visible.entries()].map(([signature, occurrences]) => {
    const allOccurrences = signatures.get(signature) ?? occurrences;
    return {
      signature,
      count: allOccurrences.length,
      context_count: new Set(allOccurrences.map((occurrence) => `${occurrence.context_signature}\u0000${occurrence.context}`)).size,
      samples: [...new Set(allOccurrences.map((occurrence) => occurrence.context))].slice(0, SAMPLE_LIMIT),
      occurrences: occurrences.map(({ normalized_text: _normalized, ...occurrence }) => occurrence),
    };
  });
  const progress = db.prepare(`
    SELECT count(*) AS total,
      count(*) FILTER (WHERE proposals.status IN ('accepted', 'rejected', 'corrected')) AS reviewed
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = proposals.fingerprint_id
    WHERE abilities.current = 1 AND fingerprints.family_id = ?
      AND (? IS NULL OR abilities.faction_id = ?)
      AND proposals.status IN ('pending', 'accepted', 'rejected', 'corrected')
      AND NOT (proposals.status = 'pending' AND ${RESTATES_ACTIVE_ANNOTATION})
  `).get(familyId, options.factionId ?? null, options.factionId ?? null) as { total: number; reviewed: number };
  const last = page.at(-1);
  return {
    groups,
    progress,
    next_cursor: after.length > page.length && last
      ? encodeCursor({
        score: last.score,
        signature: familyGroupSignature(last),
        proposal_id: last.proposal_id,
      })
      : null,
  };
}

export type PendingFamilyGroup = {
  family_id: string;
  signature: string;
  exact_text: string;
  count: number;
  context_count: number;
  page_context_max: number;
  faction_counts: Record<string, number>;
  faction_page_context_max: Record<string, number>;
  origins: string[];
};

/** Every pending Family Mode group across active families, with per-faction occurrence counts. */
export function pendingFamilyGroups(db: DatabaseSync): PendingFamilyGroup[] {
  const families = db.prepare("SELECT DISTINCT id FROM semantic_families WHERE status = 'active' ORDER BY id").all() as Array<{ id: string }>;
  const groups: PendingFamilyGroup[] = [];
  for (const family of families) {
    const bySignature = new Map<string, CandidateOccurrence[]>();
    for (const occurrence of candidateOccurrences(db, family.id)) {
      const signature = familyGroupSignature(occurrence);
      const group = bySignature.get(signature) ?? [];
      group.push(occurrence);
      bySignature.set(signature, group);
    }
    for (const [signature, occurrences] of bySignature) {
      const factionCounts: Record<string, number> = {};
      for (const occurrence of occurrences) factionCounts[occurrence.faction_id] = (factionCounts[occurrence.faction_id] ?? 0) + 1;
      const factionContexts = new Map<string, Map<string, number>>();
      const factionPageSizes = new Map<string, number>();
      for (const occurrence of occurrences) {
        const id = occurrence.faction_id;
        const pageSize = factionPageSizes.get(id) ?? 0;
        if (pageSize >= GROUP_PAGE_LIMIT) continue;
        factionPageSizes.set(id, pageSize + 1);
        const contexts = factionContexts.get(id) ?? new Map<string, number>();
        const key = `${occurrence.context_signature}\u0000${occurrence.context}`;
        contexts.set(key, (contexts.get(key) ?? 0) + 1);
        factionContexts.set(id, contexts);
      }
      const pageContexts = new Map<string, number>();
      for (const occurrence of occurrences.slice(0, GROUP_PAGE_LIMIT)) {
        const key = `${occurrence.context_signature}\u0000${occurrence.context}`;
        pageContexts.set(key, (pageContexts.get(key) ?? 0) + 1);
      }
      groups.push({
        family_id: family.id,
        signature,
        exact_text: occurrences[0]!.exact_text,
        count: occurrences.length,
        context_count: new Set(occurrences.map((occurrence) => `${occurrence.context_signature}\u0000${occurrence.context}`)).size,
        page_context_max: Math.max(...pageContexts.values()),
        faction_counts: factionCounts,
        faction_page_context_max: Object.fromEntries([...factionContexts].map(([id, contexts]) => [id, Math.max(...contexts.values())])),
        origins: [...new Set(occurrences.map((occurrence) => occurrence.origin))].sort(),
      });
    }
  }
  return groups;
}

/** Repeated no-fingerprint surfaces (pending or unresolved, not yet annotated), largest first. */
export function unresolvedClusters(db: DatabaseSync): Array<{ signature: string; rows: FrontierRow[] }> {
  const unresolved = db.prepare(`
    SELECT proposals.id AS proposal_id, abilities.id AS ability_version_id, abilities.faction_id,
      abilities.ability_id, abilities.source_hash, source_spans.fragment, source_spans.start_byte,
      source_spans.end_byte, source_spans.exact_text, proposals.reason_json
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND proposals.fingerprint_id IS NULL
      AND proposals.status IN ('pending', 'unresolved')
      AND NOT EXISTS (
        SELECT 1 FROM annotations
        WHERE annotations.span_id = source_spans.id AND annotations.status = 'active'
      )
    ORDER BY proposals.id
  `).all() as FrontierRow[];
  const clusterMap = new Map<string, FrontierRow[]>();
  for (const row of unresolved) {
    const signature = normalizedSurface(row.exact_text);
    if (!signature) continue;
    const entries = clusterMap.get(signature) ?? [];
    entries.push(row);
    clusterMap.set(signature, entries);
  }
  return [...clusterMap.entries()]
    .filter(([, rows]) => rows.length > 1)
    .sort(([, first], [, second]) => second.length - first.length || first[0]!.proposal_id - second[0]!.proposal_id)
    .map(([signature, rows]) => ({ signature, rows }));
}

function parsedReason(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    return { malformed_reason_json: serialized };
  }
}

/**
 * Prioritise repeated unresolved source wording, then review conflicts, then current low-coverage abilities.
 * Known fingerprints are deliberately excluded from unresolved clusters even when they are rare.
 */
export function getFrontier(db: DatabaseSync): {
  clusters: Array<{
    signature: string;
    count: number;
    samples: Array<{
      ability_version_id: number;
      source_hash: string;
      fragment: string;
      start_byte: number;
      end_byte: number;
      exact_text: string;
    }>;
  }>;
  conflicts: Array<{ proposal_id: number; ability_version_id: number; reason: unknown }>;
  abilities: Array<{ id: number; faction_id: string; ability_id: string; leaf_fraction: number }>;
} {
  const clusters = unresolvedClusters(db)
    .slice(0, 24)
    .map(({ signature, rows }) => ({
      signature,
      count: rows.length,
      samples: rows.slice(0, SAMPLE_LIMIT).map((row) => ({
        ability_version_id: row.ability_version_id,
        source_hash: row.source_hash,
        fragment: row.fragment,
        start_byte: row.start_byte,
        end_byte: row.end_byte,
        exact_text: row.exact_text,
      })),
    }));

  const conflictRows = db.prepare(`
    SELECT DISTINCT proposals.id AS proposal_id, abilities.id AS ability_version_id, proposals.reason_json
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND (
      proposals.status = 'corrected'
      OR (
        proposals.status IN ('pending', 'unresolved')
        AND EXISTS (
          SELECT 1
          FROM annotations
          JOIN source_spans AS annotation_spans ON annotation_spans.id = annotations.span_id
          JOIN fingerprints AS annotation_fingerprints ON annotation_fingerprints.id = annotations.fingerprint_id
          JOIN semantic_families AS annotation_families
            ON annotation_families.id = annotation_fingerprints.family_id
            AND annotation_families.version = annotation_fingerprints.family_version
          WHERE annotations.status = 'active'
            AND annotation_spans.ability_version_id = abilities.id
            AND annotation_spans.fragment = source_spans.fragment
            AND annotation_spans.start_byte < source_spans.end_byte
            AND source_spans.start_byte < annotation_spans.end_byte
            AND annotation_families.role = proposals.role
            -- The same fingerprint on overlapping bytes restates a confirmed leaf; it is not a contradiction.
            AND proposals.fingerprint_id IS NOT annotations.fingerprint_id
        )
      )
    )
    ORDER BY CASE proposals.status WHEN 'corrected' THEN 0 ELSE 1 END, proposals.id DESC
    LIMIT 24
  `).all() as Array<{ proposal_id: number; ability_version_id: number; reason_json: string }>;
  const coverage = getCurrentCoverage(db);
  const abilityRows = db.prepare(`
    SELECT id, faction_id, ability_id FROM abilities WHERE current = 1 ORDER BY id
  `).all() as Array<{ id: number; faction_id: string; ability_id: string }>;

  return {
    clusters,
    conflicts: conflictRows.map((row) => ({
      proposal_id: row.proposal_id,
      ability_version_id: row.ability_version_id,
      reason: parsedReason(row.reason_json),
    })),
    abilities: abilityRows
      .map((ability) => ({
        ...ability,
        leaf_fraction: coverage.get(ability.id)?.leaf_fraction ?? 0,
      }))
      .sort((first, second) => first.leaf_fraction - second.leaf_fraction || first.id - second.id)
      .slice(0, 24),
  };
}
