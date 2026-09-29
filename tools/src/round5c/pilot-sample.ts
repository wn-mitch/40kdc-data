import type { DatabaseSync } from "node:sqlite";

import { getCurrentCoverage } from "./coverage.js";
import { leafSurface, untiledRuns } from "./leaves.js";
import { listLeafProposals } from "./leaf-proposals.js";

/**
 * A deterministic, seeded, stratified sample of residue abilities for the DeepSeek-vs-Jev pilot
 * (Phase 4 step 8b follow-up). Stratifies on two axes: the faction an ability belongs to, and
 * which of the top residue clusters (by occurrence count) its largest untiled span falls in — an
 * ability whose spans match no cluster the residue report already found lands in a catch-all
 * "other" stratum, so the sample still covers residue outside the biggest named shapes.
 */

export type PilotAbility = {
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  /** The cluster (from the residue report) its largest untiled span matches, or null if none did. */
  cluster: number | null;
  untiled_spans: number;
};

export type PilotStratum = { cluster: number | "other"; occurrences: number; candidates: number; sampled: number };

export type PilotSample = {
  seed: number;
  generated_at: string;
  target_size: number;
  factions_represented: number;
  strata: PilotStratum[];
  abilities: PilotAbility[];
};

export type PilotSampleOptions = {
  seed?: number;
  targetSize?: number;
  /** How many of the residue report's largest clusters get their own stratum. */
  topClusters?: number;
};

/** A small, fast, seedable PRNG (mulberry32) — deterministic across Node versions and platforms,
 * unlike relying on `Math.random`. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates using a seeded generator, so the same seed always gives the same order. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** Every current residue ability, with the cluster (if any) its largest untiled span matches. */
function residueCandidates(db: DatabaseSync): PilotAbility[] {
  const coverage = getCurrentCoverage(db);
  const listing = listLeafProposals(db, { limit: 100000, kinds: ["unlabelled"] });
  const surfaceToCluster = new Map<string, number>();
  for (const cluster of listing.clusters) for (const proposal of cluster.proposals) surfaceToCluster.set(proposal.surface, cluster.cluster);

  const rows = db.prepare(`SELECT id, faction_id, ability_id FROM abilities WHERE current = 1`)
    .all() as Array<{ id: number; faction_id: string; ability_id: string }>;
  const candidates: PilotAbility[] = [];
  for (const row of rows) {
    const view = coverage.get(row.id);
    if (!view) continue;
    const runs = untiledRuns(view);
    if (runs.length === 0) continue;
    let cluster: number | null = null;
    let bestBytes = -1;
    for (const run of runs) {
      const matched = surfaceToCluster.get(leafSurface(run.text));
      const bytes = run.end_byte - run.start_byte;
      if (matched !== undefined && bytes > bestBytes) { cluster = matched; bestBytes = bytes; }
    }
    candidates.push({ ability_version_id: row.id, faction_id: row.faction_id, ability_id: row.ability_id, cluster, untiled_spans: runs.length });
  }
  return candidates;
}

/**
 * Within one stratum's candidates, take one per distinct faction first (in shuffled order), then
 * fill any remaining quota from what's left — so a stratum dominated by one faction's abilities
 * doesn't crowd out the others until every faction present has had a turn.
 */
function sampleStratum(candidates: readonly PilotAbility[], quota: number, random: () => number): PilotAbility[] {
  if (candidates.length <= quota) return [...candidates];
  const byFaction = new Map<string, PilotAbility[]>();
  for (const candidate of shuffled(candidates, random)) {
    const list = byFaction.get(candidate.faction_id) ?? [];
    list.push(candidate);
    byFaction.set(candidate.faction_id, list);
  }
  const factionOrder = shuffled([...byFaction.keys()], random);
  const picked: PilotAbility[] = [];
  let round = 0;
  while (picked.length < quota) {
    let addedThisRound = false;
    for (const faction of factionOrder) {
      if (picked.length >= quota) break;
      const list = byFaction.get(faction)!;
      if (round >= list.length) continue;
      picked.push(list[round]!);
      addedThisRound = true;
    }
    if (!addedThisRound) break; // every faction's list exhausted before quota is filled
    round += 1;
  }
  return picked;
}

const DEFAULT_OPTIONS: Required<PilotSampleOptions> = { seed: 1, targetSize: 140, topClusters: 20 };

export function selectPilotSample(db: DatabaseSync, options: PilotSampleOptions = {}): PilotSample {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const candidates = residueCandidates(db);
  const listing = listLeafProposals(db, { limit: 100000, kinds: ["unlabelled"] });
  const topClusterIds = [...listing.clusters]
    .sort((left, right) => right.occurrences - left.occurrences || right.closes - left.closes)
    .slice(0, opts.topClusters)
    .map((cluster) => cluster.cluster);
  const clusterOccurrences = new Map(listing.clusters.map((cluster) => [cluster.cluster, cluster.occurrences]));

  const byStratum = new Map<number | "other", PilotAbility[]>();
  for (const candidate of candidates) {
    const key: number | "other" = candidate.cluster !== null && topClusterIds.includes(candidate.cluster) ? candidate.cluster : "other";
    const list = byStratum.get(key) ?? [];
    list.push(candidate);
    byStratum.set(key, list);
  }
  // Deterministic stratum order: named clusters largest-occurrence first, "other" last.
  const strataKeys: Array<number | "other"> = [...topClusterIds.filter((id) => byStratum.has(id)), ...(byStratum.has("other") ? ["other" as const] : [])];

  const random = mulberry32(opts.seed);
  // Even split across strata, remainder to the largest strata first, capped by each stratum's size.
  const base = Math.floor(opts.targetSize / Math.max(1, strataKeys.length));
  let remainder = opts.targetSize - base * strataKeys.length;
  const abilities: PilotAbility[] = [];
  const strata: PilotStratum[] = [];
  for (const key of strataKeys) {
    const pool = byStratum.get(key)!;
    let quota = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    quota = Math.min(quota, pool.length);
    const picked = sampleStratum(pool, quota, random);
    abilities.push(...picked);
    strata.push({ cluster: key, occurrences: key === "other" ? 0 : clusterOccurrences.get(key) ?? 0, candidates: pool.length, sampled: picked.length });
  }
  // If strata came in under target (small pools), top up from the largest remaining pools.
  let shortfall = opts.targetSize - abilities.length;
  if (shortfall > 0) {
    const chosen = new Set(abilities.map((a) => a.ability_version_id));
    const leftovers = shuffled(candidates.filter((c) => !chosen.has(c.ability_version_id)), random);
    for (const candidate of leftovers) {
      if (shortfall <= 0) break;
      abilities.push(candidate);
      shortfall -= 1;
    }
  }

  return {
    seed: opts.seed,
    generated_at: new Date().toISOString(),
    target_size: opts.targetSize,
    factions_represented: new Set(abilities.map((a) => a.faction_id)).size,
    strata,
    abilities: abilities.sort((left, right) => left.faction_id.localeCompare(right.faction_id) || left.ability_id.localeCompare(right.ability_id)),
  };
}
