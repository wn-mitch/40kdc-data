/**
 * unit-stats.ts — reconcile each unit profile's characteristics (M, T, W, Sv, Ld, OC) with the
 * GW MFM dump's miniature statlines (the `unit-stats` subcommand).
 *
 * A datasheet's visible miniatures (not `statlineHidden`) each print one statline; a hidden one
 * repeats another's. A repo profile takes the statline of the visible miniature with its name,
 * else of the hidden miniature with its name. A unit with one profile whose visible miniatures all
 * print the same statline takes that statline whatever the names. When exactly one profile and
 * exactly one visible miniature are left unpaired after that, the profile takes the miniature's
 * name and statline (a renamed model: "Boss Nob" printed as "Nob"). Any other profile is reported
 * as unmatched, never guessed.
 *
 * The dump is authoritative: a differing characteristic is corrected. A characteristic the dump
 * prints as "-" (an aircraft's Move, a fortification's OC) has no value, recorded as null. Any
 * other value without a number is reported and the authored value kept.
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
  to: number | null;
}

export interface UnitStatsReport {
  corrected: UnitStatChange[];
  /** Characteristics the dump confirmed. */
  confirmed: number;
  /** Characteristics the dump prints with neither a number nor "-"; the authored value is kept. */
  noNumber: Array<{ dir: string; unit: string; profile: string; field: StatField; raw: string; authored: unknown }>;
  /** Profiles that took the name of the one visible miniature left unpaired. */
  renamed: Array<{ dir: string; unit: string; from: string; to: string }>;
  /** Profiles no miniature names. */
  unmatched: Array<{ dir: string; unit: string; profile: string; miniatures: string[] }>;
  staged: StagedWrite[];
}

type Mini = { name: string; statline: Statline };

/** The one statline the miniatures named `name` print, or null when none does or they disagree. */
function namedStatline(minis: readonly Mini[], name: string): Statline | null {
  const key = statlineNameKey(name);
  const named = minis.filter((mini) => statlineNameKey(mini.name) === key);
  const distinct = new Set(named.map((mini) => JSON.stringify(mini.statline)));
  return distinct.size === 1 ? named[0]!.statline : null;
}

/** Which statline a repo profile takes by name (visible, then hidden miniatures), or null. */
export function profileStatline(
  profile: Profile,
  profileCount: number,
  visible: readonly Mini[],
  hidden: readonly Mini[] = [],
): Statline | null {
  const named = namedStatline(visible, profile.name ?? "") ?? namedStatline(hidden, profile.name ?? "");
  if (named) return named;
  if (profileCount !== 1 || visible.length === 0) return null;
  const distinct = new Set(visible.map((mini) => JSON.stringify(mini.statline)));
  return distinct.size === 1 ? visible[0]!.statline : null;
}

/**
 * Each profile's statline. A profile left unattributed takes the name and statline of the one
 * visible miniature no profile names, when it is the only one left on either side.
 */
export function attributeStatlines(
  profiles: readonly Profile[],
  visible: readonly Mini[],
  hidden: readonly Mini[] = [],
): Array<{ statline: Statline | null; rename?: string }> {
  const out: Array<{ statline: Statline | null; rename?: string }> = profiles.map((profile) => ({ statline: profileStatline(profile, profiles.length, visible, hidden) }));
  const open = out.flatMap((entry, index) => (entry.statline === null ? [index] : []));
  const named = new Set(profiles.map((profile) => statlineNameKey(profile.name ?? "")));
  const unpaired = visible.filter((mini) => !named.has(statlineNameKey(mini.name)));
  const unpairedNames = new Set(unpaired.map((mini) => statlineNameKey(mini.name)));
  if (open.length === 1 && unpairedNames.size === 1) {
    const statline = namedStatline(unpaired, unpaired[0]!.name);
    if (statline) out[open[0]!] = { statline, rename: unpaired[0]!.name };
  }
  return out;
}

