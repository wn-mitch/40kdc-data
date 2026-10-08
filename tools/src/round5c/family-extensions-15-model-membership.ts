import { type FamilyExtension, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-9 membership of a Stratagem's target: "your unit" after a model-level unit-filter on a
 * Stratagem names the unit the Stratagem targets, which the selected model must share. Version 1
 * keeps this-unit and this-model; the new value is a Stratagem's target only, and only "in" (a
 * model of that unit) can name it.
 */
export const FAMILY_EXTENSIONS_15_MODEL_MEMBERSHIP: readonly FamilyExtension[] = [
  {
    family: "membership",
    description: "As the previous version, plus of: stratagem-target, the Stratagem's target unit (\"in your unit\" on a Stratagem). Only relation in can name it; this-unit and this-model keep their meaning.",
    schema: (previous) => withProperties(previous, {
      of: widenedEnum(previous, "of", ["stratagem-target"]),
    }),
    normalize: (input, previous) => {
      if (input.of !== "stratagem-target") return previous(input);
      if (input.relation !== "in") throw new TypeError("membership of a Stratagem's target is only a model of that unit (relation in).");
      return standIn(input, "of", "this-unit", previous);
    },
  },
];
