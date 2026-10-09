import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";
import { WEAPON_KEYWORDS } from "./family-extensions-2.js";
import { WEAPON_REMOVAL_KEYWORDS } from "./weapon-buff-families.js";
import { enumValue } from "./family-validation.js";

/**
 * Wave-10 weapon-ability removal: the scope version that names weapons by one weapon keyword
 * ("Your unit's [Blast] ranged attacks"). The removal family itself (weapon-ability-removal) is a
 * base family in weapon-buff-families.ts; this file only widens weapon-property-scope.
 */

/**
 * The keywords a scope can select by: those a removal can name and that characteristic-modifier
 * already takes as weapon_keyword. Extra Attacks and Close-quarters can be removed but are not in
 * WEAPON_KEYWORDS, so a scope cannot select weapons by them.
 */
export const SCOPE_WEAPON_KEYWORDS: readonly string[] = WEAPON_KEYWORDS.filter((keyword) => WEAPON_REMOVAL_KEYWORDS.includes(keyword));

export const FAMILY_EXTENSIONS_16_WEAPON_REMOVAL: readonly FamilyExtension[] = [
  {
    // "Your unit's [Blast] ranged attacks: Do not have [Blast]. Have +1 A.": the scope selects weapons by a keyword.
    family: "weapon-property-scope",
    description: "As the previous version, plus weapon_keyword: the scope selects only weapons with that weapon ability (Blast, Torrent, Heavy …). weapon_type is still required, and a bound-weapon scope takes no weapon_keyword.",
    schema: (previous) => withProperties(previous, { weapon_keyword: optional({ enum: SCOPE_WEAPON_KEYWORDS }) }),
    normalize: (input, previous) => {
      if (!("weapon_keyword" in input)) return previous(input);
      if ("weapon" in input) throw new TypeError("weapon-property-scope.weapon_keyword cannot combine with weapon: the bound weapon is one weapon, not a keyword's weapons.");
      const { weapon_keyword: keyword, ...rest } = input;
      const normalized = previous(rest);
      return { ...normalized, weapon_keyword: enumValue(keyword, SCOPE_WEAPON_KEYWORDS, "weapon-property-scope.weapon_keyword") };
    },
  },
];
