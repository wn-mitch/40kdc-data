import { type FamilyExtension, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/** The roll a Deadly Demise ability makes when its bearer is destroyed. */
const DEADLY_DEMISE = "deadly-demise";

/** Stand-in roll for the previous version, which does not take the Deadly Demise roll; it is put back after. */
const ROLL_STAND_IN = "hit";

/**
 * roll-modifier on the Deadly Demise roll ("add 1 to the Deadly Demise roll if ..."). The DSL's
 * roll-modifier already names `deadly-demise`; the leaf family did not. The roll takes no weapon
 * scope: it is no weapon's roll. It is named by `roll` alone, not listed in `rolls`.
 */
export const FAMILY_EXTENSIONS_20_ROLL_MODIFIER_AND_REROLL_GAPS: readonly FamilyExtension[] = [
  {
    family: "roll-modifier",
    description: "As the previous version, and roll can be deadly-demise: the roll a Deadly Demise ability makes when its bearer is destroyed. It takes no weapon_type.",
    schema: (previous) => withProperties(previous, { roll: widenedEnum(previous, "roll", [DEADLY_DEMISE]) }),
    normalize: (input, previous) => {
      if (input.roll !== DEADLY_DEMISE) return previous(input);
      if ("weapon_type" in input) throw new TypeError("roll-modifier roll deadly-demise is no weapon's roll; drop weapon_type.");
      if ("rolls" in input) throw new TypeError("roll-modifier names a roll or rolls, not both.");
      return standIn(input, "roll", ROLL_STAND_IN, previous);
    },
  },
];
