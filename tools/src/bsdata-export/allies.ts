/**
 * Allied rules (`allies.json`) in the export. A rule applies in each faction
 * catalogue whose faction keywords meet its army gate. There its source
 * datasheets are added to the army's list, behind its detachment gate, and
 * an "Allies: <label>" category carries its points cap and per-keyword unit
 * caps. Its Warlord and Enhancement locks hide those options on the source
 * datasheets while that catalogue is the army's.
 *
 * A rule's `removes_ability_ids` hide those ability profiles in the host
 * army. A rule that `replaces_faction_keywords` swaps its units' Faction
 * categories for the army's while the rule is open. Keyword caps are in
 * `ally-keyword-caps.ts`. Mirrors the allied checks in `roster-resolve.ts`.
 */
import type { Dataset } from "../data/dataset.js";
import type { UnitView } from "../data/entities.js";
import type { AlliedRule } from "../generated.js";
import { allyKeywordCaps, SIZES, type Size } from "./ally-keyword-caps.js";
import type { IdAllocator } from "./ids.js";
import { categoryLink, compact, condition, constraint, entryLink, modifier } from "./nodes.js";
import { children, type BsNode } from "./source.js";
import type { SystemRefs } from "./system.js";

export interface AllyPlan {
  /** Catalogue (faction id) the rule applies in. */
  readonly host: string;
  readonly rule: AlliedRule;
  /** The rule's datasheets, resolved in its source faction. */
  readonly units: readonly UnitView[];
}

export function unitKey(unit: { faction_id: string; id: string }): string {
  return `${unit.faction_id}/${unit.id}`;
}

/**
 * Every (catalogue, rule) pair where the rule's host gate (`host_faction_ids`)
 * and army gate (`army_keywords_any`, case-insensitive) admit the catalogue's
 * army, as `Dataset.alliesFor` does; the detachment gate is a modifier on the
 * offers instead (`closedWhen`). A non-exclusive rule does not apply in an army of its
 * source faction's family: there its datasheets are ordinary picks. A rule
 * without a source faction draws its datasheets from every faction
 * (`Dataset.allyUnitsFor`), less those of the host's family.
 */
export function allyPlans(dataset: Dataset, factions: readonly string[]): AllyPlan[] {
  const rootOf = (factionId: string): string => dataset.factions.get(factionId)?.raw.parent_faction_id ?? factionId;
  const out: AllyPlan[] = [];
  for (const host of factions) {
    const keywords = new Set((dataset.factions.get(host)?.raw.keywords ?? []).map((k) => k.toLowerCase()));
    for (const rule of dataset.alliedRules.all) {
      const hosts = rule.host_faction_ids ?? [];
      if (hosts.length > 0 && !hosts.includes(host)) continue;
      const gate = rule.army_keywords_any ?? [];
      if (gate.length > 0 && !gate.some((k) => keywords.has(k.toLowerCase()))) continue;
      const source = rule.source_faction_id;
      if (source && !rule.exclusive && rootOf(source) === rootOf(host)) continue;
      const units = source
        ? (rule.source_datasheet_ids ?? []).map((id) => dataset.units.byFaction(source).find((u) => u.id === id)).filter((u): u is UnitView => u !== undefined)
        : dataset.allyUnitsFor(rule.id).filter((u) => rule.exclusive || rootOf(u.raw.faction_id) !== rootOf(host));
      if (units.length > 0) out.push({ host, rule, units });
    }
  }
  return out;
}

/** The catalogues in which each datasheet loses its Warlord or Enhancement option. */
export function allyLocks(plans: readonly AllyPlan[]): {
  warlord: Map<string, Set<string>>;
  enhancements: Map<string, Set<string>>;
  /** `<unit key>|<ability id>` → hosts where the rule removes that ability. */
  abilities: Map<string, Set<string>>;
} {
  const warlord = new Map<string, Set<string>>();
  const enhancements = new Map<string, Set<string>>();
  const abilities = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, host: string): void => {
    map.set(key, (map.get(key) ?? new Set<string>()).add(host));
  };
  for (const plan of plans) {
    for (const unit of plan.units) {
      if (plan.rule.cannot_be_warlord) add(warlord, unitKey(unit.raw), plan.host);
      if (plan.rule.cannot_take_enhancements) add(enhancements, unitKey(unit.raw), plan.host);
      for (const abilityId of plan.rule.removes_ability_ids ?? []) add(abilities, `${unitKey(unit.raw)}|${abilityId}`, plan.host);
    }
  }
  return { warlord, enhancements, abilities };
}

