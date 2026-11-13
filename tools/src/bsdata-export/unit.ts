/**
 * One datasheet as a BSData unit (or single-model) entry: stat and ability
 * profiles, keyword categories with its roster section as the primary one,
 * points, the datasheet limit, models and wargear, and its leader association.
 */
import type { Dataset } from "../data/dataset.js";
import type { UnitView } from "../data/entities.js";
import { unitLimitForBattleSize } from "../data/battle-sizes.js";
import type { Unit } from "../generated.js";
import type { IdAllocator } from "./ids.js";
import { categoryLink, characteristic, compact, condition, constraint, cost, hiddenWhen, modifier, profile } from "./nodes.js";
import { basePrice, pointsModifiers } from "./points.js";
import type { BsNode } from "./source.js";
import { SECTION_CATEGORIES, type SystemRefs } from "./system.js";
import { doublesLimit } from "./restrictions.js";
import { unitSelections } from "./wargear.js";

/** Base types in the order a unit's section falls back to them. */
const BASE_TYPES = ["Infantry", "Mounted", "Beast", "Monster", "Vehicle", "Swarm", "Drone", "Fortification"] as const;

export interface UnitBuildContext {
  readonly ids: IdAllocator;
  readonly dataset: Dataset;
  readonly refs: SystemRefs;
  /** Category id for a keyword or datasheet name, defined in `catalogueFaction`'s catalogue. */
  readonly category: (catalogueFaction: string, name: string) => string;
  readonly catalogueId: (factionId: string) => string | undefined;
  readonly hostCatalogues: (host: string, unit: Unit) => { readonly exact: boolean; readonly ids: readonly string[] };
  readonly detachmentEntryId: (detachmentId: string) => string | undefined;
  readonly itemEntry: (unit: Unit, itemId: string) => { readonly id: string; readonly name: string } | undefined;
  /** Catalogues (by faction id) whose army keywords bar a unit's `excluded_faction_keywords`. */
  readonly excludingCatalogues: (unit: Unit) => readonly string[];
  /** Catalogue ids in whose armies an allied rule removes `abilityId` from the unit. */
  readonly abilityRemovedIn: (unit: Unit, abilityId: string) => readonly string[];
  /** Detachment bars and conditional keywords (`restrictions.ts`), applied after the datasheet limit. */
  readonly restrictions: (unit: Unit, limitId: string, limits: { incursion: number; strike: number } | null) => BsNode[];
  /** Unit ids some leader / support character can attach to. */
  readonly ledBy: { readonly leader: ReadonlySet<string>; readonly support: ReadonlySet<string> };
  /** What the unit takes from its catalogue: the Warlord upgrade link and an enhancement group. */
  readonly characterOptions: (unit: UnitView, entryKey: string) => { readonly entryLinks: readonly BsNode[]; readonly groups: readonly BsNode[] };
}

export function preferredUnitName(unit: Unit): string {
  return unit.is_legend ? `${unit.name} [Legends]` : unit.name;
}

export function isEpicHero(unit: Unit): boolean {
  return unit.role === "epic-hero" || (unit.keywords ?? []).includes("Epic Hero");
}

/** The roster section a unit is listed under. */
export function primarySection(unit: Unit): string {
  const keywords = new Set(unit.keywords ?? []);
  if (isEpicHero(unit)) return "Epic Hero";
  if (unit.role === "character" || keywords.has("Character")) return "Character";
  if (unit.role === "battleline" || keywords.has("Battleline")) return "Battleline";
  if (unit.role === "dedicated-transport" || keywords.has("Dedicated Transport")) return "Dedicated Transport";
  return BASE_TYPES.find((type) => keywords.has(type)) ?? "Unit";
}

function statText(value: unknown, suffix = ""): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return suffix && /^\d+$/.test(text) ? `${text}${suffix}` : text;
}

function baseText(unit: Unit): string {
  const base = unit.base_size_mm as { shape?: string; diameter?: number; width?: number; length?: number } | null | undefined;
  if (!base) return "";
  if (typeof base.diameter === "number") return `${base.diameter}mm`;
  if (typeof base.length === "number" && typeof base.width === "number") return `${base.length}x${base.width}mm`;
  if (base.shape === "hull") return "Hull";
  return "";
}

