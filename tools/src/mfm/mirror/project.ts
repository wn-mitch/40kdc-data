/**
 * Project the plan onto the data files: the new text of every changed file under `data/`, each
 * edited in place (span-preserving) so the diff is only what the mirror changed. Also returns a
 * per-file log of every reference rewrite and removal for the report.
 */
import type { Replacement } from "../../round6/json-spans.js";
import { CORE_FACTION, safeSlug } from "../dump-prose-rows.js";
import { CONFIRMED } from "../wargear.js";
import { bareName, type Identity, ratingFromTail } from "./identity.js";
import { editArray } from "./json-edit.js";
import { recKey } from "./match.js";
import type { MirrorPlan, Undecided } from "./plan.js";
import { findRefs } from "./refs.js";
import type { AbilityRecord, EntityRecord, Json, RepoFile, RepoSnapshot } from "./repo.js";
import { mfmIds } from "./repo.js";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort(cmp).join("\u0000") === [...b].sort(cmp).join("\u0000");

export interface FileChange {
  rel: string;
  abs: string;
  /** False when the file does not exist yet (a new faction dir). */
  exists: boolean;
  before: string;
  after: string;
}

export interface RewriteLog {
  file: string;
  where: string;
  from: string;
  to: string | null;
  kind: string;
}

export interface Projection {
  files: FileChange[];
  log: RewriteLog[];
  undecided: Undecided[];
}

const ABILITY_TYPE: Record<string, string> = { stratagem: "stratagem", enhancement: "enhancement" };

function abilityTypeOf(identity: Identity): string {
  if (identity.faction === CORE_FACTION) return identity.kinds.includes("stratagem") ? "stratagem" : "core";
  if (ABILITY_TYPE[identity.namespace]) return ABILITY_TYPE[identity.namespace]!;
  if (identity.kinds.includes("army-rule")) return "faction";
  if (identity.kinds.includes("detachment-rule") || identity.kinds.every((k) => k === "rule-section" || k === "menu-option")) {
    return identity.rows.some((r) => r.owner.kind === "army") ? "faction" : "detachment";
  }
  return "unit";
}

