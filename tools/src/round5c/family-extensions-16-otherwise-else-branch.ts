import type { SemanticFamilyDefinition } from "./contracts.js";

/**
 * Wave-10 otherwise-else-branch (tier 5). "Otherwise, …" opens the sentence that is the else branch
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
