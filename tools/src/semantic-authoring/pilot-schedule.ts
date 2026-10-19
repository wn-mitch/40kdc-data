import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";
import type { PilotSample } from "./pilot-sample.js";

/**
 * The order in which pilot steps draw abilities: one persisted schedule per pilot, built once
 * from a stratified sample. It holds one ability per distinct source text (duplicates would
 * repeat the same labelling problem), rotates across the sample's strata so each step mixes
 * residue shapes and factions, and records which step took which abilities so successive steps
 * are disjoint. The sample's own file is sorted by faction and cannot be walked in order.
 */

export type ScheduledAbility = { ability_version_id: number; source_hash: string; faction_id: string; ability_id: string; stratum: string };
export type PilotSchedule = {
  seed: number;
  sample_path: string;
  created_at: string;
  excluded: number[];
  order: ScheduledAbility[];
  /** Step name → the ability versions it took, in the order steps were started. */
  taken: Array<{ step: string; ability_version_ids: number[] }>;
};

/** A deterministic PRNG (mulberry32), so the schedule is reproducible from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

/** Build a schedule (pure: nothing is written). */
export function buildSchedule(db: DatabaseSync, sample: PilotSample, samplePath: string, seed: number, excluded: readonly number[]): PilotSchedule {
  const next = random(seed);
  const hashes = new Map((db.prepare(`SELECT id, source_hash FROM abilities WHERE current = 1 AND id IN (${sample.abilities.map((item) => Number(item.ability_version_id)).join(",") || "NULL"})`)
    .all() as Array<{ id: number; source_hash: string }>).map((row) => [row.id, row.source_hash]));
  const excludedHashes = new Set(excluded.map((id) => hashes.get(id)).filter(Boolean));
  const seen = new Set<string>();
  const strata = new Map<string, ScheduledAbility[]>();
  for (const ability of shuffled(sample.abilities, next)) {
    const hash = hashes.get(ability.ability_version_id);
    if (!hash || excluded.includes(ability.ability_version_id) || excludedHashes.has(hash) || seen.has(hash)) continue;
    seen.add(hash);
    const stratum = String(ability.cluster ?? "other");
    const list = strata.get(stratum) ?? [];
    list.push({ ability_version_id: ability.ability_version_id, source_hash: hash, faction_id: ability.faction_id, ability_id: ability.ability_id, stratum });
    strata.set(stratum, list);
  }
  // Round-robin over strata, largest first, so every step draws from as many shapes as it can.
  const queues = [...strata.values()].sort((left, right) => right.length - left.length || left[0]!.stratum.localeCompare(right[0]!.stratum));
  const order: ScheduledAbility[] = [];
  while (queues.some((queue) => queue.length > 0)) for (const queue of queues) { const item = queue.shift(); if (item) order.push(item); }
  return { seed, sample_path: samplePath, created_at: new Date().toISOString(), excluded: [...excluded], order, taken: [] };
}

export function schedulePath(artifactDirectory: string): string {
  return resolve(artifactDirectory, "pilot-schedule.json");
}

export function readSchedule(artifactDirectory: string): PilotSchedule | null {
  const path = schedulePath(artifactDirectory);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as PilotSchedule : null;
}

export function writeSchedule(artifactDirectory: string, schedule: PilotSchedule): void {
  const path = schedulePath(artifactDirectory);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
}

/** The next `count` scheduled abilities no earlier step took (pure). */
export function nextSlice(schedule: PilotSchedule, count: number): ScheduledAbility[] {
  const taken = new Set(schedule.taken.flatMap((step) => step.ability_version_ids));
  return schedule.order.filter((item) => !taken.has(item.ability_version_id)).slice(0, count);
}

/** Identity of a schedule's order, so a report names exactly which schedule it drew from. */
export function scheduleHash(schedule: PilotSchedule): string {
  return hashJson({ seed: schedule.seed, order: schedule.order.map((item) => item.ability_version_id) });
}
