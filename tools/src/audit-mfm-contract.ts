/**
 * Audit MFM contract coverage — capture "unprocessed MFM data" as a re-runnable
 * gap document (`gap_analysis.md` at the repo root).
 *
 * The branch's declarative source contract makes "what dump data don't we
 * ingest?" computable. This audit re-derives it along three independent axes:
 *
 *   A. Field-level (contract fidelity) — mapping fields that don't yet consume
 *      dump data they could: `coverage: partial|unimplemented` with a dump
 *      source, or `provenance: unresolved-candidate`, plus each mapping's
 *      `unmapped_mfm_fields` whose `candidate_pointer` is non-null.
 *   B. Table-level — populated catalog tables that no mapping consumes at all
 *      (prose/artwork-dominant tables are routed to Section D, not counted as
 *      structural gaps).
 *   C. Entity-level (presence) — dump entities with no repo counterpart, reusing
 *      the same coverage pass that writes `data/core/_reports/mfm-coverage.md`.
 *
 * By-design exclusions (GW prose → out-of-repo store, artwork, Legends/Forge-World
 * cull, unmapped Titanicus factions, Combat-Patrol hold-back) are listed as
 * resolved, not gaps. The output carries only ids / field-names / counts /
 * reasons — never GW prose — so it is IP-safe to commit.
 *
 * Inputs: `tools/src/mfm/mappings/*.mapping.json` + `tools/src/mfm/dump.catalog.json`
 * (committed, dump-independent) and, when present, `_private/dump.json` (for the
 * entity axis + live row counts).
 *
 * Usage:
 *   npx tsx tools/src/audit-mfm-contract.ts            # write gap_analysis.md
 *   npx tsx tools/src/audit-mfm-contract.ts --dry-run  # print summary only
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coverage, wholeDatasetCounts, type WholeDatasetCounts } from "./ingest-mfm.js";
import { loadDump, type MfmDump } from "./mfm/loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "../..");
const MAPPINGS_DIR = resolve(__dirname, "mfm/mappings");
const CATALOG_PATH = resolve(__dirname, "mfm/dump.catalog.json");
const OUTPUT_PATH = join(DEFAULT_ROOT, "gap_analysis.md");

// ---------------------------------------------------------------------------
// Contract shapes (see mfm-source-map.schema.json / dump-catalog.schema.json)
// ---------------------------------------------------------------------------

export interface MappingField {
  provenance: string;
  coverage: string;
  sources: string[];
  transforms?: { symbol: string; operation: string }[];
  consumers?: string[];
  reason: string;
}

export interface UnmappedMfmField {
  source: string;
  candidate_pointer: string | null;
  reason: string;
}

export interface Mapping {
  entity_schema: string;
  root_tables: string[];
  fields: Record<string, MappingField>;
  unmapped_mfm_fields: UnmappedMfmField[];
}

export interface CatalogField {
  description: string;
  ip_class: string;
  shape_review: string;
  relation?: string;
}

export interface CatalogTable {
  description: string;
  row_shape: string;
  identity: { fields: string[]; status: string };
  fields: Record<string, CatalogField>;
  notes?: string;
}

export interface Catalog {
  catalog_version: number;
  tables: Record<string, CatalogTable>;
}

// ---------------------------------------------------------------------------
// Field axis
// ---------------------------------------------------------------------------

const GAP_COVERAGE = new Set(["partial", "unimplemented"]);

/** A field is an actionable gap when the dump has data no transform yet consumes. */
export function isActionableFieldGap(f: MappingField): boolean {
  if (f.provenance === "unresolved-candidate") return true; // dump has it, no transform
  if (f.coverage === "partial") return true; // implemented in part; remainder unprojected
  if (f.coverage === "unimplemented" && f.sources.length > 0) return true;
  return false;
}

export interface FieldGapGroup {
  representative: string;
  pointers: string[];
  coverage: string;
  provenance: string;
  sources: string[];
  reason: string;
}

