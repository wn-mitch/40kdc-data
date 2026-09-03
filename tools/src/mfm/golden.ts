/**
 * golden.ts — the MFM data-completeness "golden" mechanism.
 *
 * The repo mirrors GW's live game data, sourced from the gitignored MFM dump
 * (`_private/dump.json`). Because CI can never read that dump, completeness is
 * gated instead against two COMMITTED, IP-safe audit artifacts under
 * `data/_audit/` (kebab entity ids + a numeric `data_version` only — no GW prose):
 *
 *   - `mfm-golden.json` — the authoritative dump inventory: for each category,
 *     the repo ids the live dump implies, per scope (faction dir, or the literal
 *     `_root` for whole-dataset categories).
 *   - `mfm-gaps.json`   — the accepted-gap allowlist: every golden id the repo
 *     does NOT cover at generation time, so the freshly-committed completeness
 *     test (see `test/mfm-completeness.test.ts`) is green. Curated over time by
 *     re-running `just mfm-golden` and reviewing its diff.
 *
 * Every inventory the golden is built from runs through the SAME derivation ingest
 * uses (unit/detachment/enhancement from `ingest-mfm.ts`, stratagem/mission/wargear
 * from their `mfm/` modules, allies from `runAllies`), so a golden id can never
 * drift from the id ingest would actually match against the repo. `buildGaps` and
 * the test both read the repo through the single `repoIds` reader defined here.
 *
 * This module NEVER mutates `data/core`; it only emits the two audit artifacts.
 */
import * as fs from "fs";
import * as path from "path";
import { MfmDump } from "./loader.js";
import { CORE_DIR, REPO_ROOT } from "./repo-files.js";
import { repoDirs } from "./faction-map.js";
import { unitInventory, detachmentInventory, enhancementInventory } from "../ingest-mfm.js";
import { stratagemInventory } from "./stratagems.js";
import { missionInventory } from "./missions.js";
import { wargearOptionInventory, weaponInventory, compositionInventory } from "./wargear.js";
import { runAllies } from "./allies.js";
import { type GoldenMode, GOLDEN_MODES } from "./game-mode.js";

const AUDIT_DIR = path.join(REPO_ROOT, "data", "_audit");
export const GOLDEN_PATH = path.join(AUDIT_DIR, "mfm-golden.json");
export const GAPS_PATH = path.join(AUDIT_DIR, "mfm-gaps.json");

/** The completeness categories, in stable order. Adding one here (with a `repoIds`
 *  reader + a `buildGolden` inventory) auto-extends the completeness test. */
export const GOLDEN_CATEGORIES = [
  "units",
  "detachments",
  "enhancements",
  "stratagems",
  "unit_compositions",
  "wargear_options",
  "weapons",
  "missions",
  "allies",
] as const;

export interface GoldenManifest {
  /** The dump's `data_version` when the golden was generated. */
  data_version: number;
  /** category → scope (faction dir or `_root`) → sorted, de-duplicated repo ids
   *  (the FULL inventory across every game mode). */
  categories: Record<string, Record<string, string[]>>;
  /** category → scope → (id → non-matched-play game mode). An id absent here is
   *  matched-play (the competitive default), so the map stays compact. Lets the
   *  completeness test split competitive from per-mode coverage. */
  modes: Record<string, Record<string, Record<string, GoldenMode>>>;
}

