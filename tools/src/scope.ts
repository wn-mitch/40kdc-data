/**
 * Resolve which roster units an ability (typically a detachment rule) benefits,
 * from its curated `applies_to` keyword filter. This is the roster-highlighting
 * contract consumers replicate: all four canonical keyword clauses must hold,
 * compared against the union of its `keywords` and `faction_keywords`.
 * Keywords compare without regard to case or apostrophe style: rules print them uppercase
 * ("LEGIONES DAEMONICA"), which is how `applies_to` spells them, while units
 * store datasheet spelling ("Legiones Daemonica", "T’au Empire").
 *
 * Two distinct "no constraint" forms, both deliberate:
 *   - a `null`/absent filter has no resolvable scope → matches nothing (the app
 *     renders no highlight rather than guess);
 *   - a present empty filter object constrains nothing and matches every unit.
 *
 * Pinned byte-for-byte across the TS/Rust/Python ports by the
 * `conformance/applies-to` corpus (bump `conformance/SPEC_VERSION` on change).
 */

/** The canonical static keyword predicate shared by unit scopes and filters. */
interface KeywordPredicate {
  all_of?: readonly string[];
  any_of?: readonly string[];
  none_of?: readonly string[];
  not_all_of?: readonly string[];
}

/** The curated keyword filter, as carried on `Ability.applies_to`. */
export type AppliesToFilter = KeywordPredicate;

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
  return keywordMatchesPredicate(filter, [...(unit.keywords ?? []), ...(unit.faction_keywords ?? [])]);
}

/** Match all present clauses; empty any_of and not_all_of clauses are false. */
export function keywordMatchesPredicate(filter: KeywordPredicate, keywords: Iterable<string>): boolean {
  const owned = new Set(Array.from(keywords, keywordKey));
  const has = (keyword: string): boolean => owned.has(keywordKey(keyword));
  return (filter.all_of === undefined || filter.all_of.every(has))
    && (filter.any_of === undefined || filter.any_of.some(has))
    && (filter.none_of === undefined || !filter.none_of.some(has))
    && (filter.not_all_of === undefined || !filter.not_all_of.every(has));
}

/** How two keyword spellings compare: uppercase, with a curly apostrophe read as a straight one. */
export function keywordKey(keyword: string): string {
  return keyword.toUpperCase().replaceAll("’", "'");
}
