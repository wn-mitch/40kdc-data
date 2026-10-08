import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, optional, type Schema, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-9 selected weapon: "that weapon" names a weapon an earlier leaf of the same record bound.
 * `weapon: antecedent` on weapon-ability-grant binds the weapon a select-weapon bound
 * (`compile-weapon-antecedent.ts`); on attack-filter it names the attacks made with the weapons
 * an earlier keyword grant gave that keyword. Each version checks only its own key and hands the
 * rest of a leaf to the previous version.
 */

const WEAPON = "weapon";

/** Placeholder for a key the previous version requires but this one takes from a bound weapon. */
const BOUND_STAND_IN = "all";

function withoutRequired(schema: Schema, key: string): Schema {
  return { ...schema, required: (schema.required as string[]).filter((item) => item !== key) };
}

export const FAMILY_EXTENSIONS_13_SELECTED_WEAPON: readonly FamilyExtension[] = [
  {
    // "that weapon has the [DEVASTATING WOUNDS] ability": the weapon an earlier select-weapon bound.
    family: "weapon-ability-grant",
    description: "As the previous version, and weapon: antecedent gives the keyword to the weapon an earlier select-weapon bound (\"that weapon has the [X] ability\"). The subject is this-model and one keyword is named; weapon_type is the bound weapon's and may be left out; weapon_name and weapon_keyword cannot narrow a bound weapon.",
    schema: (previous) => withoutRequired(withProperties(previous, { weapon: optional({ enum: [ANTECEDENT] }) }), "weapon_type"),
    normalize: (input, previous) => {
      if (!(WEAPON in input)) {
        if (input.weapon_type === undefined) throw new TypeError("weapon-ability-grant needs weapon_type unless weapon is antecedent.");
        return previous(input);
      }
      if (input.weapon !== ANTECEDENT) throw new TypeError(`weapon-ability-grant.weapon is ${ANTECEDENT} or absent.`);
      if (input.subject !== "this-model") throw new TypeError("weapon-ability-grant with weapon antecedent takes subject this-model: the bound weapon is this model's.");
      if (typeof input.keyword !== "string") throw new TypeError("weapon-ability-grant with weapon antecedent names one keyword; a frame has none.");
      if (input.weapon_type === "all") throw new TypeError("weapon-ability-grant with weapon antecedent takes the bound weapon's melee or ranged type, not all.");
      for (const key of ["weapon_name", "weapon_keyword", "incoming"]) {
        if (key in input) throw new TypeError(`weapon-ability-grant with weapon antecedent cannot also name ${key}; the bound weapon is already one weapon.`);
      }
      const { weapon: _weapon, weapon_type: stated, ...rest } = input;
      const normalized = previous({ ...rest, weapon_type: stated ?? BOUND_STAND_IN });
      const { weapon_type: _standIn, ...others } = normalized;
      return stated === undefined ? { ...others, weapon: ANTECEDENT } : { ...others, weapon_type: normalized.weapon_type, weapon: ANTECEDENT };
    },
  },
  {
    // "each time an attack is made with such a weapon": the attacks made with the weapons an earlier grant gave a keyword.
    family: "attack-filter",
    description: "As the previous version, plus weapon: antecedent, the attacks made with the weapons an earlier keyword grant gave that keyword (\"each time an attack is made with such a weapon\"). It takes attack_type and negated only; the grant's weapon type sets attack_type.",
    schema: (previous) => withProperties(previous, { weapon: optional({ enum: [ANTECEDENT] }) }),
    normalize: (input, previous) => {
      if (!(WEAPON in input)) return previous(input);
      if (input.weapon !== ANTECEDENT) throw new TypeError(`attack-filter.weapon is ${ANTECEDENT} or absent.`);
      const extra = Object.keys(input).filter((key) => key !== WEAPON && key !== "attack_type" && key !== "negated");
      if (extra.length) throw new TypeError(`attack-filter weapon antecedent names the weapons an earlier grant gave a keyword; ${extra.join(", ")} cannot narrow them.`);
      // The keyword comes from the grant at compile time; a stand-in lets the previous version check the rest.
      const { weapon: _weapon, ...rest } = input;
      const { weapon_keyword: _standIn, ...others } = previous({ ...rest, weapon_keyword: "Antecedent" });
      return { ...others, weapon: ANTECEDENT };
    },
  },
];
