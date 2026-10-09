import type { SemanticFamilyDefinition } from "./contracts.js";
import { DICE } from "./family-extension-helpers.js";
import { exactKeys } from "./family-validation.js";

/**
 * The amount of a characteristic change whose recipient filter sits between the change and the
 * amount ("… raise the Zorn characteristic of K models from your army by 2"). A
 * qualifier with the CONDITION role: the binder (compile-characteristic-amount.ts) consumes it
 * before any role-based pass, so the role never reaches lowering.
 */
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
];

/** Validate and canonicalise a characteristic-amount leaf's parameters, or return null for other families. */
export function normalizeCharacteristicAmountParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
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
