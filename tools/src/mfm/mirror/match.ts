/**
 * Match every repo ability record to the dump identity it mirrors, or classify it for removal.
 *
 * A record is matched through the entity that owns it wherever the repo links one to a dump row
 * (a stratagem's or enhancement's `mfm` ref, a detachment's rule, a unit's datasheet); otherwise
 * by name inside its faction family. A record already carrying an identity's id matches it
 * directly, which is what makes a second run a no-op.
 */
import type { AbilityRow, AbilityRowSet } from "../dump-prose-rows.js";
import { CORE_FACTION } from "../dump-prose-rows.js";
import { SHARED_ROSTERS } from "../faction-map.js";
import type { Identity, IdentitySet } from "./identity.js";
import { matchName, spellingMatches, type Tier } from "./names.js";
import { type AbilityRecord, mfmIds, type RepoSnapshot } from "./repo.js";

export type MatchResult =
  | { kind: "match"; id: string; via: string; tier?: Tier; note?: string }
  | { kind: "remove"; reason: RemovalReason; detail?: string };

export type RemovalReason = "foreign-faction-only" | "not-in-dump" | "unowned-dump-row" | "no-owner-in-dump" | "legends-only";

export interface RecordRef {
  dir: string;
  file: string;
  index: number;
  record: AbilityRecord;
}

export const recKey = (dir: string, id: string): string => `${dir}\u0000${id}`;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Parent dirs of a supplement/legion dir, and the supplements of a parent. */
export function familyOf(dir: string): string[] {
  const out = new Set([dir, CORE_FACTION, ...(SHARED_ROSTERS[dir] ?? [])]);
  for (const [child, parents] of Object.entries(SHARED_ROSTERS)) if (parents[0] === dir) out.add(child);
  return [...out];
}

/** The enrichment dir whose records a core dir's entities reference (chapters without one use their parent's). */
export function recordDirFor(snap: RepoSnapshot, dir: string): string {
  if (dir === CORE_FACTION || snap.enrichmentDirs.has(dir)) return dir;
  return SHARED_ROSTERS[dir]?.[0] ?? dir;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const g = m.get(k);
  if (g) {
    if (!g.includes(v)) g.push(v);
  } else m.set(k, [v]);
}

export interface RepoIndex {
  /** (record dir, ability id) → dump stratagem/enhancement row ids of the entities citing it. */
  entityRows: Map<string, string[]>;
  /** (record dir, rule id) → dump detachment ids of the detachments naming it. */
  ruleDetachments: Map<string, string[]>;
  /** (record dir, detachment id) → dump detachment ids. */
  detachmentDump: Map<string, string[]>;
  /** (record dir, rule id) → factions whose faction record lists it. */
  ruleFactions: Map<string, string[]>;
  /** (record dir, unit id) → dump datasheet ids. */
  unitDatasheets: Map<string, string[]>;
  /** (record dir, ability id) → unit ids referencing it. */
  unitRefs: Map<string, string[]>;
  /** Dump detachment ids any repo detachment carries. */
  repoDetachments: Set<string>;
  /** Dump datasheet ids any repo unit carries. */
  repoDatasheets: Set<string>;
  /** Dump stratagem/enhancement row ids any repo entity carries. */
  repoEntityRows: Set<string>;
}

export function indexRepo(snap: RepoSnapshot): RepoIndex {
  const ix: RepoIndex = {
    entityRows: new Map(),
    ruleDetachments: new Map(),
    detachmentDump: new Map(),
    ruleFactions: new Map(),
    unitDatasheets: new Map(),
    unitRefs: new Map(),
    repoDetachments: new Set(),
    repoDatasheets: new Set(),
    repoEntityRows: new Set(),
  };
  for (const f of [...snap.stratagems, ...snap.enhancements]) {
    const rd = recordDirFor(snap, f.dir);
    for (const e of f.records) {
      const ids = mfmIds(e);
      ids.forEach((id) => ix.repoEntityRows.add(id));
      const ab = typeof e.ability_id === "string" ? e.ability_id : null;
      for (const id of ids) {
        if (ab) push(ix.entityRows, recKey(rd, ab), id);
        push(ix.entityRows, recKey(rd, e.id), id);
      }
    }
  }
  for (const f of snap.detachments) {
    const rd = recordDirFor(snap, f.dir);
    for (const d of f.records) {
      const ids = mfmIds(d);
      ids.forEach((id) => ix.repoDetachments.add(id));
      const rules = [d.detachment_rule_id, ...((d.detachment_rule_ids as string[] | undefined) ?? [])].filter((r): r is string => typeof r === "string");
      for (const id of ids) {
        push(ix.detachmentDump, recKey(rd, d.id), id);
        for (const r of rules) push(ix.ruleDetachments, recKey(rd, r), id);
      }
    }
  }
  for (const f of snap.factions) {
    const rd = recordDirFor(snap, f.dir);
    for (const fac of f.records) for (const r of (fac.faction_rule_ids as string[] | undefined) ?? []) push(ix.ruleFactions, recKey(rd, r), f.dir);
  }
  for (const f of snap.units) {
    const rd = recordDirFor(snap, f.dir);
    for (const u of f.records) {
      const ids = mfmIds(u);
      ids.forEach((id) => ix.repoDatasheets.add(id));
      for (const id of ids) push(ix.unitDatasheets, recKey(rd, u.id), id);
      for (const a of (u.ability_ids as string[] | undefined) ?? []) push(ix.unitRefs, recKey(rd, a), u.id);
    }
  }
  return ix;
}

