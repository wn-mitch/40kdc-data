/**
 * chapter-scope.ts — reconcile Space Marine chapter access against the GW MFM
 * dump (the `chapter-scope` ingest subcommand).
 *
 * The repo files every Space Marine datasheet in one shared pool
 * (`data/core/adeptus-astartes/units.json`, all `faction_id: "adeptus-astartes"`),
 * and a chapter army is derived by `faction_keywords`: a unit carrying only
 * `["Adeptus Astartes"]` is generic (every chapter may field it unless barred); a
 * unit that adds a chapter keyword (e.g. `"Black Templars"`) is locked to that
 * chapter.
 *
 * The dump models chapters as children of `Adeptus Astartes` that draw the generic
 * pool minus a `faction_keyword_excluded_datasheet` table. This subcommand derives,
 * fully from the dump on every reimport:
 *
 *  1. faction_keywords. A name with a generic `[Adeptus Astartes]` datasheet is
 *     generic; a name every datasheet of which is chapter-locked (Helbrecht,
 *     Emperor's Champion, …) carries its chapter keywords.
 *
 *  2. excluded_faction_keywords. Every chapter the dump excludes from a generic
 *     datasheet is stamped on the generic unit, so the roster-legality checker bars
 *     it (Black Templars cannot field Librarians; Deathwatch cannot field the generic
 *     Terminator Squad).
 *
 *  3. Chapter reprints (`chapter-reprints.ts`). A chapter supplement that prints its
 *     own same-name copy of a generic datasheet (the Black Templars Gladiators,
 *     Impulsor and Repulsors) gets its own unit `<slug>-<chapter-dir>`, locked to the
 *     chapter and holding only the reprint's `mfm` ref; the generic unit holds only
 *     the codex datasheet's ref. A missing reprint unit is cloned from the generic
 *     unit with its unit composition and wargear options; the per-datasheet passes
 *     (points, wargear, composition tiers, mirror) then reconcile it against the
 *     reprint datasheet.
 *
 * Scope: children of `Adeptus Astartes` only. Cross-army ally exclusions in the
 * same dump table (Imperial Knights / Emperor's Children rows) name units outside
 * the pool and are ignored.
 *
 * Like every MFM subcommand, mutations are applied in BOTH dry-run and write modes
 * and routed through {@link applyWrites}, which validates the projected dataset
 * (AJV + integrity) and only persists on --write — a clean dry run guarantees a
 * clean write.
 */
import * as path from "path";
import { nameToId } from "../converters/id-generator.js";
import { MfmDump } from "./loader.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import type { StagedWrite } from "./apply.js";
import { chapterReprints, type ChapterReprint } from "./chapter-reprints.js";

const POOL_DIR = path.join(CORE_DIR, "adeptus-astartes");
const UNITS_PATH = path.join(POOL_DIR, "units.json");
const COMPOSITIONS_PATH = path.join(POOL_DIR, "unit-compositions.json");
const WARGEAR_OPTIONS_PATH = path.join(POOL_DIR, "wargear-options.json");

/** The repo's parent Space Marine faction keyword; every chapter is a child of it. */
const PARENT_KEYWORD = "Adeptus Astartes";

interface ExternalRef {
  namespace: string;
  id: string;
}

interface UnitRecord {
  id: string;
  name: string;
  faction_keywords?: string[];
  excluded_faction_keywords?: string[];
  allied_points?: { host_faction?: string }[];
  external_refs?: ExternalRef[];
  [k: string]: unknown;
}

interface UnitScopedRecord {
  id?: string;
  unit_id: string;
  [k: string]: unknown;
}

/** Dump-derived chapter scope for one generic or chapter-locked unit slug. */
export interface ChapterScope {
  /** Source datasheet name (for reports). */
  name: string;
  /** Reconciled faction keywords: `[Adeptus Astartes]` when generic, else `+ chapters`. */
  factionKeywords: string[];
  /** Chapters barred from this generic unit (with or without a reprint). */
  excludedKeywords: string[];
}

/** Order-insensitive string-set equality. */
function sameSet(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  const s = new Set(x);
  return y.every((v) => s.has(v));
}

/**
 * Build, for every Space-Marine-family datasheet name (slugged) other than a chapter reprint, its
 * reconciled `faction_keywords` and chapter bars — derived purely from the dump. Pure (no repo
 * I/O) so it is directly unit-testable.
 */