export function projectData(plan: MirrorPlan, snap: RepoSnapshot): Projection {
  const log: RewriteLog[] = [];
  const undecided: Undecided[] = [];
  const files: FileChange[] = [];
  const emit = (f: { rel: string; abs: string; text: string }, after: string, exists = true): void => {
    if (after !== f.text) files.push({ rel: f.rel, abs: f.abs, exists, before: f.text, after });
  };

  // Repo detachment id for a dump detachment, preferring the identity's own dir.
  const repoDetachment = new Map<string, { dir: string; id: string }[]>();
  for (const f of snap.detachments) for (const d of f.records) for (const m of mfmIds(d)) repoDetachment.set(m, [...(repoDetachment.get(m) ?? []), { dir: f.dir, id: d.id }]);
  const detachmentIdFor = (identity: Identity): string | null => {
    if (!identity.detachment) return null;
    const c = repoDetachment.get(identity.detachment.id) ?? [];
    return (c.find((x) => x.dir === identity.faction) ?? c[0])?.id ?? null;
  };

  /** DSL reference rewrites inside a record read from `dir`. */
  const refRewrites = (dir: string, file: string, id: string, node: unknown): Replacement[] => {
    const reps: Replacement[] = [];
    for (const ref of findRefs(node)) {
      const to = ref.kind === "stratagem" ? plan.resolveEntity("stratagem", dir, ref.value) : plan.resolve(dir, ref.value);
      if (to === undefined) {
        undecided.push({ kind: "unresolved-ref", where: `${file}#${id}/${ref.path.join("/")}`, detail: `${ref.shape} "${ref.value}" resolves to no record` });
        continue;
      }
      if (to === null) {
        undecided.push({ kind: "dangling-ref", where: `${file}#${id}/${ref.path.join("/")}`, detail: `${ref.shape} "${ref.value}" names a removed record; the DSL must be re-authored` });
        continue;
      }
      if (to !== ref.value) {
        reps.push({ path: ref.path, value: to });
        log.push({ file, where: `${id}/${ref.path.join("/")}`, from: ref.value, to, kind: ref.shape });
      }
    }
    return reps;
  };

  // ── abilities.json ───────────────────────────────────────────────────────────────────────
  const edits = new Map<string, { replace: Map<number, Replacement[]>; remove: Set<number>; append: Json[] }>();
  const editOf = (dir: string) => {
    let e = edits.get(dir);
    if (!e) edits.set(dir, (e = { replace: new Map(), remove: new Set(), append: [] }));
    return e;
  };
  const fileOf = new Map(snap.abilities.map((f) => [f.dir, f]));
  const moved: { dir: string; record: Json }[] = [];
  for (const d of plan.records) {
    const f = fileOf.get(d.dir)!;
    const record = f.records[d.index]!;
    if (!d.survivor || !d.newId) {
      editOf(d.dir).remove.add(d.index);
      log.push({ file: f.rel, where: d.oldId, from: d.oldId, to: d.newId, kind: d.reason === "merged" ? "record-merged" : `record-removed:${d.reason}` });
      continue;
    }
    const identity = plan.ids.byId.get(d.newId)!;
    const target = identity.faction;
    const changes: Record<string, unknown> = {};
    if (record.ability_id !== d.newId) changes.ability_id = d.newId;
    if (safeSlug(bareName(record.name)) !== safeSlug(bareName(identity.name))) changes.name = identity.name;
    // Every faction record names its faction (the bundle no longer stamps it from the dir).
    if (target !== CORE_FACTION && record.faction_id !== target) changes.faction_id = target;
    if (target === CORE_FACTION && record.ability_type !== abilityTypeOf(identity)) changes.ability_type = abilityTypeOf(identity);
    if (Array.isArray(record.unit_ids)) {
      const want = target === CORE_FACTION ? [] : (plan.unitsOf.get(d.newId) ?? []);
      if (!sameSet(record.unit_ids, want)) changes.unit_ids = want;
    }
    // A record renamed or folded across a reissue keeps the detachment it came from; it must name
    // one the identity is printed in, or prose lookups keyed on it find nothing.
    if (typeof record.detachment_id === "string" && identity.detachment) {
      const printed = new Set(
        identity.rows.flatMap((r) => (r.owner.kind === "detachment" ? (repoDetachment.get(r.owner.id) ?? []).map((x) => x.id) : [])),
      );
      const want = detachmentIdFor(identity);
      if (want && !printed.has(record.detachment_id)) changes.detachment_id = want;
    }
    const refs = [...refRewrites(d.dir, f.rel, d.oldId, record), ...ratingRewrites(identity, d.oldId, record)];
    if (identity.ratings && d.oldId !== identity.id && !refs.some((r) => isRatingValue(r.value))) {
      undecided.push({ kind: "rated-core", where: `${d.dir}/${d.oldId}`, detail: `kept as ${identity.id}, but no literal equal to its rating was found in the DSL; re-author with {rating: true}` });
    }
    if (d.oldId !== d.newId) log.push({ file: f.rel, where: d.oldId, from: d.oldId, to: d.newId, kind: "record-id" });
    if (target === d.dir) {
      const reps: Replacement[] = [...Object.entries(changes).map(([k, v]) => ({ path: [k], value: v })), ...refs];
      if (reps.length) editOf(d.dir).replace.set(d.index, reps);
    } else {
      const clone = structuredClone(record) as Json;
      for (const r of refs) setPath(clone, r.path, r.value);
      Object.assign(clone, changes);
      if (target === CORE_FACTION) delete clone.faction_id;
      editOf(d.dir).remove.add(d.index);
      moved.push({ dir: target, record: clone });
      log.push({ file: f.rel, where: d.oldId, from: `${d.dir}/${d.oldId}`, to: `${target}/${d.newId}`, kind: "record-moved" });
    }
  }
  for (const m of moved.sort((a, b) => cmp(a.dir, b.dir) || cmp(String(a.record.ability_id), String(b.record.ability_id)))) editOf(m.dir).append.push(m.record);
  for (const s of [...plan.stubs].sort((a, b) => cmp(a.id, b.id))) {
    const type = abilityTypeOf(s);
    const stub: Json = {
      ability_id: s.id,
      name: s.name,
      authored_by: "40kdc-community",
      game_version: { ...CONFIRMED },
      stub: true,
      unit_ids: s.faction === CORE_FACTION ? [] : (plan.unitsOf.get(s.id) ?? []),
      ...(s.faction === CORE_FACTION ? {} : { faction_id: s.faction }),
      detachment_id: detachmentIdFor(s),
      ability_type: type,
      effect: { type: "no-effect" },
      scope: { duration: "permanent" },
    };
    editOf(s.faction).append.push(stub);
    log.push({ file: `data/enrichment/${s.faction}/abilities.json`, where: s.id, from: "", to: s.id, kind: "stub-created" });
  }
  for (const [dir, e] of [...edits].sort((a, b) => cmp(a[0], b[0]))) {
    const f = fileOf.get(dir);
    const rel = `data/enrichment/${dir}/abilities.json`;
    const base = f ?? { rel, abs: `${snap.root}/${rel}`, text: "[]\n" };
    emit(base, editArray(base.text, e), !!f);
  }

  // ── phase-mappings.json ──────────────────────────────────────────────────────────────────
  for (const f of snap.phaseMappings) {
    const remove = new Set<number>();
    const replace = new Map<number, Replacement[]>();
    const seen = new Set<string>();
    f.records.forEach((m, i) => {
      const src = String(m.source_id);
      const type = String(m.source_type);
      let to: string | null | undefined;
      if (type === "stratagem" || type === "enhancement") to = plan.resolveEntity(type, f.dir, src) ?? plan.resolve(f.dir, src);
      else to = plan.resolve(f.dir, src);
      const alive = to && (type === "stratagem" || type === "enhancement" ? true : plan.hasRecord(to));
      if (!alive) {
        remove.add(i);
        log.push({ file: f.rel, where: `#${i}`, from: `${type}:${src}`, to: null, kind: "phase-mapping-dead" });
        return;
      }
      const key = JSON.stringify({ ...m, source_id: to });
      if (seen.has(key)) {
        remove.add(i);
        log.push({ file: f.rel, where: `#${i}`, from: `${type}:${src}`, to: to!, kind: "phase-mapping-duplicate" });
        return;
      }
      seen.add(key);
      if (to !== src) {
        replace.set(i, [{ path: ["source_id"], value: to }]);
        log.push({ file: f.rel, where: `#${i}`, from: src, to: to!, kind: "phase-mapping" });
      }
    });
    emit(f, editArray(f.text, { replace, remove }));
  }

  // ── units.json ───────────────────────────────────────────────────────────────────────────
  const unitProj = new Map(plan.units.map((u) => [recKey(u.dir, u.unitId), u]));
  for (const f of snap.units) {
    const replace = new Map<number, Replacement[]>();
    f.records.forEach((u, i) => {
      const p = unitProj.get(recKey(f.dir, u.id));
      const reps: Replacement[] = [];
      const role = plan.roleChanges.get(recKey(f.dir, u.id));
      if (role) {
        reps.push({ path: ["attachment_role"], value: role });
        log.push({ file: f.rel, where: u.id, from: String(u.attachment_role ?? null), to: role, kind: "unit-attachment-role" });
      }
      if (p && JSON.stringify(p.after) !== JSON.stringify(p.before)) {
        reps.push({ path: ["ability_ids"], value: p.after });
        log.push({ file: f.rel, where: u.id, from: JSON.stringify(p.before), to: JSON.stringify(p.after), kind: "unit-ability-ids" });
      }
      if (reps.length) replace.set(i, reps);
    });
    emit(f, editArray(f.text, { replace }));
  }

  // ── stratagems / enhancements ────────────────────────────────────────────────────────────
  const entityDecision = new Map(plan.entities.map((e) => [`${e.kind}\u0000${e.file}\u0000${e.index}`, e]));
  const entityFile = (kind: "stratagem" | "enhancement", f: RepoFile<EntityRecord>): void => {
    const remove = new Set<number>();
    const replace = new Map<number, Replacement[]>();
    f.records.forEach((e, i) => {
      const d = entityDecision.get(`${kind}\u0000${f.rel}\u0000${i}`)!;
      if (!d.newId || d.replica) {
        remove.add(i);
        log.push({ file: f.rel, where: e.id, from: e.id, to: d.replica ? d.newId : null, kind: d.replica ? `${kind}-removed-replica` : `${kind}-removed` });
        return;
      }
      const reps: Replacement[] = [];
      if (d.newId !== e.id) reps.push({ path: ["id"], value: d.newId });
      if ("ability_id" in e && e.ability_id !== d.abilityId) reps.push({ path: ["ability_id"], value: d.abilityId });
      if (reps.length) {
        replace.set(i, reps);
        log.push({ file: f.rel, where: e.id, from: `${e.id}|${String(e.ability_id)}`, to: `${d.newId}|${String(d.abilityId)}`, kind: `${kind}-entity` });
      }
    });
    emit(f, editArray(f.text, { replace, remove }));
  };
  snap.stratagems.forEach((f) => entityFile("stratagem", f));
  snap.enhancements.forEach((f) => entityFile("enhancement", f));

  // ── detachments ──────────────────────────────────────────────────────────────────────────
  const listRewrite = (file: string, where: string, list: string[], map: (v: string) => string | null | undefined, kind: string): string[] | null => {
    const out: string[] = [];
    let changed = false;
    for (const v of list) {
      const to = map(v);
      if (to === undefined) {
        undecided.push({ kind: "unresolved-ref", where: `${file}#${where}`, detail: `${kind} "${v}" resolves to nothing` });
        out.push(v);
      } else if (to === null) {
        changed = true;
        log.push({ file, where, from: v, to: null, kind: `${kind}-dropped` });
      } else {
        if (to !== v) {
          changed = true;
          log.push({ file, where, from: v, to, kind });
        }
        if (!out.includes(to)) out.push(to);
        else changed = true;
      }
    }
    return changed ? out : null;
  };
  for (const f of snap.detachments) {
    const remove = new Set<number>();
    const replace = new Map<number, Replacement[]>();
    f.records.forEach((d, i) => {
      const dec = entityDecision.get(`detachment\u0000${f.rel}\u0000${i}`)!;
      if (!dec.newId) {
        remove.add(i);
        log.push({ file: f.rel, where: d.id, from: d.id, to: null, kind: "detachment-removed" });
        return;
      }
      const reps: Replacement[] = [];
      if (typeof d.detachment_rule_id === "string") {
        const to = plan.resolve(f.dir, d.detachment_rule_id);
        if (to && to !== d.detachment_rule_id) {
          reps.push({ path: ["detachment_rule_id"], value: to });
          log.push({ file: f.rel, where: d.id, from: d.detachment_rule_id, to, kind: "detachment-rule-id" });
        } else if (!to) undecided.push({ kind: to === null ? "dangling-ref" : "unresolved-ref", where: `${f.rel}#${d.id}/detachment_rule_id`, detail: `"${d.detachment_rule_id}"` });
      }
      for (const [key, fn] of [
        ["detachment_rule_ids", (v: string) => plan.resolve(f.dir, v)],
        ["stratagem_ids", (v: string) => plan.resolveEntity("stratagem", f.dir, v)],
        ["enhancement_ids", (v: string) => plan.resolveEntity("enhancement", f.dir, v)],
      ] as const) {
        if (!Array.isArray(d[key])) continue;
        const next = listRewrite(f.rel, `${d.id}/${key}`, d[key] as string[], fn, key);
        if (next) reps.push({ path: [key], value: next });
      }
      if (reps.length) replace.set(i, reps);
    });
    emit(f, editArray(f.text, { replace, remove }));
  }

  // ── factions ─────────────────────────────────────────────────────────────────────────────
  for (const f of snap.factions) {
    const replace = new Map<number, Replacement[]>();
    f.records.forEach((fac, i) => {
      if (!Array.isArray(fac.faction_rule_ids)) return;
      const next = listRewrite(f.rel, `${fac.id}/faction_rule_ids`, fac.faction_rule_ids as string[], (v) => plan.resolve(f.dir, v), "faction_rule_ids");
      if (next) replace.set(i, [{ path: ["faction_rule_ids"], value: next }]);
    });
    emit(f, editArray(f.text, { replace }));
  }

  return { files: files.sort((a, b) => cmp(a.rel, b.rel)), log, undecided };
}

