import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * Wave 8, set-up restrictions: a set-up a rule forbids or requires, and the set-up moment's
 * source. Each version checks only its own additions and hands the rest to the previous one.
 *
 * "Set up as Reinforcements" is set up from Reserves (11th edition has no Reinforcements rule),
 * so it records the same strategic-reserves value. "Horizontally" in a distance is a connective.
 */

/** Where a set-up moment brings a unit from. */
export const SET_UP_SOURCES = ["strategic-reserves"] as const;

/** set-up parameters that place a permitted set-up; a forbidden one names its zone through a folded limit. */
const PLACING_KEYS = ["via", "marker_inches", "marker_wholly", "placement", "ignore_limits", "min_enemy_distance", "within_edge"] as const;

export const FAMILY_EXTENSIONS_W8_SETUP: readonly FamilyExtension[] = [
  {
    // "enemy units … cannot be set up within 12\" of this model"; "that unit must be set up wholly within …".
    family: "set-up",
    description: "As the previous version, plus allow false (\"cannot be set up\": the set-up this leaf names, with any placement limit after it, is forbidden) and mandatory (\"must be set up\").",
    schema: (previous) => withProperties(previous, { allow: optional({ const: false }), mandatory: optional({ const: true }) }),
    normalize: (input, previous) => {
      const { allow, mandatory, ...rest } = input;
      if (allow !== undefined && allow !== false) throw new TypeError("set-up.allow is false or absent.");
      if (mandatory !== undefined && mandatory !== true) throw new TypeError("set-up.mandatory is true or absent.");
      if (allow === false && mandatory === true) throw new TypeError("set-up cannot be both forbidden (allow false) and required (mandatory).");
      if (allow === false) {
        const placing = PLACING_KEYS.find((key) => key in rest);
        if (placing) throw new TypeError(`set-up.${placing} places a permitted set-up; a forbidden set-up (allow false) names its zone through the placement limit after it.`);
      }
      return { ...previous(rest), ...(allow === false ? { allow: false } : {}), ...(mandatory === true ? { mandatory: true } : {}) };
    },
  },
  {
    // "Enemy units that are set up on the battlefield from Reserves" (or "as Reinforcements").
    family: "event",
    description: "As the previous version, plus from on a set-up moment: strategic-reserves (\"set up … from Reserves\", \"set up … as Reinforcements\", \"arrive on the battlefield from Reserves\").",
    schema: (previous) => withProperties(previous, { from: optional({ enum: [...SET_UP_SOURCES], "x-only-when": { kind: ["set-up"] } }) }),
    normalize: (input, previous) => {
      if (input.from === undefined) return previous(input);
      const { from, ...rest } = input;
      if (rest.kind !== "set-up") throw new TypeError("event.from names where a set-up moment brings the unit from; kind must be set-up.");
      if (!(SET_UP_SOURCES as readonly unknown[]).includes(from)) throw new TypeError(`event.from is one of ${SET_UP_SOURCES.join(", ")}.`);
      return { ...previous(rest), from };
    },
  },
];