/** Sort + de-duplicate an id iterable into a stable array. */
function dedupeSort(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

/** The per-scope id lists + parallel id→mode map (non-matched-play only) that one
 *  category contributes to the manifest. */
interface FoldedCategory {
  ids: Record<string, string[]>;
  modes: Record<string, Record<string, GoldenMode>>;
}

/** Fold a dir→(id→mode) inventory into the manifest's per-scope id lists plus the
 *  compact non-matched-play mode map, dropping empty scopes. */
function foldScoped(m: Map<string, Map<string, GoldenMode>>): FoldedCategory {
  const ids: Record<string, string[]> = {};
  const modes: Record<string, Record<string, GoldenMode>> = {};
  for (const [scope, byId] of m) {
    const list = dedupeSort(byId.keys());
    if (list.length) ids[scope] = list;
    const nm: Record<string, GoldenMode> = {};
    for (const [id, mode] of byId) if (mode !== "matched-play") nm[id] = mode;
    if (Object.keys(nm).length) modes[scope] = nm;
  }
  return { ids, modes };
}

/** A whole-dataset category (missions/allies) at `_root` — matched-play only. */
function foldRoot(ids: Iterable<string>): FoldedCategory {
  const list = dedupeSort(ids);
  return { ids: list.length ? { _root: list } : {}, modes: {} };
}

/** Build the authoritative dump inventory. Each category runs through the same
 *  derivation ingest uses, so the golden mirrors what ingest would match — and
 *  each id carries the game mode derived in that same pass. */
export function buildGolden(dump: MfmDump): GoldenManifest {
  const built: Record<string, FoldedCategory> = {
    units: foldScoped(unitInventory(dump)),
    detachments: foldScoped(detachmentInventory(dump)),
    enhancements: foldScoped(enhancementInventory(dump)),
    stratagems: foldScoped(stratagemInventory(dump)),
    unit_compositions: foldScoped(compositionInventory(dump)),
    wargear_options: foldScoped(wargearOptionInventory(dump)),
    weapons: foldScoped(weaponInventory(dump)),
    missions: foldRoot(missionInventory(dump)),
    allies: foldRoot(runAllies(dump).rules.map((r) => r.id)),
  };
  const categories: Record<string, Record<string, string[]>> = {};
  const modes: Record<string, Record<string, Record<string, GoldenMode>>> = {};
  for (const [category, folded] of Object.entries(built)) {
    categories[category] = folded.ids;
    if (Object.keys(folded.modes).length) modes[category] = folded.modes;
  }
  return { data_version: dump.version ?? 0, categories, modes };
}

/** Distinct string values of `key` across the JSON array at `p` (empty if absent). */
function readIdSet(p: string, key: string): Set<string> {
  if (!fs.existsSync(p)) return new Set();
  const rows = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>[];
  const out = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "string") out.add(v);
  }
  return out;
}

/** dir → ids read from `<dir>/<file>` under `key`, for every repo faction dir. */
function perDir(file: string, key: string): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const dir of repoDirs()) out[dir] = readIdSet(path.join(CORE_DIR, dir, file), key);
  return out;
}

/** Stratagems split repo↔faction: a golden id counts as covered if it is present
 *  in the dir's `stratagems.json` OR the shared root `stratagems.json`. */
function stratagemRepoIds(): Record<string, Set<string>> {
  const rootIds = readIdSet(path.join(CORE_DIR, "stratagems.json"), "id");
  const out: Record<string, Set<string>> = {};
  for (const dir of repoDirs()) {
    const ids = readIdSet(path.join(CORE_DIR, dir, "stratagems.json"), "id");
    for (const id of rootIds) ids.add(id);
    out[dir] = ids;
  }
  return out;
}

/** The repo ids that cover a golden category, keyed by scope. Read straight from
 *  `data/core/` — never the dump — so the completeness test is CI-safe. */
export function repoIds(category: string): Record<string, Set<string>> {
  switch (category) {
    case "units":
      return perDir("units.json", "id");
    case "detachments":
      return perDir("detachments.json", "id");
    case "enhancements":
      return perDir("enhancements.json", "id");
    case "weapons":
      return perDir("weapons.json", "id");
    case "unit_compositions":
      return perDir("unit-compositions.json", "unit_id");
    case "wargear_options":
      return perDir("wargear-options.json", "unit_id");
    case "stratagems":
      return stratagemRepoIds();
    case "missions":
      return { _root: readIdSet(path.join(CORE_DIR, "mission-cards.json"), "id") };
    case "allies":
      return { _root: readIdSet(path.join(CORE_DIR, "allies.json"), "id") };
    default:
      throw new Error(`unknown golden category: ${category}`);
  }
}

