import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { dslAlternative, type FilterAlternative, normalizeAlternatives, singleKeywordAlternatives } from "./unit-filter-alternatives.js";

/**
 * Unit-filter alternatives ("**A** or **B C** unit") through compilation: alternatives written as
 * separate filter leaves join into one filter's `alternatives`, and a filter's alternatives lower
 * to the DSL's `any_of_filters`, or to `any_of` when each is one keyword and nothing else. A unit
 * matches any one alternative; their keywords are never pooled into one requirement.
 */

type FilterParameters = {
  side?: string; keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; states?: string[]; visible?: boolean; other?: boolean;
  level?: string; held_in?: string; excluded_abilities?: string[]; excluded_all_keywords?: string[]; alternatives?: FilterAlternative[];
};

const sorted = (list: readonly string[] | undefined) => [...(list ?? [])].sort();
const shared = (lists: ReadonlyArray<readonly string[] | undefined>) => sorted((lists[0] ?? []).filter((item) => lists.every((list) => (list ?? []).includes(item))));
const without = (list: readonly string[] | undefined, drop: readonly string[]) => (list ?? []).filter((item) => !drop.includes(item));

/**
 * One unit-filter for alternatives written as separate filters ("**HERETIC ASTARTES INFANTRY**
 * (excluding **DAMNED** units) or **HERETIC ASTARTES MOUNTED** unit"): what every alternative
 * names stays the filter's own; the rest of each alternative, its exclusions and states included,
 * becomes one item of `alternatives`. Alternatives that are each one other keyword become an
 * any-of. Alternatives on different sides, of models and units, or differing in where a unit is
 * held, visibility, "other" or an all-of or ability exclusion have no one filter, so they fail
 * rather than narrow to units that are both.
 */
export function alternativeFilter(filters: readonly CompileLeaf[]): CompileLeaf {
  const params = filters.map((filter) => filter.parameters as FilterParameters);
  const fail = (why: string): never => { throw new CompileError(`Alternative unit-filters (A or B) ${why}; one DSL unit-filter cannot say them.`); };
  const same = (pick: (p: FilterParameters) => unknown) => params.every((p) => JSON.stringify(pick(p) ?? null) === JSON.stringify(pick(params[0]!) ?? null));
  const sides = new Set(params.map((p) => p.side).filter((value) => value !== "any"));
  if (sides.size > 1) fail("are on different sides");
  if (!same((p) => p.level ?? "unit")) fail("name both models and units");
  if (!same((p) => p.held_in) || !same((p) => p.visible === true) || !same((p) => p.other === true)) fail("differ in where a unit is held, visibility or \"other\"");
  if (!same((p) => sorted(p.excluded_all_keywords)) || !same((p) => sorted(p.excluded_abilities))) fail("exclude different keyword sets or abilities");
  if (params.some((p) => p.any_keywords?.length || p.alternatives?.length)) fail("already hold alternatives of their own");
  const common = {
    keywords: shared(params.map((p) => p.keywords)),
    excluded_keywords: shared(params.map((p) => p.excluded_keywords)),
    states: shared(params.map((p) => p.states)),
  };
  const alternatives = params.map((p): FilterAlternative => {
    const keywords = without(p.keywords, common.keywords);
    const excluded = without(p.excluded_keywords, common.excluded_keywords);
    const states = without(p.states, common.states);
    return { ...(keywords.length ? { keywords } : {}), ...(excluded.length ? { excluded_keywords: excluded } : {}), ...(states.length ? { states } : {}) };
  });
  if (alternatives.some((item) => Object.keys(item).length === 0)) fail("include one that names nothing beyond what every alternative names");
  const { keywords: _k, excluded_keywords: _e, states: _s, ...rest } = params[0]!;
  const parameters: Record<string, unknown> = { ...rest, side: [...sides][0] ?? "any" };
  if (common.keywords.length) parameters.keywords = common.keywords;
  if (common.excluded_keywords.length) parameters.excluded_keywords = common.excluded_keywords;
  if (common.states.length) parameters.states = common.states;
  let normalized: FilterAlternative[];
  try {
    normalized = normalizeAlternatives(alternatives, "alternatives", common);
  } catch (error) {
    return fail(`do not form distinct alternatives (${(error as Error).message})`);
  }
  const anyOf = singleKeywordAlternatives(normalized);
  if (anyOf !== null) parameters.any_keywords = anyOf;
  else parameters.alternatives = normalized;
  return { ...filters[0]!, end_byte: filters.at(-1)!.end_byte, parameters };
}

/** A filter's alternatives that are each one keyword and nothing else, as the any-of they are. */
export function collapsedAlternatives(parameters: Record<string, unknown>): Record<string, unknown> {
  const list = parameters.alternatives as FilterAlternative[] | undefined;
  if (list === undefined) return parameters;
  const anyOf = singleKeywordAlternatives(list);
  if (anyOf === null) return parameters;
  if (parameters.any_keywords !== undefined) throw new CompileError("A unit-filter holds one any-of; it cannot also hold alternatives.");
  const { alternatives: _alternatives, ...rest } = parameters;
  return { ...rest, any_keywords: anyOf };
}

/** Alternatives as the DSL unit-filter field that says them: `any_of` when each is one keyword, else `any_of_filters`. */
export function dslAlternatives(list: readonly FilterAlternative[] | undefined): Record<string, unknown> {
  if (list === undefined || list.length === 0) return {};
  const anyOf = singleKeywordAlternatives(list);
  return anyOf !== null ? { any_of: anyOf } : { any_of_filters: list.map(dslAlternative) };
}
