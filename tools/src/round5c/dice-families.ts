import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue, exactKeys } from "./family-validation.js";

/**
 * Dice, mortal wounds, and fighting on death. A roll is its own leaf ("roll one D6"); each
 * result band ("on a 4+", "on a 2-5") is a condition that gates the effects of its clause, and
 * the compiler turns the bands into the DSL's dice-gated or dice-table. Fighting on death keeps
 * its roll and eligibility inside itself, because each destroyed model rolls separately.
 */

export const DICE = ["D3", "D6", "2D6"] as const;
export const DICE_FACES: Record<string, number> = { D3: 3, D6: 6, "2D6": 12 };
export const WOUND_COUNTS = ["1", "2", "3", "D3", "D6", "D3+3", "2D6"] as const;
export const MORTAL_RECIPIENTS = ["target", "that-unit", "this-unit", "this-model"] as const;
export const FIGHT_ON_DEATH_TIMING = ["when-its-unit-fights", "after-the-attacking-unit-finishes"] as const;

export const DICE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "dice-roll",
    version: 1,
    role: "EVENT",
    label: "Roll dice",
    description: "\"Roll one D6\": the result bands that follow (on a 4+, on a 2-5) say what happens for each result.",
    starter: { dice: "" },
    parameterSchema: { type: "object", required: ["dice"], properties: { dice: { enum: DICE } }, additionalProperties: false },
  },
  {
    id: "roll-result",
    version: 1,
    role: "CONDITION",
    label: "On a roll of",
    description: "The result band of the roll: \"on a 4+\" is 4 to 6 on a D6, \"on a 2-5\" is 2 to 5, \"on a 6\" is 6 to 6.",
    starter: { from: null, to: null },
    parameterSchema: {
      type: "object",
      required: ["from", "to"],
      properties: { from: { type: "integer", minimum: 1, maximum: 12 }, to: { type: "integer", minimum: 1, maximum: 12 } },
      additionalProperties: false,
    },
  },
  {
    id: "mortal-wounds",
    version: 1,
    role: "EFFECT",
    label: "Mortal wounds",
    description: "A unit suffers mortal wounds: the attack's target, the unit selected earlier (\"that unit\"), this unit, or this model.",
    starter: { recipient: "", count: "" },
    parameterSchema: {
      type: "object",
      required: ["recipient", "count"],
      properties: { recipient: { enum: MORTAL_RECIPIENTS }, count: { enum: WOUND_COUNTS } },
      additionalProperties: false,
    },
  },
  {
    id: "fight-on-death",
    version: 1,
    role: "EFFECT",
    label: "Fights after being destroyed",
    description: "\"Do not remove it from play; that destroyed model can fight …\": when its unit fights, or after the attacking unit finishes. A roll and a \"has not fought\" condition before it limit which destroyed models do.",
    starter: { timing: "" },
    parameterSchema: { type: "object", required: ["timing"], properties: { timing: { enum: FIGHT_ON_DEATH_TIMING } }, additionalProperties: false },
  },
];

export function normalizeDiceParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case "dice-roll":
      exactKeys(input, ["dice"], family);
      return { dice: enumValue(input.dice, DICE, "dice-roll.dice") };
    case "roll-result": {
      exactKeys(input, ["from", "to"], family);
      const from = boundedInteger(input.from, 1, 12, "roll-result.from");
      const to = boundedInteger(input.to, from, 12, "roll-result.to");
      return { from, to };
    }
    case "mortal-wounds":
      exactKeys(input, ["recipient", "count"], family);
      return { recipient: enumValue(input.recipient, MORTAL_RECIPIENTS, "mortal-wounds.recipient"), count: enumValue(input.count, WOUND_COUNTS, "mortal-wounds.count") };
    case "fight-on-death":
      exactKeys(input, ["timing"], family);
      return { timing: enumValue(input.timing, FIGHT_ON_DEATH_TIMING, "fight-on-death.timing") };
    default:
      return null;
  }
}
