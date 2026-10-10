import { type FamilyExtension, optional, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { AMONG_TARGETS } from "./family-extensions-w8-multi.js";

/**
 * Family versions for "those X units": a unit an earlier unit-position of matching-unit introduced
 * (the set a previous leaf matched, not a unit a selection picked). The pool itself is built by
 * compile-matched-set.ts; these versions only let the consumer leaves name it.
 */

/** A unit-filter or targeting-restriction that names the matched set ("those VEHICLE units"). */
export const MATCHED_UNITS = "matched-units";

const MATCHED_FILTER: FamilyExtension = {
  // "select one of those **VEHICLE** units", "each time one of those **VEHICLE** units makes a ranged attack".
  family: "unit-filter",
  description: "As the previous version, plus among matched-units: the filter names the units an earlier unit-position of matching-unit introduced (\"one of those VEHICLE units\"). Side friendly or enemy, and no targets.",
  schema: (previous) => withProperties(previous, {
    among: optional({ enum: [AMONG_TARGETS, MATCHED_UNITS] }),
  }),
  normalize: (input, previous) => {
    if (input.among !== MATCHED_UNITS) return previous(input);
    if (input.side === "any") throw new TypeError("unit-filter.among matched-units names friendly or enemy units.");
    if ("targets" in input) throw new TypeError("unit-filter.targets applies to stratagem-targets, not matched-units.");
    const { among: _among, ...rest } = input;
    return { ...previous(rest), among: MATCHED_UNITS };
  },
};

const MATCHED_TARGET: FamilyExtension = {
  // "that only targets one or more of those enemy units", "must select one or more of those enemy units as the targets of that charge".
  family: "targeting-restriction",
  description: "As the previous version, plus target matched-units: the units an earlier unit-position of matching-unit introduced. by does not widen.",
  schema: (previous) => withProperties(previous, {
    target: widenedEnum(previous, "target", [MATCHED_UNITS]),
  }),
  normalize: (input, previous) => {
    if (input.target !== MATCHED_UNITS) return previous(input);
    // The previous version checks target against by; a placeholder that differs from by stands in, then target is restored.
    const placeholder = input.by === "enemy-units" ? "friendly-units" : "enemy-units";
    const { target: _target, ...rest } = input;
    return { ...previous({ ...rest, target: placeholder }), target: MATCHED_UNITS };
  },
};

export const FAMILY_EXTENSIONS_16_THOSE_ENEMY_UNITS_ROLE: readonly FamilyExtension[] = [MATCHED_FILTER, MATCHED_TARGET];