export function buildChapterScopeCanon(dump: MfmDump): Map<string, ChapterScope> {
  const fkById = dump.byId("faction_keyword");
  const fkNameById = new Map<string, string>();
  for (const [id, row] of fkById) {
    const n = dump.enName(row);
    if (n) fkNameById.set(id, n);
  }

  // Parent keyword id + the set of its child chapter ids/names.
  let parentId: string | undefined;
  for (const [id, n] of fkNameById) if (n === PARENT_KEYWORD) parentId = id;
  const childNameById = new Map<string, string>();
  if (parentId) {
    for (const [id, row] of fkById) {
      if (row.parentFactionKeywordId === parentId) {
        const n = fkNameById.get(id);
        if (n) childNameById.set(id, n);
      }
    }
  }
  const childNames = new Set(childNameById.values());
  const reprints = chapterReprints(dump);

  // datasheetId → its faction-keyword NAME set.
  const kwByDatasheet = new Map<string, Set<string>>();
  for (const r of dump.table("datasheet_faction_keyword")) {
    const n = fkNameById.get(r.factionKeywordId);
    if (!n) continue;
    (kwByDatasheet.get(r.datasheetId) ?? kwByDatasheet.set(r.datasheetId, new Set()).get(r.datasheetId)!).add(n);
  }

  // Aggregate the SM-family datasheets per slug; a reprint is its own unit, not part of the slug.
  interface Agg {
    name: string;
    hasGeneric: boolean;
    chapters: Set<string>; // child chapters that print a chapter-locked datasheet of this name
  }
  const bySlug = new Map<string, Agg>();
  const slugOfDatasheet = new Map<string, string>();
  for (const ds of dump.table("datasheet")) {
    if (!ds.id || ds.isLegends || reprints.has(ds.id)) continue;
    const kws = kwByDatasheet.get(ds.id);
    if (!kws || !kws.has(PARENT_KEYWORD)) continue; // SM-family only
    const name = dump.enName(ds);
    if (!name) continue;
    let slug: string;
    try {
      slug = nameToId(name);
    } catch {
      continue;
    }
    slugOfDatasheet.set(ds.id, slug);
    const chapters = [...kws].filter((k) => childNames.has(k));
    const agg = bySlug.get(slug) ?? { name, hasGeneric: false, chapters: new Set<string>() };
    if (chapters.length === 0) agg.hasGeneric = true;
    for (const c of chapters) agg.chapters.add(c);
    bySlug.set(slug, agg);
  }

  // Bars: every (chapter, generic datasheet) exclusion.
  const barsBySlug = new Map<string, Set<string>>();
  for (const r of dump.table("faction_keyword_excluded_datasheet")) {
    const chapter = childNameById.get(r.factionKeywordId);
    if (!chapter) continue; // not a chapter of Adeptus Astartes — out of scope
    const slug = slugOfDatasheet.get(r.datasheetId);
    if (!slug) continue; // excluded datasheet isn't in the SM-family pool
    (barsBySlug.get(slug) ?? barsBySlug.set(slug, new Set()).get(slug)!).add(chapter);
  }

  const out = new Map<string, ChapterScope>();
  for (const [slug, agg] of bySlug) {
    const factionKeywords = agg.hasGeneric
      ? [PARENT_KEYWORD]
      : [PARENT_KEYWORD, ...[...agg.chapters].sort()];
    const excludedKeywords = [...(barsBySlug.get(slug) ?? [])].sort();
    out.set(slug, { name: agg.name, factionKeywords, excludedKeywords });
  }
  return out;
}

export interface UnitChange {
  id: string;
  field: "faction_keywords" | "excluded_faction_keywords";
  from: string[] | undefined;
  to: string[] | undefined;
}

export interface ChapterScopeReport {
  matched: number;
  factionKeywordsChanged: UnitChange[];
  excludedChanged: UnitChange[];
  /** Reprint units cloned from their generic unit this run. */
  reprintsCreated: string[];
  /** Reprint `mfm` refs moved onto their reprint unit: `<from> → <to>`. */
  refsMoved: string[];
  /** Repo units in the AA pool with no SM-family datasheet in the dump (review). */
  repoOnly: string[];
  /** Dump SM-family slugs with no repo unit (review). */
  dumpOnly: string[];
  staged: StagedWrite[];
}

const mfmRef = (id: string): ExternalRef => ({ namespace: "mfm", id });

/** A reprint unit cloned from its generic unit, before the per-datasheet passes reconcile it. */
function cloneReprintUnit(generic: UnitRecord, r: ChapterReprint): UnitRecord {
  const unit = structuredClone(generic);
  unit.id = r.unitId;
  unit.faction_keywords = [PARENT_KEYWORD, r.chapterKeyword];
  delete unit.excluded_faction_keywords;
  delete unit.allied_points;
  unit.external_refs = [mfmRef(r.datasheetId)];
  return unit;
}

