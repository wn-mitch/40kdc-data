/**
 * The mirror plan: a pure function of (dump, repo). Decides, for every existing ability record,
 * the identity it becomes (or why it goes); which record survives when several fold into one
 * identity; which identities are seeded as stubs; how stratagem, enhancement and detachment
 * entities follow; and each unit's printed `ability_ids`. `resolve` answers "what does this old id
 * become in this dir" for every reference rewrite.
 */
import type { AbilityRowSet } from "../dump-prose-rows.js";
import { CORE_FACTION } from "../dump-prose-rows.js";
import type { MfmDump } from "../loader.js";
import { buildIdentities, type Identity, type IdentitySet, SEEDING_KINDS, suffixed } from "./identity.js";
import { createMatcher, familyOf, indexRepo, type MatchResult, recKey, recordDirFor, type RemovalReason, type RepoIndex } from "./match.js";
import { abilityRefId } from "../../data/ability-refs.js";
import { findRefs } from "./refs.js";
import { type AbilityRecord, type EntityRecord, mfmIds, type RepoSnapshot } from "./repo.js";
import { indexByDatasheet, isStructural, projectUnit, type UnitProjection } from "./units.js";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface RecordDecision {
  dir: string;
  file: string;
  index: number;
  oldId: string;
  /** The identity id, or null when removed. */
  newId: string | null;
  /** This record is the one kept for its identity (false: folded into another, or removed). */
  survivor: boolean;
  via?: string;
  reason?: RemovalReason | "merged";
  detail?: string;
  note?: string;
}

export interface EntityDecision {
  kind: "stratagem" | "enhancement" | "detachment";
  dir: string;
  file: string;
  index: number;
  oldId: string;
  newId: string | null;
  /** The entity's `ability_id` after the mirror (stratagems/enhancements). */
  abilityId?: string | null;
  reason?: string;
}

export interface Undecided {
  kind: string;
  where: string;
  detail: string;
}

export interface MirrorPlan {
  ids: IdentitySet;
  records: RecordDecision[];
  /** Identities with no existing record that get a stub, with their target dir. */
  stubs: Identity[];
  /** Identity id → the surviving record. */
  survivors: Map<string, RecordDecision>;
  entities: EntityDecision[];
  units: UnitProjection[];
  /** Units whose attachment role the attachment-role ingest changes, keyed `recKey(dir, unitId)`. */
  roleChanges: Map<string, "leader" | "support">;
  /** Identity id → unit ids (projected) that print it. */
  unitsOf: Map<string, string[]>;
  hasRecord: (id: string) => boolean;
  /** An ability id as referenced from `dir`: new id, null when removed, undefined when unknown. */
  resolve: (dir: string, id: string) => string | null | undefined;
  /** A stratagem/enhancement entity id as referenced from `dir`. */
  resolveEntity: (kind: "stratagem" | "enhancement", dir: string, id: string) => string | null | undefined;
  /** A context-free id (conformance, tests): the one target every dir agrees on, else ambiguous. */
  resolveGlobal: (id: string, kind?: "ability" | "stratagem" | "enhancement") => { to: string | null } | { ambiguous: (string | null)[] } | undefined;
  /** This run's context-free renames (merged into the history file on write). */
  history: () => IdHistory;
  undecided: Undecided[];
  repoIndex: RepoIndex;
}

/** Pick the surviving record: one already in the identity's dir, authored over stub, the id the dump derives, then (dir, id) order. */
function survivorOrder(identity: Identity, a: RecordDecision & { record: AbilityRecord }, b: RecordDecision & { record: AbilityRecord }): number {
  const home = (d: RecordDecision) => (d.dir === identity.faction ? 0 : 1);
  const stub = (d: { record: AbilityRecord }) => (d.record.stub ? 1 : 0);
  const exact = (d: RecordDecision) => (d.oldId === identity.id ? 0 : d.oldId === identity.base ? 1 : 2);
  return home(a) - home(b) || stub(a) - stub(b) || exact(a) - exact(b) || cmp(a.dir, b.dir) || cmp(a.oldId, b.oldId);
}

/**
 * Context-free renames from earlier writes, by kind: old id → new id, null (removed), or the
 * candidates when it was ambiguous. Lets a later run rewrite literals a skipped dir still holds
 * after the data itself has moved on.
 */
export type IdHistory = Partial<Record<"ability" | "stratagem" | "enhancement", Record<string, string | null | (string | null)[]>>>;

export interface PlanOptions {
  /** Earlier writes' renames (consulted only for ids the repo no longer holds). */
  history?: IdHistory;
  /** Attachment roles from the attachment-role ingest, keyed `recKey(dir, unitId)`; they override the repo's. */
  roles?: ReadonlyMap<string, "leader" | "support">;
}

