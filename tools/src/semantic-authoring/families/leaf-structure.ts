import type { SemanticFamilyDefinition } from "../contracts.js";
import { IGNORE_STATS, ROLL_KINDS } from "../dice-families.js";
import { type FamilyExtension, optional, withProperties } from "../family-extension-helpers.js";
import { enumSet, exactKeys } from "../family-validation.js";

/**
 * Leaves that structure a record rather than state a mechanic: versions of instead, and the
 * otherwise, additive-option, ignore-modifier-list and condition-exclusion base families.
 */

/**
 * A base family: "excluding" in "(excluding units with X that are not Y and are not within Z)". The
 * conditions after it, up to the closing parenthesis, are one group, and the units meeting all of
 * them are excluded (compile-condition-exclusions.ts). Takes no parameters.
 */
export const CONDITION_EXCLUSION_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "condition-exclusion",
    version: 1,
    role: "CONDITION",
    label: "Excluding units that",
    description: "Qualifies the conditions that follow it, up to the closing parenthesis (or the end of the sentence): the units meeting all of them are excluded. Takes no parameters.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/**
 * otherwise-else-branch. "Otherwise, …" opens the sentence that is the else branch
 * of the sentence before it. The leaf takes no parameters: the branch it marks is found by position
 * (compile-otherwise.ts), so there is no value to record. A restated condition in the Otherwise
 * sentence is a separate leaf.
 */
export const OTHERWISE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "otherwise",
    version: 1,
    role: "COMBINATOR",
    label: "Otherwise",
    description: "The sentence this leaf opens is the else branch of the sentence before it: it applies when that sentence's leading condition does not hold (\"If your unit is not engaged, it can move … Otherwise, it can fall back\"). Takes no parameters.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/**
 * Two qualifiers whose wording sits apart from the activation or lead-in they complete. Neither
 * changes a DSL schema: each is a CONDITION-role leaf that a binder folds into its host before
 * lowering (compile-additive-option.ts, compile-ignore-list.ts), so the role never reaches
 * lowering.
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

/** otherwise@1 parameters: the leaf records no value, so only an empty object is accepted. */
export function normalizeOtherwiseParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "otherwise") return null;
  exactKeys(input, [], family);
  return {};
}

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

export const LEAF_STRUCTURE_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "Your unit can make a Normal move of: Up to D6\". Or: If …, up to 6\"": the player picks one.
    family: "instead",
    version: 2,
    description: "As the previous version, plus choice: true on \"Or:\" between two effects of the same kind: the player picks one of them (each under its own conditions), rather than this clause replacing the earlier one when its condition holds.",
    schema: (previous) => withProperties(previous, { choice: optional({ const: true }) }),
    normalize: (input, previous) => {
      if (input.choice === undefined) return previous(input);
      const { choice, ...rest } = input;
      if (choice !== true) throw new TypeError("instead.choice must be true, or omitted.");
      return { ...previous(rest), choice: true };
    },
  },
];
