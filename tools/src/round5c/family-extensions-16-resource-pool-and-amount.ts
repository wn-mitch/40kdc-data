import { POOL_ID_PATTERN } from "./economy-families.js";
import { DICE, type FamilyExtension, properties, standIn, withProperties } from "./family-extension-helpers.js";

/**
 * Resource gains with a dice amount and a plain pool id. "You gain an additional D3 Miracle dice"
 * and "gain D3 Blood Tithe points" give the amount as dice; "start the battle with 2 additional
 * Resurgence points" names the pool plainly. The previous version keeps every value it accepted:
 * the v3 pool branches (including the known-id enum the samplers read) stay, and the dice amount is
 * an added branch. Earlier versions refuse a dice amount, so existing leaves keep their meaning,
 * and `{source: ...}` still fails at compile time because it is quoted text.
 */

export const FAMILY_EXTENSIONS_16_RESOURCE_POOL_AND_AMOUNT: readonly FamilyExtension[] = [
  {
    family: "resource-gain",
    description: "As the previous version, and amount may be a dice amount (D3, D6, 2D6, D3+1) for a gain rolled on the bearer's ability, and pool may be any kebab-case pool id. Dice amounts are normalized to uppercase.",
    schema: (previous) => {
      const { amount, pool } = properties(previous);
      return withProperties(previous, {
        amount: { anyOf: [...(amount.anyOf as unknown[]), { type: "string", pattern: DICE.source, examples: ["D3"] }] },
        pool: { anyOf: [...(pool.anyOf as unknown[]), { type: "string", pattern: POOL_ID_PATTERN.source }] },
      });
    },
    normalize: (input, previous) => {
      if (typeof input.amount !== "string") return previous(input);
      const dice = input.amount.trim().toUpperCase();
      if (!DICE.test(dice)) return previous(input);
      return { ...standIn(input, "amount", 1, previous), amount: dice };
    },
  },
];