interface RowIndex {
  byDatasheet: Map<string, AbilityRow[]>;
  byDetachment: Map<string, AbilityRow[]>;
  byFaction: Map<string, AbilityRow[]>;
}

function indexRows(set: AbilityRowSet): RowIndex {
  const ix: RowIndex = { byDatasheet: new Map(), byDetachment: new Map(), byFaction: new Map() };
  for (const r of set.rows) {
    push(ix.byFaction, r.faction, r);
    if (r.owner.kind === "datasheet") push(ix.byDatasheet, r.owner.id, r);
    if (r.owner.kind === "detachment") push(ix.byDetachment, r.owner.id, r);
    for (const ds of r.datasheetIds ?? []) push(ix.byDatasheet, ds, r);
  }
  return ix;
}

/** Core ids a rated repo id folds into ("deadly-demise-d3" → "deadly-demise"). */
function coreFold(ids: IdentitySet, oldId: string): { identity: Identity; rest: string } | null {
  let best: { identity: Identity; rest: string } | null = null;
  for (const i of ids.identities) {
    if (i.namespace !== "core" || !i.kinds.includes("core-ability")) continue;
    if (oldId !== i.id && !oldId.startsWith(`${i.id}-`)) continue;
    if (!best || i.id.length > best.identity.id.length) best = { identity: i, rest: oldId.slice(i.id.length + 1) };
  }
  return best;
}

const RATING_SLUG = /^(?:\d*d\d+(?:-(?:plus-)?\d+)?|\d+(?:-plus)?)$/;

export interface Matcher {
  match(ref: RecordRef): MatchResult;
}

