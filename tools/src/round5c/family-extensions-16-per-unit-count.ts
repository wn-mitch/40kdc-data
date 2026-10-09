import { enumValue } from "./family-validation.js";
import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 per-unit-count timing: a count-scale can say when its count is taken. A count in a rule
 * that starts at a moment and lasts is taken once, when the rule applies, and fixed for its
 * duration ("At the start of the Fight phase, until the end of the phase, +2 A for every 5 enemy
 * models within 6\""). Absent or "live" is the previous meaning, so a live leaf keeps its shape.
 * The compiler checks the on-apply rules (compile-count-scale.ts); this version checks only the
 * timing key and what it can combine with.
 */
export const TIMINGS = ["live", "on-apply"] as const;

export const FAMILY_EXTENSIONS_16_PER_UNIT_COUNT: readonly FamilyExtension[] = [
  {
    family: "count-scale",
    description: "As the previous version, plus timing: live (the default, and the same leaf as no timing) or on-apply, a count in a lasting rule taken once when the rule applies. on-apply cannot count following-items.",
    schema: (previous) => withProperties(previous, { timing: optional({ enum: TIMINGS }) }),
    normalize: (input, previous) => {
      if (!("timing" in input)) return previous(input);
      const { timing, ...rest } = input;
      const checked = enumValue(timing, TIMINGS, "count-scale.timing");
      if (checked === "live") return previous(rest);
      if (rest.counts === "following-items") throw new TypeError("count-scale.timing on-apply counts a fixed set once; following-items counts one item at a time.");
      // The key stays: the compiler reads it to mark the scaling evaluated on apply.
      return { ...previous(rest), timing: checked };
    },
  },
];
