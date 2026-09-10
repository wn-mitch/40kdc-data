/**
 * Audit loadout coverage: core units that carry no weapon loadout — the
 * skeletons the MFM `seed-units` pass creates (id/name/profiles/points/keywords)
 * and the `wargear`/`composition-tiers` reconcile passes never back-filled.
 *
 * `seed-units` deliberately emits a unit with `weapon_ids`/`ability_ids` absent,
 * to be filled by follow-up passes; but those passes skip any datasheet whose
 * unit didn't yet exist when they ran, so a unit seeded afterwards keeps an empty
 * loadout. This audit separates missing equipment from explicitly authored
 * weaponless compositions, without a unit-ID exemption list.
 *
 * A weaponless composition has non-empty model rows, each explicitly declaring
 * an empty default_weapon_ids array, and no variants or wargear options.
 * Missing arrays are unknown equipment, not a declaration that a model is unarmed.
 * Legends (`is_legend: true`) are excluded.
 *
 * Writes `data/_audit/loadout-coverage.json` and `data/_audit/loadout-coverage.md`,
 * grouped by faction.
 *
 * Usage:
 *   npx tsx tools/src/audit-loadout-coverage.ts            # write reports
 *   npx tsx tools/src/audit-loadout-coverage.ts --dry-run  # print summary only
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "../..");

interface CoreUnit {
  id: string;
  weapon_ids?: string[] | null;
  ability_ids?: string[] | null;
  is_legend?: boolean;
}

interface Composition {
  unit_id: string;
  models?: { default_weapon_ids?: string[]; loadout_variants?: unknown[] }[];
}

export interface SkeletonUnit {
  faction: string;
  unit_id: string;
  missing: ("weapons" | "wargear-options" | "composition" | "abilities")[];
}

export interface LoadoutCoverageReport {
  generatedFrom: string;
  totalSkeletons: number;
  byFaction: Record<string, SkeletonUnit[]>;
  totalWeaponless: number;
  weaponlessByFaction: Record<string, string[]>;
}

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function listFactionDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

function unitIdSet(path: string, key: string): Set<string> {
  const out = new Set<string>();
  if (!existsSync(path)) return out;
  for (const row of readJSON<Record<string, unknown>[]>(path)) {
    const id = row[key];
    if (typeof id === "string") out.add(id);
  }
  return out;
}

export function auditLoadoutCoverage(opts: { rootDir?: string } = {}): LoadoutCoverageReport {
  const root = opts.rootDir ?? DEFAULT_ROOT;
  const coreDir = resolve(root, "data/core");

  const byFaction: Record<string, SkeletonUnit[]> = {};
  let totalSkeletons = 0;
  const weaponlessByFaction: Record<string, string[]> = {};
  let totalWeaponless = 0;

  for (const faction of listFactionDirs(coreDir)) {
    const unitsPath = join(coreDir, faction, "units.json");
    if (!existsSync(unitsPath)) continue;
    const compositionsPath = join(coreDir, faction, "unit-compositions.json");
    const compositions = existsSync(compositionsPath) ? readJSON<Composition[]>(compositionsPath) : [];
    const compByUnit = new Map(compositions.map((composition) => [composition.unit_id, composition]));
    const wgoUnits = unitIdSet(join(coreDir, faction, "wargear-options.json"), "unit_id");

    const skeletons: SkeletonUnit[] = [];
    for (const u of readJSON<CoreUnit[]>(unitsPath)) {
      if (u.is_legend) continue;
      if ((u.weapon_ids?.length ?? 0) > 0) continue; // has a loadout → not a skeleton
      const composition = compByUnit.get(u.id);
      if (!wgoUnits.has(u.id) && composition?.models?.length &&
          composition.models.every((model) => Array.isArray(model.default_weapon_ids) &&
            model.default_weapon_ids.length === 0 && !(model.loadout_variants?.length))) {
        (weaponlessByFaction[faction] ??= []).push(u.id);
        totalWeaponless++;
        continue;
      }
      const missing: SkeletonUnit["missing"] = ["weapons"];
      if (!wgoUnits.has(u.id)) missing.push("wargear-options");
      if (!compByUnit.has(u.id)) missing.push("composition");
      if ((u.ability_ids?.length ?? 0) === 0) missing.push("abilities");
      skeletons.push({ faction, unit_id: u.id, missing });
    }

    if (skeletons.length === 0) continue;
    skeletons.sort((a, b) => a.unit_id.localeCompare(b.unit_id));
    byFaction[faction] = skeletons;
    totalSkeletons += skeletons.length;
  }

  return {
    generatedFrom: "tools/src/audit-loadout-coverage.ts",
    totalSkeletons,
    byFaction,
    totalWeaponless,
    weaponlessByFaction: Object.fromEntries(
      Object.entries(weaponlessByFaction).map(([faction, ids]) => [faction, ids.sort()]),
    ),
  };
}

function renderMarkdown(report: LoadoutCoverageReport): string {
  const factions = Object.keys(report.byFaction).sort();
  const lines: string[] = [];
  lines.push("# Loadout-coverage audit");
  lines.push("");
  lines.push(
    "Generated by `tools/src/audit-loadout-coverage.ts` (`npm run audit:loadout-coverage`).",
  );
  lines.push("Lists non-Legends units whose equipment remains unrecorded. Explicitly authored");
  lines.push("empty model loadouts without variants or options are listed separately as weaponless.");
  lines.push("");
  lines.push(`**Total skeletons: ${report.totalSkeletons}**`);
  lines.push(`**Explicitly weaponless units: ${report.totalWeaponless}**`);
  lines.push("");
  lines.push("| faction | skeletons |");
  lines.push("|---|--:|");
  for (const f of factions) {
    lines.push(`| ${f} | ${report.byFaction[f].length} |`);
  }
  lines.push("");
  for (const f of factions) {
    lines.push(`## ${f} (${report.byFaction[f].length})`);
    lines.push("");
    for (const s of report.byFaction[f]) {
      lines.push(`- \`${s.unit_id}\` — missing: ${s.missing.join(", ")}`);
    }
    lines.push("");
  }
  for (const faction of Object.keys(report.weaponlessByFaction).sort()) {
    lines.push(`## ${faction} — explicitly weaponless`);
    lines.push("");
    for (const id of report.weaponlessByFaction[faction]) lines.push(`- \`${id}\``);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

// ─── CLI ────────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") ===
    fileURLToPath(import.meta.url).replace(/\.\w+$/, "");

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: npx tsx tools/src/audit-loadout-coverage.ts [--dry-run]");
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const report = auditLoadoutCoverage();
  const auditDir = resolve(DEFAULT_ROOT, "data/_audit");

  console.log(`Total loadout skeletons: ${report.totalSkeletons}`);
  console.log(`Explicitly weaponless units: ${report.totalWeaponless}`);
  for (const f of Object.keys(report.byFaction).sort()) {
    console.log(`  ${f}: ${report.byFaction[f].length}`);
  }

  if (!dryRun) {
    writeFileSync(
      join(auditDir, "loadout-coverage.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    writeFileSync(join(auditDir, "loadout-coverage.md"), renderMarkdown(report));
    console.log(
      `\nWrote data/_audit/loadout-coverage.json and data/_audit/loadout-coverage.md`,
    );
  } else {
    console.log("\n(dry-run; no files written)");
  }
}