export function createMatcher(snap: RepoSnapshot, set: AbilityRowSet, ids: IdentitySet): Matcher {
  const repo = indexRepo(snap);
  const rows = indexRows(set);
  const identitiesOf = (rs: readonly AbilityRow[]): Identity[] => {
    const out = new Map<string, Identity>();
    for (const r of rs) {
      const id = ids.byRowKey.get(r.key);
      if (id) out.set(id, ids.byId.get(id)!);
    }
    return [...out.values()].sort((a, b) => cmp(a.id, b.id));
  };
  /** Among several identities, the one whose datasheets overlap the record's most, then the primary variant. */
  /** Among several identities: a faction record keeps to faction rules (a same-name core rule is another rule), then datasheet overlap, then the primary variant. */
  const choose = (cands: Identity[], datasheets: readonly string[], core = false): { identity: Identity; note?: string } => {
    const ds = new Set(datasheets);
    const own = cands.filter((i) => (i.faction === CORE_FACTION) === core);
    if (own.length) cands = own;
    const scored = cands.map((i) => ({ i, overlap: i.datasheetIds.filter((d) => ds.has(d)).length }));
    scored.sort((a, b) => b.overlap - a.overlap || (a.i.variant ? 1 : 0) - (b.i.variant ? 1 : 0) || cmp(a.i.id, b.i.id));
    const identity = scored[0]!.i;
    return cands.length > 1 ? { identity, note: `record spans ${cands.length} dump variants (${cands.map((c) => c.id).join(", ")}); kept as ${identity.id}` } : { identity };
  };
  let core = false;
  const hit = (cands: Identity[], via: string, tier: Tier | undefined, datasheets: readonly string[] = []): MatchResult | null => {
    if (!cands.length) return null;
    const { identity, note } = choose(cands, datasheets, core);
    return { kind: "match", id: identity.id, via, ...(tier ? { tier } : {}), ...(note ? { note } : {}) };
  };
  const byName = (pool: readonly AbilityRow[], id: string, suffixes: string[], via: string, datasheets: readonly string[] = []): MatchResult | null => {
    const m = matchName(pool, id, suffixes);
    return m ? hit(identitiesOf(m.rows), via, m.tier, datasheets) : null;
  };

  return {
    match({ dir, record }): MatchResult {
      const id = record.ability_id;
      const type = record.ability_type ?? "unit";
      const family = familyOf(dir);
      const suffixes = [dir, ...family, ...(record.detachment_id ? [record.detachment_id] : [])];
      core = dir === CORE_FACTION || type === "core";

      // Already mirrored: the record carries its own identity's id (a faction record never takes a core id by name alone).
      const direct = ids.byId.get(id);
      if (direct && (direct.faction === CORE_FACTION ? core : direct.faction === dir)) return { kind: "match", id, via: "id" };

      if (dir === CORE_FACTION || type === "core") {
        const fold = type === "core" || dir !== CORE_FACTION ? coreFold(ids, id) : null;
        if (fold) {
          const note = fold.rest && !RATING_SLUG.test(fold.rest) ? `rated core fold with a non-rating tail "${fold.rest}"; check by hand` : undefined;
          return { kind: "match", id: fold.identity.id, via: "core-fold", ...(note ? { note } : {}) };
        }
        const r = byName(rows.byFaction.get(CORE_FACTION) ?? [], id, [], "core-name");
        if (r) return r;
      }

      const k = recKey(dir, id);
      if (type === "stratagem" || type === "enhancement") {
        const dumpIds = repo.entityRows.get(k) ?? [];
        const cands = identitiesOf(dumpIds.flatMap((d) => (ids.byDumpRow.get(`${type}#${d}`) ?? []).flatMap((iid) => ids.byId.get(iid)!.rows)));
        const r = hit(cands, `${type}-entity`, undefined);
        if (r) return r;
        const dets = record.detachment_id ? repo.detachmentDump.get(recKey(dir, record.detachment_id)) ?? [] : [];
        const pool = dets.flatMap((d) => rows.byDetachment.get(d) ?? []).filter((x) => x.kind === type);
        const n = byName(pool, id, suffixes, `${type}-detachment-name`);
        if (n) return n;
      }
      if (type === "detachment") {
        const dets = [...(repo.ruleDetachments.get(k) ?? []), ...(record.detachment_id ? repo.detachmentDump.get(recKey(dir, record.detachment_id)) ?? [] : [])];
        const pool = dets.flatMap((d) => rows.byDetachment.get(d) ?? []).filter((x) => x.kind !== "stratagem" && x.kind !== "enhancement");
        const n = byName(pool, id, suffixes, "detachment-rule");
        if (n) return n;
      }
      if (type === "faction") {
        const facs = repo.ruleFactions.get(k) ?? family;
        const pool = facs.flatMap((f) => rows.byFaction.get(f) ?? []).filter((x) => x.owner.kind === "army");
        const n = byName(pool, id, suffixes, "army-rule");
        if (n) return n;
      }

      // Unit-printed: the datasheets of the units the record names or that cite it.
      const unitIds = [...new Set([...(record.unit_ids ?? []), ...(repo.unitRefs.get(k) ?? [])])].sort(cmp);
      const datasheets = [...new Set(unitIds.flatMap((u) => repo.unitDatasheets.get(recKey(dir, u)) ?? []))].sort(cmp);
      if (datasheets.length) {
        const pool = datasheets.flatMap((d) => rows.byDatasheet.get(d) ?? []);
        const n = byName(pool, id, suffixes, "unit-datasheet", datasheets);
        if (n) return n;
      }

      // Last: the faction family's own rows, any owner, exact or spelling tiers only.
      const familyRows = family.flatMap((f) => rows.byFaction.get(f) ?? []);
      const m = matchName(familyRows, id, suffixes);
      if (m && (m.tier === "exact" || m.tier === "relaxed" || m.tier === "spelling")) {
        const r = hit(identitiesOf(m.rows), "family-name", m.tier, datasheets);
        if (r) return r;
      }

      const elsewhere = spellingMatches(set.rows, id, suffixes).filter((r) => !family.includes(r.faction));
      if (elsewhere.length) {
        return { kind: "remove", reason: "foreign-faction-only", detail: `printed only by ${[...new Set(elsewhere.map((r) => r.faction))].sort(cmp).join(", ")}` };
      }
      const unowned = set.unowned.filter((u) => u.name && spellingMatches([{ name: u.name, kind: "datasheet-ability" } as AbilityRow], id, suffixes).length);
      if (unowned.length) return { kind: "remove", reason: "unowned-dump-row", detail: unowned.map((u) => `${u.table}#${u.rowId}`).join(", ") };
      if ((type === "stratagem" || type === "enhancement") && !(repo.entityRows.get(k) ?? []).some((d) => ids.byDumpRow.has(`${type}#${d}`))) {
        return { kind: "remove", reason: "no-owner-in-dump", detail: "no stratagem/enhancement entity citing it links a dump row" };
      }
      return { kind: "remove", reason: "not-in-dump" };
    },
  };
}
