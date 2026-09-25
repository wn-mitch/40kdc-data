import type { DatabaseSync } from "node:sqlite";

import { getCurrentCoverage } from "./coverage.js";
import { initializeWorkbench, RESTATES_ACTIVE_ANNOTATION } from "./db.js";
import { normalizedSurface } from "./matching.js";
import { GROUP_PAGE_LIMIT, pendingFamilyGroups, unresolvedClusters } from "./retrieval.js";

/** A repeatable decision matters when it can affect more than one source occurrence. */
export const MULTI_YIELD_THRESHOLD = 2;
/** A seed shorter than this is already phrase-sized; only longer whole-clause seeds are flagged. */
export const BROAD_SEED_MIN_TOKENS = 6;
const BROAD_SEED_WINDOW = { min: 4, max: 8 } as const;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type QueueKind = "conflict" | "unparsed-source" | "family-group" | "unresolved-cluster" | "broad-seed" | "luna" | "ability";

export type QueueTarget =
  | { view: "family"; family_id: string; signature: string }
  | { view: "abilities"; ability_version_id: number; source_hash?: string; action?: "analyze-source" }
  | { view: "luna"; mode: "residue"; faction_id: string | null };

export type QueueItem = {
  /** Stable identity across recomputes, so the UI can keep focus on an item. */
  key: string;
  kind: QueueKind;
  /**
   * Maximum visible candidates for a family group, eligible stamp matches, or one
   * proposal on an ability card. Only stamp approval applies without further selection.
   */
  unlocks: number;
  /** Everything behind the item (a family group's full backlog); breaks ties between equal yields. */
  backlog: number;
  why: string;
  target: QueueTarget;
};

export type WorkQueue = {
  items: QueueItem[];
  total: number;
  thresholds: { multi_yield: number; group_page: number };
};

// Kind order breaks ties between equal yields: cheaper, more deterministic actions first.
const KIND_ORDER: Record<QueueKind, number> = {
  conflict: 0,
  "family-group": 4,
  "unresolved-cluster": 5,
  ability: 6,
  "broad-seed": 7,
  "unparsed-source": 8,
  luna: 9,
};

