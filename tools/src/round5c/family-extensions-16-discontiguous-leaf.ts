import type { SemanticFamilyDefinition } from "./contracts.js";
import { IGNORE_STATS, ROLL_KINDS } from "./dice-families.js";
import { enumSet, exactKeys } from "./family-validation.js";

/**
 * Two qualifiers whose wording sits apart from the activation or lead-in they complete. Neither
 * changes a DSL schema: each is a CONDITION-role leaf that a binder folds into its host before
 * lowering (compile-additive-option.ts, compile-ignore-list.ts), so the role never reaches lowering.
 */

export const DISCONTIGUOUS_LEAF_FAMILIES: SemanticFamilyDefinition[] = [
  {
    id: "additive-option",
    version: 1,
    role: "CONDITION",
    label: "Additive option qualifier",
    description: "\"in addition to any other <noun>\" after the duration of an option activation. The binder sets additive on the ability-activate before it and drops this leaf. It names no option of its own.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    id: "ignore-modifier-list",
    version: 1,
    role: "CONDITION",
    label: "Ignore-modifier list",
    description: "One item of the list after an ignore-modifiers lead-in: the characteristics it names (stats) or the rolls it names (rolls). At least one of the two. The binder folds the items onto the lead-in and drops these leaves.",
    starter: { stats: ["BS"] },
    parameterSchema: {
      type: "object",
      properties: {
        stats: { type: "array", items: { enum: IGNORE_STATS }, minItems: 1, uniqueItems: true },
        rolls: { type: "array", items: { enum: ROLL_KINDS }, minItems: 1, uniqueItems: true },
      },
      anyOf: [{ required: ["stats"] }, { required: ["rolls"] }],
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise a discontiguous-leaf family's parameters, or return null for other families. */
export function normalizeDiscontiguousLeafParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family === "additive-option") {
    exactKeys(input, [], family);
    return {};
  }
  if (family !== "ignore-modifier-list") return null;
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => key !== "stats" && key !== "rolls")) {
    throw new TypeError("ignore-modifier-list parameters are stats and/or rolls, and at least one of them.");
  }
  const result: Record<string, unknown> = {};
  if (input.stats !== undefined) result.stats = enumSet(input.stats, IGNORE_STATS, "ignore-modifier-list.stats");
  if (input.rolls !== undefined) result.rolls = enumSet(input.rolls, ROLL_KINDS, "ignore-modifier-list.rolls");
  return result;
}
