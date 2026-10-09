import type { SemanticFamilyDefinition } from "./contracts.js";

/**
 * A designation may be chosen while its unit is embarked. It gates nothing by itself: the fold in
 * compile-embarked-permission.ts sets allow_while_embarked on the designation before it and drops
 * the leaf (as wounds-remaining qualifies a set-up effect).
 */
export const EMBARKED_PERMISSION_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "embarked-permission",
    version: 1,
    role: "CONDITION",
    label: "Designation allowed while embarked",
    description: "This ability can be used even though its unit is embarked within a Transport. It qualifies the persistent designation before it in its fragment and gates nothing.",
    starter: { subject: "this-unit" },
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: { subject: { enum: ["this-unit"] } },
      additionalProperties: false,
    },
  },
];
