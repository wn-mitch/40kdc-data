import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * A unit-filter that names the attack's target: "while targeting an enemy unit" after an effect.
 * The filter's span takes the trailing "while targeting" words, as unit-mark does for a designated
 * target. Its units are the defender of the attack the effect is gated on (compile-unit-filters.ts
 * folds it to unit-filter-target). Earlier versions have no subject and compile as before.
 */

/** The only subject a unit-filter takes in this version. */
export const FILTER_SUBJECT_TARGET = "target";

export const FAMILY_EXTENSIONS_16_TRAILING_WHILE_TARGETING: readonly FamilyExtension[] = [
  {
    family: "unit-filter",
    description: "As the previous version, and subject target: the units the filter matches are the attack's target (\"while targeting an enemy unit\"). Only in an effect fragment, and the side must be friendly or enemy.",
    schema: (previous) => withProperties(previous, { subject: optional({ const: FILTER_SUBJECT_TARGET }) }),
    normalize: (input, previous) => {
      if (!("subject" in input)) return previous(input);
      const { subject, ...rest } = input;
      if (subject !== FILTER_SUBJECT_TARGET) throw new TypeError(`unit-filter.subject must be ${FILTER_SUBJECT_TARGET}.`);
      return { ...previous(rest), subject: FILTER_SUBJECT_TARGET };
    },
  },
];
