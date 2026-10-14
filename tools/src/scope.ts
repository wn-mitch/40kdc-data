/**
 * Resolve which roster units an ability (typically a detachment rule) benefits,
 * from its curated `applies_to` keyword filter. This is the roster-highlighting
 * contract consumers replicate: a unit matches iff it carries every
 * `required_keywords` entry and none of the `excluded_keywords`, compared
 * against the union of its `keywords` and `faction_keywords`. Keywords compare
 * without regard to case or apostrophe style: rules print them uppercase
 * ("LEGIONES DAEMONICA"), which is how `applies_to` spells them, while units
 * store datasheet spelling ("Legiones Daemonica", "T’au Empire").
 *
 * Two distinct "no constraint" forms, both deliberate:
 *   - a `null`/absent filter has no resolvable scope → matches nothing (the app
 *     renders no highlight rather than guess);
 *   - a present filter object with neither keyword list constrains nothing →
 *     matches every unit (vacuous required/excluded sets).
 *
 * Pinned byte-for-byte across the TS/Rust/Python ports by the
 * `conformance/applies-to` corpus (bump `conformance/SPEC_VERSION` on change).
 */

/** The curated keyword filter, as carried on `Ability.applies_to`. */
export interface AppliesToFilter {
  required_keywords?: string[];
  excluded_keywords?: string[];
}

/** The keyword-bearing fields of a unit a filter is matched against. */
export interface UnitKeywordSource {
  keywords?: string[];
  faction_keywords?: string[];
}

/** True when `unit` falls within `filter`'s scope. See module docs for semantics. */
export function unitMatchesAppliesTo(
  filter: AppliesToFilter | null | undefined,
  unit: UnitKeywordSource,
): boolean {
  if (filter == null) return false;
  const owned = new Set<string>([...(unit.keywords ?? []), ...(unit.faction_keywords ?? [])].map(keywordKey));
  for (const kw of filter.required_keywords ?? []) {
    if (!owned.has(keywordKey(kw))) return false;
  }
  for (const kw of filter.excluded_keywords ?? []) {
    if (owned.has(keywordKey(kw))) return false;
  }
  return true;
}

/** How two keyword spellings compare: uppercase, with a curly apostrophe read as a straight one. */
export function keywordKey(keyword: string): string {
  return keyword.toUpperCase().replaceAll("’", "'");
}
