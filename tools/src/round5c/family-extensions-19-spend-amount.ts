import { type FamilyExtension, properties, standIn, type Schema, withProperties } from "./family-extension-helpers.js";

/** A spend of as many as the player chooses, at least one ("spend one or more BTP"). */
export const ONE_OR_MORE = "one-or-more";

/**
 * resource-spend with an open amount: "spend one or more BTP you have". The DSL's resource-spend
 * names it (`amount: one-or-more`). A cap ("up to 2") is not this value: nothing in the DSL says
 * the largest amount, so such a leaf keeps its number or stays unauthored.
 */
export const FAMILY_EXTENSIONS_19_SPEND_AMOUNT: readonly FamilyExtension[] = [
  {
    family: "resource-spend",
    description: "As the previous version, plus amount one-or-more: the player chooses how many to spend, at least one (\"spend one or more BTP you have\").",
    schema: (previous) => {
      const amount = properties(previous).amount as Schema;
      return withProperties(previous, { amount: { ...amount, anyOf: [...(amount.anyOf as Schema[]), { const: ONE_OR_MORE }] } });
    },
    normalize: (input, previous) => input.amount === ONE_OR_MORE ? standIn(input, "amount", "all", previous) : previous(input),
  },
];
