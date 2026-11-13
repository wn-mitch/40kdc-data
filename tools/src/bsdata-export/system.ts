/**
 * The exported game system: cost and profile types, the roster section and
 * keyword categories every faction shares, the Army Roster force with its
 * battle-size limits, and the Battle Size and Force Disposition selections.
 *
 * Limits come from the package's own battle-size rules (`battle-sizes.ts`), so
 * the list builder enforces what `Dataset` roster validation enforces.
 */
import type { Dataset } from "../data/dataset.js";
import {
  detachmentCapForBattleSize,
  enhancementLimitForBattleSize,
  pointsLimitForBattleSize,
} from "../data/battle-sizes.js";
import { BSDATA_IDS, type IdAllocator } from "./ids.js";
import {
  BATTLESCRIBE_VERSION,
  categoryLink,
  compact,
  condition,
  constraint,
  cost,
  entryLink,
  hiddenWhen,
  modifier,
  XMLNS_GAME_SYSTEM,
} from "./nodes.js";
import type { BsNode } from "./source.js";

/** Roster sections, in the order the Army Roster lists them. */
export const SECTION_CATEGORIES = [
  "Configuration",
  "Epic Hero",
  "Character",
  "Battleline",
  "Infantry",
  "Swarm",
  "Mounted",
  "Beast",
  "Monster",
  "Vehicle",
  "Drone",
  "Dedicated Transport",
  "Fortification",
  "Unit",
] as const;

/** Marker categories the exporter's rules refer to. */
export const MARKER_CATEGORIES = ["Leader", "Support", "Warlord", "3DP Detachment"] as const;

const BATTLE_SIZES = [
  { key: "Incursion", size: "incursion", label: "1. Incursion" },
  { key: "Strike Force", size: "strike-force", label: "2. Strike Force" },
] as const;

export interface SystemContext {
  readonly ids: IdAllocator;
  readonly dataset: Dataset;
  readonly revision: number;
  readonly readme: string;
  /** Whether any exported unit is a Legends datasheet. */
  readonly legends: boolean;
}

/** Ids the catalogues refer back to. */
export interface SystemRefs {
  readonly gameSystemId: string;
  readonly cost: { readonly pts: string; readonly dp: string; readonly enhancements: string };
  readonly profileTypes: typeof BSDATA_IDS.system.profileTypes;
  readonly category: (name: string) => string;
  readonly hasCategory: (name: string) => boolean;
  readonly battleSize: Readonly<Record<"incursion" | "strike-force", string>>;
  readonly showLegends: string;
  readonly disposition: (dispositionId: string) => { readonly name: string; readonly categoryId: string };
}

function factionCategoryNames(dataset: Dataset): string[] {
  const names = new Set<string>();
  for (const faction of dataset.factions.all) {
    for (const keyword of faction.raw.keywords ?? []) names.add(`Faction: ${keyword}`);
    for (const unit of dataset.units.byFaction(faction.id)) for (const keyword of unit.raw.faction_keywords ?? []) names.add(`Faction: ${keyword}`);
  }
  return [...names].sort();
}

export function systemRefs(ctx: Pick<SystemContext, "ids" | "dataset">): SystemRefs {
  const sys = BSDATA_IDS.system;
  const names = new Set<string>([
    ...SECTION_CATEGORIES,
    ...MARKER_CATEGORIES,
    ...ctx.dataset.forceDispositions.all.map((d) => d.name),
    ...factionCategoryNames(ctx.dataset),
  ]);
  const category = (name: string): string => {
    if (!names.has(name)) throw new Error(`bsdata export: ${name} is not a game-system category`);
    return ctx.ids.id(`category:system:${name}`, sys.categories[name]);
  };
  return {
    gameSystemId: BSDATA_IDS.gameSystem.id,
    cost: {
      pts: sys.costTypes.pts,
      dp: sys.costTypes["Detachment Points"],
      enhancements: sys.costTypes.Enhancements,
    },
    profileTypes: sys.profileTypes,
    category,
    hasCategory: (name) => names.has(name),
    battleSize: {
      incursion: ctx.ids.id("battle-size:incursion", sys.entries.Incursion),
      "strike-force": ctx.ids.id("battle-size:strike-force", sys.entries["Strike Force"]),
    },
    showLegends: ctx.ids.id("show-legends", sys.entries["Show Legends"]),
    disposition: (dispositionId) => {
      const disposition = ctx.dataset.forceDispositions.get(dispositionId);
      if (!disposition) throw new Error(`bsdata export: unknown force disposition ${dispositionId}`);
      return { name: disposition.name, categoryId: category(disposition.name) };
    },
  };
}