function plural(count: number, word: string): string {
  if (count === 1) return `${count} ${word}`;
  return `${count} ${word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

function byYield(left: QueueItem, right: QueueItem): number {
  return right.unlocks - left.unlocks || right.backlog - left.backlog || KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

function factionOf(db: DatabaseSync): Map<number, string> {
  const rows = db.prepare("SELECT id, faction_id FROM abilities WHERE current = 1").all() as Array<{ id: number; faction_id: string }>;
  return new Map(rows.map((row) => [row.id, row.faction_id]));
}

/**
 * Pending or unresolved proposals that overlap an active annotation of the same role with a
 * different (or no) fingerprint, as one
 * item pointing at the ability with the most. Each conflict is a single-ability fix, so listing
 * them individually would bury every multi-occurrence action beneath singletons.
 */
function conflictItem(db: DatabaseSync, factionId: string | null): QueueItem | null {
  const rows = db.prepare(`
    SELECT abilities.id AS ability_version_id, abilities.faction_id, abilities.ability_id, count(DISTINCT proposals.id) AS count
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND proposals.status IN ('pending', 'unresolved')
      AND (? IS NULL OR abilities.faction_id = ?)
      AND EXISTS (
        SELECT 1
        FROM annotations
        JOIN source_spans AS annotation_spans ON annotation_spans.id = annotations.span_id
        JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
        JOIN semantic_families ON semantic_families.id = fingerprints.family_id
          AND semantic_families.version = fingerprints.family_version
        WHERE annotations.status = 'active'
          AND annotation_spans.ability_version_id = abilities.id
          AND annotation_spans.fragment = source_spans.fragment
          AND annotation_spans.start_byte < source_spans.end_byte
          AND source_spans.start_byte < annotation_spans.end_byte
          AND semantic_families.role = proposals.role
          -- The same fingerprint on overlapping bytes restates a confirmed leaf; it is not a contradiction.
          AND proposals.fingerprint_id IS NOT annotations.fingerprint_id
      )
    GROUP BY abilities.id
    ORDER BY count DESC, abilities.id
  `).all(factionId, factionId) as Array<{ ability_version_id: number; faction_id: string; ability_id: string; count: number }>;
  const first = rows[0];
  if (!first) return null;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return {
    key: `conflict:${factionId ?? "*"}`,
    kind: "conflict",
    unlocks: total,
    backlog: total,
    why: `${plural(total, "pending proposal")} across ${plural(rows.length, "ability")} overlap confirmed leaves of the same role. Resolve them before confirming more; next: ${first.faction_id}/${first.ability_id}.`,
    target: { view: "abilities", ability_version_id: first.ability_version_id },
  };
}

function familyItems(db: DatabaseSync, factionId: string | null): QueueItem[] {
  return pendingFamilyGroups(db).flatMap((group): QueueItem[] => {
    const count = factionId === null ? group.count : group.faction_counts[factionId] ?? 0;
    if (count === 0) return [];
    const unlocks = factionId === null ? group.page_context_max : group.faction_page_context_max[factionId] ?? 0;
    return [{
      key: `family:${group.family_id}:${group.signature}`,
      kind: "family-group",
      unlocks,
      backlog: count,
      why: `${group.family_id} "${group.exact_text}": ${plural(count, "pending occurrence")}${factionId === null ? ` across ${plural(group.context_count, "context")}` : ` in ${factionId}`}`
        + `; ${plural(unlocks, "candidate")} on this page ${unlocks === 1 ? "shares" : "share"} one source context (${group.origins.join(", ")}).`,
      target: { view: "family", family_id: group.family_id, signature: group.signature },
    }];
  });
}

function clusterItems(db: DatabaseSync, factionId: string | null): QueueItem[] {
  return unresolvedClusters(db).flatMap(({ signature, rows }): QueueItem[] => {
    // A lone connective ("and") repeats everywhere and names no mechanic.
    if (orderedTokens(signature).length < 2) return [];
    const scoped = factionId === null ? rows : rows.filter((row) => row.faction_id === factionId);
    if (scoped.length === 0) return [];
    const first = scoped[0]!;
    return [{
      key: `cluster:${signature}`,
      kind: "unresolved-cluster",
      unlocks: scoped.length,
      backlog: scoped.length,
      why: `Unresolved wording "${first.exact_text}" repeats ${plural(scoped.length, "time")}; naming it once lets retrieval propagate it.`,
      target: { view: "abilities", ability_version_id: first.ability_version_id },
    }];
  });
}

function abilityItems(db: DatabaseSync, factionId: string | null): QueueItem[] {
  const rows = db.prepare(`
    SELECT abilities.id, abilities.faction_id, abilities.ability_id, count(*) AS count
    FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    WHERE abilities.current = 1 AND proposals.status IN ('pending', 'unresolved')
      AND (? IS NULL OR abilities.faction_id = ?)
      AND NOT ${RESTATES_ACTIVE_ANNOTATION}
    GROUP BY abilities.id
  `).all(factionId, factionId) as Array<{ id: number; faction_id: string; ability_id: string; count: number }>;
  return rows.map((row) => ({
    key: `ability:${row.id}`,
    kind: "ability",
    unlocks: 1,
    backlog: row.count,
    why: `${row.faction_id}/${row.ability_id}: ${plural(row.count, "pending proposal")} on one card; review them individually.`,
    target: { view: "abilities", ability_version_id: row.id },
  }));
}

function orderedTokens(surface: string): string[] {
  return surface.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Human seeds that retrieval cannot propagate because their span is a whole clause: its exact
 * surface occurs nowhere else, but a shorter phrase inside it does. The estimate is an FTS phrase
 * count of other abilities, a hint for narrowing the seed rather than a guaranteed yield.
 */
function broadSeedItems(db: DatabaseSync, factionId: string | null): QueueItem[] {
  const spans = db.prepare(`
    SELECT source_spans.exact_text FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    WHERE annotations.status = 'active'
    UNION ALL
    SELECT source_spans.exact_text FROM proposals
    JOIN source_spans ON source_spans.id = proposals.span_id
  `).all() as Array<{ exact_text: string }>;
  const surfaceCounts = new Map<string, number>();
  for (const span of spans) {
    const surface = normalizedSurface(span.exact_text);
    surfaceCounts.set(surface, (surfaceCounts.get(surface) ?? 0) + 1);
  }
  const seeds = db.prepare(`
    SELECT annotations.id AS annotation_id, abilities.id AS ability_version_id, abilities.faction_id,
      abilities.ability_id, source_spans.exact_text, fingerprints.family_id
    FROM annotations
    JOIN source_spans ON source_spans.id = annotations.span_id
    JOIN abilities ON abilities.id = source_spans.ability_version_id
    JOIN fingerprints ON fingerprints.id = annotations.fingerprint_id
    WHERE annotations.status = 'active' AND annotations.authority_kind = 'human' AND abilities.current = 1
      AND (? IS NULL OR abilities.faction_id = ?)
    ORDER BY annotations.id
  `).all(factionId, factionId) as Array<{ annotation_id: number; ability_version_id: number; faction_id: string; ability_id: string; exact_text: string; family_id: string }>;
  const phraseCount = db.prepare(`
    SELECT count(DISTINCT source_chunks.ability_version_id) AS count
    FROM source_chunks_fts
    JOIN source_chunks ON source_chunks.id = source_chunks_fts.rowid
    JOIN abilities ON abilities.id = source_chunks.ability_version_id
    WHERE source_chunks_fts MATCH ? AND abilities.current = 1 AND abilities.id <> ?
  `);
  const items: QueueItem[] = [];
  for (const seed of seeds) {
    const surface = normalizedSurface(seed.exact_text);
    const tokens = orderedTokens(surface);
    if (tokens.length < BROAD_SEED_MIN_TOKENS || (surfaceCounts.get(surface) ?? 0) > 1) continue;
    let best: { phrase: string; count: number } | null = null;
    for (let width = Math.min(BROAD_SEED_WINDOW.max, tokens.length - 1); width >= BROAD_SEED_WINDOW.min; width -= 1) {
      for (let start = 0; start + width <= tokens.length; start += 1) {
        const window = tokens.slice(start, start + width);
        const query = `"${window.map((token) => token.replaceAll('"', '""')).join(" ")}"`;
        const { count } = phraseCount.get(query, seed.ability_version_id) as { count: number };
        // Wider windows are visited first, so a tie keeps the more specific phrase.
        if (count > (best?.count ?? 0)) best = { phrase: window.join(" "), count };
      }
    }
    if (!best) continue;
    items.push({
      key: `broad-seed:${seed.annotation_id}`,
      kind: "broad-seed",
      unlocks: best.count,
      backlog: best.count,
      why: `${seed.faction_id}/${seed.ability_id}: the ${seed.family_id} seed "${seed.exact_text}" matches nowhere else; the phrase "${best.phrase}" appears in about ${plural(best.count, "other ability")}. Narrow the seed so retrieval can propagate it.`,
      target: { view: "abilities", ability_version_id: seed.ability_version_id },
    });
  }
  return items;
}