function unitProfiles(view: UnitView, ctx: UnitBuildContext, key: string): BsNode[] {
  const type = ctx.refs.profileTypes.Unit;
  const c = type.characteristics;
  const stats = view.raw.profiles.map((p, index) =>
    profile(p.name ?? view.name, ctx.ids.id(`${key}:profile:${index}`), type.id, "Unit", [
      characteristic("M", c.M, statText(p.M, '"')),
      characteristic("T", c.T, statText(p.T)),
      characteristic("Sv", c.Sv, statText(p.Sv, "+")),
      characteristic("W", c.W, statText(p.W)),
      characteristic("LD", c.LD, statText(p.Ld, "+")),
      characteristic("OC", c.OC, statText(p.OC)),
      characteristic("InSv", c.InSv, statText(p.invuln_sv, "+")),
      characteristic("Base", c.Base, baseText(view.raw)),
    ]),
  );
  const abilities = ctx.refs.profileTypes.Abilities;
  const described = view.abilities.map((ability) => {
    const node = profile(ability.name, ctx.ids.id(`${key}:ability:${ability.id}`), abilities.id, "Abilities", [
      characteristic("Description", abilities.characteristics.Description, ability.describe()),
    ]);
    const removedIn = ctx.abilityRemovedIn(view.raw, ability.id);
    if (removedIn.length === 0) return node;
    return {
      ...node,
      modifiers: [
        modifier({
          field: "hidden",
          type: "set",
          value: true,
          conditionGroups: [
            { type: "or", conditions: removedIn.map((id) => condition({ childId: id, field: "selections", scope: "primary-catalogue", type: "instanceOf", value: 1 })) },
          ],
        }),
      ],
    };
  });
  return [...stats, ...described];
}

/** The category a unit's `keyword` links: a game-system category, else the home family's keyword category. */
export function keywordCategoryId(ctx: Pick<UnitBuildContext, "refs" | "category">, home: string, keyword: string): string {
  const sectionLike = (SECTION_CATEGORIES as readonly string[]).includes(keyword) || ctx.refs.hasCategory(keyword);
  return sectionLike ? ctx.refs.category(keyword) : ctx.category(home, keyword);
}

function unitCategoryLinks(unit: Unit, ctx: UnitBuildContext, key: string, home: string): BsNode[] {
  const primary = primarySection(unit);
  const links: BsNode[] = [];
  const seen = new Set<string>();
  const add = (name: string, targetId: string, isPrimary: boolean): void => {
    if (seen.has(targetId)) return;
    seen.add(targetId);
    links.push(categoryLink(name, ctx.ids.id(`${key}:category:${name}`), targetId, isPrimary));
  };
  add(primary, ctx.refs.category(primary), true);
  for (const keyword of unit.faction_keywords ?? []) add(`Faction: ${keyword}`, ctx.refs.category(`Faction: ${keyword}`), false);
  for (const keyword of [...(unit.keywords ?? []), unit.name]) add(keyword, keywordCategoryId(ctx, home, keyword), false);
  if (unit.attachment_role === "leader") add("Leader", ctx.refs.category("Leader"), false);
  if (unit.attachment_role === "support") add("Support", ctx.refs.category("Support"), false);
  return links;
}

function datasheetLimit(
  unit: Unit,
  ctx: UnitBuildContext,
  key: string,
): { id: string; limits: { incursion: number; strike: number } | null; constraints: BsNode[]; modifiers: BsNode[] } {
  const id = ctx.ids.id(`${key}:limit`);
  if (isEpicHero(unit)) {
    return {
      id,
      limits: null,
      constraints: [constraint({ id, type: "max", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true })],
      modifiers: [],
    };
  }
  const factor = doublesLimit(unit) ? 2 : 1;
  const strike = unitLimitForBattleSize("strike-force")! * factor;
  const incursion = unitLimitForBattleSize("incursion")! * factor;
  return {
    id,
    limits: { incursion, strike },
    constraints: [constraint({ id, type: "max", value: strike, field: "selections", scope: "force", includeChildSelections: true })],
    modifiers: [
      modifier({
        field: id,
        type: "set",
        value: incursion,
        conditions: [
          condition({ childId: ctx.refs.battleSize.incursion, field: "selections", scope: "roster", type: "atLeast", value: 1, includeChildSelections: true, includeChildForces: true }),
        ],
      }),
    ],
  };
}

