import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue, exactKeys } from "./family-validation.js";

/**
 * Psychic abilities. "Psychic Ability (psychic level N)" names a cost in its heading: the bearer
 * can use the ability only if its unit's psychic-level pool holds N, and using it spends N
 * (compile-psychic-cost.ts). The maximum is a sanity bound: the rules print none.
 */

export const PSYCHIC_COST_FAMILY = "psychic-level-cost";

/**
 * Rituals (compile-ritual-menu.ts). "can attempt Rituals from those listed" opens the menu; its Psychic
 * test is the dice rolls, the doubles check and the manifest rule printed before the first Ritual, and
 * each Ritual is a named option with its Warp Charge. Inside a Ritual, "the Psychic test result for this
 * Ritual was 10+" is a roll-total on the test's roll.
 */
export const RITUAL_MENU_OPEN = "ritual-menu-open";
export const RITUAL_MANIFEST = "ritual-manifest";
export const TEST_DOUBLES = "test-doubles";
export const ROLL_TOTAL = "roll-total";
/** The roll a ritual-menu binds its Psychic test to, which a Ritual's roll-total reads. */
export const PSYCHIC_TEST_ROLL = "psychic-test";
/** The highest total a roll-total names: 2D6 and one more D6. */
const MAX_TEST_TOTAL = 18;

/** The highest psychic level the schema accepts. A higher level is a new reading to review, not a value to lower. */
const MAX_PSYCHIC_LEVEL = 6;

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
  {
    id: RITUAL_MENU_OPEN,
    version: 1,
    role: "EFFECT",
    label: "Ritual menu",
    description: "\"can attempt Rituals from those listed\": the Rituals after it are named options (each with its Warp Charge), attempted with the Psychic test printed between this leaf and the first Ritual. Takes no parameters.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    id: RITUAL_MANIFEST,
    version: 1,
    role: "COMBINATOR",
    label: "Ritual manifests",
    description: "\"If that model is not destroyed, the combined total of all the dice … is the Psychic test result. If this equals or exceeds the Warp Charge value …, that model manifests that Ritual\": the rule that closes a ritual menu's Psychic test. Takes no parameters.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    id: TEST_DOUBLES,
    version: 1,
    role: "CONDITION",
    label: "Test rolled a double",
    description: "\"if one or more doubles or triples were rolled during this test\": any two of the test's dice show the same result (a triple holds a double). Only a ritual menu's Psychic test reads it.",
    starter: { on: "double" },
    parameterSchema: { type: "object", required: ["on"], properties: { on: { enum: ["double"] } }, additionalProperties: false },
  },
  {
    id: ROLL_TOTAL,
    version: 1,
    role: "CONDITION",
    label: "Roll total is at least",
    description: "\"If the Psychic test result for this Ritual was 10+\": the total of the named roll is at least min. roll_var psychic-test is a ritual menu's Psychic test.",
    starter: { roll_var: PSYCHIC_TEST_ROLL, min: 10 },
    parameterSchema: {
      type: "object",
      required: ["roll_var", "min"],
      properties: { roll_var: { enum: [PSYCHIC_TEST_ROLL] }, min: { type: "integer", minimum: 2, maximum: MAX_TEST_TOTAL } },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise parameters for a psychic family, or null when the family is not one. */
export function normalizePsychicParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case PSYCHIC_COST_FAMILY:
      exactKeys(input, ["level"], family);
      return { level: boundedInteger(input.level, 1, MAX_PSYCHIC_LEVEL, "psychic-level-cost.level") };
    case RITUAL_MENU_OPEN:
    case RITUAL_MANIFEST:
      exactKeys(input, [], family);
      return {};
    case TEST_DOUBLES:
      exactKeys(input, ["on"], family);
      return { on: enumValue(input.on, ["double"], "test-doubles.on") };
    case ROLL_TOTAL:
      exactKeys(input, ["roll_var", "min"], family);
      return { roll_var: enumValue(input.roll_var, [PSYCHIC_TEST_ROLL], "roll-total.roll_var"), min: boundedInteger(input.min, 2, MAX_TEST_TOTAL, "roll-total.min") };
    default:
      return null;
  }
}
