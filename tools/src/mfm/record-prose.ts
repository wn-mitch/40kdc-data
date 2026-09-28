/**
 * Repo ability records → their GW prose in the private MFM dump.
 *
 * Every tool that needs an ability's rule text reads it here, from `_private/dump.json` through
 * {@link DumpProse}. Nothing is read from or written to any other prose store, and nothing this
 * module returns may be written into a tracked file.
 *
 * A record is resolved by its owner, never by a global name search:
 *   - stratagems and enhancements by the `mfm` external ref on their core record (the exact dump
 *     row), else by their detachment;
 *   - detachment rules by their detachment, army (faction) rules by the faction's army rules;
 *   - core abilities by the core rules;
 *   - unit abilities by the datasheets of their `unit_ids` (pinned by the units' `mfm` refs).
 * A faction dir searches its own publication first, then the supplements that file their
 * datasheets under it (SHARED_ROSTERS). When one query answers with several texts, the codex
 * (non-Combat-Patrol) and non-Legends texts are preferred; if that still leaves two, the record is
 * `ambiguous` and no text is returned.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { type AbilityRow, type AbilityRowKind, CORE_FACTION } from "./dump-prose-rows.js";
import { type DumpProse, loadDumpProse, type OwnerQuery, type ProseQuery, type ProseVariant } from "./dump-prose-lookup.js";
import { SHARED_ROSTERS } from "./faction-map.js";
import { readJsonArray, REPO_ROOT } from "./repo-files.js";

/** A resolved record's prose in the old store's entry shape, so `assembleStoreSource` reads it unchanged. */
export interface ProseEntry {
  ability_id: string;
  faction_id: string;
  name?: string;
  ability_type?: string;
  raw_text?: string;
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
  source: { kind: "mfm"; ref: string; edition: "11e" };
}

export type RecordProse =
  | { status: "found"; entry: ProseEntry; rows: AbilityRow[] }
  | { status: "missing" }
  | { status: "ambiguous"; variants: ProseVariant[] };

/** The enrichment fields resolution reads. */
export interface AbilityRecordRef {
  ability_id?: string;
  id?: string;
  name?: string;
  ability_type?: string;
  unit_ids?: readonly string[];
  detachment_id?: string | null;
}

type ExternalRef = { namespace?: string; id?: string };
type CoreRecord = { id: string; ability_id?: string; detachment_id?: string | null; external_refs?: ExternalRef[] };

const mfmIds = (r: { external_refs?: ExternalRef[] }): string[] => (r.external_refs ?? []).filter((x) => x.namespace === "mfm" && x.id).map((x) => x.id!);

const DETACHMENT_RULE_KINDS: readonly AbilityRowKind[] = ["detachment-rule", "rule-section", "menu-option", "allegiance-ability"];
const ARMY_RULE_KINDS: readonly AbilityRowKind[] = ["army-rule", "rule-section", "menu-option"];

/** The dump's prose for the repo's ability records, one faction dir at a time. */
export class RepoProse {
  private readonly coreDir: string;
  private readonly enrichmentDir: string;
  private readonly rowsById = new Map<string, AbilityRow[]>();
  private readonly units = new Map<string, Map<string, string[]>>();
  private readonly detachments = new Map<string, Map<string, string[]>>();
  private readonly coreRecords = new Map<string, Map<string, CoreRecord>>();
  private readonly factionCache = new Map<string, Map<string, ProseEntry>>();

  constructor(
    readonly prose: DumpProse,
    readonly repoRoot: string = REPO_ROOT,
  ) {
    this.coreDir = path.join(repoRoot, "data", "core");
    this.enrichmentDir = path.join(repoRoot, "data", "enrichment");
    for (const r of prose.rows) this.rowsById.set(r.rowId, [...(this.rowsById.get(r.rowId) ?? []), r]);
  }

  /** Enrichment faction dirs that hold an abilities.json (`_core` included, `_example*` excluded). */
  factions(): string[] {
    if (!fs.existsSync(this.enrichmentDir)) return [];
    return fs
      .readdirSync(this.enrichmentDir)
      .filter((d) => !d.startsWith("_example") && fs.existsSync(path.join(this.enrichmentDir, d, "abilities.json")))
      .sort();
  }

  /** The faction dirs a record in `dir` searches, in order: its own publication, then the supplements filed under it. */
  searchOrder(dir: string): string[][] {
    const children = Object.entries(SHARED_ROSTERS)
      .filter(([, parents]) => parents.includes(dir))
      .map(([child]) => child)
      .sort();
    return children.length ? [[dir], children] : [[dir]];
  }

