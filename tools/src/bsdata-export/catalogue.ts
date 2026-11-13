/**
 * Faction catalogues. A faction family (a faction and its child factions, such
 * as Space Marines and its chapters) keeps every datasheet, item, detachment
 * and enhancement in the parent's catalogue. Each child catalogue links the
 * parent, importing its root list, and adds its own datasheets and Detachment
 * selection. The parent's Detachment selection hides in a child's army, and a
 * generic datasheet a chapter cannot take hides in that chapter's army.
 */
import type { Dataset } from "../data/dataset.js";
import type { UnitView } from "../data/entities.js";
import { meetsEnhancementGroups, missingRequiredAbilities } from "../data/enhancement-eligibility.js";
import type { Detachment, Enhancement, Unit } from "../generated.js";
import { BSDATA_IDS, type IdAllocator } from "./ids.js";
import { itemEntry } from "./items.js";
import {
  BATTLESCRIBE_VERSION,
  categoryLink,
  characteristic,
  compact,
  condition,
  constraint,
  cost,
  entryLink,
  hiddenWhen,
  profile,
  XMLNS_CATALOGUE,
} from "./nodes.js";
import type { BsNode } from "./source.js";
import type { SystemRefs } from "./system.js";
import { allyLocks, allyPieces, allyPlans, hiddenInCatalogues, unitKey, type AllyContext } from "./allies.js";
import { minimumConstraints, tagCategories, barModifiers, baseLimits, doublesLimit, keywordGrantModifiers, type RestrictionContext } from "./restrictions.js";
import { buildUnitEntry, homeFactionOf, isEpicHero, keywordCategoryId, type UnitBuildContext } from "./unit.js";

export interface CatalogueContext {
  readonly ids: IdAllocator;
  readonly dataset: Dataset;
  readonly refs: SystemRefs;
  readonly revision: number;
  /** Faction ids that get a catalogue. */
  readonly factions: readonly string[];
}

export interface BuiltCatalogue {
  readonly factionId: string;
  readonly file: string;
  readonly document: BsNode;
}

function isCharacter(unit: Unit): boolean {
  return unit.role === "character" || unit.role === "epic-hero" || (unit.keywords ?? []).includes("Character");
}

function parentOf(dataset: Dataset, factionId: string): string | null {
  return dataset.factions.get(factionId)?.raw.parent_faction_id ?? null;
}

/** Shared state for every catalogue in one export. */
export class CatalogueSet {
  private readonly categoryDefs = new Map<string, Map<string, string>>();
  private readonly categoryRules = new Map<string, { constraints: BsNode[]; modifiers: BsNode[] }>();

  constructor(private readonly ctx: CatalogueContext) {}

  rootOf(factionId: string): string {
    return parentOf(this.ctx.dataset, factionId) ?? factionId;
  }

  familyOf(root: string): string[] {
    return this.ctx.factions.filter((f) => this.rootOf(f) === root);
  }

  catalogueId(factionId: string): string | undefined {
    if (!this.ctx.factions.includes(factionId)) return undefined;
    return this.ctx.ids.id(`catalogue:${factionId}`, BSDATA_IDS.catalogues[factionId]?.id);
  }

  /** A keyword or datasheet-name category, defined in the family root's catalogue. */
  category(home: string, name: string): string {
    const root = this.rootOf(home);
    const preferred = BSDATA_IDS.categories[home]?.[name] ?? BSDATA_IDS.categories[root]?.[name];
    const id = this.ctx.ids.id(`category:${root}:${name}`, preferred);
    const defs = this.categoryDefs.get(root) ?? new Map<string, string>();
    defs.set(name, id);
    this.categoryDefs.set(root, defs);
    return id;
  }

