/**
 * Checks on the projected dataset: id collisions across every entity kind, the (faction, old id)
 * map being a function, and the full AJV + integrity validation of the projection, run through
 * `mfm/apply.ts` against a throwaway copy of `data/` (so files the mirror creates can be validated
 * too; `apply.ts` only stages over files that exist).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prepareWrites, type StagedWrite } from "../apply.js";
import type { MirrorPlan } from "./plan.js";
import type { FileChange } from "./project.js";
import type { RepoSnapshot } from "./repo.js";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface Collision {
  id: string;
  where: string[];
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith("_") || e.name === "_core") out.push(...jsonFiles(abs));
    } else if (e.name.endsWith(".json")) out.push(abs);
  }
  return out;
}

/**
 * Ability ids that collide: with each other across dirs, or with an entity of another kind. A
 * stratagem or enhancement entity sharing its ability's id is the intended link (D6), and a core
 * ability sharing the core catalog id (`unit-keywords.json`) is the catalog entry itself.
 */
export function findCollisions(snap: RepoSnapshot, files: readonly FileChange[]): Collision[] {
  const projected = new Map(files.map((f) => [f.abs, f.after]));
  const textOf = (abs: string): string => projected.get(abs) ?? readFileSync(abs, "utf8");
  const where = new Map<string, Set<string>>();
  const add = (id: string, w: string): void => {
    where.set(id, (where.get(id) ?? new Set()).add(w));
  };
  const abilityFiles = new Set<string>();
  for (const f of files) if (/^data\/enrichment\/[^/]+\/abilities\.json$/.test(f.rel)) abilityFiles.add(f.abs);
  for (const f of snap.abilities) abilityFiles.add(f.abs);
  for (const abs of abilityFiles) {
    const dir = path.basename(path.dirname(abs));
    for (const r of JSON.parse(textOf(abs)) as { ability_id: string }[]) add(r.ability_id, `ability:${dir}`);
  }
  for (const abs of jsonFiles(path.join(snap.root, "data", "core"))) {
    const base = path.basename(abs, ".json");
    if (base === "stratagems" || base === "enhancements" || base === "unit-keywords") continue;
    let v: unknown;
    try {
      v = JSON.parse(textOf(abs));
    } catch {
      continue;
    }
    if (!Array.isArray(v)) continue;
    const dir = path.basename(path.dirname(abs));
    for (const e of v) if (e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string") add((e as { id: string }).id, `${base}:${dir}`);
  }
  const out: Collision[] = [];
  for (const [id, ws] of where) {
    const abilityDirs = [...ws].filter((w) => w.startsWith("ability:"));
    if (!abilityDirs.length) continue;
    // Replicated chapter copies of a detachment/unit id are one entity; only kinds matter here.
    const kinds = new Set([...ws].map((w) => w.split(":")[0]));
    if (abilityDirs.length > 1 || kinds.size > 1) out.push({ id, where: [...ws].sort(cmp) });
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

/** Old keys mapped to more than one new id (must be empty: the map is a function). */
export function oneToMany(plan: MirrorPlan): string[] {
  const seen = new Map<string, Set<string | null>>();
  for (const d of plan.records) seen.set(`${d.dir}/${d.oldId}`, (seen.get(`${d.dir}/${d.oldId}`) ?? new Set()).add(d.newId));
  return [...seen].filter(([, v]) => v.size > 1).map(([k, v]) => `${k} → ${[...v].join(" | ")}`);
}

export interface ValidationOutcome {
  ok: boolean;
  message: string;
}

/** Validate the projected `data/` changes on a copy of the data tree; never touches the repo. */
export async function validateProjection(snap: RepoSnapshot, files: readonly FileChange[]): Promise<ValidationOutcome> {
  const dataFiles = files.filter((f) => f.rel.startsWith("data/core/") || f.rel.startsWith("data/enrichment/"));
  const tmp = mkdtempSync(path.join(os.tmpdir(), "40kdc-mirror-"));
  const log = console.log;
  try {
    const copy = path.join(tmp, "data");
    cpSync(path.join(snap.root, "data"), copy, { recursive: true });
    const staged: StagedWrite[] = [];
    for (const f of dataFiles) {
      const dest = path.join(copy, f.rel.slice("data/".length));
      if (!existsSync(dest)) {
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, "[]\n");
      }
      staged.push({ path: dest, value: JSON.parse(f.after), text: f.after });
    }
    const lines: string[] = [];
    console.log = (...a: unknown[]) => lines.push(a.map(String).join(" "));
    await prepareWrites(staged, { label: "mfm:mirror", dataRoot: copy });
    return { ok: true, message: lines.join("\n") };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    console.log = log;
    rmSync(tmp, { recursive: true, force: true });
  }
}