  /** Resolve one enrichment record of faction dir `faction`. */
  forRecord(faction: string, record: AbilityRecordRef): RecordProse {
    const id = record.ability_id ?? record.id;
    if (!id) return { status: "missing" };
    const pinned = this.pinnedRows(faction, record, id);
    if (pinned) return this.found(faction, record, id, pinned);
    for (const factions of this.searchOrder(faction)) {
      const got = this.resolveIn(factions, faction, record, id);
      if (got.status !== "missing") return got;
    }
    return { status: "missing" };
  }

  /** Every resolvable record of one faction dir, keyed by ability id (first record wins on a duplicate id). */
  faction(faction: string): Map<string, ProseEntry> {
    const cached = this.factionCache.get(faction);
    if (cached) return cached;
    const out = new Map<string, ProseEntry>();
    for (const record of readJsonArray<AbilityRecordRef>(path.join(this.enrichmentDir, faction, "abilities.json"))) {
      const id = record.ability_id ?? record.id;
      if (!id || out.has(id)) continue;
      const got = this.forRecord(faction, record);
      if (got.status === "found") out.set(id, got.entry);
    }
    this.factionCache.set(faction, out);
    return out;
  }

  /** `{ faction: { ability_id: entry } }` for the given (default: all) faction dirs. */
  index(factions: readonly string[] = this.factions()): Record<string, Record<string, ProseEntry>> {
    return Object.fromEntries(factions.map((f) => [f, Object.fromEntries(this.faction(f))]));
  }

  private found(faction: string, record: AbilityRecordRef, id: string, rows: AbilityRow[]): RecordProse {
    const row = rows[0]!;
    const entry: ProseEntry = {
      ability_id: id,
      faction_id: faction,
      ...(record.name ? { name: record.name } : {}),
      ...(record.ability_type ? { ability_type: record.ability_type } : {}),
      ...proseFields(row),
      source: { kind: "mfm", ref: row.ref, edition: "11e" },
    };
    if (entry.raw_text === undefined && entry.when === undefined && entry.target === undefined && entry.effect === undefined) return { status: "missing" };
    return { status: "found", entry, rows };
  }

  /** A stratagem's or enhancement's exact dump row, by its core record's `mfm` ref. */
  private pinnedRows(faction: string, record: AbilityRecordRef, id: string): AbilityRow[] | null {
    const kind = record.ability_type === "stratagem" ? "stratagem" : record.ability_type === "enhancement" ? "enhancement" : null;
    if (!kind) return null;
    const core = this.coreRecord(faction, kind === "stratagem" ? "stratagems" : "enhancements", id);
    for (const rowId of core ? mfmIds(core) : []) {
      const rows = (this.rowsById.get(rowId) ?? []).filter((r) => r.kind === kind);
      if (rows.length) return rows;
    }
    return null;
  }

  private resolveIn(factions: string[], dir: string, record: AbilityRecordRef, id: string): RecordProse {
    for (const tier of this.queryTiers(factions, dir, record, id)) {
      const variants = new Map<string, ProseVariant>();
      for (const q of tier) {
        for (const v of preferredVariants(this.prose, q)) {
          const key = v.text ?? "";
          const have = variants.get(key);
          if (have) have.rows.push(...v.rows.filter((r) => !have.rows.includes(r)));
          else variants.set(key, { text: v.text, rows: [...v.rows] });
        }
      }
      if (!variants.size) continue;
      if (variants.size > 1) return { status: "ambiguous", variants: [...variants.values()] };
      return this.found(dir, record, id, [...variants.values()][0]!.rows);
    }
    return { status: "missing" };
  }

  /** The record's queries, in tiers: the first tier that matches any row answers. */
  private queryTiers(factions: string[], dir: string, record: AbilityRecordRef, id: string): ProseQuery[][] {
    const q = (owner: OwnerQuery, kinds?: readonly AbilityRowKind[], faction: string | string[] = factions): ProseQuery => ({ faction, owner, ability: id, ...(kinds ? { kinds } : {}) });
    // A core ability is the Core Rules' rule; the per-datasheet reprints answer only when it has none.
    if (dir === CORE_FACTION || record.ability_type === "core") return [[q({ kind: "core" }, ["core-rule"], CORE_FACTION)], [q({ kind: "core" }, undefined, CORE_FACTION)]];
    const detachment = record.detachment_id ?? this.coreRecord(dir, record.ability_type === "enhancement" ? "enhancements" : "stratagems", id)?.detachment_id;
    const detachmentOwner = (): OwnerQuery => ({ kind: "detachment", id: detachment!, ...this.idsOf(this.detachments, "detachments", dir, detachment!, "detachmentIds") });
    switch (record.ability_type) {
      case "stratagem":
        return [[detachment ? q(detachmentOwner(), ["stratagem"]) : q({ kind: "core" }, ["stratagem"], CORE_FACTION)]];
      case "enhancement":
        return detachment ? [[q(detachmentOwner(), ["enhancement"])]] : [];
      case "detachment":
        return detachment ? [[q(detachmentOwner(), DETACHMENT_RULE_KINDS)]] : [];
      case "faction":
        return [[q({ kind: "army" }, ARMY_RULE_KINDS)]];
      default:
        return [(record.unit_ids ?? []).map((unit) => q({ kind: "unit", id: unit, ...this.idsOf(this.units, "units", dir, unit, "datasheetIds") }))];
    }
  }

