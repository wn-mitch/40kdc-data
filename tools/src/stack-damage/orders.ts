import type { Dataset } from "../data/dataset.js";
import type { UnitLookup } from "./stratagem-eligibility.js";

/** An Officer's Orders ability: the datasheets that hold it and the units it may order. */
interface OrderIssuer {
  readonly unitIds: readonly string[];
  readonly eligible: unknown;
}

const ISSUERS = new WeakMap<Dataset, Map<string, readonly OrderIssuer[]>>();

/**
 * The Orders abilities that draw their menu from `armyRuleId` (an `issue-orders` node with
 * `menu_from`), wherever the node sits in the ability's effect.
 */
function orderIssuers(dataset: Dataset, armyRuleId: string): readonly OrderIssuer[] {
  let byRule = ISSUERS.get(dataset);
  if (!byRule) ISSUERS.set(dataset, (byRule = new Map()));
  const cached = byRule.get(armyRuleId);
  if (cached) return cached;
  const issuers: OrderIssuer[] = [];
  for (const ability of dataset.abilities) {
    const unitIds = ability.raw.unit_ids ?? [];
    if (unitIds.length === 0) continue;
    for (const node of issueOrderNodes(ability.raw.effect)) {
      if (node.menu_from === armyRuleId) issuers.push({ unitIds, eligible: node.eligible });
    }
  }
  byRule.set(armyRuleId, issuers);
  return issuers;
}

function issueOrderNodes(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) issueOrderNodes(item, out);
  } else if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.type === "issue-orders") out.push(record);
    for (const value of Object.values(record)) issueOrderNodes(value, out);
  }
  return out;
}

/** Whether a keyword filter (`all_of`/`any_of`/`none_of`) holds for `keywords`; absent holds. */
function eligibleHolds(filter: unknown, keywords: ReadonlySet<string>): boolean {
  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) return true;
  const list = (key: string): string[] => {
    const value = (filter as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase()) : [];
  };
  const anyOf = list("any_of");
  return list("all_of").every((keyword) => keywords.has(keyword))
    && (anyOf.length === 0 || anyOf.some((keyword) => keywords.has(keyword)))
    && !list("none_of").some((keyword) => keywords.has(keyword));
}

/**
 * The keywords the combined unit of `ids` carries in `detachmentId`, lower-cased: printed and
 * faction keywords plus conditional keywords that detachment grants.
 */
export function combinedKeywords(ids: readonly string[], units: UnitLookup, detachmentId: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const unit = units(id);
    if (!unit) continue;
    const conditional = (unit.conditional_keywords ?? [])
      .filter((entry) => entry.required_detachment_id == null || entry.required_detachment_id === detachmentId)
      .map((entry) => entry.keyword);
    for (const keyword of [...(unit.keywords ?? []), ...(unit.faction_keywords ?? []), ...conditional]) out.add(keyword.toLowerCase());
  }
  return out;
}

/**
 * The units among `candidates` that can issue `armyRuleId`'s Orders to the unit carrying
 * `receiverKeywords`: holders of an Orders ability that draws its menu from the rule (an
 * `issue-orders` node with `menu_from`) whose `eligible` filter the unit satisfies. A rule no
 * Orders ability draws on is issued by its own `unit_ids` holders, with no receiver filter.
 */
export function orderIssuingUnits(dataset: Dataset, armyRuleId: string, candidates: Iterable<string>, receiverKeywords: ReadonlySet<string>): string[] {
  const issuers = orderIssuers(dataset, armyRuleId);
  const holders = issuers.length > 0
    ? new Set(issuers.filter((issuer) => eligibleHolds(issuer.eligible, receiverKeywords)).flatMap((issuer) => issuer.unitIds))
    : new Set(dataset.abilities.get(armyRuleId)?.raw.unit_ids ?? []);
  return [...new Set(candidates)].filter((id) => holders.has(id));
}

/**
 * Whether an army rule's Orders reach the unit carrying `receiverKeywords` from a unit in
 * `present` (the stack's members or supporting units). A rule with no listed issuer needs none.
 */
export function ordersReach(dataset: Dataset, armyRuleId: string, present: ReadonlySet<string>, receiverKeywords: ReadonlySet<string>): boolean {
  if (orderIssuers(dataset, armyRuleId).length === 0 && (dataset.abilities.get(armyRuleId)?.raw.unit_ids ?? []).length === 0) return true;
  return orderIssuingUnits(dataset, armyRuleId, present, receiverKeywords).length > 0;
}

/** Whether `abilityId` is a rule that issues Orders. */
export function issuesOrders(dataset: Dataset, abilityId: string): boolean {
  return issueOrderNodes(dataset.abilities.get(abilityId)?.raw.effect).length > 0;
}
