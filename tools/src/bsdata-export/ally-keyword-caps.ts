/**
 * An allied rule's per-keyword unit caps (`keyword_limits`) as hidden
 * categories in the host catalogue. Mirrors `allyKeywordLimitViolations` in
 * `roster-allies.ts`; keywords match case-insensitively.
 *
 * - Each limited keyword gets a category with a force-wide maximum per battle
 *   size. The allied offers of units carrying the keyword link it.
 * - An exemption (`exemptions` on a cap) raises that cap by one for each pair
 *   of an included donor and an included receiver: one modifier per pair count
 *   `k`, applying while at least `k` donors and `k` receivers are selected, as
 *   BSData writes its Retinue exemptions. `k` runs up to the most pairs the
 *   datasheet limits allow (see `pairBound`), so the cap equals the package's
 *   count of exempted units.
 * - Alternatives (`keyword_limits_exclusive`): a keyword's cap drops to 0 once
 *   any other limited keyword's category has a selection, so the included
 *   units can carry only one of the keywords.
 */
import type { UnitView } from "../data/entities.js";
import type { AlliedRule, Unit } from "../generated.js";
import type { IdAllocator } from "./ids.js";
import { baseLimits } from "./restrictions.js";
import { compact, condition, constraint, modifier } from "./nodes.js";
import type { BsNode } from "./source.js";
import type { SystemRefs } from "./system.js";
import { isEpicHero } from "./unit.js";

export type Size = "incursion" | "strike-force";
export const SIZES: readonly Size[] = ["incursion", "strike-force"];

type Exemption = NonNullable<NonNullable<AlliedRule["keyword_limits"]>[number]["exemptions"]>[number];

export interface AllyCapContext {
  readonly ids: IdAllocator;
  readonly refs: SystemRefs;
}

/** A unit's keywords and faction keywords, lower-cased. */
export function unitKeywords(unit: Unit): Set<string> {
  return new Set([...(unit.keywords ?? []), ...(unit.faction_keywords ?? [])].map((k) => k.toLowerCase()));
}

function hasAll(keywords: ReadonlySet<string>, need: readonly string[]): boolean {
  return need.every((k) => keywords.has(k.toLowerCase()));
}

function sizeSelected(ctx: AllyCapContext, size: Size): BsNode {
  return condition({ childId: ctx.refs.battleSize[size], field: "selections", scope: "roster", type: "atLeast", value: 1, includeChildSelections: true, includeChildForces: true });
}

function atLeast(categoryId: string, value: number): BsNode {
  return condition({ childId: categoryId, field: "selections", scope: "force", type: "atLeast", value, includeChildSelections: true });
}

/** The most selections of `unit` one army can hold at `size`, doubled limits included. */
function selectionBound(unit: Unit, size: Size): number {
  if (isEpicHero(unit)) return 1;
  const limits = baseLimits(true);
  return size === "incursion" ? limits.incursion : limits.strike;
}

/**
 * The most donor/receiver pairs a list can include at `size`: the fewer of the
 * selections the pool's donor and receiver datasheets allow. The donors' own
 * caps (Character) do not bound it, so a list over those caps exempts as many
 * units as the package does and reports only the caps it breaks.
 */
function pairBound(units: readonly UnitView[], exemption: Exemption, limitKeyword: string, size: Size): number {
  const donors = units.filter((u) => hasAll(unitKeywords(u.raw), exemption.donor_keywords));
  const receivers = units.filter((u) => hasAll(unitKeywords(u.raw), [...exemption.receiver_keywords, limitKeyword]));
  const sum = (list: readonly UnitView[]): number => list.reduce((total, u) => total + selectionBound(u.raw, size), 0);
  return Math.min(sum(donors), sum(receivers));
}

/** Throws when two exemptions of one cap share a receiver: the package then exempts greedily, which a count per pair cannot follow. */
function checkDisjoint(rule: AlliedRule, units: readonly UnitView[], keyword: string, exemptions: readonly Exemption[]): void {
  for (const unit of units) {
    const keywords = unitKeywords(unit.raw);
    const receiving = exemptions.filter((e) => hasAll(keywords, e.receiver_keywords));
    if (receiving.length > 1) throw new Error(`allied rule ${rule.id}: ${unit.id} receives more than one ${keyword} exemption`);
  }
}