/** Abilities named by any pending source-decomposition run, whatever its transport or model label. */
export function pendingLunaAbilities(db: DatabaseSync): Set<number> {
  return new Set((db.prepare(`
    SELECT DISTINCT json_extract(request_ability.value, '$.ability_version_id') AS id
    FROM model_runs, json_each(model_runs.config_json, '$.request_abilities') AS request_ability
    WHERE model_runs.status = 'pending' AND json_type(model_runs.config_json, '$.request_abilities') = 'array'
  `).all() as Array<{ id: number }>).map((row) => Number(row.id)));
}

/**
 * One item per faction for the deterministic first ability that nothing has touched: meaningful
 * unaccounted source, no reviewed leaf or structure, no pending or unresolved claim, and no
 * pending decomposition run. It links to that exact source version and its Analyze action.
 */
function unparsedSourceItems(db: DatabaseSync, factionId: string | null, pendingRuns: ReadonlySet<number>): QueueItem[] {
  const rows = db.prepare(`
    SELECT abilities.id, abilities.faction_id, abilities.ability_id, abilities.source_hash
    FROM abilities
    WHERE abilities.current = 1 AND (? IS NULL OR abilities.faction_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM annotations JOIN source_spans ON source_spans.id = annotations.span_id
        WHERE source_spans.ability_version_id = abilities.id AND annotations.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM proposals JOIN source_spans ON source_spans.id = proposals.span_id
        WHERE source_spans.ability_version_id = abilities.id AND proposals.status IN ('pending', 'unresolved')
      )
      AND NOT EXISTS (
        SELECT 1 FROM source_atom_proposals JOIN source_spans ON source_spans.id = source_atom_proposals.span_id
        WHERE source_spans.ability_version_id = abilities.id AND source_atom_proposals.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM source_atom_reviews JOIN source_spans ON source_spans.id = source_atom_reviews.span_id
        WHERE source_spans.ability_version_id = abilities.id AND source_atom_reviews.status = 'active'
      )
    ORDER BY abilities.faction_id, abilities.ability_id, abilities.id
  `).all(factionId, factionId) as Array<{ id: number; faction_id: string; ability_id: string; source_hash: string }>;
  const coverage = getCurrentCoverage(db);
  const byFaction = new Map<string, { first: typeof rows[number]; bytes: number; count: number }>();
  for (const row of rows) {
    if (pendingRuns.has(row.id)) continue;
    const view = coverage.get(row.id);
    const bytes = (view?.unaccounted ?? []).reduce((total, region) => total + region.end_byte - region.start_byte, 0);
    if (bytes === 0) continue;
    const entry = byFaction.get(row.faction_id);
    if (!entry) byFaction.set(row.faction_id, { first: row, bytes, count: 1 });
    else {
      entry.count += 1;
      if (bytes > entry.bytes) { entry.first = row; entry.bytes = bytes; }
    }
  }
  return [...byFaction.values()].map(({ first, bytes, count }): QueueItem => ({
    key: `unparsed:${first.faction_id}`,
    kind: "unparsed-source",
    unlocks: 1,
    backlog: count,
    why: `${plural(count, "ability")} in ${first.faction_id} have no proposals or reviewed source yet. Analyze ${first.faction_id}/${first.ability_id} (${bytes} unaccounted bytes) or label it by hand.`,
    target: { view: "abilities", ability_version_id: first.id, source_hash: first.source_hash, action: "analyze-source" },
  }));
}

