import type { SemanticFamilyDefinition } from "./contracts.js";
import { enumValue, exactKeys } from "./family-validation.js";

/** Effect families added after the original registry; each maps to one DSL effect. */

const SUBJECTS = ["this-unit", "this-model", "bearer"] as const;
/** Amounts as GW prints them; plain numbers become numbers in the DSL. */
export const WOUND_AMOUNTS = ["1", "2", "3", "D3", "D6", "D3+3"] as const;

export const EFFECT_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "regain-wounds",
    version: 1,
    role: "EFFECT",
    label: "Regain lost wounds",
    description: "A model regains lost wounds (heals). Adding to the Wounds characteristic is a different leaf.",
    starter: { subject: "", amount: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "amount"],
      properties: { subject: { enum: SUBJECTS }, amount: { enum: WOUND_AMOUNTS } },
      additionalProperties: false,
    },
  },
];

export function normalizeEffectParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case "regain-wounds":
      exactKeys(input, ["subject", "amount"], family);
      return { subject: enumValue(input.subject, SUBJECTS, "regain-wounds.subject"), amount: enumValue(input.amount, WOUND_AMOUNTS, "regain-wounds.amount") };
    default:
      return null;
  }
}
