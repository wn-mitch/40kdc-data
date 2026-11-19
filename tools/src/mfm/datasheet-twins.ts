/**
 * datasheet-twins.ts — route same-named datasheets of one publication to their repo units.
 *
 * A Combat Patrol box can print one unit twice under one name. Two copies that print the same
 * datasheet (the same abilities, models, wargear, points and leaders) are one repo unit. Copies
 * that differ (a Boss Nob with another gun, a squad no leader can join) are separate units: the
 * copy that prints the most rows (the one a leader can join) keeps the name slug, and each other
 * distinct copy is `<slug>-2`, `<slug>-3`, …, by rows printed and then datasheet id.
 */
import { createHash } from "node:crypto";
import { nameToId } from "../converters/id-generator.js";
import type { DatasheetRow, MfmDump } from "./loader.js";

/** A datasheet that shares its name with another of its publication. */
export interface DatasheetTwin {
  datasheetId: string;
  /** The name slug the copies share. */
  slug: string;
  /** The repo unit the copy maps to: `slug`, or `<slug>-<n>` for a distinct copy after the first. */
  unitId: string;
  /** The lowest datasheet id printing the same content: the copy every pass reads for the unit. */
  primaryId: string;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Fields that differ between two prints of one datasheet without changing what it says. */
const VOLATILE = new Set(["id", "datasheetId", "displayOrder", "bannerImage", "rowImage", "isFreeFromEntitlements"]);

const camelOf = (table: string): string => table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * A digest of what a datasheet prints: every row that names it, nested with the rows that hang off
 * it (a miniature's loadout). A row id a field names becomes that row's own fields (an ability's
 * English text, a wargear item, the miniature a choice set belongs to), so two prints of one
 * datasheet digest alike though every row id differs.
 */
export function datasheetDigest(dump: MfmDump, datasheetId: string): string {
  return createHash("sha256").update(datasheetPrint(dump, datasheetId).join("\n")).digest("hex");
}

/** The canonical rows {@link datasheetDigest} hashes, one JSON line per row the datasheet names. */
export function datasheetPrint(dump: MfmDump, datasheetId: string): string[] {
  type Row = Record<string, unknown>;
  const columns = new Map<string, string[]>();
  for (const [name, rows] of Object.entries(dump.tables as Record<string, Row[] | undefined>)) {
    if (Array.isArray(rows) && rows.length) columns.set(name, Object.keys(rows[0]!));
  }
  const byId = (table: string, id: string): Row | undefined => (dump.byId(table as never) as unknown as ReadonlyMap<string, Row>).get(id);
  const rowsOf = (table: string, key: string, id: string): readonly Row[] =>
    (dump.groupBy(table as never, key as never) as unknown as ReadonlyMap<string, readonly Row[]>).get(id) ?? [];
  const tableOf = (key: string): string | null => {
    const table = key.replace(/Id$/, "").replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return columns.get(table)?.includes("id") ? table : null;
  };
  // A detachment's rows that name a datasheet (a Combat Patrol's roster, its warlord) are the
  // detachment's, not what the datasheet prints.
  const printed = (table: string): boolean => !table.startsWith("detachment_");
  const childTables = (table: string): string[] => {
    const key = `${camelOf(table)}Id`;
    return [...columns].filter(([t, cols]) => printed(t) && cols.includes(key)).map(([t]) => t).sort(cmp);
  };
  const DEPTH = 3;
  const tops: [string, Row][] = [];
  for (const [table, cols] of [...columns].sort((a, b) => cmp(a[0], b[0]))) {
    if (table !== "datasheet" && printed(table) && cols.includes("datasheetId")) for (const r of rowsOf(table, "datasheetId", datasheetId)) tops.push([table, r]);
  }
  // A field naming one of the datasheet's own rows renders that row's fields once, never its children.
  const fields = (r: Row, expand: boolean): Row => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r).sort((a, b) => cmp(a[0], b[0]))) {
      if (VOLATILE.has(k)) continue;
      if (k === "localisations") {
        o[k] = (v as { en?: unknown } | null)?.en ?? null;
        continue;
      }
      const target = k.endsWith("Id") && typeof v === "string" ? tableOf(k) : null;
      const named = target && target !== "datasheet" ? byId(target, v as string) : undefined;
      o[k] = named ? (expand ? fields(named, false) : `@${target}`) : v;
    }
    return o;
  };
  const render = (table: string, r: Row, depth: number): Row => {
    const children: string[] = [];
    if (depth > 0 && typeof r.id === "string") {
      for (const child of childTables(table)) {
        for (const c of rowsOf(child, `${camelOf(table)}Id`, r.id)) children.push(JSON.stringify([child, render(child, c, depth - 1)]));
      }
    }
    return { ...fields(r, true), "@children": children.sort(cmp) };
  };
  return tops.map(([table, r]) => JSON.stringify([table, render(table, r, DEPTH)])).sort(cmp);
}

const cache = new WeakMap<MfmDump, Map<string, DatasheetTwin>>();

/** Every live datasheet sharing its publication and name slug with another, keyed by datasheet id. */
export function datasheetTwins(dump: MfmDump): Map<string, DatasheetTwin> {
  const hit = cache.get(dump);
  if (hit) return hit;
  const out = new Map<string, DatasheetTwin>();
  cache.set(dump, out);
  if (!dump.tables.datasheet) return out;
  const groups = new Map<string, DatasheetRow[]>();
  for (const ds of dump.table("datasheet")) {
    if (!ds.id || ds.isLegends) continue;
    let slug: string;
    try {
      slug = nameToId(dump.enName(ds) ?? "");
    } catch {
      continue;
    }
    const key = `${ds.publicationId}\u0000${slug}`;
    groups.set(key, [...(groups.get(key) ?? []), ds]);
  }
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const slug = key.split("\u0000")[1]!;
    const classes = new Map<string, { ids: string[]; size: number }>();
    for (const ds of [...rows].sort((a, b) => cmp(a.id!, b.id!))) {
      const print = datasheetPrint(dump, ds.id!);
      const digest = createHash("sha256").update(print.join("\n")).digest("hex");
      const c = classes.get(digest) ?? classes.set(digest, { ids: [], size: print.length }).get(digest)!;
      c.ids.push(ds.id!);
    }
    const ordered = [...classes.values()].sort((a, b) => b.size - a.size || cmp(a.ids[0]!, b.ids[0]!));
    ordered.forEach(({ ids }, i) => {
      const unitId = i === 0 ? slug : `${slug}-${i + 1}`;
      for (const datasheetId of ids) out.set(datasheetId, { datasheetId, slug, unitId, primaryId: ids[0]! });
    });
  }
  return out;
}

/** The primary datasheet of a twin unit after the first (`<slug>-2`), if `unitId` names one. */
export function twinForUnit(dump: MfmDump, unitId: string): DatasheetTwin | undefined {
  for (const t of datasheetTwins(dump).values()) if (t.unitId === unitId && t.unitId !== t.slug && t.datasheetId === t.primaryId) return t;
  return undefined;
}