function lunaItem(db: DatabaseSync, factionId: string | null, factions: ReadonlyMap<number, string>): QueueItem | null {
  const pendingRuns = pendingLunaAbilities(db);
  let abilities = 0;
  let regions = 0;
  for (const [id, coverage] of getCurrentCoverage(db)) {
    if (coverage.residue.length === 0 || pendingRuns.has(id)) continue;
    if (factionId !== null && factions.get(id) !== factionId) continue;
    abilities += 1;
    regions += coverage.residue.length;
  }
  if (abilities === 0) return null;
  return {
    key: `luna:${factionId ?? "*"}`,
    kind: "luna",
    unlocks: regions,
    backlog: regions,
    why: `Remaining human work resolves one occurrence per action. ${plural(regions, "unclaimed region")} across ${plural(abilities, "ability")} have no pending proposal; prepare a Luna residue request.`,
    target: { view: "luna", mode: "residue", faction_id: factionId },
  };
}

/** Resolve conflicts, then prioritize repeatable decisions before external residue work. */
export function getQueue(db: DatabaseSync, options: { factionId?: string; limit?: number } = {}): WorkQueue {
  initializeWorkbench(db);
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError(`Queue limit must be an integer from 1 through ${MAX_LIMIT}.`);
  const factionId = options.factionId?.trim() || null;
  const factions = factionOf(db);

  const conflict = conflictItem(db, factionId);
  const unparsed = unparsedSourceItems(db, factionId, pendingLunaAbilities(db));
  const ranked = [
    ...familyItems(db, factionId),
    ...clusterItems(db, factionId),
    ...abilityItems(db, factionId),
  ].sort(byYield);
  const multi = ranked.filter((item) => item.unlocks >= MULTI_YIELD_THRESHOLD);
  const single = ranked.filter((item) => item.unlocks < MULTI_YIELD_THRESHOLD);
  const hints = broadSeedItems(db, factionId).sort(byYield);
  const luna = lunaItem(db, factionId, factions);
  const familySingles = single.filter((item) => item.kind === "family-group");
  const items = [
    ...(conflict ? [conflict] : []), ...multi, ...hints, ...familySingles,
    ...unparsed, ...(luna ? [luna] : []), ...single.filter((item) => item.kind !== "family-group"),
  ];
  return {
    items: items.slice(0, limit),
    total: items.length,
    thresholds: { multi_yield: MULTI_YIELD_THRESHOLD, group_page: GROUP_PAGE_LIMIT },
  };
}