export interface AllyCapCategory {
  readonly name: string;
  readonly id: string;
  /** Names the category among the rule's, for the ids of the links to it. */
  readonly key: string;
  /** The keywords (lower-cased) a unit carries, all of them, to be linked. */
  readonly keywords: readonly string[];
}

export interface AllyCaps {
  readonly categoryEntries: BsNode[];
  /** The categories a unit's offer links. */
  readonly linksFor: (unit: Unit) => AllyCapCategory[];
}

/** The keyword-cap categories of one allied rule in one host catalogue; `key` and `label` name the rule there. */
export function allyKeywordCaps(ctx: AllyCapContext, key: string, label: string, rule: AlliedRule, units: readonly UnitView[]): AllyCaps {
  const limits = (rule.keyword_limits ?? []).filter((l) => SIZES.includes(l.battle_size as Size));
  const keywords = [...new Set((rule.keyword_limits ?? []).map((l) => l.keyword))];
  const categoryIds = new Map(keywords.map((k) => [k, ctx.ids.id(`${key}:keyword-category:${k}`)]));
  const linked: AllyCapCategory[] = [];
  const entries: BsNode[] = [];
  const pairCategories = new Map<string, AllyCapCategory>();
  /** The hidden category counting an exemption's donors or receivers. */
  const pairCategory = (role: "donor" | "receiver", need: readonly string[]): AllyCapCategory => {
    const signature = `${role}:${[...need].sort().join("+")}`;
    const existing = pairCategories.get(signature);
    if (existing) return existing;
    const name = `${label}: ${role === "donor" ? "Exemption donor" : "Exemption receiver"}: ${need.join(" + ")}`;
    const category = { name, id: ctx.ids.id(`${key}:exemption:${signature}`), key: `exemption:${signature}`, keywords: need.map((k) => k.toLowerCase()) };
    pairCategories.set(signature, category);
    entries.push({ name, id: category.id, hidden: true });
    linked.push(category);
    return category;
  };
  for (const keyword of keywords) {
    const id = categoryIds.get(keyword)!;
    const rows = limits.filter((l) => l.keyword === keyword);
    const capAt = (size: Size) => rows.find((r) => r.battle_size === size);
    const strike = capAt("strike-force")?.max_count;
    const capped = rows.length > 0 || rule.keyword_limits_exclusive === true;
    const maxId = ctx.ids.id(`${key}:keyword:${keyword}`);
    const modifiers: BsNode[] = [];
    const incursion = capAt("incursion")?.max_count;
    if (incursion !== undefined && incursion !== (strike ?? Number.MAX_SAFE_INTEGER)) {
      modifiers.push(modifier({ field: maxId, type: "set", value: incursion, conditions: [sizeSelected(ctx, "incursion")] }));
    }
    for (const row of rows) {
      const size = row.battle_size as Size;
      const exemptions = row.exemptions ?? [];
      checkDisjoint(rule, units, keyword, exemptions);
      for (const exemption of exemptions) {
        const donor = pairCategory("donor", exemption.donor_keywords);
        const receiver = pairCategory("receiver", [...exemption.receiver_keywords, keyword]);
        for (let k = 1; k <= pairBound(units, exemption, keyword, size); k++) {
          modifiers.push(
            modifier({ field: maxId, type: "increment", value: 1, conditionGroups: [{ type: "and", conditions: [sizeSelected(ctx, size), atLeast(donor.id, k), atLeast(receiver.id, k)] }] }),
          );
        }
      }
    }
    if (rule.keyword_limits_exclusive) {
      const others = keywords.filter((k) => k !== keyword).map((k) => categoryIds.get(k)!);
      if (others.length > 0) modifiers.push(modifier({ field: maxId, type: "set", value: 0, conditionGroups: [{ type: "or", conditions: others.map((o) => atLeast(o, 1)) }] }));
    }
    const name = `${label}: ${keyword}`;
    entries.push(
      compact({
        name,
        id,
        hidden: true,
        constraints: capped ? [constraint({ id: maxId, type: "max", value: strike ?? -1, field: "selections", scope: "force", includeChildSelections: true })] : [],
        modifiers,
      }),
    );
    linked.push({ name, id, key: `keyword:${keyword}`, keywords: [keyword.toLowerCase()] });
  }
  return {
    categoryEntries: entries,
    linksFor: (unit) => {
      const have = unitKeywords(unit);
      return linked.filter((c) => c.keywords.every((k) => have.has(k)));
    },
  };
}
