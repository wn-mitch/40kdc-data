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
import type { Detachment, Enhancement, Unit } from "../generated.js";
import { BSDATA_IDS, type IdAllocator } from "./ids.js";
import { itemEntry } from "./items.js";
import {
  BATTLESCRIBE_VERSION,
  categoryLink,
  compact,
  constraint,
  cost,
  entryLink,
  XMLNS_CATALOGUE,
} from "./nodes.js";
import type { BsNode } from "./source.js";
import type { SystemRefs } from "./system.js";
import { allyLocks, allyPieces, allyPlans, hiddenInCatalogues, unitKey, type AllyContext } from "./allies.js";
import { minimumConstraints, tagCategories, barModifiers, baseLimits, doublesLimit, keywordGrantModifiers, type RestrictionContext } from "./restrictions.js";
import { keywordLimitPieces, type KeywordLimitContext, type KeywordLimitPieces } from "./keyword-limits.js";
import { mandateCategories, supremeCommanderLink, warlordLink, type WarlordContext } from "./warlord.js";
import { canTake, detachmentContainer, detachmentEntry, enhancementEntry } from "./detachments.js";
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

function parentOf(dataset: Dataset, factionId: string): string | null {
  return dataset.factions.get(factionId)?.raw.parent_faction_id ?? null;
}

/** Shared state for every catalogue in one export. */
export class CatalogueSet {
  private readonly categoryDefs = new Map<string, Map<string, string>>();
  private readonly hiddenCategories = new Set<string>();
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

  /** A hidden category that groups a unit's wargear entries for a shared cap, defined in the family root's catalogue. */
  hiddenCategory(home: string, key: string, name: string): string {
    const root = this.rootOf(home);
    const id = this.ctx.ids.id(`category:${key}`);
    const defs = this.categoryDefs.get(root) ?? new Map<string, string>();
    if (defs.has(name) && defs.get(name) !== id) throw new Error(`bsdata export: two categories named ${name} in ${root}`);
    defs.set(name, id);
    this.categoryDefs.set(root, defs);
    this.hiddenCategories.add(id);
    return id;
  }

  categoryEntries(root: string): BsNode[] {
    return [...(this.categoryDefs.get(root) ?? new Map<string, string>())]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, id]) => compact({ name, id, hidden: this.hiddenCategories.has(id), ...this.categoryRules.get(id) }));
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
  const viewByEntryId = new Map(ctx.factions.flatMap((f) => ctx.dataset.units.byFaction(f).map((view) => [unitEntryId(view), view] as const)));
  const limitCtx: KeywordLimitContext = { ids: ctx.ids, dataset: ctx.dataset, detachmentEntryId: (d) => set.detachmentEntryId(d) };
  /** `links` with the keyword-limit categories of `host`'s army added to each unit link. */
  const withLimits = (host: string, limits: KeywordLimitPieces, links: readonly BsNode[]): BsNode[] =>
    links.map((link) => {
      const view = viewByEntryId.get(String(link.targetId));
      const extra = view ? limits.linksFor(view.raw, String(link.id)) : [];
      return extra.length === 0 ? link : { ...link, categoryLinks: [...((link.categoryLinks as BsNode[] | undefined) ?? []), ...extra] };
    });
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
    const warlordCtx: WarlordContext = {
      ids: ctx.ids,
      dataset: ctx.dataset,
      refs: ctx.refs,
      detachmentEntryId: (d) => set.detachmentEntryId(d, root),
      detachments: familyDetachments,
      warlordId,
    };
    const unitCtx: UnitBuildContext = {
      ids: ctx.ids,
      dataset: ctx.dataset,
      refs: ctx.refs,
      category: (home, name) => set.category(home, name),
      hiddenCategory: (home, key, name) => set.hiddenCategory(home, key, name),
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
        const warlord = warlordLink(warlordCtx, root, view.raw, entryKey, lockedIn(locks.warlord, view));
        const entryLinks = warlord ? [warlord] : [];
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
        return { entryLinks, groups, categoryLinks: supremeCommanderLink(warlordCtx, view.raw, entryKey) };
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
    const rootLimits = keywordLimitPieces(limitCtx, root);
    const rootUnitLinks = withLimits(root, rootLimits, [...rootLinksFor(root), ...rootAllies.rootLinks]);
    out.push({
      factionId: root,
      file: BSDATA_IDS.catalogues[root].file,
      document: catalogueRoot(ctx, root, set, {
        catalogueLinks: sourceLinks(root, []),
        categoryEntries: [...set.categoryEntries(root), ...tags.entries, ...mandateCategories(warlordCtx, root), ...rootAllies.categoryEntries, ...rootLimits.categoryEntries],
        entryLinks: [
          ...rootUnitLinks,
          entryLink({ name: "Detachment", id: ctx.ids.id(`root-link:${root}/detachment`), targetId: container.id as string, type: "selectionEntry" }),
        ],
        sharedSelectionEntries: shared,
      }),
    });
    for (const child of set.familyOf(root).filter((f) => f !== root)) {
      const childContainer = detachmentContainer(set, ctx, child, root);
      const childAllies = pieces.get(child)!;
      const childLimits = keywordLimitPieces(limitCtx, child);
      // The parent's links are shared by every child army, so they cannot carry a child's caps.
      const unreachable = withLimits(child, childLimits, rootUnitLinks).filter((l, i) => l !== rootUnitLinks[i]);
      if (unreachable.length > 0) throw new Error(`bsdata export: ${child} keyword limits count parent-roster units (${unreachable.map((l) => l.name).join(", ")})`);
      out.push({
        factionId: child,
        file: BSDATA_IDS.catalogues[child].file,
        document: catalogueRoot(ctx, child, set, {
          catalogueLinks: [
            { name: BSDATA_IDS.catalogues[root]?.name ?? root, id: ctx.ids.id(`catalogue-link:${child}`), importRootEntries: true, targetId: set.catalogueId(root)!, type: "catalogue" },
            ...sourceLinks(child, [root]),
          ],
          categoryEntries: [...childAllies.categoryEntries, ...childLimits.categoryEntries],
          entryLinks: [
            ...withLimits(child, childLimits, [...rootLinksFor(child), ...childAllies.rootLinks]),
            entryLink({ name: "Detachment", id: ctx.ids.id(`root-link:${child}/detachment`), targetId: childContainer.id as string, type: "selectionEntry" }),
          ],
          sharedSelectionEntries: [childContainer],
        }),
      });
    }
  }
  return out;
}
