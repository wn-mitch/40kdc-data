/**
 * A read-only snapshot of the repo files the mirror reads and rewrites: every faction dir's
 * abilities, phase mappings, units, stratagems, enhancements, detachments and factions, plus the
 * core stratagems. Each file keeps its original text so edits can be spliced in place.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { REPO_ROOT } from "../repo-files.js";

export type Json = Record<string, unknown>;

export interface RepoFile<T = Json> {
  /** Repo-relative path with forward slashes. */
  rel: string;
  abs: string;
  /** Faction dir, or `_core` / `` for top-level files. */
  dir: string;
  text: string;
  records: T[];
}

export interface AbilityRecord extends Json {
  ability_id: string;
  name: string;
  ability_type?: string;
  faction_id?: string | null;
  detachment_id?: string | null;
  unit_ids?: string[];
  stub?: true;
  effect?: Json;
}

export interface EntityRecord extends Json {
  id: string;
  name?: string;
  external_refs?: { namespace: string; id: string }[];
}

export interface RepoSnapshot {
  root: string;
  abilities: RepoFile<AbilityRecord>[];
  phaseMappings: RepoFile[];
  units: RepoFile<EntityRecord>[];
  stratagems: RepoFile<EntityRecord>[];
  enhancements: RepoFile<EntityRecord>[];
  detachments: RepoFile<EntityRecord>[];
  factions: RepoFile<EntityRecord>[];
  /** Weapons and non-weapon wargear (the ids a unit's loadout counts). */
  wargear: RepoFile<EntityRecord>[];
  /** Enrichment dirs that exist (abilities.json present). */
  enrichmentDirs: Set<string>;
  /** Core faction dirs that exist. */
  coreDirs: Set<string>;
}

const posix = (p: string): string => p.split(path.sep).join("/");

function dirsUnder(abs: string): string[] {
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") || d.name === "_core")
    .map((d) => d.name)
    .sort();
}

function readFile<T>(root: string, rel: string, dir: string): RepoFile<T> | null {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`Expected a JSON array in ${rel}`);
  return { rel: posix(rel), abs, dir, text, records: parsed as T[] };
}

/** The mfm external-ref ids of an entity. */
export function mfmIds(e: { external_refs?: { namespace: string; id: string }[] } | undefined): string[] {
  return (e?.external_refs ?? []).filter((r) => r.namespace === "mfm").map((r) => r.id);
}

/** Load the snapshot from a repo root (defaults to this checkout). */
export function loadRepo(root: string = REPO_ROOT): RepoSnapshot {
  const coreRoot = path.join(root, "data", "core");
  const enrichRoot = path.join(root, "data", "enrichment");
  const coreDirs = dirsUnder(coreRoot).filter((d) => d !== "_core");
  const enrichDirs = dirsUnder(enrichRoot);
  const snap: RepoSnapshot = {
    root,
    abilities: [],
    phaseMappings: [],
    units: [],
    stratagems: [],
    enhancements: [],
    detachments: [],
    factions: [],
    wargear: [],
    enrichmentDirs: new Set(),
    coreDirs: new Set(coreDirs),
  };
  for (const dir of enrichDirs) {
    const a = readFile<AbilityRecord>(root, path.join("data", "enrichment", dir, "abilities.json"), dir);
    if (a) {
      snap.abilities.push(a);
      snap.enrichmentDirs.add(dir);
    }
    const p = readFile<Json>(root, path.join("data", "enrichment", dir, "phase-mappings.json"), dir);
    if (p) snap.phaseMappings.push(p);
  }
  for (const dir of coreDirs) {
    const push = (list: RepoFile<EntityRecord>[], base: string): void => {
      const f = readFile<EntityRecord>(root, path.join("data", "core", dir, base), dir);
      if (f) list.push(f);
    };
    push(snap.units, "units.json");
    push(snap.stratagems, "stratagems.json");
    push(snap.enhancements, "enhancements.json");
    push(snap.detachments, "detachments.json");
    push(snap.factions, "factions.json");
    push(snap.wargear, "wargear.json");
    push(snap.wargear, "weapons.json");
  }
  const coreStrats = readFile<EntityRecord>(root, path.join("data", "core", "stratagems.json"), "_core");
  if (coreStrats) snap.stratagems.push(coreStrats);
  return snap;
}