  categoryEntries(root: string): BsNode[] {
    return [...(this.categoryDefs.get(root) ?? new Map<string, string>())]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, id]) => compact({ name, id, hidden: false, ...this.categoryRules.get(id) }));
  }

  /** Constraints and modifiers a keyword category carries (unit minimums). */
  constrainCategory(id: string, rules: { constraints: BsNode[]; modifiers: BsNode[] }): void {
    this.categoryRules.set(id, rules);
  }

  familyDetachments(root: string): Detachment[] {
    const byId = new Map<string, Detachment>();
    for (const faction of this.familyOf(root)) {
      for (const detachment of this.ctx.dataset.detachments.byFaction(faction)) if (!byId.has(detachment.id)) byId.set(detachment.id, detachment);
    }
    return [...byId.values()];
  }

  detachmentEntryId(detachmentId: string, root?: string): string | undefined {
    const detachment = this.ctx.dataset.detachments.getAny(detachmentId);
    if (!detachment) return undefined;
    const familyRoot = root ?? this.rootOf(detachment.faction_id);
    const preferred = this.familyOf(familyRoot)
      .map((f) => BSDATA_IDS.detachments[f]?.[detachmentId])
      .find((id) => id !== undefined);
    return this.ctx.ids.id(`detachment:${familyRoot}/${detachmentId}`, preferred);
  }

  enhancementEntryId(root: string, enhancement: Enhancement): string {
    const preferred = this.familyOf(root)
      .map((f) => BSDATA_IDS.enhancements[f]?.[enhancement.id])
      .find((id) => id !== undefined);
    return this.ctx.ids.id(`enhancement:${root}/${enhancement.id}`, preferred);
  }

  familyEnhancements(root: string): { enhancement: Enhancement; detachment: Detachment }[] {
    const seen = new Set<string>();
    const out: { enhancement: Enhancement; detachment: Detachment }[] = [];
    for (const detachment of this.familyDetachments(root)) {
      for (const id of detachment.enhancement_ids ?? []) {
        const enhancement = this.ctx.dataset.enhancements.getAny(id);
        if (enhancement && !seen.has(id)) {
          seen.add(id);
          out.push({ enhancement, detachment });
        }
      }
    }
    return out;
  }
}

function abilityText(dataset: Dataset, factionId: string, abilityId: string): { name: string; text: string } | undefined {
  const ability = dataset.abilities.byFaction(factionId).find((a) => a.id === abilityId) ?? dataset.abilities.getAny(abilityId);
  return ability ? { name: ability.name, text: ability.describe() } : undefined;
}

function detachmentEntry(set: CatalogueSet, ctx: CatalogueContext, root: string, detachment: Detachment, tagLinks: readonly BsNode[]): BsNode {
  const id = set.detachmentEntryId(detachment.id, root)!;
  const key = `detachment:${root}/${detachment.id}`;
  const rules = (detachment.detachment_rule_ids ?? (detachment.detachment_rule_id ? [detachment.detachment_rule_id] : []))
    .map((ruleId) => ({ ruleId, rule: abilityText(ctx.dataset, detachment.faction_id, ruleId) }))
    .filter((r): r is { ruleId: string; rule: { name: string; text: string } } => r.rule !== undefined)
    .map(({ ruleId, rule }) => ({ name: rule.name, id: ctx.ids.id(`${key}:rule:${ruleId}`), description: rule.text, hidden: false }));
  return compact({
    name: detachment.name,
    id,
    hidden: false,
    import: true,
    type: "upgrade",
    categoryLinks: [
      ...(detachment.force_dispositions ?? []).map((dispositionId) => {
        const disposition = ctx.refs.disposition(dispositionId);
        return categoryLink(disposition.name, ctx.ids.id(`${key}:disposition:${dispositionId}`), disposition.categoryId, false);
      }),
      ...tagLinks,
    ],
    constraints: [constraint({ id: ctx.ids.id(`${key}:max`), type: "max", value: 1, field: "selections", scope: "force", includeChildSelections: true })],
    costs: [cost("pts", ctx.refs.cost.pts, 0), cost("Detachment Points", ctx.refs.cost.dp, detachment.detachment_points ?? 0)],
    rules,
  });
}

