/**
 * Populate `base_size_mm` on units and their composition models from the GW
 * Tournament Companion base-size guide (primary) and bevy-deploy-helper (fallback).
 *
 * Additive only: this patches the existing committed `units.json` and
 * `unit-compositions.json` in place, preserving every other field and key order.
 * It deliberately does NOT re-run `convert-faction` (which regenerates and would
 * regress unrelated committed data — see CONTRIBUTING.md / project memory).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGuideIndex,
  buildBevyIndex,
  assignBaseSizes,
  type GuideRow,
  type BaseSize,
  type BevySources,
  type UnitInput,
  type CompositionModel,
} from "../converters/base-size-bridge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../.."); // tools/src/commands → repo root
const CORE_DIR = resolve(ROOT, "data/core");
const GUIDE_PATH = resolve(__dirname, "../converters/data/base-size-guide.json");
const BEVY_DIR = resolve(ROOT, "../bevy-deploy-helper/assets");
const REPORT_PATH = resolve(CORE_DIR, "_reports/_base-sizes.unresolved.json");

interface UnitRecord {
  id: string;
  keywords?: string[];
  faction_keywords?: string[];
  base_size_mm?: BaseSize | null;
  [k: string]: unknown;
}
interface CompositionRecord {
  unit_id: string;
  models: Array<CompositionModel & { base_size_mm?: BaseSize } & Record<string, unknown>>;
  [k: string]: unknown;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/** Rebuild an object, dropping any existing `base_size_mm`, then inserting it after
 *  the first present anchor key (or appending if none/undefined). Preserves order. */
function withBaseSize<T extends Record<string, unknown>>(
  obj: T,
  value: BaseSize | undefined,
  anchors: string[],
): T {
  const anchor = anchors.find((k) => k in obj);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "base_size_mm") continue; // re-inserted below (idempotent re-runs)
    out[k] = v;
    if (k === anchor && value) out.base_size_mm = value;
  }
  if (value && !anchor) out.base_size_mm = value;
  return out as T;
}

/** Vehicle/Aircraft units are expected to be hull-based; tracked separately in the summary. */
function isVehicle(u: UnitRecord): boolean {
  return (u.keywords ?? []).some((k) => /vehicle|aircraft/i.test(k));
}

export function populateBaseSizesCommand(): void {
  // ── Sources ──────────────────────────────────────────────────────
  const guideRows = readJson<GuideRow[]>(GUIDE_PATH);
  const guide = buildGuideIndex(guideRows);

  let bevy = new Map<string, BaseSize>();
  if (existsSync(resolve(BEVY_DIR, "Datasheets.json"))) {
    const src: BevySources = {
      datasheets: readJson(resolve(BEVY_DIR, "Datasheets.json")),
      models: readJson(resolve(BEVY_DIR, "Datasheets_models.json")),
    };
    bevy = buildBevyIndex(src);
  } else {
    console.warn(`  ! bevy fallback not found at ${BEVY_DIR} — proceeding guide-only`);
  }

  // ── Load every faction's units + compositions ────────────────────
  const factions = readdirSync(CORE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .filter((f) => existsSync(resolve(CORE_DIR, f, "units.json")));

  const compByUnit = new Map<string, CompositionModel[]>();
  const compFiles = new Map<string, { path: string; records: CompositionRecord[] }>();
  for (const f of factions) {
    const cpath = resolve(CORE_DIR, f, "unit-compositions.json");
    if (!existsSync(cpath)) continue;
    const records = readJson<CompositionRecord[]>(cpath);
    compFiles.set(f, { path: cpath, records });
    for (const c of records) compByUnit.set(c.unit_id, c.models);
  }

  const unitFiles = new Map<string, { path: string; records: UnitRecord[] }>();
  const unitInputs: UnitInput[] = [];
  for (const f of factions) {
    const upath = resolve(CORE_DIR, f, "units.json");
    const records = readJson<UnitRecord[]>(upath);
    unitFiles.set(f, { path: upath, records });
    for (const u of records) {
      unitInputs.push({ id: u.id, models: compByUnit.get(u.id) ?? [] });
    }
  }

  // ── Resolve ──────────────────────────────────────────────────────
  const { assignments, report } = assignBaseSizes(unitInputs, guide, bevy);

  // ── Patch units.json (representative base) ───────────────────────
  const stats = { unitsTotal: 0, unitsPopulated: 0, nvTotal: 0, nvPopulated: 0, draftUnits: 0 };
  for (const [f, { path, records }] of unitFiles) {
    const patched = records.map((u) => {
      stats.unitsTotal++;
      const vehicle = isVehicle(u);
      if (!vehicle) stats.nvTotal++;
      const base = assignments.get(u.id)?.unitBase;
      if (base) {
        stats.unitsPopulated++;
        if (!vehicle) stats.nvPopulated++;
        if (base.draft) stats.draftUnits++;
      }
      return withBaseSize(u, base, ["faction_keywords", "keywords", "profiles"]);
    });
    writeJson(path, patched);
  }

  // ── Patch unit-compositions.json (per-model bases) ───────────────
  let modelEntries = 0;
  let modelPopulated = 0;
  for (const [f, { path, records }] of compFiles) {
    const patched = records.map((c) => {
      const modelBases = assignments.get(c.unit_id)?.modelBases ?? new Map<string, BaseSize>();
      const models = c.models.map((m) => {
        modelEntries++;
        const base = modelBases.get(m.name);
        if (base) modelPopulated++;
        return withBaseSize(m, base, ["is_leader_model", "default_weapon_ids", "max"]);
      });
      return { ...c, models };
    });
    writeJson(path, patched);
  }

  // ── Report ───────────────────────────────────────────────────────
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeJson(REPORT_PATH, {
    generated_from: "GW Chapter Approved Tournament Companion — Base Size Guide (primary) + bevy-deploy-helper (fallback)",
    summary: {
      units_total: stats.unitsTotal,
      units_populated: stats.unitsPopulated,
      non_vehicle_total: stats.nvTotal,
      non_vehicle_populated: stats.nvPopulated,
      draft_units: stats.draftUnits,
      bevy_fallback: report.bevyFallback.length,
      unmatched: report.unmatched.length,
      unresolved_models: report.unresolvedModels.length,
      guide_unparsed: report.guideUnparsed.length,
    },
    unmatched_units: report.unmatched.sort(),
    bevy_fallback_units: report.bevyFallback.sort(),
    unresolved_models: report.unresolvedModels.sort(),
    guide_unparsed_rows: report.guideUnparsed,
  });

  // ── Summary ──────────────────────────────────────────────────────
  const pct = (n: number, d: number) => (d === 0 ? "0" : ((100 * n) / d).toFixed(1));
  console.log(`  ✓ base sizes populated`);
  console.log(`    units:        ${stats.unitsPopulated}/${stats.unitsTotal} (${pct(stats.unitsPopulated, stats.unitsTotal)}%)`);
  console.log(`    non-vehicle:  ${stats.nvPopulated}/${stats.nvTotal} (${pct(stats.nvPopulated, stats.nvTotal)}%)`);
  console.log(`    per-model:    ${modelPopulated}/${modelEntries}`);
  console.log(`    draft units:  ${stats.draftUnits}   bevy fallback: ${report.bevyFallback.length}`);
  console.log(`    unmatched:    ${report.unmatched.length}   unresolved models: ${report.unresolvedModels.length}`);
  console.log(`    report → ${REPORT_PATH.replace(ROOT + "/", "")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) populateBaseSizesCommand();