/** A `hidden` modifier active while the army's catalogue is any of `catalogueIds`. */
export function hiddenInCatalogues(catalogueIds: readonly string[]): BsNode | undefined {
  if (catalogueIds.length === 0) return undefined;
  return modifier({
    field: "hidden",
    type: "set",
    value: true,
    conditionGroups: [
      {
        type: "or",
        conditions: catalogueIds.map((id) => condition({ childId: id, field: "selections", scope: "primary-catalogue", type: "instanceOf", value: 1 })),
      },
    ],
  });
}

export interface AllyContext {
  readonly ids: IdAllocator;
  readonly dataset: Dataset;
  readonly refs: SystemRefs;
  readonly unitEntryId: (unit: UnitView) => string;
  readonly unitName: (unit: UnitView) => string;
  readonly detachmentEntryId: (detachmentId: string) => string | undefined;
  /** Modifiers the host's link carries for its own detachments: keyword grants and datasheet bars. */
  readonly hostModifiers: (host: string, unit: UnitView) => BsNode[];
  /** Whether the host catalogue's own root list links the unit. */
  readonly offeredBy: (host: string, unit: UnitView) => boolean;
}

/** The condition group under which a rule is closed: none of its gating detachments is selected. */
function closedWhen(ctx: AllyContext, rule: AlliedRule): BsNode | undefined {
  const ids = (rule.detachment_ids ?? []).map((d) => ctx.detachmentEntryId(d)).filter((id): id is string => id !== undefined);
  if (ids.length === 0) return undefined;
  return {
    type: "and",
    conditions: ids.map((id) => condition({ childId: id, field: "selections", scope: "force", type: "lessThan", value: 1, includeChildSelections: true })),
  };
}

/**
 * The army's Faction categories in place of `unit`'s, while the rule is open:
 * a removal for each of the unit's Faction keywords the army lacks, an
 * addition for each army keyword the unit lacks.
 */
function replacedFactionModifiers(ctx: AllyContext, host: string, rule: AlliedRule, unit: UnitView): BsNode[] {
  if (!rule.replaces_faction_keywords) return [];
  const army = ctx.dataset.factions.get(host)?.raw.keywords ?? [];
  const own = unit.raw.faction_keywords ?? [];
  const closed = closedWhen(ctx, rule);
  const open = closed ? [{ type: "or", conditions: children(closed, "conditions").map((c) => ({ ...c, type: "atLeast", value: 1 })) }] : undefined;
  const category = (type: "add" | "remove", keyword: string): BsNode => modifier({ field: "category", type, value: ctx.refs.category(`Faction: ${keyword}`), conditionGroups: open });
  return [...own.filter((k) => !army.includes(k)).map((k) => category("remove", k)), ...army.filter((k) => !own.includes(k)).map((k) => category("add", k))];
}

/** Hidden while every rule offering the unit is closed; none when any rule is always open. */
function gateModifier(closed: readonly (BsNode | undefined)[]): BsNode | undefined {
  if (closed.length === 0 || closed.some((group) => group === undefined)) return undefined;
  return modifier({ field: "hidden", type: "set", value: true, conditionGroups: [{ type: "and", conditionGroups: closed as BsNode[] }] });
}

