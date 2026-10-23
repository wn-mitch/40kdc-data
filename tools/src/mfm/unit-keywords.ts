/**
 * unit-keywords.ts — reconcile each existing unit's `keywords` with the GW MFM dump (the
 * `unit-keywords` subcommand).
 *
 * The dump is authoritative: a unit's keywords are its miniatures' keywords plus its datasheet
 * name ({@link buildKeywords}). Units imported before an 11th-edition codex keep keywords that
 * codex replaced (Grenades where it prints Explosives) and often lack their datasheet name; this
 * pass adds what the dump lists and drops what it does not. A keyword the dump grants the
 * datasheet only conditionally (a Mark of Chaos chosen at muster) is kept where the unit already
 * carries it, since the repo does not yet model that choice. Kept keywords keep their order, and
 * added ones follow in the dump's order. `faction_keywords` and `conditional_keywords` are left
 * alone.
 *
 * Datasheet→repo-unit matching reuses {@link forEachDirDatasheet}, so it cannot drift from the
 * wargear reconcile. Mutations are routed through {@link applyWrites}, which validates the
 * projected dataset and only persists on --write.
 */
import * as fs from "fs";
import * as path from "path";
import type { MfmDump } from "./loader.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import { buildKeywords } from "./seed-units.js";
import { forEachDirDatasheet } from "./wargear.js";
import type { StagedWrite } from "./apply.js";

interface UnitRecord {
  id: string;
  keywords?: string[];
  [k: string]: unknown;
}

export interface UnitKeywordsReport {
  changed: { dir: string; id: string; added: string[]; removed: string[] }[];
  confirmed: number;
  staged: StagedWrite[];
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((k, i) => k === b[i]);
const lower = (list: Iterable<string>) => new Set([...list].map((k) => k.toLowerCase()));

/** The keyword names the dump grants a datasheet only under a condition (`conditional_keyword`). */
function conditionalKeywords(dump: MfmDump, datasheetId: string): string[] {
  const kwById = dump.byId("keyword");
  return (dump.groupBy("conditional_keyword", "datasheetId").get(datasheetId) ?? [])
    .map((row) => dump.enName(kwById.get(row.keywordId)))
    .filter((name): name is string => typeof name === "string");
}

export function runUnitKeywords(dump: MfmDump): UnitKeywordsReport {
  const canon = new Map<string, Map<string, { keywords: string[]; conditional: Set<string> }>>();
  forEachDirDatasheet(dump, ({ dir, ds, unitId }) => {
    const name = dump.enName(ds);
    if (!name) return;
    const entry = { keywords: buildKeywords(dump, ds.id!, name), conditional: lower(conditionalKeywords(dump, ds.id!)) };
    (canon.get(dir) ?? canon.set(dir, new Map()).get(dir)!).set(unitId, entry);
  });
  const report: UnitKeywordsReport = { changed: [], confirmed: 0, staged: [] };
  for (const [dir, byUnit] of [...canon].sort(([a], [b]) => a.localeCompare(b))) {
    const upath = path.join(CORE_DIR, dir, "units.json");
    if (!fs.existsSync(upath)) continue;
    const units = readJsonArray<UnitRecord>(upath);
    let dirty = false;
    for (const unit of units) {
      const entry = byUnit.get(unit.id);
      if (!entry) continue;
      const current = unit.keywords ?? [];
      const has = lower(entry.keywords);
      const kept = current.filter((k) => has.has(k.toLowerCase()) || entry.conditional.has(k.toLowerCase()));
      const had = lower(kept);
      const added = entry.keywords.filter((k) => !had.has(k.toLowerCase()));
      const next = [...kept, ...added];
      if (same(current, next)) { report.confirmed++; continue; }
      report.changed.push({ dir, id: unit.id, added, removed: current.filter((k) => !lower(next).has(k.toLowerCase())) });
      unit.keywords = next;
      dirty = true;
    }
    if (dirty) report.staged.push({ path: upath, value: units });
  }
  return report;
}

export function buildUnitKeywordsReport(report: UnitKeywordsReport, write: boolean): string {
  const L: string[] = [`# MFM unit keywords — ${write ? "APPLIED" : "DRY RUN"}`, ""];
  L.push("Sets each matched unit's `keywords` to its dump miniatures' keywords plus its datasheet name.", "");
  L.push("| Metric | Count |", "|---|--:|");
  L.push(`| Changed | ${report.changed.length} |`, `| Confirmed (already matched) | ${report.confirmed} |`, "");
  const added = new Map<string, number>(), removed = new Map<string, number>();
  for (const c of report.changed) {
    c.added.forEach((k) => added.set(k, (added.get(k) ?? 0) + 1));
    c.removed.forEach((k) => removed.set(k, (removed.get(k) ?? 0) + 1));
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `- ${k}: ${n}`);
  L.push("## Keywords added", "", ...top(added), "", "## Keywords removed", "", ...top(removed), "");
  L.push("## Units changed", "");
  for (const c of report.changed) L.push(`- ${c.dir}/${c.id}: +[${c.added.join(", ")}] −[${c.removed.join(", ")}]`);
  return L.join("\n") + "\n";
}