export function runUnitStats(dump: MfmDump): UnitStatsReport {
  const report: UnitStatsReport = { corrected: [], confirmed: 0, noNumber: [], renamed: [], unmatched: [], staged: [] };
  const minisBySheet = dump.groupBy("miniature", "datasheetId");
  // dir → unitId → the first matching datasheet's visible and hidden miniatures.
  const byDir = new Map<string, Map<string, { visible: Mini[]; hidden: Mini[] }>>();
  forEachDirDatasheet(dump, ({ dir, ds, unitId }) => {
    const units = byDir.get(dir) ?? byDir.set(dir, new Map()).get(dir)!;
    if (units.has(unitId)) return;
    const minis = (minisBySheet.get(ds.id!) ?? []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
    const asMini = (mini: (typeof minis)[number]): Mini => ({
      name: dump.enName(mini) ?? "",
      statline: Object.fromEntries(STAT_FIELDS.map(([field, key]) => [field, (mini as unknown as Record<string, string | undefined>)[key]])) as Statline,
    });
    units.set(unitId, { visible: minis.filter((mini) => !mini.statlineHidden).map(asMini), hidden: minis.filter((mini) => mini.statlineHidden).map(asMini) });
  });

  for (const [dir, sheets] of byDir) {
    const upath = path.join(CORE_DIR, dir, "units.json");
    if (!fs.existsSync(upath)) continue;
    const units = readJsonArray<UnitRecord>(upath);
    let dirty = false;
    for (const unit of units) {
      const sheet = sheets.get(unit.id);
      if (sheet === undefined) continue;
      const { visible, hidden } = sheet;
      const attributed = attributeStatlines(unit.profiles, visible, hidden);
      unit.profiles.forEach((profile, index) => {
        const { statline, rename } = attributed[index]!;
        if (statline === null) {
          report.unmatched.push({ dir, unit: unit.id, profile: profile.name ?? unit.id, miniatures: visible.map((mini) => mini.name) });
          return;
        }
        if (rename !== undefined && rename !== profile.name) {
          report.renamed.push({ dir, unit: unit.id, from: profile.name ?? unit.id, to: rename });
          profile.name = rename;
          dirty = true;
        }
        const label = profile.name ?? unit.id;
        for (const [field] of STAT_FIELDS) {
          const raw = statline[field] ?? "";
          const want = parseDumpStat(raw);
          if (want === null && raw.trim() === "-") {
            // The datasheet prints no value (an aircraft's Move).
            if (profile[field] === null) { report.confirmed += 1; continue; }
            report.corrected.push({ dir, unit: unit.id, profile: label, field, from: profile[field], to: null });
            profile[field] = null;
            dirty = true;
            continue;
          }
          if (want === null) {
            report.noNumber.push({ dir, unit: unit.id, profile: label, field, raw, authored: profile[field] });
            continue;
          }
          if (profile[field] === want) { report.confirmed += 1; continue; }
          report.corrected.push({ dir, unit: unit.id, profile: label, field, from: profile[field], to: want });
          profile[field] = want;
          dirty = true;
        }
      });
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
  L.push("A differing value is corrected; one the dump prints as \"-\" becomes null. A profile left over with");
  L.push("one visible miniature left over takes that miniature's name.", "");
  L.push("| Metric | Count |", "|---|--:|");
  L.push(`| Corrected | ${report.corrected.length} |`);
  L.push(`| Confirmed | ${report.confirmed} |`);
  L.push(`| No number in the dump (authored kept) | ${report.noNumber.length} |`);
  L.push(`| Renamed to the dump's model name | ${report.renamed.length} |`);
  L.push(`| Unmatched profiles | ${report.unmatched.length} |`, "");
  const section = (title: string, lines: string[]): void => {
    if (lines.length === 0) return;
    L.push(`## ${title}`, "", ...lines, "");
  };
  section("Corrected (dump authoritative)", report.corrected.map((c) => `- ${c.dir}/${c.unit} :: ${c.profile} ${c.field}: ${JSON.stringify(c.from)} → ${c.to}`));
  section("Renamed to the dump's model name", report.renamed.map((r) => `- ${r.dir}/${r.unit} :: ${r.from} → ${r.to}`));
  section("No number in the dump (authored kept)", report.noNumber.map((n) => `- ${n.dir}/${n.unit} :: ${n.profile} ${n.field}: dump ${JSON.stringify(n.raw)}, authored ${JSON.stringify(n.authored)}`));
  section("Unmatched profiles (not attributed)", report.unmatched.map((u) => `- ${u.dir}/${u.unit} :: ${u.profile} (miniatures: ${u.miniatures.join(", ") || "none"})`));
  return L.join("\n") + "\n";
}