/** Clone the generic unit's unit-scoped records (compositions, wargear options) for a reprint. */
function cloneScoped(records: UnitScopedRecord[], r: ChapterReprint): boolean {
  if (records.some((rec) => rec.unit_id === r.unitId)) return false;
  const copies = records
    .filter((rec) => rec.unit_id === r.slug)
    .map((rec) => {
      const copy = structuredClone(rec);
      copy.unit_id = r.unitId;
      if (typeof copy.id === "string" && copy.id.startsWith(`${r.slug}-`))
        copy.id = `${r.unitId}-${copy.id.slice(r.slug.length + 1)}`;
      return copy;
    });
  records.push(...copies);
  return copies.length > 0;
}

/** Create or reconcile each reprint unit and keep reprint refs off every other unit. */
function reconcileReprints(
  dump: MfmDump,
  units: UnitRecord[],
  report: ChapterScopeReport,
  scoped: { compositions: UnitScopedRecord[]; options: UnitScopedRecord[] },
): { units: boolean; compositions: boolean; options: boolean } {
  const dirty = { units: false, compositions: false, options: false };
  const reprints = [...chapterReprints(dump).values()].sort((a, b) => a.unitId.localeCompare(b.unitId));
  const reprintIds = new Map(reprints.map((r) => [r.datasheetId, r.unitId]));

  // Strip each reprint's ref from any unit other than its own.
  for (const u of units) {
    const refs = u.external_refs ?? [];
    const kept = refs.filter((ref) => ref.namespace !== "mfm" || (reprintIds.get(ref.id) ?? u.id) === u.id);
    if (kept.length === refs.length) continue;
    for (const ref of refs) if (!kept.includes(ref)) report.refsMoved.push(`${u.id} → ${reprintIds.get(ref.id)}`);
    u.external_refs = kept;
    dirty.units = true;
  }

  for (const r of reprints) {
    // The chapter prices its reprint itself, so the generic unit holds no host pricing for it.
    const generic = units.find((u) => u.id === r.slug);
    const hosted = generic?.allied_points ?? [];
    const keptAllied = hosted.filter((a) => a.host_faction !== r.chapterDir);
    if (generic && keptAllied.length !== hosted.length) {
      if (keptAllied.length) generic.allied_points = keptAllied;
      else delete generic.allied_points;
      dirty.units = true;
    }
    let unit = units.find((u) => u.id === r.unitId);
    if (!unit) {
      const at = units.findIndex((u) => u.id === r.slug);
      if (at < 0) continue; // generic unit absent → seed-units' concern
      unit = cloneReprintUnit(units[at], r);
      units.splice(at + 1, 0, unit);
      report.reprintsCreated.push(r.unitId);
      dirty.units = true;
      if (cloneScoped(scoped.compositions, r)) dirty.compositions = true;
      if (cloneScoped(scoped.options, r)) dirty.options = true;
      continue;
    }
    const keywords = [PARENT_KEYWORD, r.chapterKeyword];
    if (!sameSet(unit.faction_keywords, keywords)) {
      report.factionKeywordsChanged.push({ id: unit.id, field: "faction_keywords", from: unit.faction_keywords, to: keywords });
      unit.faction_keywords = keywords;
      dirty.units = true;
    }
    if (unit.excluded_faction_keywords !== undefined) {
      report.excludedChanged.push({ id: unit.id, field: "excluded_faction_keywords", from: unit.excluded_faction_keywords, to: undefined });
      delete unit.excluded_faction_keywords;
      dirty.units = true;
    }
    if (!(unit.external_refs ?? []).some((ref) => ref.namespace === "mfm" && ref.id === r.datasheetId)) {
      unit.external_refs = [...(unit.external_refs ?? []), mfmRef(r.datasheetId)];
      dirty.units = true;
    }
  }
  return dirty;
}

