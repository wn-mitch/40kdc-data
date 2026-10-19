import type { SemanticFamilyDefinition } from "./contracts.js";
import { enumValue, exactKeys } from "./family-validation.js";

/**
 * `weapon-has-ability` (wave 10): "If such a weapon already has that ability". "Such a weapon" is
 * the weapons the nearest earlier keyword grant gave a keyword to; "that ability" is that keyword.
 * `granted_rating` states what a weapon that already prints the ability gets from the grant: keep
 * (it keeps its printed rating; only the sentence after the condition applies to it) or add (the
 * granted rating adds to the printed one). The leaf must say which; no fold picks a reading.
 * Folded into the host of the sentence after it by compile-weapon-already-has.ts.
 */
export const GRANTED_RATINGS = ["keep", "add"] as const;

export const WEAPON_HAS_ABILITY_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "weapon-has-ability",
    version: 1,
    role: "CONDITION",
    label: "Such a weapon already has that ability",
    description: "\"If such a weapon already has that ability\": the weapons the keyword grant before it gave a keyword to, and that keyword, as the weapon prints it before this ability. granted_rating keep: a weapon that already prints the ability keeps its printed rating (the grant adds nothing to it); add: the granted rating adds to the printed one.",
    starter: { weapon: "earlier-grant", ability: "earlier-grant", granted_rating: "keep" },
    parameterSchema: {
      type: "object",
      required: ["weapon", "ability", "granted_rating"],
      properties: {
        weapon: { enum: ["earlier-grant"] },
        ability: { enum: ["earlier-grant"] },
        granted_rating: { enum: GRANTED_RATINGS },
      },
      additionalProperties: false,
    },
  },
];

/** weapon-has-ability@1 parameters: both references are antecedents, and the rating reading is stated. */
export function normalizeWeaponHasAbilityParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "weapon-has-ability") return null;
  exactKeys(input, ["weapon", "ability", "granted_rating"], family);
  return {
    weapon: enumValue(input.weapon, ["earlier-grant"], "weapon-has-ability.weapon"),
    ability: enumValue(input.ability, ["earlier-grant"], "weapon-has-ability.ability"),
    granted_rating: enumValue(input.granted_rating, GRANTED_RATINGS, "weapon-has-ability.granted_rating"),
  };
}
