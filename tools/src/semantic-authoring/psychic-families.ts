import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, exactKeys } from "./family-validation.js";

/**
 * Psychic abilities. "Psychic Ability (psychic level N)" names a cost in its heading: the bearer
 * can use the ability only if its unit's psychic-level pool holds N, and using it spends N
 * (compile-psychic-cost.ts). The maximum is a sanity bound: the rules print none.
 */

export const PSYCHIC_COST_FAMILY = "psychic-level-cost";

/** The highest psychic level the schema accepts. A higher level is a new reading to review, not a value to lower. */
export const MAX_PSYCHIC_LEVEL = 6;

export const PSYCHIC_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: PSYCHIC_COST_FAMILY,
    version: 1,
    role: "RESTRICTION",
    label: "Psychic level cost",
    description: "The psychic level a psychic ability costs (\"psychic level 2\" in its heading). The ability can be used only while the unit's psychic-level pool holds that many, and each use spends them.",
    starter: { level: 1 },
    parameterSchema: {
      type: "object",
      required: ["level"],
      properties: { level: { type: "integer", minimum: 1, maximum: MAX_PSYCHIC_LEVEL } },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise parameters for a psychic family, or null when the family is not one. */
export function normalizePsychicParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== PSYCHIC_COST_FAMILY) return null;
  exactKeys(input, ["level"], family);
  return { level: boundedInteger(input.level, 1, MAX_PSYCHIC_LEVEL, "psychic-level-cost.level") };
}