function sizedCap(ctx: AllyContext, key: string, field: string, values: Partial<Record<Size, number>>): { constraints: BsNode[]; modifiers: BsNode[] } {
  const strike = values["strike-force"];
  const incursion = values.incursion;
  if (strike === undefined && incursion === undefined) return { constraints: [], modifiers: [] };
  const id = ctx.ids.id(key);
  const base = strike ?? Number.MAX_SAFE_INTEGER;
  return {
    constraints: [constraint({ id, type: "max", value: strike ?? -1, field, scope: "force", includeChildSelections: true })],
    modifiers:
      incursion !== undefined && incursion !== base
        ? [
            modifier({
              field: id,
              type: "set",
              value: incursion,
              conditions: [condition({ childId: ctx.refs.battleSize.incursion, field: "selections", scope: "roster", type: "atLeast", value: 1, includeChildSelections: true, includeChildForces: true })],
            }),
          ]
        : [],
  };
}

export interface AllyPieces {
  readonly categoryEntries: BsNode[];
  readonly rootLinks: BsNode[];
  /** Source catalogues (faction ids) the host must link to resolve the datasheets. */
  readonly sources: Set<string>;
  /** Gate modifiers and category links for root links the host already has, keyed by unit key. */
  readonly onExisting: Map<string, { modifiers: BsNode[]; categoryLinks: BsNode[] }>;
}

/** The categories, links and gates one host catalogue gets from its allied rules. */
export function allyPieces(ctx: AllyContext, host: string, plans: readonly AllyPlan[], sourceRootOf: (factionId: string) => string): AllyPieces {
  const pieces: AllyPieces = { categoryEntries: [], rootLinks: [], sources: new Set(), onExisting: new Map() };
  const offers = new Map<string, { unit: UnitView; closed: (BsNode | undefined)[]; categoryLinks: BsNode[]; replacements: BsNode[]; rules: string[] }>();
  for (const plan of plans.filter((p) => p.host === host)) {
    const { rule } = plan;
    const key = `ally:${host}/${rule.id}`;
    const label = `Allies: ${rule.label ?? rule.name}`;
    const points = Object.fromEntries((rule.points_limits ?? []).filter((p) => SIZES.includes(p.battle_size as Size)).map((p) => [p.battle_size, p.max_points]));
    const cap = sizedCap(ctx, `${key}:points`, ctx.refs.cost.pts, points);
    const categoryId = ctx.ids.id(`${key}:category`);
    pieces.categoryEntries.push(compact({ name: label, id: categoryId, hidden: false, constraints: cap.constraints, modifiers: cap.modifiers }));
    const caps = allyKeywordCaps(ctx, key, label, rule, plan.units);
    pieces.categoryEntries.push(...caps.categoryEntries);
    const closed = closedWhen(ctx, rule);
    for (const unit of plan.units) {
      const offer = offers.get(unitKey(unit.raw)) ?? { unit, closed: [], categoryLinks: [], replacements: [], rules: [] };
      offer.closed.push(closed);
      offer.rules.push(rule.id);
      offer.replacements.push(...replacedFactionModifiers(ctx, host, rule, unit));
      offer.categoryLinks.push(
        categoryLink(label, ctx.ids.id(`${key}:${unit.id}:category`), categoryId, false),
        ...caps.linksFor(unit.raw).map((c) => categoryLink(c.name, ctx.ids.id(`${key}:${unit.id}:${c.key}`), c.id, false)),
      );
      offers.set(unitKey(unit.raw), offer);
    }
  }
  for (const [keyOfUnit, offer] of offers) {
    const gate = gateModifier(offer.closed);
    const modifiers = [...(gate ? [gate] : []), ...ctx.hostModifiers(host, offer.unit), ...offer.replacements];
    if (ctx.offeredBy(host, offer.unit)) {
      // Already on the army's list: the rules gate and count the existing link.
      pieces.onExisting.set(keyOfUnit, { modifiers, categoryLinks: offer.categoryLinks });
      continue;
    }
    pieces.sources.add(sourceRootOf(offer.unit.raw.faction_id));
    pieces.rootLinks.push(
      entryLink({
        name: ctx.unitName(offer.unit),
        id: ctx.ids.id(`ally:${host}/${keyOfUnit}`),
        targetId: ctx.unitEntryId(offer.unit),
        type: "selectionEntry",
        categoryLinks: offer.categoryLinks,
        modifiers: modifiers.length > 0 ? modifiers : undefined,
      }),
    );
  }
  return pieces;
}