function categoryEntries(ctx: SystemContext, refs: SystemRefs): BsNode[] {
  const out: BsNode[] = [];
  for (const name of SECTION_CATEGORIES) out.push({ name, id: refs.category(name), hidden: false });
  for (const name of MARKER_CATEGORIES) {
    const entry: Record<string, unknown> = { name, id: refs.category(name), hidden: name !== "Warlord" };
    if (name === "Warlord") {
      entry.constraints = [
        constraint({ id: ctx.ids.id("constraint:warlord-min"), type: "min", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
        constraint({ id: ctx.ids.id("constraint:warlord-max"), type: "max", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
      ];
    }
    if (name === "3DP Detachment") {
      entry.constraints = [
        constraint({ id: ctx.ids.id("constraint:3dp-max"), type: "max", value: 1, field: "selections", scope: "force", includeChildSelections: true }),
      ];
    }
    out.push(compact(entry));
  }
  for (const disposition of ctx.dataset.forceDispositions.all) {
    out.push({ name: disposition.name, id: refs.category(disposition.name), hidden: false });
  }
  for (const name of factionCategoryNames(ctx.dataset)) out.push({ name, id: refs.category(name), hidden: false });
  return out;
}

function incursionSelected(refs: SystemRefs): BsNode {
  return condition({
    childId: refs.battleSize.incursion,
    field: "selections",
    scope: "roster",
    type: "atLeast",
    value: 1,
    includeChildSelections: true,
    includeChildForces: true,
  });
}

/** A max constraint at the Strike Force value, set to the Incursion value when Incursion is picked. */
function battleSizeLimit(
  ctx: SystemContext,
  refs: SystemRefs,
  key: string,
  preferredId: string | undefined,
  field: string,
  scope: string,
  limit: (size: "incursion" | "strike-force") => number | null,
): { constraint: BsNode; modifier: BsNode } {
  const id = ctx.ids.id(key, preferredId);
  const strike = limit("strike-force");
  const incursion = limit("incursion");
  if (strike === null || incursion === null) throw new Error(`bsdata export: no ${key} for a battle size`);
  return {
    constraint: constraint({ id, type: "max", value: strike, field, scope, includeChildSelections: true, includeChildForces: true }),
    modifier: modifier({ field: id, type: "set", value: incursion, conditions: [incursionSelected(refs)] }),
  };
}

function armyRoster(ctx: SystemContext, refs: SystemRefs): BsNode {
  const entries = BSDATA_IDS.system.entries;
  const limits = [
    battleSizeLimit(ctx, refs, "limit:pts", entries["Army Roster limit: pts"], refs.cost.pts, "parent", pointsLimitForBattleSize),
    battleSizeLimit(ctx, refs, "limit:dp", entries["Army Roster limit: Detachment Points"], refs.cost.dp, "parent", detachmentCapForBattleSize),
    battleSizeLimit(ctx, refs, "limit:enhancements", entries["Army Roster limit: Enhancements"], refs.cost.enhancements, "force", enhancementLimitForBattleSize),
  ];
  return {
    name: "Army Roster",
    id: ctx.ids.id("force:army-roster", BSDATA_IDS.system.forces["Army Roster"]),
    hidden: false,
    categoryLinks: SECTION_CATEGORIES.map((name) =>
      categoryLink(name, ctx.ids.id(`force:army-roster:category:${name}`), refs.category(name), false),
    ),
    constraints: limits.map((l) => l.constraint),
    modifiers: limits.map((l) => l.modifier),
  };
}

function zeroCosts(refs: SystemRefs): BsNode[] {
  return [cost("pts", refs.cost.pts, 0)];
}

function configurationEntry(ctx: SystemContext, refs: SystemRefs, key: string, name: string, preferredId: string | undefined, body: Record<string, unknown>): BsNode {
  return compact({
    name,
    id: ctx.ids.id(key, preferredId),
    hidden: false,
    import: true,
    type: "upgrade",
    categoryLinks: [categoryLink("Configuration", ctx.ids.id(`${key}:category`), refs.category("Configuration"), true)],
    constraints: [
      constraint({ id: ctx.ids.id(`${key}:min`), type: "min", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
      constraint({ id: ctx.ids.id(`${key}:max`), type: "max", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
    ],
    costs: zeroCosts(refs),
    ...body,
  });
}

function battleSizeEntry(ctx: SystemContext, refs: SystemRefs): BsNode {
  const entries = BSDATA_IDS.system.entries;
  const groupId = ctx.ids.id("battle-size:group", entries["Battle Size group"]);
  const options = BATTLE_SIZES.map(({ size, label }) => ({
    name: `${label} (${pointsLimitForBattleSize(size)} Point limit)`,
    id: refs.battleSize[size],
    hidden: false,
    import: true,
    type: "upgrade",
    costs: zeroCosts(refs),
  }));
  return configurationEntry(ctx, refs, "battle-size", "Battle Size", entries["Battle Size"], {
    selectionEntryGroups: [
      {
        name: "Battle Size",
        id: groupId,
        defaultSelectionEntryId: refs.battleSize["strike-force"],
        hidden: false,
        constraints: [
          constraint({ id: ctx.ids.id("battle-size:group:min"), type: "min", value: 1, field: "selections", scope: "parent" }),
          constraint({ id: ctx.ids.id("battle-size:group:max"), type: "max", value: 1, field: "selections", scope: "parent" }),
        ],
        selectionEntries: options,
      },
    ],
  });
}

function dispositionGroup(ctx: SystemContext, refs: SystemRefs): BsNode {
  const entries = BSDATA_IDS.system.entries;
  return {
    name: "Force Disposition",
    id: ctx.ids.id("force-disposition:group", entries["Force Disposition group"]),
    hidden: false,
    constraints: [
      constraint({ id: ctx.ids.id("force-disposition:group:min"), type: "min", value: 1, field: "selections", scope: "parent" }),
      constraint({ id: ctx.ids.id("force-disposition:group:max"), type: "max", value: 1, field: "selections", scope: "parent" }),
    ],
    selectionEntries: ctx.dataset.forceDispositions.all.map((disposition) => {
      const { categoryId } = refs.disposition(disposition.id);
      return {
        name: disposition.name,
        id: ctx.ids.id(`force-disposition:${disposition.id}`, entries[`Force Disposition: ${disposition.name}`]),
        hidden: false,
        import: true,
        type: "upgrade",
        costs: zeroCosts(refs),
        // Offered only once a selected detachment grants this disposition.
        modifiers: [
          hiddenWhen([
            condition({ childId: categoryId, childName: disposition.name, field: "selections", scope: "roster", type: "lessThan", value: 1, includeChildSelections: true, includeChildForces: true }),
          ]),
        ],
      };
    }),
  };
}

function showLegendsEntry(ctx: SystemContext, refs: SystemRefs): BsNode {
  return {
    name: "Show Legends",
    id: refs.showLegends,
    hidden: false,
    import: true,
    type: "upgrade",
    categoryLinks: [categoryLink("Configuration", ctx.ids.id("show-legends:category"), refs.category("Configuration"), true)],
    constraints: [
      constraint({ id: ctx.ids.id("show-legends:max"), type: "max", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
    ],
    costs: zeroCosts(refs),
  };
}

function profileTypes(): BsNode[] {
  const types = BSDATA_IDS.system.profileTypes;
  return Object.entries(types).map(([name, type], index) => ({
    name,
    id: type.id,
    sortIndex: index + 1,
    characteristicTypes: Object.entries(type.characteristics).map(([charName, id]) => ({ name: charName, id })),
  }));
}

/** Builds the `{gameSystem}` document. */
export function buildGameSystem(ctx: SystemContext, refs: SystemRefs): BsNode {
  const entries = BSDATA_IDS.system.entries;
  const shared: BsNode[] = [battleSizeEntry(ctx, refs)];
  const forceDisposition = configurationEntry(ctx, refs, "force-disposition", "Force Disposition", entries["Force Disposition"], {
    entryLinks: [
      entryLink({
        name: "Force Disposition",
        id: ctx.ids.id("force-disposition:group-link"),
        targetId: ctx.ids.id("force-disposition:group", entries["Force Disposition group"]),
        type: "selectionEntryGroup",
      }),
    ],
  });
  shared.push(forceDisposition);
  if (ctx.legends) shared.push(showLegendsEntry(ctx, refs));
  const rootLinks = [
    entryLink({ name: "Battle Size", id: ctx.ids.id("battle-size:link", entries["Battle Size link"]), targetId: shared[0].id as string, type: "selectionEntry" }),
    entryLink({ name: "Force Disposition", id: ctx.ids.id("force-disposition:link", entries["Force Disposition link"]), targetId: forceDisposition.id as string, type: "selectionEntry" }),
  ];
  if (ctx.legends) {
    rootLinks.push(entryLink({ name: "Show Legends", id: ctx.ids.id("show-legends:link"), targetId: refs.showLegends, type: "selectionEntry" }));
  }
  return {
    gameSystem: {
      name: BSDATA_IDS.gameSystem.name,
      id: refs.gameSystemId,
      battleScribeVersion: BATTLESCRIBE_VERSION,
      readme: ctx.readme,
      revision: ctx.revision,
      type: "gameSystem",
      xmlns: XMLNS_GAME_SYSTEM,
      categoryEntries: categoryEntries(ctx, refs),
      costTypes: [
        { name: "pts", id: refs.cost.pts, defaultCostLimit: -1, hidden: false },
        { name: "Detachment Points", id: refs.cost.dp, defaultCostLimit: -1, hidden: false },
        { name: "Enhancements", id: refs.cost.enhancements, defaultCostLimit: -1, hidden: true },
      ],
      entryLinks: rootLinks,
      forceEntries: [armyRoster(ctx, refs)],
      profileTypes: profileTypes(),
      publications: [{ name: "40kdc-data", id: ctx.ids.id("publication:40kdc-data"), publisherUrl: "https://40kdc.alpacasoft.dev" }],
      sharedSelectionEntries: shared,
      sharedSelectionEntryGroups: [dispositionGroup(ctx, refs)],
    },
  };
}
