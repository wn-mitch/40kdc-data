/**
 * Allied rules (`allies.json`) in the export. A rule applies in each faction
 * catalogue whose faction keywords meet its army gate. There its source
 * datasheets are added to the army's list, behind its detachment gate, and
 * an "Allies: <label>" category carries its points cap and per-keyword unit
 * caps. Its Warlord and Enhancement locks hide those options on the source
 * datasheets while that catalogue is the army's.
 *
 * A rule's `removes_ability_ids` hide those ability profiles in the host
 * army. Mirrors the allied checks in `roster-resolve.ts`.
 */
import type { Dataset } from "../data/dataset.js";
import type { UnitView } from "../data/entities.js";
import type { AlliedRule } from "../generated.js";
import type { IdAllocator } from "./ids.js";
import { categoryLink, compact, condition, constraint, entryLink, modifier } from "./nodes.js";
import type { BsNode } from "./source.js";
import type { SystemRefs } from "./system.js";

export interface AllyPlan {
  /** Catalogue (faction id) the rule applies in. */
  readonly host: string;
  readonly rule: AlliedRule;
  /** The rule's datasheets, resolved in its source faction. */
  readonly units: readonly UnitView[];
}

type Size = "incursion" | "strike-force";
const SIZES: readonly Size[] = ["incursion", "strike-force"];

export function unitKey(unit: { faction_id: string; id: string }): string {
  return `${unit.faction_id}/${unit.id}`;
}

/** Every (catalogue, rule) pair where the rule's army gate admits the catalogue's army. */
export function allyPlans(dataset: Dataset, factions: readonly string[]): AllyPlan[] {
  const out: AllyPlan[] = [];
  for (const host of factions) {
    const keywords = new Set(dataset.factions.get(host)?.raw.keywords ?? []);
    for (const rule of dataset.alliedRules.all) {
      const gate = rule.army_keywords_any ?? [];
      if (gate.length > 0 && !gate.some((k) => keywords.has(k))) continue;
      const source = rule.source_faction_id;
      if (!source) continue;
      const units = (rule.source_datasheet_ids ?? [])
        .map((id) => dataset.units.byFaction(source).find((u) => u.id === id))
        .filter((u): u is UnitView => u !== undefined);
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
  const offers = new Map<string, { unit: UnitView; closed: (BsNode | undefined)[]; categoryLinks: BsNode[]; rules: string[] }>();
  for (const plan of plans.filter((p) => p.host === host)) {
    const { rule } = plan;
    const key = `ally:${host}/${rule.id}`;
    const label = `Allies: ${rule.label ?? rule.name}`;
    const points = Object.fromEntries((rule.points_limits ?? []).filter((p) => SIZES.includes(p.battle_size as Size)).map((p) => [p.battle_size, p.max_points]));
    const cap = sizedCap(ctx, `${key}:points`, ctx.refs.cost.pts, points);
    const categoryId = ctx.ids.id(`${key}:category`);
    pieces.categoryEntries.push(compact({ name: label, id: categoryId, hidden: false, constraints: cap.constraints, modifiers: cap.modifiers }));
    const keywordCategories = new Map<string, string>();
    for (const keyword of new Set((rule.keyword_limits ?? []).map((l) => l.keyword))) {
      const limits = Object.fromEntries(
        (rule.keyword_limits ?? []).filter((l) => l.keyword === keyword && SIZES.includes(l.battle_size as Size)).map((l) => [l.battle_size, l.max_count]),
      );
      const keywordCap = sizedCap(ctx, `${key}:keyword:${keyword}`, "selections", limits);
      const id = ctx.ids.id(`${key}:keyword-category:${keyword}`);
      keywordCategories.set(keyword, id);
      pieces.categoryEntries.push(compact({ name: `${label}: ${keyword}`, id, hidden: true, constraints: keywordCap.constraints, modifiers: keywordCap.modifiers }));
    }
    const closed = closedWhen(ctx, rule);
    for (const unit of plan.units) {
      const keywords = new Set([...(unit.raw.keywords ?? []), ...(unit.raw.faction_keywords ?? [])]);
      const offer = offers.get(unitKey(unit.raw)) ?? { unit, closed: [], categoryLinks: [], rules: [] };
      offer.closed.push(closed);
      offer.rules.push(rule.id);
      offer.categoryLinks.push(
        categoryLink(label, ctx.ids.id(`${key}:${unit.id}:category`), categoryId, false),
        ...[...keywordCategories]
          .filter(([keyword]) => keywords.has(keyword))
          .map(([keyword, id]) => categoryLink(`${label}: ${keyword}`, ctx.ids.id(`${key}:${unit.id}:keyword:${keyword}`), id, false)),
      );
      offers.set(unitKey(unit.raw), offer);
    }
  }
  for (const [keyOfUnit, offer] of offers) {
    const gate = gateModifier(offer.closed);
    if (ctx.offeredBy(host, offer.unit)) {
      // Already on the army's list: the rules gate and count the existing link.
      pieces.onExisting.set(keyOfUnit, { modifiers: gate ? [gate] : [], categoryLinks: offer.categoryLinks });
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
        modifiers: gate ? [gate] : undefined,
      }),
    );
  }
  return pieces;
}
