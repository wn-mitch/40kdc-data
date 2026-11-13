/**
 * Detachment rules on army composition, as BSData categories and modifiers.
 * Mirrors the detachment checks in `roster-resolve.ts`:
 *
 * - Detachments that share a tag link a hidden "Detachment Tag" category
 *   capped at one selection per army.
 * - A datasheet a detachment bars (`excluded_datasheet_ids`, or a unit missing
 *   a `restrictions.required_keywords` keyword or carrying an
 *   `excluded_keywords` one) hides, and its datasheet limit drops to 0, while
 *   that detachment is selected.
 * - `unit_minimums` set a minimum on the keyword's category while the
 *   detachment is selected.
 * - `conditional_keywords` add the keyword's category to a unit while the
 *   detachment is selected or the army carries the faction keyword. A granted
 *   BATTLELINE or DEDICATED TRANSPORT doubles the datasheet limit as it does
 *   in roster validation.
 *
 * A unit's keywords in an army follow roster validation: its own keywords,
 * faction keywords and name, the army's faction keywords when the unit's
 * faction keywords are all the army's, and the grants that apply. Restrictions
 * are evaluated with the restricting detachment as the only grant source.
 */
import type { Dataset } from "../data/dataset.js";
import { unitLimitForBattleSize } from "../data/battle-sizes.js";
import type { Detachment, Unit } from "../generated.js";
import type { IdAllocator } from "./ids.js";
import { categoryLink, compact, condition, constraint, modifier } from "./nodes.js";
import type { BsNode } from "./source.js";
import type { SystemRefs } from "./system.js";

export interface RestrictionContext {
  readonly ids: IdAllocator;
  readonly dataset: Dataset;
  readonly refs: SystemRefs;
  /** Faction ids with a catalogue. */
  readonly factions: readonly string[];
  readonly catalogueId: (factionId: string) => string;
  /** The Detachment option id for a detachment id. */
  readonly detachmentEntryId: (detachmentId: string) => string | undefined;
  /** The category id a unit's keyword links in its home catalogue. */
  readonly keywordCategory: (unit: Unit, keyword: string) => string;
}

const DOUBLING = new Set(["Battleline", "Dedicated Transport"]);

/** Whether a unit's own role or keywords double its datasheet limit (BATTLELINE, DEDICATED TRANSPORT). */
export function doublesLimit(unit: Unit): boolean {
  return unit.role === "battleline" || unit.role === "dedicated-transport" || (unit.keywords ?? []).some((k) => DOUBLING.has(k));
}

function selected(entryId: string): BsNode {
  return condition({ childId: entryId, field: "selections", scope: "force", type: "atLeast", value: 1, includeChildSelections: true });
}

function primaryIn(catalogueIds: readonly string[]): BsNode {
  return {
    type: "or",
    conditions: catalogueIds.map((id) => condition({ childId: id, field: "selections", scope: "primary-catalogue", type: "instanceOf", value: 1 })),
  };
}

function incursion(ctx: RestrictionContext, atLeast: boolean): BsNode {
  return condition({
    childId: ctx.refs.battleSize.incursion,
    field: "selections",
    scope: "roster",
    type: atLeast ? "atLeast" : "lessThan",
    value: 1,
    includeChildSelections: true,
    includeChildForces: true,
  });
}

/** Faction ids whose army keywords include `keyword`. */
function factionsWithKeyword(ctx: RestrictionContext, keyword: string): string[] {
  return ctx.factions.filter((f) => (ctx.dataset.factions.get(f)?.raw.keywords ?? []).includes(keyword));
}

/** Faction ids whose Detachment selection offers `detachmentId`. */
export function hostsOffering(ctx: Pick<RestrictionContext, "dataset" | "factions">, detachmentId: string): string[] {
  return ctx.factions.filter((f) => ctx.dataset.detachments.byFaction(f).some((d) => d.id === detachmentId));
}

