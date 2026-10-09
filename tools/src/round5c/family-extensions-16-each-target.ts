import { type FamilyExtension, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { EACH_TARGET } from "./family-extensions-w8-multi.js";

/**
 * Wave-10 each-target eligibility: a unit-state or unit-position condition that holds of every
 * Stratagem target named before it ("Each unit targeted with this Stratagem must be more than 3\"
 * away", "You cannot select units that are within Engagement Range"). The previous version
 * checks the rest of a leaf; subject each-target is read as this-unit there, then restored, so
 * the compiler (compile-target-groups.ts) copies the condition into every target's eligibility.
 */
export const FAMILY_EXTENSIONS_16_EACH_TARGET: readonly FamilyExtension[] = [
  {
    family: "unit-state",
    description: "As the previous version, plus subject each-target: the condition holds of every Stratagem target named before it (\"Each unit targeted with this Stratagem must …\", \"You cannot select units that are within Engagement Range …\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EACH_TARGET]) }),
    normalize: (input, previous) => standInEachTarget(input, previous),
  },
  {
    family: "unit-position",
    description: "As the previous version, plus subject each-target: the position holds of every Stratagem target named before it (\"Each unit targeted with this Stratagem must be more than 3\\\" away from all enemy units\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EACH_TARGET]) }),
    normalize: (input, previous) => standInEachTarget(input, previous),
  },
];

function standInEachTarget(input: Record<string, unknown>, previous: (input: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  if (input.subject !== EACH_TARGET) return previous(input);
  const normalized = previous({ ...input, subject: "this-unit" });
  return { ...normalized, subject: EACH_TARGET };
}