  /** A unit's or detachment's `mfm` ids from its core record: the record's own dir first, then any dir. */
  private idsOf<K extends "datasheetIds" | "detachmentIds">(cache: Map<string, Map<string, string[]>>, file: string, dir: string, id: string, key: K): Partial<Record<K, string[]>> {
    const ids = this.byDir(cache, file, dir).get(id) ?? this.allDirs().map((d) => this.byDir(cache, file, d).get(id)).find((x) => x?.length);
    return ids?.length ? ({ [key]: ids } as Partial<Record<K, string[]>>) : {};
  }

  private byDir(cache: Map<string, Map<string, string[]>>, file: string, dir: string): Map<string, string[]> {
    let m = cache.get(dir);
    if (!m) {
      m = new Map(readJsonArray<CoreRecord>(path.join(this.coreDir, dir, `${file}.json`)).map((r) => [r.id, mfmIds(r)]));
      cache.set(dir, m);
    }
    return m;
  }

  private coreRecord(dir: string, file: "stratagems" | "enhancements", id: string): CoreRecord | undefined {
    const load = (d: string): Map<string, CoreRecord> => {
      const key = `${d}\0${file}`;
      let m = this.coreRecords.get(key);
      if (!m) {
        const p = d === CORE_FACTION ? path.join(this.coreDir, `${file}.json`) : path.join(this.coreDir, d, `${file}.json`);
        m = new Map();
        for (const r of readJsonArray<CoreRecord>(p)) for (const k of [r.id, r.ability_id]) if (k && !m.has(k)) m.set(k, r);
        this.coreRecords.set(key, m);
      }
      return m;
    };
    return load(dir).get(id) ?? (file === "stratagems" ? load(CORE_FACTION).get(id) : undefined);
  }

  private allDirsCache: string[] | null = null;
  private allDirs(): string[] {
    this.allDirsCache ??= fs.existsSync(this.coreDir)
      ? fs
          .readdirSync(this.coreDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
          .map((d) => d.name)
          .sort()
      : [];
    return this.allDirsCache;
  }
}

/** A query's variants, narrowed to the codex and then the non-Legends texts when it prints more than one. */
function preferredVariants(prose: DumpProse, q: ProseQuery): ProseVariant[] {
  let variants = prose.variants(q);
  for (const narrow of [{ combatPatrol: false }, { legends: false }, { combatPatrol: false, legends: false }]) {
    if (variants.length <= 1) break;
    const narrowed = prose.variants({ ...q, ...narrow });
    if (narrowed.length) variants = narrowed;
  }
  return variants;
}

/** A row's prose in store fields: a stratagem's WHEN/TARGET/EFFECT/RESTRICTIONS, else `raw_text`. */
function proseFields(row: AbilityRow): Partial<ProseEntry> {
  if (row.kind === "stratagem" && row.stratagem) {
    const s = row.stratagem;
    const effect = [s.effect, s.secondaryEffect].filter(Boolean).join("\n") || undefined;
    return {
      ...(s.when ? { when: s.when } : {}),
      ...(s.target ? { target: s.target } : {}),
      ...(effect ? { effect } : {}),
      ...(s.restrictions ? { restrictions: s.restrictions } : {}),
    };
  }
  return row.text ? { raw_text: row.text } : {};
}

let cached: { key: string; repo: RepoProse } | null = null;

/** The repo's prose from the dump, loaded once per (dump, repo root). */
export function loadRepoProse(options: { dumpPath?: string; repoRoot?: string } = {}): RepoProse {
  const key = `${options.dumpPath ?? ""}\0${options.repoRoot ?? REPO_ROOT}`;
  if (!cached || cached.key !== key) cached = { key, repo: new RepoProse(loadDumpProse(options.dumpPath), options.repoRoot) };
  return cached.repo;
}

