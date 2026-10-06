import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * Family versions the per-unit-count work needed: a bare quantifier whose passes also take the
 * attack's target ("roll one D6 for the target unit and one D6 for each other enemy unit within 6\"
 * of it").
 */
export const FAMILY_EXTENSIONS_W8_COUNT: readonly FamilyExtension[] = [
  {
    family: "for-each-unit-select",
    description: "As the previous version, plus including target on the bare quantifier: the passes take the attack's target as well as each unit the unit-filter after it names (\"for the target unit and one D6 for each other enemy unit within 6\\\" of it\"). The filter's other then means other than the target.",
    schema: (previous) => withProperties(previous, { including: optional({ const: "target" }) }),
    normalize: (input, previous) => {
      if (!("including" in input)) return previous(input);
      const { including, ...rest } = input;
      if (including !== "target") throw new TypeError("for-each-unit-select.including is target, or omitted.");
      if (Object.keys(rest).length) throw new TypeError("for-each-unit-select.including qualifies only the bare quantifier {}; the unit-filter after it names the other units.");
      return { including: "target" };
    },
  },
];