/** `unit`'s keywords in `host`'s army with only `detachmentId` selected. */
export function armyKeywords(dataset: Dataset, unit: Unit, host: string, detachmentId: string): Set<string> {
  const army = dataset.factions.get(host)?.raw.keywords ?? [];
  const owned = new Set<string>([...(unit.keywords ?? []), ...(unit.faction_keywords ?? []), unit.name]);
  if (army.length > 0 && (unit.faction_keywords ?? []).every((k) => army.includes(k))) for (const k of army) owned.add(k);
  for (const grant of unit.conditional_keywords ?? []) {
    if (grant.required_detachment_id && grant.required_detachment_id !== detachmentId) continue;
    if (grant.required_faction_keyword && !army.includes(grant.required_faction_keyword)) continue;
    owned.add(grant.keyword);
  }
  return owned;
}

/** Whether `detachment` bars `unit` from `host`'s army. */
export function barred(dataset: Dataset, unit: Unit, host: string, detachment: Detachment): boolean {
  if ((detachment.excluded_datasheet_ids ?? []).includes(unit.id)) return true;
  const restrictions = detachment.restrictions;
  if (!restrictions) return false;
  const keywords = armyKeywords(dataset, unit, host, detachment.id);
  return (restrictions.required_keywords ?? []).some((k) => !keywords.has(k)) || (restrictions.excluded_keywords ?? []).some((k) => keywords.has(k));
}

const restricting = new WeakMap<Dataset, Detachment[]>();

/** Detachments that restrict which datasheets an army takes. */
export function restrictingDetachments(dataset: Dataset): Detachment[] {
  const cached = restricting.get(dataset);
  if (cached) return cached;
  const byId = new Map<string, Detachment>();
  for (const faction of dataset.factions.all) {
    for (const d of dataset.detachments.byFaction(faction.id)) {
      const r = d.restrictions;
      const restricts = (d.excluded_datasheet_ids ?? []).length > 0 || (r?.required_keywords ?? []).length > 0 || (r?.excluded_keywords ?? []).length > 0;
      if (restricts && !byId.has(d.id)) byId.set(d.id, d);
    }
  }
  restricting.set(dataset, [...byId.values()]);
  return restricting.get(dataset)!;
}

/**
 * Conditional keyword categories on a unit entry, and the doubled datasheet
 * limit a granted BATTLELINE or DEDICATED TRANSPORT gives, for the grants
 * `include` admits by their detachment (null for a faction-keyword grant).
 * Appended after the entry's own limit modifiers so they override them.
 */
export function keywordGrantModifiers(
  ctx: RestrictionContext,
  unit: Unit,
  limitId: string,
  limits: { incursion: number; strike: number } | null,
  include: (detachmentId: string | null) => boolean,
): BsNode[] {
  const out: BsNode[] = [];
  const doubledAlready = doublesLimit(unit);
  for (const grant of unit.conditional_keywords ?? []) {
    if (!include(grant.required_detachment_id ?? null)) continue;
    const when: BsNode[] = [];
    if (grant.required_detachment_id) {
      const id = ctx.detachmentEntryId(grant.required_detachment_id);
      if (!id) continue;
      when.push({ type: "and", conditions: [selected(id)] });
    }
    if (grant.required_faction_keyword) {
      const hosts = factionsWithKeyword(ctx, grant.required_faction_keyword);
      if (hosts.length === 0) continue;
      when.push(primaryIn(hosts.map(ctx.catalogueId)));
    }
    if (when.length === 0) continue;
    out.push(modifier({ field: "category", type: "add", value: ctx.keywordCategory(unit, grant.keyword), conditionGroups: [{ type: "and", conditionGroups: when }] }));
    if (limits && !doubledAlready && DOUBLING.has(grant.keyword)) {
      out.push(
        modifier({ field: limitId, type: "set", value: limits.strike * 2, conditionGroups: [{ type: "and", conditions: [incursion(ctx, false)], conditionGroups: when }] }),
        modifier({ field: limitId, type: "set", value: limits.incursion * 2, conditionGroups: [{ type: "and", conditions: [incursion(ctx, true)], conditionGroups: when }] }),
      );
    }
  }
  return out;
}