function association(view: UnitView, ctx: UnitBuildContext, key: string): BsNode[] {
  const role = view.raw.attachment_role;
  if (role !== "leader" && role !== "support") return [];
  const bodyguards = ctx.dataset.bodyguardsAttachableFrom(view.id, view.factionId);
  if (bodyguards.length === 0) return [];
  return [
    {
      name: role === "leader" ? "Leading" : "Supporting",
      id: ctx.ids.id(`${key}:association`),
      action: "group",
      childId: "unit",
      childName: "unit",
      includeChildSelections: true,
      label: role === "leader" ? "Leader" : "Supported by",
      max: 1,
      min: 0,
      scope: "force",
      conditionGroups: [
        {
          type: "or",
          conditions: bodyguards.map((bodyguard) =>
            condition({
              childId: ctx.category(homeFactionOf(ctx.dataset, bodyguard.raw), bodyguard.raw.name),
              childName: bodyguard.name,
              field: "selections",
              scope: "self",
              type: "instanceOf",
              value: 1,
            }),
          ),
        },
      ],
    },
  ];
}

/**
 * The catalogue a unit belongs to: a child faction (a Space Marine chapter)
 * when the unit carries that faction's keyword, else its own faction.
 */
export function homeFactionOf(dataset: Dataset, unit: Unit): string {
  const keywords = new Set(unit.faction_keywords ?? []);
  for (const faction of dataset.factions.all) {
    if (faction.raw.parent_faction_id !== unit.faction_id) continue;
    const own = (faction.raw.keywords ?? []).filter((k) => !(dataset.factions.get(unit.faction_id)?.raw.keywords ?? []).includes(k));
    if (own.length > 0 && own.every((k) => keywords.has(k))) return faction.id;
  }
  return unit.faction_id;
}

/** Builds the shared selection entry for `view`. */
export function buildUnitEntry(view: UnitView, ctx: UnitBuildContext, preferredId: string | undefined): BsNode {
  const unit = view.raw;
  const key = `unit:${unit.faction_id}/${unit.id}`;
  const id = ctx.ids.id(key, preferredId);
  const name = preferredUnitName(unit);
  const multiModel = (unit.model_count?.max ?? 1) > 1;
  const home = homeFactionOf(ctx.dataset, unit);
  const selections = unitSelections(unit, {
    ids: ctx.ids,
    dataset: ctx.dataset,
    entryId: id,
    ptsTypeId: ctx.refs.cost.pts,
    itemEntry: (itemId) => ctx.itemEntry(unit, itemId),
  }, multiModel);
  const limit = datasheetLimit(unit, ctx, key);
  const character = ctx.characterOptions(view, key);
  const hide: BsNode[] = [];
  if (unit.is_legend) {
    hide.push(
      hiddenWhen([
        condition({ childId: ctx.refs.showLegends, field: "selections", scope: "roster", type: "lessThan", value: 1, includeChildSelections: true, includeChildForces: true }),
      ]),
    );
  }
  for (const catalogueId of ctx.excludingCatalogues(unit)) {
    hide.push(hiddenWhen([condition({ childId: catalogueId, field: "selections", scope: "primary-catalogue", type: "instanceOf", value: 1 })]));
  }
  const constraints = [...limit.constraints];
  if (ctx.ledBy.leader.has(unit.id)) {
    constraints.push(constraint({ id: ctx.ids.id(`${key}:leaders`), type: "max", value: 1, field: "associations", scope: "self", childId: ctx.refs.category("Leader"), childName: "Leader" }));
  }
  if (ctx.ledBy.support.has(unit.id)) {
    constraints.push(constraint({ id: ctx.ids.id(`${key}:supports`), type: "max", value: 1, field: "associations", scope: "self", childId: ctx.refs.category("Support"), childName: "Support" }));
  }
  const modifiers = [
    ...pointsModifiers(unit, {
      entryId: id,
      entryName: name,
      multiModel,
      minModels: unit.model_count?.min ?? 1,
      ptsTypeId: ctx.refs.cost.pts,
      hostCatalogues: (host) => ctx.hostCatalogues(host, unit),
      detachmentEntryId: ctx.detachmentEntryId,
    }),
    ...limit.modifiers,
    ...ctx.restrictions(unit, limit.id, limit.limits),
    ...hide,
  ];
  return compact({
    name,
    id,
    hidden: false,
    import: true,
    type: multiModel ? "unit" : "model",
    associations: association(view, ctx, key),
    categoryLinks: unitCategoryLinks(unit, ctx, key, home),
    constraints,
    costs: [cost("pts", ctx.refs.cost.pts, basePrice(unit, unit.model_count?.min ?? 1))],
    entryLinks: [...selections.entryLinks, ...character.entryLinks],
    modifiers,
    profiles: unitProfiles(view, ctx, key),
    selectionEntryGroups: [...selections.selectionEntryGroups, ...character.groups],
  });
}
