import { keywordKey, keywordMatchesPredicate } from "../scope.js";

/** One keyword a bearer gains (`add`) or loses at list building, compared by {@link keywordKey}. */
export interface ListKeywordChange {
  add: boolean;
  key: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const BEARER_REFS = new Set(["this-model", "this-unit"]);
const isBearer = (ref: unknown): boolean => ref === undefined || ref === null || (typeof ref === "string" && BEARER_REFS.has(ref));
const PREDICATE_KEYS = ["all_of", "any_of", "none_of", "not_all_of"] as const;

/**
 * The keyword predicate of an `attachment` condition's `with` filter, when list building can decide
 * it from the attached unit's keywords alone: only the four keyword clauses, a friendly owner and a
 * unit level. `null` when no filter is given; `undefined` when the filter needs more than keywords.
 */
function withPredicate(filter: unknown): Record<string, string[]> | null | undefined {
  if (filter === undefined || filter === null) return null;
  if (!isObject(filter)) return undefined;
  const predicate: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === null) continue;
    if (key === "owner" && value === "friendly") continue;
    if (key === "level" && value === "unit") continue;
    if (!(PREDICATE_KEYS as readonly string[]).includes(key)) return undefined;
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
    predicate[key] = value;
  }
  return predicate;
}

/** The keyword changes of one effect leaf on the bearer, in order; other leaves change no keyword. */
function leafChanges(leaf: Record<string, unknown>): ListKeywordChange[] {
  if (!isBearer(leaf.target) || !isObject(leaf.modifier)) return [];
  const modifier = leaf.modifier;
  if (leaf.type === "keyword-grant" && Array.isArray(modifier.keywords)) {
    return modifier.keywords.filter((k): k is string => typeof k === "string").map((k) => ({ add: true, key: keywordKey(k) }));
  }
  if (leaf.type === "rule-state" && modifier.rule_kind === "keyword" && typeof modifier.rule === "string") {
    if (modifier.direction === "suppressed") return [{ add: false, key: keywordKey(modifier.rule) }];
    if (modifier.direction === "granted") return [{ add: true, key: keywordKey(modifier.rule) }];
  }
  return [];
}

/**
 * The keyword changes an ability makes to its bearer once the bearer is attached to a unit, when
 * attachment alone gates them, so they hold from list building on: an untriggered ability whose
 * effect is a `conditional` on a single `attachment` predicate (role `attached`, the bearer as
 * subject) over a leaf or a `sequence` of leaves. `keyword-grant` adds keywords and a `keyword`
 * `rule-state` suppresses or grants one. Returns `undefined` for any other ability shape (a
 * compound condition such as "in the first battle round, while attached" is not list building),
 * else the predicate the attached unit's keywords must meet (`null` for none) and the changes.
 */
export function attachmentKeywordChanges(
  ability: Record<string, unknown>,
): { predicate: Record<string, string[]> | null; changes: ListKeywordChange[] } | undefined {
  if (ability.trigger !== undefined && ability.trigger !== null) return undefined;
  const effect = ability.effect;
  if (!isObject(effect) || effect.type !== "conditional" || !isObject(effect.condition) || !isObject(effect.effect)) return undefined;
  const condition = effect.condition;
  if (condition.type !== "attachment" || condition.operator !== undefined) return undefined;
  const params = isObject(condition.parameters) ? condition.parameters : {};
  if (params.role !== "attached" || !isBearer(params.subject)) return undefined;
  const predicate = withPredicate(params.with);
  if (predicate === undefined) return undefined;
  const body = effect.effect;
  const leaves = body.type === "sequence" && Array.isArray(body.steps) ? body.steps.filter(isObject) : [body];
  const changes = leaves.flatMap(leafChanges);
  return changes.length > 0 ? { predicate, changes } : undefined;
}

/**
 * The bearer's list-building keyword changes from its own abilities while it is attached to a
 * unit with `attachedToKeywords` (leader or support attachment), in ability then effect order.
 * None when the bearer is not attached.
 */
export function listBuildingKeywordChanges(
  bearerAbilities: readonly Record<string, unknown>[],
  attachedToKeywords: Iterable<string> | undefined,
): ListKeywordChange[] {
  if (attachedToKeywords === undefined) return [];
  const attached = [...attachedToKeywords];
  return bearerAbilities.flatMap((ability) => {
    const gated = attachmentKeywordChanges(ability);
    if (!gated) return [];
    if (gated.predicate !== null && !keywordMatchesPredicate(gated.predicate, attached)) return [];
    return gated.changes;
  });
}

/**
 * Keyword membership over a roster keyword set with list-building changes applied in order. A
 * keyword the set holds keeps the set's exact spelling test; a change matches any spelling.
 */
export function withKeywordChanges(owned: ReadonlySet<string>, changes: readonly ListKeywordChange[]): (keyword: string) => boolean {
  if (changes.length === 0) return (keyword) => owned.has(keyword);
  const removed = new Set<string>();
  const granted = new Set<string>();
  for (const change of changes) {
    if (change.add) {
      granted.add(change.key);
      removed.delete(change.key);
    } else {
      removed.add(change.key);
      granted.delete(change.key);
    }
  }
  return (keyword) => {
    const key = keywordKey(keyword);
    return granted.has(key) || (owned.has(keyword) && !removed.has(key));
  };
}
