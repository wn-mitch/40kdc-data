import type { Enhancement } from "../generated.js";
import { unitAbilityIds } from "./ability-refs.js";

/**
 * Whether a bearer meets an enhancement's eligibility groups: every keyword of one keyword group
 * (`keyword_restriction_groups`, or the flat `keyword_restrictions` as one group), or the datasheet
 * and every keyword of one `datasheet_restriction_groups` entry. An enhancement with no group of
 * either kind admits any bearer. `has` tests one keyword as the record spells it; exclusions are
 * the caller's.
 */
export function meetsEnhancementGroups(enhancement: Enhancement, unitId: string, has: (keyword: string) => boolean): boolean {
  const keywordGroups: readonly (readonly string[])[] = enhancement.keyword_restriction_groups
    ?? (enhancement.keyword_restrictions ? [enhancement.keyword_restrictions] : []);
  const datasheetGroups = enhancement.datasheet_restriction_groups ?? [];
  if (keywordGroups.length === 0 && datasheetGroups.length === 0) return true;
  return keywordGroups.some((group) => group.every(has))
    || datasheetGroups.some((group) => group.unit_id === unitId && (group.keywords ?? []).every(has));
}

/**
 * The core abilities an enhancement requires (`required_ability_ids`, "model with the Deep Strike
 * ability only") that the bearer's datasheet does not list in its `ability_ids`, in the record's order.
 */
export function missingRequiredAbilities(enhancement: Enhancement, bearerAbilityIds: readonly unknown[] | undefined): string[] {
  const held = new Set(unitAbilityIds(bearerAbilityIds));
  return (enhancement.required_ability_ids ?? []).filter((id) => !held.has(id));
}
