/**
 * unit-stats.ts — reconcile each unit profile's characteristics (M, T, W, Sv, Ld, OC) with the
 * GW MFM dump's miniature statlines (the `unit-stats` subcommand).
 *
 * A datasheet's visible miniatures (not `statlineHidden`) each print one statline. A repo profile
 * takes the statline of the miniature with its name; a unit with one profile whose visible
 * miniatures all print the same statline takes that statline whatever the names. Any other
 * profile is reported as unmatched, never guessed.
 *
 * The dump is authoritative: a differing characteristic is corrected. A characteristic the dump
 * prints as "-" (an aircraft's Move, a fortification's OC) has no number to compare, so the
 * authored value is kept and reported.
 *
 * Datasheet→repo-unit matching reuses {@link forEachDirDatasheet}, as the base-sizes and wargear
 * passes do. Mutations are applied in both dry-run and write modes and routed through
 * {@link applyWrites}, which validates the projected dataset and persists only on --write.
 */
import * as fs from "fs";
import * as path from "path";
import { MfmDump } from "./loader.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import { forEachDirDatasheet } from "./wargear.js";
import type { StagedWrite } from "./apply.js";

/** Repo profile field → dump miniature field. */
export const STAT_FIELDS = [
  ["M", "movement"],
  ["T", "toughness"],
  ["W", "wounds"],
  ["Sv", "save"],
  ["Ld", "leadership"],
  ["OC", "objectiveControl"],
] as const;

type StatField = (typeof STAT_FIELDS)[number][0];
type Statline = Record<StatField, string | undefined>;

interface Profile {
  name?: string;
  [k: string]: unknown;
}
interface UnitRecord {
  id: string;
  profiles: Profile[];
  [k: string]: unknown;
}

/**
 * A dump characteristic as an integer: Move carries a trailing `"`, Save and Leadership a
 * trailing `+`, the rest are bare digits. "-", "N/A" and empty print no number: null.
 */