export const isRatingValue = (v: unknown): boolean => v !== null && typeof v === "object" && (v as { rating?: unknown }).rating === true;

/**
 * A rated core record folded from one faction's copy ("feel-no-pain-5") hard-codes that copy's
 * rating. Every rating slot (a Feel No Pain threshold, a grant value, a count) holding exactly
 * that rating reads the unit's printed rating instead.
 */
export function ratingRewrites(identity: Identity, oldId: string, record: Json): Replacement[] {
  if (!identity.ratings || !oldId.startsWith(`${identity.id}-`)) return [];
  const rating = ratingFromTail(oldId.slice(identity.id.length + 1));
  if (rating === null) return [];
  const out: Replacement[] = [];
  const walk = (v: unknown, path: (string | number)[]): void => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, [...path, i]));
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const slot = k === "threshold" || k === "value" || k === "count";
      const equal = typeof x === "number" ? x === rating : typeof x === "string" && x.toUpperCase() === String(rating).toUpperCase();
      if (slot && equal && path.includes("modifier")) out.push({ path: [...path, k], value: { rating: true } });
      else walk(x, [...path, k]);
    }
  };
  walk(record.effect, ["effect"]);
  return out;
}

function setPath(obj: Json, path: readonly (string | number)[], value: unknown): void {
  let cur: unknown = obj;
  for (const step of path.slice(0, -1)) cur = (cur as Record<string | number, unknown>)[step];
  (cur as Record<string | number, unknown>)[path[path.length - 1]!] = value;
}

export type { AbilityRecord };