/**
 * Hidden and a datasheet limit of 0 while a detachment that bars `unit` is
 * selected, for each restricting detachment `include` admits. A detachment
 * offered by several armies that bars the unit in only some of them adds a
 * primary-catalogue condition naming those armies.
 */
export function barModifiers(ctx: RestrictionContext, unit: Unit, limitId: string, include: (detachment: Detachment) => boolean): BsNode[] {
  const out: BsNode[] = [];
  for (const detachment of restrictingDetachments(ctx.dataset)) {
    if (!include(detachment)) continue;
    const entryId = ctx.detachmentEntryId(detachment.id);
    if (!entryId) continue;
    const hosts = hostsOffering(ctx, detachment.id);
    const barring = hosts.filter((host) => barred(ctx.dataset, unit, host, detachment));
    if (barring.length === 0) continue;
    const groups = [{ type: "and", conditions: [selected(entryId)], conditionGroups: barring.length === hosts.length ? undefined : [primaryIn(barring.map(ctx.catalogueId))] }].map(compact);
    out.push(modifier({ field: "hidden", type: "set", value: true, conditionGroups: groups }), modifier({ field: limitId, type: "set", value: 0, conditionGroups: groups }));
  }
  return out;
}

/** The base datasheet limits per battle size for a non-Epic-Hero unit. */
export function baseLimits(doubled: boolean): { incursion: number; strike: number } {
  const factor = doubled ? 2 : 1;
  return { incursion: unitLimitForBattleSize("incursion")! * factor, strike: unitLimitForBattleSize("strike-force")! * factor };
}

/** Hidden tag categories for a family's detachments, and each detachment's links to them. */
export function tagCategories(ids: IdAllocator, root: string, detachments: readonly Detachment[]): { entries: BsNode[]; links: Map<string, BsNode[]> } {
  const sharing = new Map<string, Detachment[]>();
  for (const d of detachments) for (const tag of new Set(d.tags ?? [])) sharing.set(tag, [...(sharing.get(tag) ?? []), d]);
  const entries: BsNode[] = [];
  const links = new Map<string, BsNode[]>();
  for (const [tag, members] of [...sharing].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (members.length < 2) continue;
    const key = `detachment-tag:${root}/${tag}`;
    const id = ids.id(key);
    const name = `Detachment Tag: ${tag}`;
    entries.push({
      name,
      id,
      hidden: true,
      constraints: [constraint({ id: ids.id(`${key}:max`), type: "max", value: 1, field: "selections", scope: "force", includeChildSelections: true })],
    });
    for (const d of members) links.set(d.id, [...(links.get(d.id) ?? []), categoryLink(name, ids.id(`${key}:${d.id}`), id, false)]);
  }
  return { entries, links };
}

/**
 * Minimum-unit constraints on keyword categories (e.g. three War Dog units in
 * Houndpack Lance), keyed by category id: a `min` constraint of 0 that the
 * detachment's selection raises.
 */
export function minimumConstraints(ctx: RestrictionContext, detachments: readonly Detachment[], categoryFor: (keyword: string) => string): Map<string, { constraints: BsNode[]; modifiers: BsNode[] }> {
  const out = new Map<string, { constraints: BsNode[]; modifiers: BsNode[] }>();
  for (const d of detachments) {
    const entryId = ctx.detachmentEntryId(d.id);
    if (!entryId) continue;
    for (const minimum of d.unit_minimums ?? []) {
      const categoryId = categoryFor(minimum.keyword);
      const key = `unit-minimum:${categoryId}`;
      const constraintId = ctx.ids.id(`${key}:min`);
      const slot = out.get(categoryId) ?? { constraints: [constraint({ id: constraintId, type: "min", value: 0, field: "selections", scope: "force", includeChildSelections: true })], modifiers: [] };
      slot.modifiers.push(modifier({ field: constraintId, type: "set", value: minimum.min, conditions: [selected(entryId)] }));
      out.set(categoryId, slot);
    }
  }
  return out;
}