export function runChapterScope(dump: MfmDump, _write: boolean): ChapterScopeReport {
  const canon = buildChapterScopeCanon(dump);
  const units = readJsonArray<UnitRecord>(UNITS_PATH);
  const compositions = readJsonArray<UnitScopedRecord>(COMPOSITIONS_PATH);
  const options = readJsonArray<UnitScopedRecord>(WARGEAR_OPTIONS_PATH);
  const reprintUnitIds = new Set([...chapterReprints(dump).values()].map((r) => r.unitId));

  const report: ChapterScopeReport = {
    matched: 0,
    factionKeywordsChanged: [],
    excludedChanged: [],
    reprintsCreated: [],
    refsMoved: [],
    repoOnly: [],
    dumpOnly: [],
    staged: [],
  };

  const matchedSlugs = new Set<string>();
  let dirty = false;
  for (const u of units) {
    if (reprintUnitIds.has(u.id)) continue;
    const scope = canon.get(u.id);
    if (!scope) {
      report.repoOnly.push(u.id);
      continue;
    }
    matchedSlugs.add(u.id);
    report.matched++;

    // faction_keywords — rewrite only when the membership set actually differs
    // (avoids reordering the ~160 unchanged units).
    if (!sameSet(u.faction_keywords, scope.factionKeywords)) {
      report.factionKeywordsChanged.push({
        id: u.id,
        field: "faction_keywords",
        from: u.faction_keywords,
        to: scope.factionKeywords,
      });
      u.faction_keywords = scope.factionKeywords;
      dirty = true;
    }

    // excluded_faction_keywords — set when non-empty, drop when the dump bars nothing.
    const curExcl = u.excluded_faction_keywords;
    if (scope.excludedKeywords.length > 0) {
      if (!sameSet(curExcl, scope.excludedKeywords)) {
        report.excludedChanged.push({
          id: u.id,
          field: "excluded_faction_keywords",
          from: curExcl,
          to: scope.excludedKeywords,
        });
        u.excluded_faction_keywords = scope.excludedKeywords;
        dirty = true;
      }
    } else if (curExcl !== undefined) {
      report.excludedChanged.push({
        id: u.id,
        field: "excluded_faction_keywords",
        from: curExcl,
        to: undefined,
      });
      delete u.excluded_faction_keywords;
      dirty = true;
    }
  }

  const reprintDirty = reconcileReprints(dump, units, report, { compositions, options });
  report.dumpOnly = [...canon.keys()].filter((s) => !matchedSlugs.has(s)).sort();
  if (dirty || reprintDirty.units) report.staged.push({ path: UNITS_PATH, value: units });
  if (reprintDirty.compositions) report.staged.push({ path: COMPOSITIONS_PATH, value: compositions });
  if (reprintDirty.options) report.staged.push({ path: WARGEAR_OPTIONS_PATH, value: options });
  return report;
}

export function buildChapterScopeReport(report: ChapterScopeReport, write: boolean): string {
  const L: string[] = [];
  L.push(`# MFM chapter-scope — ${write ? "APPLIED" : "DRY RUN"}`);
  L.push("");
  L.push("Reconciles Space Marine chapter access in the shared adeptus-astartes pool");
  L.push("from the GW MFM dump: generic vs chapter-locked `faction_keywords`, chapter");
  L.push("bars (`excluded_faction_keywords`), and a unit per chapter reprint of a");
  L.push("generic datasheet.");
  L.push("");
  L.push("| Metric | Count |");
  L.push("|---|--:|");
  L.push(`| Units matched | ${report.matched} |`);
  L.push(`| faction_keywords changed | ${report.factionKeywordsChanged.length} |`);
  L.push(`| excluded_faction_keywords changed | ${report.excludedChanged.length} |`);
  L.push(`| Reprint units created | ${report.reprintsCreated.length} |`);
  L.push(`| Reprint refs moved | ${report.refsMoved.length} |`);
  L.push(`| Repo units with no dump datasheet | ${report.repoOnly.length} |`);
  L.push(`| Dump SM datasheets with no repo unit | ${report.dumpOnly.length} |`);
  L.push("");

  const list = (title: string, items: UnitChange[]) => {
    if (!items.length) return;
    L.push(`## ${title}`, "");
    for (const c of items) L.push(`- ${c.id}: [${(c.from ?? []).join(", ")}] → [${(c.to ?? []).join(", ")}]`);
    L.push("");
  };
  list("faction_keywords", report.factionKeywordsChanged);
  list("excluded_faction_keywords (chapter bars)", report.excludedChanged);

  const plain = (title: string, items: string[]) => {
    if (!items.length) return;
    L.push(`## ${title}`, "");
    items.forEach((id) => L.push(`- ${id}`));
    L.push("");
  };
  plain("Reprint units created", report.reprintsCreated);
  plain("Reprint refs moved", report.refsMoved);
  plain("Repo units with no SM-family dump datasheet (review)", report.repoOnly);
  plain("Dump SM-family datasheets with no repo unit (review)", report.dumpOnly);
  return L.join("\n") + "\n";
}
