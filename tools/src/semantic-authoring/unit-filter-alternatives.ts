import { exactKeys } from "./family-validation.js";
import { normalizeUnitKeywords } from "./unit-filter-family.js";

/**
 * Unit-filter alternatives that differ by more than one keyword: "**LEGIO CYBERNETICA** or
 * **ADEPTUS MECHANICUS VEHICLE** unit", "**PSYKER** or Battle-shocked unit". Each alternative is
 * its own keywords, exclusions and states; the filter's other fields (side, level, its own
 * keywords) hold for every alternative. A unit matches when it matches any one alternative, never
 * the union of their keywords.
 */
export type FilterAlternative = { keywords?: string[]; excluded_keywords?: string[]; states?: string[] };

/** The states an alternative can name, as unit-filter names them. */
export const ALTERNATIVE_STATES = ["unengaged", "battle-shocked", "not-battle-shocked"] as const;

/** One alternative's parameter schema: at least one of its keywords, exclusions and states. */
export const ALTERNATIVE_SCHEMA = {
  type: "object",
  minProperties: 1,
  properties: {
    keywords: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
    excluded_keywords: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
    states: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ALTERNATIVE_STATES } },
  },
  additionalProperties: false,
};

const contains = (outer: readonly string[] | undefined, inner: readonly string[] | undefined) => (inner ?? []).every((item) => (outer ?? []).includes(item));

/** Whether a unit matching `wider` always matches it: `narrower` adds to every one of its requirements. */
function covers(wider: FilterAlternative, narrower: FilterAlternative): boolean {
  return contains(narrower.keywords, wider.keywords) && contains(narrower.excluded_keywords, wider.excluded_keywords) && contains(narrower.states, wider.states);
}

function alternative(value: unknown, label: string, shared: FilterAlternative): FilterAlternative {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is an object of keywords, excluded_keywords and states.`);
  const input = value as Record<string, unknown>;
  const keys = ["keywords", "excluded_keywords", "states"].filter((key) => key in input);
  exactKeys(input, keys, label);
  if (keys.length === 0) throw new TypeError(`${label} names at least one keyword, exclusion or state.`);
  const result: FilterAlternative = {};
  if ("keywords" in input) result.keywords = normalizeUnitKeywords(input.keywords, `${label}.keywords`);
  if ("excluded_keywords" in input) result.excluded_keywords = normalizeUnitKeywords(input.excluded_keywords, `${label}.excluded_keywords`);
  if ("states" in input) {
    const states = input.states;
    if (!Array.isArray(states) || states.length === 0) throw new TypeError(`${label}.states lists at least one state.`);
    for (const state of states) if (!(ALTERNATIVE_STATES as readonly unknown[]).includes(state)) throw new TypeError(`${label}.states must be among ${ALTERNATIVE_STATES.join(", ")}.`);
    if (new Set(states).size !== states.length) throw new TypeError(`${label}.states lists a state twice.`);
    result.states = ALTERNATIVE_STATES.filter((state) => states.includes(state));
  }
  if (result.keywords?.some((keyword) => result.excluded_keywords?.includes(keyword))) throw new TypeError(`${label} both requires and excludes a keyword.`);
  if (result.states?.includes("battle-shocked") && result.states.includes("not-battle-shocked")) throw new TypeError(`${label} cannot be both battle-shocked and not-battle-shocked.`);
  // What the filter itself requires holds for every alternative already; saying it again in one is a second spelling.
  if (result.keywords?.some((keyword) => shared.keywords?.includes(keyword))) throw new TypeError(`${label} repeats a keyword the filter itself requires.`);
  if (result.excluded_keywords?.some((keyword) => shared.keywords?.includes(keyword))) throw new TypeError(`${label} excludes a keyword the filter itself requires.`);
  if (result.keywords?.some((keyword) => shared.excluded_keywords?.includes(keyword))) throw new TypeError(`${label} requires a keyword the filter itself excludes.`);
  if (result.excluded_keywords?.some((keyword) => shared.excluded_keywords?.includes(keyword))) throw new TypeError(`${label} repeats a keyword the filter itself excludes.`);
  if (result.states?.some((state) => shared.states?.includes(state))) throw new TypeError(`${label} repeats a state the filter itself names.`);
  const both = [...(result.states ?? []), ...(shared.states ?? [])];
  if (both.includes("battle-shocked") && both.includes("not-battle-shocked")) throw new TypeError(`${label} cannot be both battle-shocked and not-battle-shocked.`);
  return result;
}

/**
 * Two or more alternatives, each checked against the filter's own (shared) keywords, exclusions
 * and states, in one canonical order so equal sets fingerprint alike. An alternative another one
 * already covers ("A or A B": every A B unit is an A unit) is refused rather than kept.
 */
export function normalizeAlternatives(value: unknown, label: string, shared: FilterAlternative = {}): FilterAlternative[] {
  if (!Array.isArray(value) || value.length < 2) throw new TypeError(`${label} lists two or more alternatives.`);
  const list = value.map((item, index) => alternative(item, `${label}[${index}]`, shared));
  const keyed = list.map((item) => JSON.stringify(item));
  if (new Set(keyed).size !== keyed.length) throw new TypeError(`${label} lists an alternative twice.`);
  list.forEach((one, i) => list.forEach((other, j) => {
    if (i !== j && covers(one, other)) throw new TypeError(`${label}[${j}] adds nothing: every unit it matches also matches ${label}[${i}].`);
  }));
  return list.map((item, index) => ({ item, key: keyed[index]! })).sort((a, b) => a.key.localeCompare(b.key)).map(({ item }) => item);
}

/** Alternatives that are each one keyword and nothing else: one any-of says them. */
export function singleKeywordAlternatives(list: readonly FilterAlternative[]): string[] | null {
  if (!list.every((item) => item.keywords?.length === 1 && item.excluded_keywords === undefined && item.states === undefined)) return null;
  return list.map((item) => item.keywords![0]!).sort();
}

/** One alternative as the DSL's unit-filter fields: keywords, exclusions, and states (unengaged is not engaged). */
export function dslAlternative(item: FilterAlternative): Record<string, unknown> {
  const negated = [...(item.states?.includes("unengaged") ? ["engaged"] : []), ...(item.states?.includes("not-battle-shocked") ? ["battle-shocked"] : [])];
  return {
    ...(item.keywords?.length ? { all_of: item.keywords } : {}),
    ...(item.excluded_keywords?.length ? { none_of: item.excluded_keywords } : {}),
    ...(item.states?.includes("battle-shocked") ? { state: "battle-shocked" } : {}),
    ...(negated.length ? { not_states: negated } : {}),
  };
}
