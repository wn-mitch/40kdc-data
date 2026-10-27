import type { FamilyExtension } from "../family-extension-helpers.js";
import { optional, withProperties } from "../family-extension-helpers.js";
import { enumValue } from "../family-validation.js";

/** Who counts as having moved: the units the permission's own subject is (it disembarks itself). */
export const COUNTS_AS_MOVED_UNITS = ["permission-subject"] as const;

/**
 * "The bearer's unit can disembark … If it does, it counts as having made a Normal move": the
 * permission's subject is the unit that disembarks, not a Transport whose carried units do. units
 * says so; without it the leaf reads as version 1 did (the units a Transport carries), which the
 * DSL cannot name.
 */
export const COUNTS_AS_MOVED_EXTENSIONS: readonly FamilyExtension[] = [
  {
    family: "counts-as-moved",
    version: 2,
    description: `As the previous version, plus units: ${COUNTS_AS_MOVED_UNITS.join(", ")} when the permission's own subject is the unit that disembarks ("the bearer's unit can disembark … if it does, it counts as having made a Normal move"), not the units a Transport carries.`,
    schema: (previous) => withProperties(previous, { units: optional({ enum: [...COUNTS_AS_MOVED_UNITS] }) }),
    normalize: (input, previous) => {
      if (input.units === undefined) return previous(input);
      const { units, ...rest } = input;
      return { ...previous(rest), units: enumValue(units, COUNTS_AS_MOVED_UNITS, "counts-as-moved.units") };
    },
  },
];