function enhancementEntry(set: CatalogueSet, ctx: CatalogueContext, root: string, enhancement: Enhancement, detachment: Detachment): BsNode {
  const id = set.enhancementEntryId(root, enhancement);
  const key = `enhancement:${root}/${enhancement.id}`;
  const detachmentId = set.detachmentEntryId(detachment.id, root)!;
  const rule = enhancement.ability_id ? abilityText(ctx.dataset, detachment.faction_id, enhancement.ability_id) : undefined;
  const abilities = ctx.refs.profileTypes.Abilities;
  return compact({
    name: enhancement.name,
    id,
    hidden: false,
    import: true,
    type: "upgrade",
    constraints: [
      constraint({ id: ctx.ids.id(`${key}:max`), type: "max", value: enhancement.max_targets ?? 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
    ],
    costs: [cost("pts", ctx.refs.cost.pts, enhancement.cost ?? 0), cost("Enhancements", ctx.refs.cost.enhancements, 1)],
    modifiers: [
      hiddenWhen([condition({ childId: detachmentId, childName: detachment.name, field: "selections", scope: "force", type: "lessThan", value: 1, includeChildSelections: true })]),
    ],
    profiles: rule
      ? [profile(enhancement.name, ctx.ids.id(`${key}:profile`), abilities.id, "Abilities", [characteristic("Description", abilities.characteristics.Description, rule.text)])]
      : undefined,
  });
}

function keywordHas(unit: Unit): (keyword: string) => boolean {
  const owned = new Set<string>([...(unit.keywords ?? []), ...(unit.faction_keywords ?? []), unit.name]);
  return (keyword) => owned.has(keyword);
}

function canTake(ctx: CatalogueContext, unit: Unit, enhancement: Enhancement): boolean {
  if (isEpicHero(unit)) return false;
  if (!isCharacter(unit) && enhancement.upgrade_tag !== true) return false;
  const rows = ctx.dataset.unitCompositionOf(unit)?.models ?? [];
  if (rows.length > 0 && rows.every((m) => m.excluded_from_enhancements === true)) return false;
  const has = keywordHas(unit);
  if (!meetsEnhancementGroups(enhancement, unit.id, has)) return false;
  if (missingRequiredAbilities(enhancement, unit.ability_ids).length > 0) return false;
  return !(enhancement.exclusion_keywords ?? []).some(has);
}

function canBeWarlord(ctx: CatalogueContext, unit: Unit): boolean {
  const rows = ctx.dataset.unitCompositionOf(unit)?.models ?? [];
  if (rows.length > 0 && rows.every((m) => m.cannot_be_warlord === true)) return false;
  return isCharacter(unit) || rows.some((m) => m.can_be_non_character_warlord === true);
}

function configurationContainer(ctx: CatalogueContext, key: string, name: string, preferredId: string | undefined, body: Record<string, unknown>): BsNode {
  return compact({
    name,
    id: ctx.ids.id(key, preferredId),
    hidden: false,
    import: true,
    type: "upgrade",
    categoryLinks: [categoryLink("Configuration", ctx.ids.id(`${key}:category`), ctx.refs.category("Configuration"), true)],
    constraints: [
      constraint({ id: ctx.ids.id(`${key}:min`), type: "min", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
      constraint({ id: ctx.ids.id(`${key}:max`), type: "max", value: 1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
    ],
    costs: [cost("pts", ctx.refs.cost.pts, 0)],
    ...body,
  });
}

/** The Detachment selection a faction's army picks its detachments from. */
function detachmentContainer(set: CatalogueSet, ctx: CatalogueContext, factionId: string, root: string): BsNode {
  const key = `detachments:${factionId}`;
  const own = ctx.dataset.detachments.byFaction(factionId);
  const hideOutside =
    factionId === root && set.familyOf(root).length > 1
      ? [hiddenWhen([condition({ childId: set.catalogueId(root)!, field: "selections", scope: "primary-catalogue", type: "notInstanceOf", value: 1 })])]
      : undefined;
  return configurationContainer(ctx, key, "Detachment", BSDATA_IDS.factionEntries[factionId]?.Detachment, {
    modifiers: hideOutside,
    selectionEntryGroups: [
      {
        name: "Detachment",
        id: ctx.ids.id(`${key}:group`),
        hidden: false,
        constraints: [constraint({ id: ctx.ids.id(`${key}:group:min`), type: "min", value: 1, field: "selections", scope: "parent" })],
        entryLinks: own.map((detachment) =>
          entryLink({ name: detachment.name, id: ctx.ids.id(`${key}:link:${detachment.id}`), targetId: set.detachmentEntryId(detachment.id, root)!, type: "selectionEntry" }),
        ),
      },
    ],
  });
}

function catalogueRoot(ctx: CatalogueContext, factionId: string, set: CatalogueSet, body: Record<string, unknown>): BsNode {
  const known = BSDATA_IDS.catalogues[factionId];
  return {
    catalogue: compact({
      name: known?.name ?? ctx.dataset.factions.get(factionId)?.name ?? factionId,
      id: set.catalogueId(factionId)!,
      battleScribeVersion: BATTLESCRIBE_VERSION,
      gameSystemId: ctx.refs.gameSystemId,
      gameSystemRevision: ctx.revision,
      library: false,
      revision: ctx.revision,
      type: "catalogue",
      xmlns: XMLNS_CATALOGUE,
      ...body,
    }),
  };
}

/** Builds every faction's catalogue. Each family root is built before its children. */
export function buildCatalogues(ctx: CatalogueContext): BuiltCatalogue[] {
  const set = new CatalogueSet(ctx);
  const leader = new Set<string>();
  const support = new Set<string>();
  for (const faction of ctx.factions) {
    for (const unit of ctx.dataset.units.byFaction(faction)) {
      const role = unit.raw.attachment_role;
      if (role !== "leader" && role !== "support") continue;
      for (const bodyguard of ctx.dataset.bodyguardsAttachableFrom(unit.id, unit.factionId)) (role === "leader" ? leader : support).add(bodyguard.id);
    }
  }
  const roots = ctx.factions.filter((f) => set.rootOf(f) === f);
  const plans = allyPlans(ctx.dataset, ctx.factions);
  const locks = allyLocks(plans);
  const lockedIn = (map: Map<string, Set<string>>, view: UnitView): string[] =>
    [...(map.get(unitKey(view.raw)) ?? [])].map((f) => set.catalogueId(f)!).sort();
  const unitEntryId = (view: UnitView): string =>
    ctx.ids.id(`unit:${view.raw.faction_id}/${view.id}`, BSDATA_IDS.units[view.raw.faction_id]?.[view.id]);
  const keywordSlug = (k: string): string => k.trim().toLowerCase().replace(/\s+/g, "-");
  const hostCatalogues = (host: string, unit: Unit): { exact: boolean; ids: string[] } => {
    if (ctx.factions.includes(host)) return { exact: true, ids: host === unit.faction_id ? [] : [set.catalogueId(host)!] };
    const ids = ctx.factions
      .filter((f) => f !== unit.faction_id && (ctx.dataset.factions.get(f)?.raw.keywords ?? []).map(keywordSlug).includes(host))
      .map((f) => set.catalogueId(f)!);
    return { exact: false, ids };
  };
  const restrictionCtx: RestrictionContext = {
    ids: ctx.ids,
    dataset: ctx.dataset,
    refs: ctx.refs,
    factions: ctx.factions,
    catalogueId: (f) => set.catalogueId(f)!,
    // A detachment's own family: a bar can come from another army's detachment.
    detachmentEntryId: (d) => set.detachmentEntryId(d),
    keywordCategory: (unit, keyword) => keywordCategoryId({ refs: ctx.refs, category: (home, name) => set.category(home, name) }, homeFactionOf(ctx.dataset, unit), keyword),
  };
  const allyCtx: AllyContext = {
    ids: ctx.ids,
    dataset: ctx.dataset,
    refs: ctx.refs,
    unitEntryId,
    unitName: (view) => (view.raw.is_legend ? `${view.name} [Legends]` : view.name),
    detachmentEntryId: (d) => set.detachmentEntryId(d),
    hostModifiers: (host, view) => {
      const limitId = ctx.ids.id(`unit:${view.raw.faction_id}/${view.id}:limit`);
      const hostFamily = (detachmentId: string): boolean => {
        const d = ctx.dataset.detachments.getAny(detachmentId);
        return d !== undefined && set.rootOf(d.faction_id) === set.rootOf(host) && set.rootOf(d.faction_id) !== set.rootOf(view.raw.faction_id);
      };
      const limits = isEpicHero(view.raw) ? null : baseLimits(doublesLimit(view.raw));
      return [
        ...keywordGrantModifiers(restrictionCtx, view.raw, limitId, limits, (d) => d !== null && hostFamily(d)),
        ...barModifiers(restrictionCtx, view.raw, limitId, (d) => hostFamily(d.id)),
      ];
    },
    offeredBy: (host, view) => homeFactionOf(ctx.dataset, view.raw) === host,
  };
  const pieces = new Map(ctx.factions.map((f) => [f, allyPieces(allyCtx, f, plans, (factionId) => set.rootOf(factionId))]));
  const out: BuiltCatalogue[] = [];
  for (const root of roots) {
    const familyDetachments = set.familyDetachments(root);
    const tags = tagCategories(ctx.ids, root, familyDetachments);
    for (const [categoryId, rules] of minimumConstraints(restrictionCtx, familyDetachments, (keyword) => keywordCategoryId({ refs: ctx.refs, category: (home, name) => set.category(home, name) }, root, keyword))) {
      set.constrainCategory(categoryId, rules);
    }
    const items = new Map<string, BsNode>();
    const enhancements = set.familyEnhancements(root);
    const warlordId = ctx.ids.id(`warlord:${root}`, BSDATA_IDS.factionEntries[root]?.Warlord);
    const unitCtx: UnitBuildContext = {
      ids: ctx.ids,
      dataset: ctx.dataset,
      refs: ctx.refs,
      category: (home, name) => set.category(home, name),
      catalogueId: (f) => set.catalogueId(f),
      hostCatalogues,
      detachmentEntryId: (d) => set.detachmentEntryId(d, root),
      itemEntry: (unit, itemId) => {
        const preferred = BSDATA_IDS.weapons[unit.faction_id]?.[itemId];
        const itemKey = `${unit.faction_id}/${itemId}`;
        let entry = items.get(itemKey);
        if (!entry) {
          entry = itemEntry(ctx.dataset, ctx.refs, ctx.ids, unit.faction_id, itemId, preferred);
          if (!entry) return undefined;
          items.set(itemKey, entry);
        }
        return { id: entry.id as string, name: entry.name as string };
      },
      excludingCatalogues: (unit) =>
        ctx.factions
          .filter((f) => (ctx.dataset.factions.get(f)?.raw.keywords ?? []).some((k) => (unit.excluded_faction_keywords ?? []).includes(k)))
          .map((f) => set.catalogueId(f)!),
      ledBy: { leader, support },
      restrictions: (unit, limitId, limits) => [
        ...keywordGrantModifiers(restrictionCtx, unit, limitId, limits, (d) => {
          if (d === null) return true;
          const detachment = ctx.dataset.detachments.getAny(d);
          return detachment !== undefined && set.rootOf(detachment.faction_id) === set.rootOf(unit.faction_id);
        }),
        ...barModifiers(restrictionCtx, unit, limitId, (d) => set.rootOf(d.faction_id) === set.rootOf(unit.faction_id)),
      ],
      abilityRemovedIn: (unit, abilityId) =>
        [...(locks.abilities.get(`${unitKey(unit)}|${abilityId}`) ?? [])].map((f) => set.catalogueId(f)!).sort(),
      characterOptions: (view: UnitView, entryKey: string) => {
        const warlordLock = hiddenInCatalogues(lockedIn(locks.warlord, view));
        const entryLinks = canBeWarlord(ctx, view.raw)
          ? [
              entryLink({
                name: "Warlord",
                id: ctx.ids.id(`${entryKey}:warlord`),
                targetId: warlordId,
                type: "selectionEntry",
                modifiers: warlordLock ? [warlordLock] : undefined,
              }),
            ]
          : [];
        const eligible = enhancements.filter(({ enhancement }) => canTake(ctx, view.raw, enhancement));
        const enhancementLock = hiddenInCatalogues(lockedIn(locks.enhancements, view));
        const groups =
          eligible.length === 0
            ? []
            : [
                compact({
                  name: "Enhancements",
                  id: ctx.ids.id(`${entryKey}:enhancements`),
                  hidden: false,
                  constraints: [constraint({ id: ctx.ids.id(`${entryKey}:enhancements:max`), type: "max", value: 1, field: "selections", scope: "parent" })],
                  entryLinks: eligible.map(({ enhancement }) =>
                    entryLink({ name: enhancement.name, id: ctx.ids.id(`${entryKey}:enhancement:${enhancement.id}`), targetId: set.enhancementEntryId(root, enhancement), type: "selectionEntry" }),
                  ),
                  modifiers: enhancementLock ? [enhancementLock] : undefined,
                }),
              ];
        return { entryLinks, groups };
      },
    };
    const units = ctx.dataset.units.byFaction(root);
    const unitEntries = units.map((view) => {
      const entry = buildUnitEntry(view, unitCtx, BSDATA_IDS.units[root]?.[view.id]);
      if (entry.id !== unitEntryId(view)) throw new Error(`bsdata export: ${view.id} entry id is not its allocated id`);
      return entry;
    });
    const rootLinksFor = (factionId: string): BsNode[] => {
      const existing = pieces.get(factionId)!.onExisting;
      return units
        .map((view, index) => ({ view, entry: unitEntries[index] }))
        .filter(({ view }) => homeFactionOf(ctx.dataset, view.raw) === factionId)
        .map(({ view, entry }) => {
          const ally = existing.get(unitKey(view.raw));
          return entryLink({
            name: entry.name as string,
            id: ctx.ids.id(`root-link:${factionId}/${view.id}`),
            targetId: entry.id as string,
            type: "selectionEntry",
            categoryLinks: ally && ally.categoryLinks.length > 0 ? ally.categoryLinks : undefined,
            modifiers: ally && ally.modifiers.length > 0 ? ally.modifiers : undefined,
          });
        });
    };
    const sourceLinks = (factionId: string, alreadyLinked: readonly string[]): BsNode[] =>
      [...pieces.get(factionId)!.sources]
        .filter((source) => source !== root && !alreadyLinked.includes(source))
        .sort()
        .map((source) => ({
          name: BSDATA_IDS.catalogues[source]?.name ?? source,
          id: ctx.ids.id(`catalogue-link:${factionId}:${source}`),
          importRootEntries: false,
          targetId: set.catalogueId(source)!,
          type: "catalogue",
        }));
    const warlord = {
      name: "Warlord",
      id: warlordId,
      hidden: false,
      import: true,
      type: "upgrade",
      categoryLinks: [categoryLink("Warlord", ctx.ids.id(`warlord:${root}:category`), ctx.refs.category("Warlord"), false)],
      constraints: [constraint({ id: ctx.ids.id(`warlord:${root}:max`), type: "max", value: 1, field: "selections", scope: "parent" })],
      costs: [cost("pts", ctx.refs.cost.pts, 0)],
    };
    const container = detachmentContainer(set, ctx, root, root);
    const shared = [
      ...unitEntries,
      ...[...items.values()],
      ...familyDetachments.map((d) => detachmentEntry(set, ctx, root, d, tags.links.get(d.id) ?? [])),
      ...enhancements.map(({ enhancement, detachment }) => enhancementEntry(set, ctx, root, enhancement, detachment)),
      warlord,
      container,
    ];
    const rootAllies = pieces.get(root)!;
    out.push({
      factionId: root,
      file: BSDATA_IDS.catalogues[root].file,
      document: catalogueRoot(ctx, root, set, {
        catalogueLinks: sourceLinks(root, []),
        categoryEntries: [...set.categoryEntries(root), ...tags.entries, ...rootAllies.categoryEntries],
        entryLinks: [
          ...rootLinksFor(root),
          ...rootAllies.rootLinks,
          entryLink({ name: "Detachment", id: ctx.ids.id(`root-link:${root}/detachment`), targetId: container.id as string, type: "selectionEntry" }),
        ],
        sharedSelectionEntries: shared,
      }),
    });
    for (const child of set.familyOf(root).filter((f) => f !== root)) {
      const childContainer = detachmentContainer(set, ctx, child, root);
      const childAllies = pieces.get(child)!;
      out.push({
        factionId: child,
        file: BSDATA_IDS.catalogues[child].file,
        document: catalogueRoot(ctx, child, set, {
          catalogueLinks: [
            { name: BSDATA_IDS.catalogues[root]?.name ?? root, id: ctx.ids.id(`catalogue-link:${child}`), importRootEntries: true, targetId: set.catalogueId(root)!, type: "catalogue" },
            ...sourceLinks(child, [root]),
          ],
          categoryEntries: childAllies.categoryEntries,
          entryLinks: [
            ...rootLinksFor(child),
            ...childAllies.rootLinks,
            entryLink({ name: "Detachment", id: ctx.ids.id(`root-link:${child}/detachment`), targetId: childContainer.id as string, type: "selectionEntry" }),
          ],
          sharedSelectionEntries: [childContainer],
        }),
      });
    }
  }
  return out;
}
