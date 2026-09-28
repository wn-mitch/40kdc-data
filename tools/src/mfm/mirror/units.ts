/**
 * A unit's `ability_ids` are what its own datasheet prints: every ability row the unit's `mfm`
 * datasheets own (plus the core abilities they link), mapped to identity ids. A codex datasheet
 * wins over a Combat Patrol or Legends one when a unit carries both. Leader and Support follow
 * the unit's attachment role from the attachment-role ingest (leader-wins for mixed datasheets).
 *
 * A datasheet line that only names the army or detachment rule is not a unit ability: the rule
 * stays on `faction_rule_ids` / the detachment.
 *
 * Existing refs to kept records that the datasheet also prints but that are not a printed kind
 * (a rule section, an attached-unit note) stay; every other existing ref not printed goes.
 */
import type { AbilityRow, AbilityRowSet } from "../dump-prose-rows.js";
import { safeSlug } from "../dump-prose-rows.js";
import { type IdentitySet, ratingFromTail } from "./identity.js";
import { UNIT_PRINTED_KINDS } from "./identity.js";
import { abilityRefId, type UnitAbilityRef } from "../../data/ability-refs.js";
import { type EntityRecord, mfmIds } from "./repo.js";

/** A printed rating as the unit schema stores it: "5+" → 5, '9"' → 9, "D3" stays a dice string. */
export function ratingValue(printed: string): string | number {
  const t = printed.replace(/[+"]$/, "");
  return /^\d+$/.test(t) ? Number(t) : t.toUpperCase();
}

/** Datasheet rules that are roster structure (modelled elsewhere), not abilities. */
export const STRUCTURAL_RULES: ReadonlySet<string> = new Set(["leader", "support", "transport", "attached-unit", "embarking", "designer-s-note", "designers-note"]);

export const isStructural = (r: AbilityRow): boolean => r.kind === "datasheet-rule" && STRUCTURAL_RULES.has(safeSlug(r.name) ?? "");

export interface UnitProjection {
  dir: string;
  unitId: string;
  before: UnitAbilityRef[];
  /** The projected entries: an id, or `{id, value}` for a rated rule. */
  after: UnitAbilityRef[];
  added: string[];
  /** Dropped refs with the reason: `not-printed`, `removed`, or `unresolved`. */
  dropped: { id: string; reason: string }[];
  /** Printed rated core abilities (the rating a grant would carry). */
  ratings: Record<string, string>;
  datasheets: string[];
  note?: string;
}

export interface UnitContext {
  set: AbilityRowSet;
  ids: IdentitySet;
  /** Resolve an existing ref in the unit's dir: new id, `null` when removed, undefined when unknown. */
  resolve: (dir: string, id: string) => string | null | undefined;
  /** Identity ids that have a record after the mirror (kept or seeded). */
  hasRecord: (id: string) => boolean;
  /** Repo wargear/weapon ids linked to a dump `wargear_item` row (mfm ref). */
  wargearOf: (dumpRowId: string) => string[];
  /** Attachment role after the attachment-role ingest. */
  roleOf: (dir: string, unitId: string) => "leader" | "support" | null | undefined;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function indexByDatasheet(set: AbilityRowSet): Map<string, AbilityRow[]> {
  const m = new Map<string, AbilityRow[]>();
  const add = (k: string, r: AbilityRow): void => {
    const g = m.get(k);
    if (g) g.push(r);
    else m.set(k, [r]);
  };
  for (const r of set.rows) {
    if (r.owner.kind === "datasheet") add(r.owner.id, r);
    for (const ds of r.datasheetIds ?? []) add(ds, r);
  }
  return m;
}

export function projectUnit(ctx: UnitContext, byDatasheet: Map<string, AbilityRow[]>, dir: string, unit: EntityRecord): UnitProjection {
  const before = [...((unit.ability_ids as UnitAbilityRef[] | undefined) ?? [])];
  const all = mfmIds(unit).filter((d) => byDatasheet.has(d));
  const rowsOf = (d: string): AbilityRow[] => byDatasheet.get(d) ?? [];
  const isSecondary = (d: string): boolean => {
    const own = rowsOf(d).filter((r) => r.owner.kind === "datasheet");
    return own.length > 0 && own.every((r) => r.publication?.combatPatrol || r.legends);
  };
  const primary = all.filter((d) => !isSecondary(d));
  const datasheets = (primary.length ? primary : all).sort(cmp);
  const proj: UnitProjection = { dir, unitId: unit.id, before, after: before, added: [], dropped: [], ratings: {}, datasheets };
  const factions = [...new Set(datasheets.flatMap((d) => rowsOf(d).filter((r) => r.owner.kind === "datasheet").map((r) => r.faction)))].sort(cmp);
  if (factions.length > 1) proj.note = `unit links datasheets of ${factions.join(", ")}; it prints the union`;
  if (!datasheets.length) {
    // No dump datasheet: only rename what resolves; nothing can be proven printed.
    const after: UnitAbilityRef[] = [];
    for (const ref of before) {
      const id = abilityRefId(ref);
      const n = ctx.resolve(dir, id);
      const to = n ?? id;
      // A rated core id ("feel-no-pain-6") spells the rating its fold must carry.
      const rating = typeof ref === "string" && to !== id && ctx.ids.byId.get(to)?.ratings && id.startsWith(`${to}-`) ? ratingFromTail(id.slice(to.length + 1)) : null;
      if (n === null) proj.dropped.push({ id, reason: "removed" });
      else if (!after.some((a) => abilityRefId(a) === to)) after.push(typeof ref === "string" ? (rating !== null ? { id: to, value: rating } : to) : { ...ref, id: to });
    }
    proj.after = after;
    proj.note = "unit links no dump datasheet; refs renamed only";
    return proj;
  }

  const printedRows = datasheets.flatMap(rowsOf);
  const printed = new Set<string>();
  const owned = new Set<string>();
  /** Identity id → the wargear item whose printed rule it is. */
  const wargearOfId = new Map<string, string>();
  const carried = new Set((unit.weapon_ids as string[] | undefined) ?? []);
  for (const r of printedRows) {
    const id = ctx.ids.byRowKey.get(r.key);
    if (!id) continue;
    owned.add(id);
    // A datasheet line that points at the army or detachment rule is that rule, listed on the faction or detachment.
    if (!UNIT_PRINTED_KINDS.has(r.kind) || isStructural(r) || r.textFrom) continue;
    if (!ctx.hasRecord(id)) continue;
    printed.add(id);
    if (r.kind === "wargear" && !wargearOfId.has(id)) {
      // The unit's own copy of the item: one it carries, else the first repo id the dump row links.
      const ids = ctx.wargearOf(r.rowId);
      const pick = ids.find((w) => carried.has(w)) ?? ids[0];
      if (pick) wargearOfId.set(id, pick);
    }
    if (r.kind === "core-ability") {
      const identity = ctx.ids.byId.get(id);
      for (const d of datasheets) {
        const rating = identity?.ratings?.[d];
        if (rating) proj.ratings[id] = rating;
      }
    }
  }

  // Leader / Support follow the attachment role.
  const role = ctx.roleOf(dir, unit.id);
  if (role === "support" && printed.has("leader")) {
    printed.delete("leader");
    owned.delete("leader");
    printed.add("support");
  } else if (role === "leader" && printed.has("support")) {
    printed.delete("support");
    owned.delete("support");
    printed.add("leader");
  }

  const after: string[] = [];
  for (const id of before.map(abilityRefId)) {
    const n = ctx.resolve(dir, id);
    if (n === null) {
      proj.dropped.push({ id, reason: "removed" });
      continue;
    }
    const target = n ?? id;
    if (printed.has(target) || (owned.has(target) && ctx.hasRecord(target))) {
      if (!after.includes(target)) after.push(target);
    } else proj.dropped.push({ id, reason: n === undefined ? "unresolved" : "not-printed" });
  }
  for (const id of [...printed].sort(cmp)) {
    if (!after.includes(id)) {
      after.push(id);
      proj.added.push(id);
    }
  }
  // A rated rule carries the rating its datasheet prints.
  proj.after = after.map((id) => {
    const rating = proj.ratings[id];
    const wargear = wargearOfId.get(id);
    if (!rating && !wargear) return id;
    return { id, ...(rating ? { value: ratingValue(rating) } : {}), ...(wargear ? { wargear } : {}) };
  });
  return proj;
}