/** The accepted-gap allowlist: per category/scope, the golden ids the repo does
 *  NOT currently cover, carrying each gap id's non-matched-play mode. Same shape
 *  as the golden, so the completeness test can gate competitive coverage against
 *  the matched-play gaps and report each non-competitive mode on its own. */
export function buildGaps(golden: GoldenManifest): GoldenManifest {
  const categories: Record<string, Record<string, string[]>> = {};
  const modes: Record<string, Record<string, Record<string, GoldenMode>>> = {};
  for (const [category, scopes] of Object.entries(golden.categories)) {
    const repo = repoIds(category);
    const gapScopes: Record<string, string[]> = {};
    const modeScopes: Record<string, Record<string, GoldenMode>> = {};
    for (const [scope, ids] of Object.entries(scopes)) {
      const have = repo[scope] ?? new Set<string>();
      const missing = ids.filter((id) => !have.has(id));
      if (missing.length) gapScopes[scope] = missing;
      const goldenModeScope = golden.modes[category]?.[scope];
      if (goldenModeScope) {
        const nm: Record<string, GoldenMode> = {};
        for (const id of missing) {
          const mode = goldenModeScope[id];
          if (mode && mode !== "matched-play") nm[id] = mode;
        }
        if (Object.keys(nm).length) modeScopes[scope] = nm;
      }
    }
    if (Object.keys(gapScopes).length) categories[category] = gapScopes;
    if (Object.keys(modeScopes).length) modes[category] = modeScopes;
  }
  return { data_version: golden.data_version, categories, modes };
}

/** The ids of `category`/`scope` in `manifest` that belong to `mode`. Matched-play
 *  is every id not listed in `manifest.modes` (the compact default). */
export function idsForMode(
  manifest: GoldenManifest,
  category: string,
  scope: string,
  mode: GoldenMode,
): string[] {
  const all = manifest.categories[category]?.[scope] ?? [];
  const modeMap = manifest.modes[category]?.[scope] ?? {};
  return all.filter((id) => (modeMap[id] ?? "matched-play") === mode);
}

/** Recursively sort object keys so serialized artifacts have a stable diff.
 *  Arrays are left in place (id lists are already sorted by {@link dedupeSort}). */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** 2-space JSON with sorted keys and a trailing newline. */
function stableJson(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2) + "\n";
}

/** Regenerate `mfm-golden.json` + `mfm-gaps.json` from the dump. Always writes
 *  (audit-only; never mutates `data/core`), so the `--write` flag does not apply. */
export function writeGolden(dump: MfmDump): void {
  const golden = buildGolden(dump);
  const gaps = buildGaps(golden);
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  fs.writeFileSync(GOLDEN_PATH, stableJson(golden));
  fs.writeFileSync(GAPS_PATH, stableJson(gaps));

  const countByMode = (m: GoldenManifest): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const mode of GOLDEN_MODES) counts[mode] = 0;
    for (const [category, scopes] of Object.entries(m.categories)) {
      for (const scope of Object.keys(scopes)) {
        for (const mode of GOLDEN_MODES) {
          counts[mode] += idsForMode(m, category, scope, mode).length;
        }
      }
    }
    return counts;
  };
  const total = (c: Record<string, number>): number =>
    GOLDEN_MODES.reduce((a, mode) => a + c[mode], 0);
  const fmt = (c: Record<string, number>): string =>
    GOLDEN_MODES.map((mode) => `${mode} ${c[mode]}`).join(", ");
  const goldenCounts = countByMode(golden);
  const gapCounts = countByMode(gaps);
  console.log(
    `Wrote ${path.relative(REPO_ROOT, GOLDEN_PATH)} — data_version ${golden.data_version}, ` +
      `${total(goldenCounts)} golden ids (${fmt(goldenCounts)}).`,
  );
  console.log(
    `Wrote ${path.relative(REPO_ROOT, GAPS_PATH)} — ` +
      `${total(gapCounts)} allowlisted gap ids (${fmt(gapCounts)}).`,
  );
}
