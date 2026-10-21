import type { SemanticFamilyDefinition } from "./contracts.js";
import { DICE } from "./family-extension-helpers.js";
import { MODEL_CHARACTERISTICS, WEAPON_CHARACTERISTICS } from "./effect-families.js";
import { boundedInteger, enumSet, exactKeys } from "./family-validation.js";

/**
 * The amount of a characteristic change whose recipient filter sits between the change and the
 * amount ("… raise the Zorn characteristic of K models from your army by 2"), and the floor a
 * parenthesis after a change puts on some of its characteristics. Each is a qualifier with the
 * CONDITION role: the binder (compile-characteristic-amount.ts) consumes it
 * before any role-based pass, so the role never reaches lowering.
 */
/** The characteristics a floor can name: those a characteristic change lowers. */
const FLOOR_CHARACTERISTICS = [...MODEL_CHARACTERISTICS, ...WEAPON_CHARACTERISTICS];

export const CHARACTERISTIC_AMOUNT_FAMILIES: SemanticFamilyDefinition[] = [
  {
    id: "characteristic-amount",
    version: 1,
    role: "CONDITION",
    label: "Amount of a characteristic change",
    description: "\"by 2\" or \"by D6+1\" after a characteristic change that has no amount and a recipient filter before this leaf: the amount the change applies. Takes the same amount types as a characteristic change: a whole number from 1, or a dice amount (D3, D6, D6+1). The binder sets it on the change and drops this leaf.",
    starter: { value: 1 },
    parameterSchema: {
      type: "object",
      required: ["value"],
      properties: {
        value: { anyOf: [{ type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, { type: "string", pattern: DICE.source }] },
      },
      additionalProperties: false,
    },
  },
  {
    id: "characteristic-floor",
    version: 1,
    role: "CONDITION",
    label: "Floor on a lowered characteristic",
    description: "\"(this rule can only worsen a model's Objective Control characteristic to a minimum of 1)\": the characteristic change right before this leaf never lowers these characteristics below minimum. It names one or more of the change's own characteristics; the others it lowers keep no floor. Only for a subtract or worsen. The binder sets the floor on the change and drops this leaf.",
    starter: { characteristics: [], minimum: 1 },
    parameterSchema: {
      type: "object",
      required: ["characteristics", "minimum"],
      properties: {
        characteristics: { type: "array", minItems: 1, uniqueItems: true, items: { enum: FLOOR_CHARACTERISTICS } },
        minimum: { type: "integer", minimum: 0, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise a characteristic-amount or -floor leaf's parameters, or return null for other families. */
export function normalizeCharacteristicAmountParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family === "characteristic-floor") {
    exactKeys(input, ["characteristics", "minimum"], family);
    const characteristics = enumSet(input.characteristics, FLOOR_CHARACTERISTICS, "characteristic-floor.characteristics");
    return { characteristics, minimum: boundedInteger(input.minimum, 0, 20, "characteristic-floor.minimum") };
  }
  if (family !== "characteristic-amount") return null;
  exactKeys(input, ["value"], family);
  const { value } = input;
  if (typeof value === "string") {
    const dice = value.trim().toUpperCase();
    if (!DICE.test(dice)) throw new TypeError("characteristic-amount.value is a whole number from 1, or a dice amount (D3, D6, D6+1).");
    return { value: dice };
  }
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError("characteristic-amount.value is a whole number from 1, or a dice amount (D3, D6, D6+1).");
  return { value };
}
