import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-9 antecedent stat adjustment: "add 2 to the Attacks characteristic of those two weapons",
 * where the weapons are the ones an earlier equipped-weapon-count condition counted. The leaf names
 * no subject; the compiler takes the recipient and the excluded weapon from that condition.
 */
export const FAMILY_EXTENSIONS_13_EQUIPPED_COUNT: readonly FamilyExtension[] = [
  {
    family: "characteristic-modifier",
    description: "As the previous version, plus weapon: antecedent (the weapons an earlier equipped-weapon-count condition counted, excluding its named weapon). Requires a melee or ranged weapon_type and no weapon_name or weapon_keyword.",
    schema: (previous) => withProperties(previous, { weapon: optional({ enum: ["antecedent"] }) }),
    normalize: (input, previous) => {
      if (input.weapon === undefined) return previous(input);
      const { weapon, ...rest } = input;
      if (weapon !== "antecedent") throw new TypeError("characteristic-modifier.weapon is antecedent or absent.");
      const normalized = previous(rest);
      if (normalized.weapon_type !== "melee" && normalized.weapon_type !== "ranged") throw new TypeError("characteristic-modifier.weapon antecedent needs a melee or ranged weapon_type.");
      if (normalized.weapon_name !== undefined || normalized.weapon_keyword !== undefined) throw new TypeError("characteristic-modifier.weapon antecedent takes no weapon_name or weapon_keyword.");
      return { ...normalized, weapon: "antecedent" };
    },
  },
];
