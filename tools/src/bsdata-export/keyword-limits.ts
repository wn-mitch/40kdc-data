/**
 * A faction's army-wide keyword caps (`keyword_limits`) as hidden categories
 * in its catalogue. Mirrors the keyword-limit check in `roster-resolve.ts`.
 *
 * `units` mode: one category, linked from the army's links to every unit that
 * carries all the keywords and no exempt faction keyword, with a roster-wide
 * maximum. A selected detachment's `keyword_limit_overrides` entry for the same
 * keywords sets the maximum (the largest of the selected ones wins).
 *
 * `alternatives` mode (at most `max` of the keywords may appear): one category
 * per keyword. A keyword's category allows no selections once `max` of the
 * other keywords are present, so the army can never hold `max + 1` of them.
 *
 * A unit's keywords are its roster keywords in this army without detachment
 * grants (see `armyKeywords`).
 */
import type { Dataset } from "../data/dataset.js";
import type { Detachment, Faction, Unit } from "../generated.js";
import type { IdAllocator } from "./ids.js";
import { categoryLink, condition, constraint, modifier } from "./nodes.js";
import { armyKeywords } from "./restrictions.js";
import type { BsNode } from "./source.js";

type KeywordLimit = NonNullable<Faction["keyword_limits"]>[number];

export interface KeywordLimitContext {
  readonly ids: IdAllocator;
  readonly dataset: Dataset;
  readonly detachmentEntryId: (detachmentId: string) => string | undefined;
}

function sameKeywords(a: readonly string[], b: readonly string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

function present(categoryId: string): BsNode {
  return condition({ childId: categoryId, field: "selections", scope: "roster", type: "atLeast", value: 1, includeChildSelections: true, includeChildForces: true });
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, size - 1).map((c) => [first, ...c]), ...combinations(rest, size)];
}

interface Category {
  readonly name: string;
  readonly id: string;
  /** Units are counted when they carry every keyword in this list. */
  readonly keywords: readonly string[];
  readonly exempt: readonly string[];
  readonly entry: BsNode;
}

export interface KeywordLimitPieces {
  readonly categoryEntries: BsNode[];
  /** Category links for a link to `unit` in this army's catalogue. */
  readonly linksFor: (unit: Unit, linkKey: string) => BsNode[];
}

function unitsCategory(ctx: KeywordLimitContext, host: string, limit: KeywordLimit, detachments: readonly Detachment[]): Category {
  const label = [...limit.keywords].sort().join(" + ");
  const key = `keyword-limit:${host}/${label}`;
  const maxId = ctx.ids.id(`${key}:max`);
  const overrides = detachments
    .flatMap((d) => (d.keyword_limit_overrides ?? []).filter((o) => sameKeywords(o.keywords, limit.keywords)).map((o) => ({ entryId: ctx.detachmentEntryId(d.id), max: o.max })))
    .filter((o): o is { entryId: string; max: number } => o.entryId !== undefined)
    .sort((a, b) => a.max - b.max);
  const name = `Limit: ${label}`;
  const id = ctx.ids.id(key);
  return {
    name,
    id,
    keywords: limit.keywords,
    exempt: limit.exempt_faction_keywords ?? [],
    entry: {
      name,
      id,
      hidden: true,
      constraints: [constraint({ id: maxId, type: "max", value: limit.max, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true })],
      ...(overrides.length > 0
        ? {
            modifiers: overrides.map((o) =>
              modifier({ field: maxId, type: "set", value: o.max, conditions: [condition({ childId: o.entryId, field: "selections", scope: "force", type: "atLeast", value: 1, includeChildSelections: true })] }),
            ),
          }
        : {}),
    },
  };
}

function alternativeCategories(ctx: KeywordLimitContext, host: string, limit: KeywordLimit): Category[] {
  const label = limit.keywords.join(" / ");
  const ids = new Map(limit.keywords.map((k) => [k, ctx.ids.id(`keyword-limit:${host}/${label}:${k}`)]));
  return limit.keywords.map((keyword) => {
    const key = `keyword-limit:${host}/${label}:${keyword}`;
    const maxId = ctx.ids.id(`${key}:max`);
    const others = limit.keywords.filter((k) => k !== keyword).map((k) => ids.get(k)!);
    const closing = combinations(others, limit.max);
    const name = `Limit: ${label}: ${keyword}`;
    return {
      name,
      id: ids.get(keyword)!,
      keywords: [keyword],
      exempt: limit.exempt_faction_keywords ?? [],
      entry: {
        name,
        id: ids.get(keyword)!,
        hidden: true,
        constraints: [
          constraint({ id: maxId, type: "max", value: limit.max === 0 ? 0 : -1, field: "selections", scope: "roster", includeChildSelections: true, includeChildForces: true }),
        ],
        ...(limit.max > 0 && closing.length > 0
          ? { modifiers: [modifier({ field: maxId, type: "set", value: 0, conditionGroups: [{ type: "or", conditionGroups: closing.map((c) => ({ type: "and", conditions: c.map(present) })) }] })] }
          : {}),
      },
    };
  });
}

/** The keyword-limit categories for `host`'s army, and the links its unit links carry. */
export function keywordLimitPieces(ctx: KeywordLimitContext, host: string): KeywordLimitPieces {
  const faction = ctx.dataset.factions.get(host)?.raw;
  const detachments = ctx.dataset.detachments.byFaction(host);
  const categories: Category[] = (faction?.keyword_limits ?? []).flatMap((limit) =>
    limit.mode === "alternatives" ? alternativeCategories(ctx, host, limit) : [unitsCategory(ctx, host, limit, detachments)],
  );
  return {
    categoryEntries: categories.map((c) => c.entry),
    linksFor: (unit, linkKey) => {
      if (categories.length === 0) return [];
      const keywords = armyKeywords(ctx.dataset, unit, host, null);
      return categories
        .filter((c) => c.keywords.every((k) => keywords.has(k)) && !(unit.faction_keywords ?? []).some((k) => c.exempt.includes(k)))
        .map((c) => categoryLink(c.name, ctx.ids.id(`${linkKey}:${c.id}`), c.id, false));
    },
  };
}
