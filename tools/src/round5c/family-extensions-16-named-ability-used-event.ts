import { EVENT_SUBJECT, type FamilyExtension, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 own-dice manoeuvre roll: "each time a unit performs an Agile Manoeuvre that involves
 * rolling a D6, add 1 to the result". The roll is the performing unit's own manoeuvre roll, so its
 * subject is the triggering unit (event-subject) and is required: without one the change would
 * land on the rule holder. Refusals are for what the compiler cannot bind (compile-manoeuvre-own-roll.ts).
 */
export const FAMILY_EXTENSIONS_16_NAMED_ABILITY_USED_EVENT: readonly FamilyExtension[] = [
  {
    family: "roll-modifier",
    description: "As the previous version, and roll can be manoeuvre: the performing unit's Agile Manoeuvre roll, which takes the triggering unit as its subject (\"add 1 to the result of an Agile Manoeuvre roll\").",
    schema: (previous) => withProperties(previous, { roll: widenedEnum(previous, "roll", ["manoeuvre"]) }),
    normalize: (input, previous) => {
      if (input.roll !== "manoeuvre") return previous(input);
      if (input.operation === "subtract") throw new TypeError("roll-modifier roll manoeuvre adds to the result; it cannot subtract.");
      if (input.weapon_type !== undefined) throw new TypeError("roll-modifier roll manoeuvre is not a weapon roll; drop weapon_type.");
      if ("rolls" in input) throw new TypeError("roll-modifier roll manoeuvre names one roll, not rolls.");
      if (input.subject !== EVENT_SUBJECT) throw new TypeError("roll-modifier roll manoeuvre names the performing unit as its subject (event-subject).");
      return standIn(input, "roll", "hit", previous);
    },
  },
];
