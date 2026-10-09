import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 model-group versions. A model-level unit-filter with a membership ("Character models in
 * this unit", "that unit's BATTLELINE models") takes the membership's unit as `member_of`; the
 * membership leaf accepts the moment's unit as a value. The unit-filter gains one role flag, an
 * attack exclusion ("this unit's ranged attacks (excluding Character models' attacks)"), which
 * compile-unit-filters.ts folds into the attack frame before it.
 */

/** The membership value that names the unit a moment names (compile-antecedent.ts binds it). */
export const MOMENT_UNIT = "antecedent";
/** The unit-filter role flag: the filter names models whose attacks an attack frame before it excludes. */
export const EXCLUDED_FROM_ATTACKS = "attacks";

export const FAMILY_EXTENSIONS_16_MODEL_KEYWORD_SCOPE: readonly FamilyExtension[] = [
  {
    // "Character models in that unit" after a moment: the membership names the moment's unit.
    family: "membership",
    description: "As the previous version, plus of: antecedent, the unit the record's moment names (\"that unit's Character models\" after \"when a friendly X unit is selected\"). Only relation in can name it; the other values keep their meaning.",
    schema: (previous) => withProperties(previous, {
      of: widenedEnum(previous, "of", [MOMENT_UNIT]),
    }),
    normalize: (input, previous) => {
      if (input.of !== MOMENT_UNIT) return previous(input);
      if (input.relation !== "in") throw new TypeError("membership of the moment's unit is only a model of that unit (relation in).");
      return standIn(input, "of", "this-unit", previous);
    },
  },
  {
    // "This unit's ranged attacks (excluding Character models' attacks)": the models an attack frame excludes.
    family: "unit-filter",
    description: "As the previous version, plus excluded_from: attacks, on a model-level filter with excluded_keywords only. It names the models whose attacks the attack frame before it does not cover (\"excluding Character models' attacks\"); without it the filter keeps its meaning.",
    schema: (previous) => withProperties(previous, {
      excluded_from: optional({ const: EXCLUDED_FROM_ATTACKS, "x-only-when": { level: ["model"] } }),
    }),
    normalize: (input, previous) => {
      if (!("excluded_from" in input)) return previous(input);
      const { excluded_from: excludedFrom, ...rest } = input;
      if (excludedFrom !== EXCLUDED_FROM_ATTACKS) throw new TypeError(`unit-filter.excluded_from must be ${EXCLUDED_FROM_ATTACKS}.`);
      if (rest.level !== "model") throw new TypeError("unit-filter.excluded_from names models, so the filter must be level model.");
      if (!Array.isArray(rest.excluded_keywords) || rest.excluded_keywords.length === 0) throw new TypeError("unit-filter.excluded_from needs excluded_keywords: the models it leaves out.");
      for (const key of ["keywords", "any_keywords", "states", "alternatives"] as const) {
        if (key in rest) throw new TypeError(`unit-filter.excluded_from takes excluded_keywords alone; ${key} is not allowed with it.`);
      }
      return { ...previous(rest), excluded_from: EXCLUDED_FROM_ATTACKS };
    },
  },
];