export function parseDumpStat(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim().replace(/["+]$/u, "");
  return /^\d+$/u.test(s) ? parseInt(s, 10) : null;
}

/** A model name compared across the dump and the repo: case, apostrophe style and punctuation drop out. */
export function statlineNameKey(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase().replace(/[’‘`]/gu, "'").replace(/[^a-z0-9]+/gu, " ").trim();
}

export interface UnitStatChange {
  dir: string;
  unit: string;
  profile: string;
  field: StatField;
  from: unknown;
  to: number;
}

export interface UnitStatsReport {
  corrected: UnitStatChange[];
  /** Characteristics the dump confirmed. */
  confirmed: number;
  /** Characteristics the dump prints with no number; the authored value is kept. */
  noNumber: Array<{ dir: string; unit: string; profile: string; field: StatField; raw: string; authored: unknown }>;
  /** Profiles no visible miniature names. */
  unmatched: Array<{ dir: string; unit: string; profile: string; miniatures: string[] }>;
  staged: StagedWrite[];
}

/** Which statline a repo profile takes, or null when none is attributable. */
export function profileStatline(
  profile: Profile,
  profileCount: number,
  visible: ReadonlyArray<{ name: string; statline: Statline }>,
): Statline | null {
  const key = statlineNameKey(profile.name ?? "");
  const named = visible.filter((mini) => statlineNameKey(mini.name) === key);
  if (named.length > 0) {
    // Two miniatures with one name and different statlines name nothing.
    const distinct = new Set(named.map((mini) => JSON.stringify(mini.statline)));
    return distinct.size === 1 ? named[0]!.statline : null;
  }
  if (profileCount !== 1 || visible.length === 0) return null;
  const distinct = new Set(visible.map((mini) => JSON.stringify(mini.statline)));
  return distinct.size === 1 ? visible[0]!.statline : null;
}

export function runUnitStats(dump: MfmDump): UnitStatsReport {
  const report: UnitStatsReport = { corrected: [], confirmed: 0, noNumber: [], unmatched: [], staged: [] };
  const minisBySheet = dump.groupBy("miniature", "datasheetId");
  // dir → unitId → the first matching datasheet's visible miniatures.
  const byDir = new Map<string, Map<string, Array<{ name: string; statline: Statline }>>>();
  forEachDirDatasheet(dump, ({ dir, ds, unitId }) => {
    const units = byDir.get(dir) ?? byDir.set(dir, new Map()).get(dir)!;
    if (units.has(unitId)) return;
    const minis = (minisBySheet.get(ds.id!) ?? []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
    units.set(unitId, minis.filter((mini) => !mini.statlineHidden).map((mini) => ({
      name: dump.enName(mini) ?? "",
      statline: Object.fromEntries(STAT_FIELDS.map(([field, key]) => [field, (mini as unknown as Record<string, string | undefined>)[key]])) as Statline,
    })));
  });

  for (const [dir, sheets] of byDir) {
    const upath = path.join(CORE_DIR, dir, "units.json");
    if (!fs.existsSync(upath)) continue;
    const units = readJsonArray<UnitRecord>(upath);
    let dirty = false;
    for (const unit of units) {
      const visible = sheets.get(unit.id);
      if (visible === undefined) continue;
      for (const profile of unit.profiles) {
        const statline = profileStatline(profile, unit.profiles.length, visible);
        const label = profile.name ?? unit.id;
        if (statline === null) {
          report.unmatched.push({ dir, unit: unit.id, profile: label, miniatures: visible.map((mini) => mini.name) });
          continue;
        }
        for (const [field] of STAT_FIELDS) {
          const raw = statline[field] ?? "";
          const want = parseDumpStat(raw);
          if (want === null) {
            report.noNumber.push({ dir, unit: unit.id, profile: label, field, raw, authored: profile[field] });
            continue;
          }
          if (profile[field] === want) { report.confirmed += 1; continue; }
          report.corrected.push({ dir, unit: unit.id, profile: label, field, from: profile[field], to: want });
          profile[field] = want;
          dirty = true;
        }
      }
    }
    if (dirty) report.staged.push({ path: upath, value: units });
  }
  return report;
}

export function buildUnitStatsReport(report: UnitStatsReport, write: boolean): string {
  const L: string[] = [];
  L.push(`# MFM unit characteristics — ${write ? "APPLIED" : "DRY RUN"}`, "");
  L.push("Reconciles each unit profile's M, T, W, Sv, Ld and OC with the statline of the dump miniature");
  L.push("that has its name (or, for a one-profile unit, the one statline its visible miniatures share).");
  L.push("A differing value is corrected. A characteristic the dump prints as \"-\" keeps the authored value.", "");
  L.push("| Metric | Count |", "|---|--:|");
  L.push(`| Corrected | ${report.corrected.length} |`);
  L.push(`| Confirmed | ${report.confirmed} |`);
  L.push(`| No number in the dump (authored kept) | ${report.noNumber.length} |`);
  L.push(`| Unmatched profiles | ${report.unmatched.length} |`, "");
  const section = (title: string, lines: string[]): void => {
    if (lines.length === 0) return;
    L.push(`## ${title}`, "", ...lines, "");
  };
  section("Corrected (dump authoritative)", report.corrected.map((c) => `- ${c.dir}/${c.unit} :: ${c.profile} ${c.field}: ${JSON.stringify(c.from)} → ${c.to}`));
  section("No number in the dump (authored kept)", report.noNumber.map((n) => `- ${n.dir}/${n.unit} :: ${n.profile} ${n.field}: dump ${JSON.stringify(n.raw)}, authored ${JSON.stringify(n.authored)}`));
  section("Unmatched profiles (not attributed)", report.unmatched.map((u) => `- ${u.dir}/${u.unit} :: ${u.profile} (miniatures: ${u.miniatures.join(", ") || "none"})`));
  return L.join("\n") + "\n";
}