export function buildPlan(dump: MfmDump, set: AbilityRowSet, snap: RepoSnapshot, opts: PlanOptions = {}): MirrorPlan {
  const ids = buildIdentities(set);
  const undecided: Undecided[] = ids.undecided.map((u) => ({ kind: "identity", where: u.id, detail: u.reason }));
  const matcher = createMatcher(snap, set, ids);
  const repoIndex = indexRepo(snap);

  // 1. Records → identities.
  const decisions: (RecordDecision & { record: AbilityRecord })[] = [];
  for (const f of snap.abilities) {
    f.records.forEach((record, index) => {
      const m: MatchResult = matcher.match({ dir: f.dir, file: f.rel, index, record });
      const base = { dir: f.dir, file: f.rel, index, oldId: record.ability_id, record, survivor: false };
      if (m.kind === "match") decisions.push({ ...base, newId: m.id, via: m.via, ...(m.note ? { note: m.note } : {}) });
      else decisions.push({ ...base, newId: null, reason: m.reason, ...(m.detail ? { detail: m.detail } : {}) });
    });
  }
  // A rules-bundle record the dump does not print is a DSL building block other rules grant, not a
  // printed rule: it stays (faction-suffixed) while a grant names it.
  const bundleTargets = new Set<string>();
  for (const f of snap.abilities) for (const r of f.records) for (const ref of findRefs(r.effect)) if (ref.kind === "ability") bundleTargets.add(recKey(f.dir, ref.value));
  for (const d of decisions) {
    if (d.newId || (d.record.effect as { type?: unknown } | undefined)?.type !== "rules-bundle" || !bundleTargets.has(recKey(d.dir, d.oldId))) continue;
    const id = suffixed(d.oldId, d.dir);
    if (!ids.byId.has(id)) {
      const helper: Identity = { id, faction: d.dir, namespace: "local", name: d.record.name, base: d.oldId, rows: [], kinds: [], datasheetIds: [], seeds: false };
      ids.identities.push(helper);
      ids.byId.set(id, helper);
    }
    undecided.push({ kind: "kept-helper", where: `${d.dir}/${d.oldId}`, detail: `rules-bundle the dump does not print (${d.reason}); kept as ${id} because grants name it` });
    d.newId = id;
    d.via = "rules-bundle-helper";
    delete d.reason;
    delete d.detail;
  }
  const byIdentity = new Map<string, (RecordDecision & { record: AbilityRecord })[]>();
  for (const d of decisions) if (d.newId) byIdentity.set(d.newId, [...(byIdentity.get(d.newId) ?? []), d]);
  const survivors = new Map<string, RecordDecision>();
  for (const [id, group] of byIdentity) {
    const identity = ids.byId.get(id)!;
    group.sort((a, b) => survivorOrder(identity, a, b));
    group[0]!.survivor = true;
    survivors.set(id, group[0]!);
    for (const d of group.slice(1)) {
      d.reason = "merged";
      d.detail = `folded into ${id} (kept ${group[0]!.dir}/${group[0]!.oldId})`;
    }
  }
  for (const d of decisions) if (d.note) undecided.push({ kind: "variant-span", where: `${d.dir}/${d.oldId}`, detail: d.note });

  // 2. Resolution of old ids.
  const idMap = new Map<string, string | null>();
  const byOld = new Map<string, Set<string | null>>();
  for (const d of decisions) {
    idMap.set(recKey(d.dir, d.oldId), d.newId);
    byOld.set(d.oldId, (byOld.get(d.oldId) ?? new Set()).add(d.newId));
  }
  const coreFolds = ids.identities.filter((i) => i.namespace === "core" && i.kinds.includes("core-ability"));
  const foldCore = (id: string): string | undefined => {
    const hit = coreFolds.filter((i) => id.startsWith(`${i.id}-`) && /^(?:\d*d\d+(?:-(?:plus-)?\d+)?|\d+(?:-plus)?)$/.test(id.slice(i.id.length + 1)));
    return hit.sort((a, b) => b.id.length - a.id.length)[0]?.id;
  };
  const resolve = (dir: string, id: string): string | null | undefined => {
    for (const d of [recordDirFor(snap, dir), ...familyOf(recordDirFor(snap, dir))]) {
      const k = recKey(d, id);
      if (idMap.has(k)) return idMap.get(k)!;
    }
    if (ids.byId.has(id)) return id;
    const fold = foldCore(id);
    if (fold) return fold;
    const all = byOld.get(id);
    if (all && all.size === 1) return [...all][0]!;
    return undefined;
  };

  // 3. Stubs: identities the dump prints for an owner the repo has, with no record yet.
  const dumpDetachments = new Set(dump.table("detachment").map((d) => d.id));
  const ownerInRepo = (identity: Identity): boolean =>
    identity.rows.some((r) => {
      if (!SEEDING_KINDS.has(r.kind) || isStructural(r)) return false;
      if (r.kind === "stratagem" || r.kind === "enhancement") return repoIndex.repoEntityRows.has(r.rowId);
      if (r.kind === "core-ability") return (r.datasheetIds ?? []).some((d) => repoIndex.repoDatasheets.has(d));
      switch (r.owner.kind) {
        case "datasheet":
          return repoIndex.repoDatasheets.has(r.owner.id);
        case "detachment":
          return repoIndex.repoDetachments.has(r.owner.id);
        case "army":
          return snap.coreDirs.has(r.faction);
        default:
          return false;
      }
    });
  const stubs = ids.identities.filter((i) => !survivors.has(i.id) && i.seeds && ownerInRepo(i));
  const recordIds = new Set([...survivors.keys(), ...stubs.map((s) => s.id)]);
  const hasRecord = (id: string): boolean => recordIds.has(id);

  // 4. Entities follow their ability (D6); no dump row → removed unless a replica of one that has it.
  const entities: EntityDecision[] = [];
  const entityMap = new Map<string, string | null>();
  const entityByOld = new Map<string, Set<string | null>>();
  for (const kind of ["stratagem", "enhancement"] as const) {
    const files = kind === "stratagem" ? snap.stratagems : snap.enhancements;
    // Old entity id → the identity it mirrors; `byRef` when a dump ref (not the ability name) says so.
    const derived = new Map<string, { id: string; byRef: boolean }>();
    for (const f of files) {
      for (const e of f.records) {
        const hits = [...new Set(mfmIds(e).flatMap((row) => ids.byDumpRow.get(`${kind}#${row}`) ?? []))];
        if (hits.length === 1) derived.set(e.id, { id: hits[0]!, byRef: true });
        else if (hits.length > 1) undecided.push({ kind: `${kind}-entity`, where: `${f.dir}/${e.id}`, detail: `links ${hits.length} identities: ${hits.join(", ")}` });
      }
    }
    for (const f of files) {
      for (const e of f.records) {
        if (derived.has(e.id) || mfmIds(e).length || typeof e.ability_id !== "string") continue;
        // No dump ref: follow the ability record the entity already names, when that record mirrors a row of this kind.
        const via = resolve(f.dir, e.ability_id);
        if (via && ids.byId.get(via)?.kinds.includes(kind)) derived.set(e.id, { id: via, byRef: false });
      }
    }
    for (const f of files) {
      // One entity per identity in a file: a dump-ref'd entity wins over a name-followed one.
      const claimed = new Map<string, string>();
      const order = f.records.map((e, i) => ({ e, i })).sort((a, b) => Number(!derived.get(a.e.id)?.byRef) - Number(!derived.get(b.e.id)?.byRef) || a.i - b.i);
      const decided = new Map<number, EntityDecision>();
      for (const { e, i } of order) {
        const d = derived.get(e.id);
        let newId = d?.id ?? null;
        let reason = newId ? undefined : "no dump row (nor a replica of one)";
        if (newId && claimed.has(newId) && claimed.get(newId) !== e.id) {
          reason = `duplicate of ${claimed.get(newId)} (both mirror ${newId})`;
          newId = null;
        }
        if (newId) {
          claimed.set(newId, e.id);
          if (!d!.byRef) undecided.push({ kind: `${kind}-entity-by-ability`, where: `${f.dir}/${e.id}`, detail: `no mfm ref; follows its ability record to ${newId}` });
        }
        const abilityId = newId && hasRecord(newId) ? newId : null;
        decided.set(i, { kind, dir: f.dir, file: f.rel, index: i, oldId: e.id, newId, abilityId, ...(reason ? { reason } : {}) });
      }
      f.records.forEach((e: EntityRecord, index) => {
        const dec = decided.get(index)!;
        entities.push(dec);
        entityMap.set(`${kind}\u0000${recKey(f.dir, e.id)}`, dec.newId);
        entityByOld.set(`${kind}\u0000${e.id}`, (entityByOld.get(`${kind}\u0000${e.id}`) ?? new Set()).add(dec.newId));
      });
    }
  }
  const detachmentReplica = new Set<string>();
  for (const f of snap.detachments) for (const d of f.records) if (mfmIds(d).some((m) => dumpDetachments.has(m))) detachmentReplica.add(d.id);
  for (const f of snap.detachments) {
    f.records.forEach((d, index) => {
      const keep = detachmentReplica.has(d.id);
      entities.push({ kind: "detachment", dir: f.dir, file: f.rel, index, oldId: d.id, newId: keep ? d.id : null, ...(keep ? {} : { reason: "no dump row (nor a replica of one)" }) });
    });
  }
  const resolveEntity = (kind: "stratagem" | "enhancement", dir: string, id: string): string | null | undefined => {
    for (const d of [dir, ...familyOf(dir)]) {
      const k = `${kind}\u0000${recKey(d, id)}`;
      if (entityMap.has(k)) return entityMap.get(k)!;
    }
    const all = entityByOld.get(`${kind}\u0000${id}`);
    if (all && all.size === 1) return [...all][0]!;
    if (ids.byId.get(id)?.namespace === kind) return id;
    return undefined;
  };
  const resolveGlobal: MirrorPlan["resolveGlobal"] = (id, kind = "ability") => {
    const set = kind === "ability" ? byOld.get(id) : entityByOld.get(`${kind}\u0000${id}`);
    if (set?.size) {
      const vals = [...set];
      // Removed copies (contamination) do not compete with the one record that survives.
      const alive = vals.filter((v): v is string => v !== null);
      if (vals.length === 1) return { to: vals[0]! };
      if (alive.length === 1) return { to: alive[0]! };
      return { ambiguous: vals.sort((a, b) => cmp(a ?? "", b ?? "")) };
    }
    if (kind === "ability") {
      if (ids.byId.has(id)) return { to: id };
      const fold = foldCore(id);
      if (fold) return { to: fold };
    }
    const past = opts.history?.[kind]?.[id];
    if (past !== undefined) return Array.isArray(past) ? { ambiguous: past } : { to: past };
    return undefined;
  };
  /** This run's context-free renames, for the history file. */
  const history = (): IdHistory => {
    const out: IdHistory = { ability: {}, stratagem: {}, enhancement: {} };
    const add = (kind: "ability" | "stratagem" | "enhancement", old: string): void => {
      const g = resolveGlobal(old, kind);
      if (!g) return;
      if ("ambiguous" in g) out[kind]![old] = g.ambiguous;
      else if (g.to !== old) out[kind]![old] = g.to;
    };
    for (const old of byOld.keys()) add("ability", old);
    for (const k of entityByOld.keys()) {
      const [kind, old] = k.split("\u0000") as ["stratagem" | "enhancement", string];
      add(kind, old);
    }
    return out;
  };

  // 5. Units.
  const roles = new Map<string, "leader" | "support" | null>();
  for (const f of snap.units) for (const u of f.records) roles.set(recKey(f.dir, u.id), (u.attachment_role as "leader" | "support" | null | undefined) ?? null);
  const roleChanges = new Map<string, "leader" | "support">();
  for (const [k, role] of opts.roles ?? []) {
    if (roles.has(k) && roles.get(k) !== role) roleChanges.set(k, role);
    if (roles.has(k)) roles.set(k, role);
  }
  const byDatasheet = indexByDatasheet(set);
  const wargearByRow = new Map<string, string[]>();
  for (const f of snap.wargear) for (const w of f.records) for (const m of mfmIds(w)) wargearByRow.set(m, [...new Set([...(wargearByRow.get(m) ?? []), w.id])].sort(cmp));
  const units: UnitProjection[] = [];
  for (const f of snap.units) {
    for (const u of f.records) {
      units.push(projectUnit({ set, ids, resolve, hasRecord, wargearOf: (row) => wargearByRow.get(row) ?? [], roleOf: (dir, id) => roles.get(recKey(dir, id)) }, byDatasheet, f.dir, u));
    }
  }
  for (const u of units) if (u.note) undecided.push({ kind: u.datasheets.length ? "multi-publication-unit" : "unit-without-datasheet", where: `${u.dir}/${u.unitId}`, detail: u.note });
  const unitsOf = new Map<string, string[]>();
  for (const u of units) for (const id of u.after.map(abilityRefId)) unitsOf.set(id, [...new Set([...(unitsOf.get(id) ?? []), u.unitId])].sort(cmp));

  return {
    ids,
    records: decisions.map(({ record: _r, ...d }) => d),
    stubs,
    survivors,
    entities,
    units,
    roleChanges,
    unitsOf,
    hasRecord,
    resolve,
    resolveEntity,
    resolveGlobal,
    history,
    undecided,
    repoIndex,
  };
}

/** The dir an identity's record lives in. */
export const targetDir = (identity: Identity): string => identity.faction;

/** `_core` when the identity is core, else its faction. */
export const isCore = (identity: Identity): boolean => identity.faction === CORE_FACTION;