export interface UnmappedGap {
  source: string;
  candidatePointer: string;
  reason: string;
}

export interface EntityFieldGaps {
  entity: string;
  entitySchema: string;
  gapGroups: FieldGapGroup[];
  unmapped: UnmappedGap[];
  counts: {
    implemented: number;
    partial: number;
    unimplemented: number;
    notApplicable: number;
    total: number;
  };
}

export function entityNameFromSchema(entitySchema: string): string {
  const base = entitySchema.split("/").pop() ?? entitySchema;
  return base.replace(/\.schema\.json$/, "");
}

function pointerRank(a: string, b: string): number {
  const da = (a.match(/\//g) ?? []).length;
  const db = (b.match(/\//g) ?? []).length;
  if (da !== db) return da - db;
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Collapse repeated `/*` field expansions that share provenance/coverage/sources/reason. */
export function aggregateEntityFieldGaps(mapping: Mapping): EntityFieldGaps {
  const counts = { implemented: 0, partial: 0, unimplemented: 0, notApplicable: 0, total: 0 };
  const groups = new Map<string, FieldGapGroup>();

  for (const [pointer, field] of Object.entries(mapping.fields)) {
    counts.total++;
    if (field.coverage === "implemented") counts.implemented++;
    else if (field.coverage === "partial") counts.partial++;
    else if (field.coverage === "unimplemented") counts.unimplemented++;
    else if (field.coverage === "not-applicable") counts.notApplicable++;

    if (!isActionableFieldGap(field)) continue;
    const sources = [...field.sources].sort();
    const key = `${field.provenance}|${field.coverage}|${sources.join(",")}|${field.reason}`;
    const existing = groups.get(key);
    if (existing) {
      existing.pointers.push(pointer);
    } else {
      groups.set(key, {
        representative: pointer,
        pointers: [pointer],
        coverage: field.coverage,
        provenance: field.provenance,
        sources: field.sources,
        reason: field.reason,
      });
    }
  }

  const gapGroups = [...groups.values()].map((g) => {
    const pointers = [...g.pointers].sort(pointerRank);
    return { ...g, pointers, representative: pointers[0] };
  });
  gapGroups.sort((a, b) => pointerRank(a.representative, b.representative));

  const unmapped: UnmappedGap[] = mapping.unmapped_mfm_fields
    .filter((u) => u.candidate_pointer !== null)
    .map((u) => ({ source: u.source, candidatePointer: u.candidate_pointer as string, reason: u.reason }))
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));

  return {
    entity: entityNameFromSchema(mapping.entity_schema),
    entitySchema: mapping.entity_schema,
    gapGroups,
    unmapped,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Table axis
// ---------------------------------------------------------------------------

/** `data.<table>.<field...>` → `<table>`. */
export function tableOfSource(source: string): string | null {
  const parts = source.split(".");
  if (parts[0] === "data" && parts.length >= 2 && parts[1]) return parts[1];
  return null;
}

/** Tables a mapping actually pulls data from (root tables + every field source). */
export function consumedTables(mappings: Mapping[]): Set<string> {
  const consumed = new Set<string>();
  for (const m of mappings) {
    for (const t of m.root_tables) consumed.add(t);
    for (const field of Object.values(m.fields)) {
      for (const src of field.sources) {
        const t = tableOfSource(src);
        if (t) consumed.add(t);
      }
    }
  }
  return consumed;
}

/** Tables named only in an `unmapped_mfm_fields` entry — acknowledged, not consumed. */
export function acknowledgedTables(mappings: Mapping[]): Set<string> {
  const seen = new Set<string>();
  for (const m of mappings) {
    for (const u of m.unmapped_mfm_fields) {
      const t = tableOfSource(u.source);
      if (t) seen.add(t);
    }
  }
  return seen;
}

const STRUCTURAL_CLASSES = new Set(["identifier", "structural", "display-name"]);

export interface TableGap {
  table: string;
  rows: number | null;
  populated: boolean;
  ipClasses: string[];
  proseDominant: boolean;
  acknowledged: boolean;
  description: string;
}

/**
 * Every populated catalog table with zero mapping consumers.
 * `proseDominant` = its only non-structural content is prose/artwork (→ Section D,
 * routed to the out-of-repo store), otherwise it carries structured data (Section B).
 */
export function classifyUnconsumedTables(
  catalog: Catalog,
  consumed: Set<string>,
  acknowledged: Set<string>,
  rowCounts: Map<string, number> | null
): TableGap[] {
  const out: TableGap[] = [];
  for (const [name, table] of Object.entries(catalog.tables)) {
    if (consumed.has(name)) continue;
    const rows = rowCounts ? rowCounts.get(name) ?? 0 : null;
    const populated = rows !== null ? rows > 0 : table.row_shape === "observed";
    if (!populated) continue;

    const ipClasses = [...new Set(Object.values(table.fields).map((f) => f.ip_class))].sort();
    const contentClasses = ipClasses.filter((c) => !STRUCTURAL_CLASSES.has(c));
    const proseDominant =
      contentClasses.length > 0 &&
      contentClasses.every((c) => c === "prose" || c === "artwork-reference") &&
      !ipClasses.includes("numeric");

    out.push({
      table: name,
      rows,
      populated,
      ipClasses,
      proseDominant,
      acknowledged: acknowledged.has(name),
      description: table.description,
    });
  }
  // Structured gaps first (highest row count first), then prose-dominant.
  out.sort((a, b) => {
    if (a.proseDominant !== b.proseDominant) return a.proseDominant ? 1 : -1;
    if ((b.rows ?? 0) !== (a.rows ?? 0)) return (b.rows ?? 0) - (a.rows ?? 0);
    return a.table < b.table ? -1 : a.table > b.table ? 1 : 0;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Entity axis
// ---------------------------------------------------------------------------

export interface EntityPresence {
  version: number | undefined;
  dirs: { dir: string; unitsNew: number; detNew: number; enhNew: number }[];
  totals: { unitsNew: number; detNew: number; enhNew: number };
  unmappedFactions: string[];
  whole: WholeDatasetCounts;
}

export function computeEntityPresence(dump: MfmDump): EntityPresence {
  const cov = coverage(dump);
  const dirs = cov.dirs
    .map((d) => ({ dir: d.dir, unitsNew: d.unitsNew.length, detNew: d.detNew.length, enhNew: d.enhNew.length }))
    .filter((d) => d.unitsNew || d.detNew || d.enhNew)
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  const totals = dirs.reduce(
    (acc, d) => ({
      unitsNew: acc.unitsNew + d.unitsNew,
      detNew: acc.detNew + d.detNew,
      enhNew: acc.enhNew + d.enhNew,
    }),
    { unitsNew: 0, detNew: 0, enhNew: 0 }
  );
  return {
    version: dump.version,
    dirs,
    totals,
    unmappedFactions: cov.unmappedFactions,
    whole: wholeDatasetCounts(dump),
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadMappings(dir: string): Mapping[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".mapping.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Mapping);
}

function tableRowCounts(dump: MfmDump): Map<string, number> {
  const counts = new Map<string, number>();
  const tables = dump.tables as Record<string, unknown[]>;
  for (const [name, rows] of Object.entries(tables)) {
    counts.set(name, Array.isArray(rows) ? rows.length : 0);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface AuditInput {
  entities: EntityFieldGaps[];
  tableGaps: TableGap[];
  presence: EntityPresence | null;
  dumpVersion: number | undefined;
}

export function buildAudit(
  mappings: Mapping[],
  catalog: Catalog,
  dump: MfmDump | null
): AuditInput {
  const entities = mappings
    .map(aggregateEntityFieldGaps)
    .sort((a, b) => (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0));
  const consumed = consumedTables(mappings);
  const acknowledged = acknowledgedTables(mappings);
  const rowCounts = dump ? tableRowCounts(dump) : null;
  const tableGaps = classifyUnconsumedTables(catalog, consumed, acknowledged, rowCounts);
  const presence = dump ? computeEntityPresence(dump) : null;
  return { entities, tableGaps, presence, dumpVersion: dump?.version };
}

function joinSources(sources: string[]): string {
  return sources.length ? sources.map((s) => `\`${s}\``).join("<br>") : "—";
}

function pointerLabel(g: FieldGapGroup): string {
  const extra = g.pointers.length - 1;
  return extra > 0 ? `\`${g.representative}\` (+${extra})` : `\`${g.representative}\``;
}

export function renderReport(input: AuditInput): string {
  const { entities, tableGaps, presence } = input;
  const L: string[] = [];

  const totalFieldGaps = entities.reduce((n, e) => n + e.gapGroups.length, 0);
  const totalUnmapped = entities.reduce((n, e) => n + e.unmapped.length, 0);
  const covTotals = entities.reduce(
    (acc, e) => ({
      implemented: acc.implemented + e.counts.implemented,
      partial: acc.partial + e.counts.partial,
      unimplemented: acc.unimplemented + e.counts.unimplemented,
      notApplicable: acc.notApplicable + e.counts.notApplicable,
      total: acc.total + e.counts.total,
    }),
    { implemented: 0, partial: 0, unimplemented: 0, notApplicable: 0, total: 0 }
  );
  const structuralTables = tableGaps.filter((t) => !t.proseDominant);
  const proseTables = tableGaps.filter((t) => t.proseDominant);

  // Header ------------------------------------------------------------------
  L.push("# MFM gap analysis — unprocessed dump data");
  L.push("");
  L.push(
    `Dump \`data_version\` **${input.dumpVersion ?? "?"}**. Generated by \`npm run audit:mfm-contract\` — do not hand-edit.`
  );
  L.push("");
  L.push("This is the working checklist of GW MFM dump data the repo does **not** yet");
  L.push("process, derived from the declarative source contract");
  L.push("(`tools/src/mfm/dump.catalog.json` + `tools/src/mfm/mappings/*.mapping.json`).");
  L.push("It lists only ids / field names / counts / reasons — no GW prose.");
  L.push("");
  L.push("Regenerate after a new dump upload (order matters):");
  L.push("");
  L.push("1. Replace `_private/dump.json` with the new export.");
  L.push("2. `cd tools && npm run mfm:contract -- --write` (refresh catalog/schema/generated; review the diff).");
  L.push("3. `npm run audit:mfm-contract` (rewrite this file).");
  L.push("");

  // Scoreboard --------------------------------------------------------------
  L.push("## Summary");
  L.push("");
  L.push("| Axis | Measure | Count |");
  L.push("|---|---|--:|");
  L.push(`| A — fields | Entity mappings | ${entities.length} |`);
  L.push(`| A — fields | Contract field entries | ${covTotals.total} |`);
  L.push(
    `| A — fields | ↳ implemented / partial / unimplemented / n-a | ${covTotals.implemented} / ${covTotals.partial} / ${covTotals.unimplemented} / ${covTotals.notApplicable} |`
  );
  L.push(`| A — fields | **Actionable field-gap groups** | **${totalFieldGaps}** |`);
  L.push(`| A — fields | **Actionable unmapped dump fields** | **${totalUnmapped}** |`);
  L.push(`| B — tables | **Populated tables, no consumer (structured)** | **${structuralTables.length}** |`);
  L.push(`| B — tables | Populated tables, no consumer (prose/artwork) | ${proseTables.length} |`);
  if (presence) {
    L.push(`| C — entities | **Units new in dump** | **${presence.totals.unitsNew}** |`);
    L.push(`| C — entities | **Detachments new in dump** | **${presence.totals.detNew}** |`);
    L.push(`| C — entities | **Enhancements new in dump** | **${presence.totals.enhNew}** |`);
    L.push(
      `| C — entities | Stratagems (repo / dump) | ${presence.whole.stratagems.repo} / ${presence.whole.stratagems.dump} |`
    );
    L.push(
      `| C — entities | Missions (repo / dump) | ${presence.whole.missions.repo} / ${presence.whole.missions.dumpPrimary}+${presence.whole.missions.dumpSecondary} |`
    );
  }
  L.push("");

  // Section A ---------------------------------------------------------------
  L.push("## A. Field-level gaps (contract fidelity)");
  L.push("");
  L.push("Dump data a repo field could carry but the transform does not yet produce.");
  L.push("`partial` = seeded in part; `unimplemented` = source present, no transform;");
  L.push("`unresolved-candidate` = dump exposes the value, no reviewed transform exists.");
  L.push("Repeated `/*` array expansions that share a source and reason are collapsed.");
  L.push("");
  const entitiesWithGaps = entities.filter((e) => e.gapGroups.length || e.unmapped.length);
  if (!entitiesWithGaps.length) {
    L.push("_No field-level gaps._");
    L.push("");
  }
  for (const e of entitiesWithGaps) {
    L.push(`### ${e.entity} (\`${e.entitySchema}\`)`);
    L.push("");
    if (e.gapGroups.length) {
      L.push("| Field | Coverage | Provenance | Dump source(s) | Reason |");
      L.push("|---|---|---|---|---|");
      for (const g of e.gapGroups) {
        L.push(`| ${pointerLabel(g)} | ${g.coverage} | ${g.provenance} | ${joinSources(g.sources)} | ${g.reason} |`);
      }
      L.push("");
    }
    if (e.unmapped.length) {
      L.push("Unmapped dump fields with a candidate repo destination:");
      L.push("");
      L.push("| Dump source | Candidate field | Reason |");
      L.push("|---|---|---|");
      for (const u of e.unmapped) {
        L.push(`| \`${u.source}\` | \`${u.candidatePointer}\` | ${u.reason} |`);
      }
      L.push("");
    }
  }

  // Section B ---------------------------------------------------------------
  L.push("## B. Table-level gaps (no mapping consumer)");
  L.push("");
  L.push("Populated dump tables carrying structured data that no mapping reads.");
  L.push("`acknowledged` = the table is named in some mapping's `unmapped_mfm_fields`.");
  L.push("");
  if (!structuralTables.length) {
    L.push("_No structured tables without a consumer._");
    L.push("");
  } else {
    L.push("| Table | Rows | ip_class | Ack. | Description |");
    L.push("|---|--:|---|:-:|---|");
    for (const t of structuralTables) {
      L.push(
        `| \`${t.table}\` | ${t.rows ?? "?"} | ${t.ipClasses.join(", ")} | ${t.acknowledged ? "✓" : ""} | ${t.description} |`
      );
    }
    L.push("");
  }

  // Section C ---------------------------------------------------------------
  L.push("## C. Entity-level gaps (dump entities absent from repo)");
  L.push("");
  if (!presence) {
    L.push("_Dump not present (`_private/dump.json`); entity axis skipped. Field/table axes above run off the committed contract._");
    L.push("");
  } else {
    L.push("New-in-dump entities with no repo record, per faction dir. Full id lists live in");
    L.push("`data/core/_reports/mfm-coverage.md` (regenerate with `npm run ingest-mfm coverage`).");
    L.push("");
    L.push("| Faction dir | Units new | Detachments new | Enhancements new |");
    L.push("|---|--:|--:|--:|");
    for (const d of presence.dirs) {
      L.push(`| ${d.dir} | ${d.unitsNew} | ${d.detNew} | ${d.enhNew} |`);
    }
    L.push(
      `| **TOTAL** | **${presence.totals.unitsNew}** | **${presence.totals.detNew}** | **${presence.totals.enhNew}** |`
    );
    L.push("");
    L.push("Whole-dataset categories the dump dwarfs the repo on:");
    L.push("");
    L.push("| Category | Repo | Dump |");
    L.push("|---|--:|--:|");
    L.push(`| Stratagems | ${presence.whole.stratagems.repo} | ${presence.whole.stratagems.dump} |`);
    L.push(
      `| Missions | ${presence.whole.missions.repo} | ${presence.whole.missions.dumpPrimary} primary + ${presence.whole.missions.dumpSecondary} secondary |`
    );
    L.push(`| Force dispositions | ${presence.whole.forceDispositions.repo} | ${presence.whole.forceDispositions.dump} |`);
    L.push("");
    if (presence.unmappedFactions.length) {
      L.push("Unmapped faction keywords owning live datasheets (no repo dir — Titanicus etc.):");
      L.push("");
      for (const f of presence.unmappedFactions) L.push(`- ${f}`);
      L.push("");
    }
  }

  // Section D ---------------------------------------------------------------
  L.push("## D. By design — not gaps");
  L.push("");
  L.push("Dump data intentionally excluded from the repo. Listed so the axes above are");
  L.push("not read as oversights.");
  L.push("");
  L.push(
    "- **GW prose → private dump only.** Ability/rules/lore text is never committed here; tools read it from `_private/dump.json` through `mfm/record-prose.ts` (`npm run prose`)."
  );
  L.push("- **Artwork references** (`bannerImage`, `rowImage`) are excluded from published data.");
  L.push(
    "- **Legends / Forge-World tail.** Datasheets the live dump omits are dropped, never backfilled (see `ingest-mfm cull-legends`)."
  );
  L.push(
    "- **Unmapped Titanicus factions.** Adeptus Titanicus / Titanicus Traitoris own live datasheets but have no repo faction dir; surfaced separately, not ingested."
  );
  L.push(
    "- **Combat-Patrol hold-back.** CP-only datasheets/detachments/enhancements are held back unless `--include-combat-patrol` is passed."
  );
  if (proseTables.length) {
    L.push("");
    L.push("Populated prose/artwork-dominant tables with no consumer (prose stays in the private dump, not the repo):");
    L.push("");
    L.push("| Table | Rows | ip_class | Description |");
    L.push("|---|--:|---|---|");
    for (const t of proseTables) {
      L.push(`| \`${t.table}\` | ${t.rows ?? "?"} | ${t.ipClasses.join(", ")} | ${t.description} |`);
    }
  }
  L.push("");
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const mappings = loadMappings(MAPPINGS_DIR);
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Catalog;

  let dump: MfmDump | null = null;
  try {
    dump = loadDump();
  } catch (e) {
    console.warn(`Dump not loaded (${e instanceof Error ? e.message : String(e)}); entity axis skipped.`);
  }

  const audit = buildAudit(mappings, catalog, dump);
  const report = renderReport(audit);

  const fieldGaps = audit.entities.reduce((n, e) => n + e.gapGroups.length, 0);
  const unmapped = audit.entities.reduce((n, e) => n + e.unmapped.length, 0);
  const structuralTables = audit.tableGaps.filter((t) => !t.proseDominant).length;
  console.log(
    `Field-gap groups ${fieldGaps}, unmapped dump fields ${unmapped}, unconsumed structured tables ${structuralTables}.`
  );
  if (audit.presence) {
    console.log(
      `New in dump: units ${audit.presence.totals.unitsNew}, detachments ${audit.presence.totals.detNew}, enhancements ${audit.presence.totals.enhNew}.`
    );
  }

  if (dryRun) {
    console.log("--dry-run: gap_analysis.md not written.");
    return;
  }
  writeFileSync(OUTPUT_PATH, report);
  console.log(`Gap analysis → ${OUTPUT_PATH}`);
}

function isEntrypoint(): boolean {
  try {
    const argv1 = process.argv[1];
    return !!argv1 && resolve(argv1) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntrypoint()) main();
