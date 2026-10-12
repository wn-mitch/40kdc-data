import { standIn, type FamilyExtension, widenedEnum, withProperties } from "./family-extension-helpers.js";

/** The subject value a unit-filter folds onto a leaf (compile-antecedent.ts FILTERED_UNITS). */
const FILTERED_UNITS = "filtered-units";

/**
 * Wave-10 t7 choice-grant bundle: family versions for the choice and grant shapes that the
 * compiler lowers. Each version checks only its own additions and hands the rest of a leaf to the
 * previous version (see family-extensions.ts).
 */
export const FAMILY_EXTENSIONS_16_T7_CHOICE_GRANT_BUNDLE: readonly FamilyExtension[] = [
  {
    // "that Blessing is active for friendly TERMINATOR SQUAD units in addition to any other Blessings":
    // the activation's units are the recipients a unit-filter names (compile-additive-option.ts binds
    // the filter onto the activation as subject_filter).
    family: "ability-activate",
    description: "As the previous version, plus subject filtered-units: the units a unit-filter names before the activation (\"active for friendly K units in addition to\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [FILTERED_UNITS]) }),
    normalize: (input, previous) => input.subject === FILTERED_UNITS ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
];
