import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, optional, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/**
 * The eleventh round of family extensions. As in the earlier rounds, a version checks only its own
 * additions and hands the rest to the previous one.
 */

/** A distance or engagement whose other unit is the unit-filter right after the leaf. */
export const FOLLOWING_FILTER = "following-filter";

/** States the DSL's unit-state can read at the start of the phase or turn (strength and carrying are other predicates). */
const STATES_AT = ["engaged", "battle-shocked", "on-battlefield", "in-reserves", "in-strategic-reserves", "in-cult-ambush"] as const;

export const FAMILY_EXTENSIONS_11: readonly FamilyExtension[] = [
  {
    // "but cannot end that move within Engagement Range of them".
    family: "move-must-end",
    description: "As the previous version, plus polarity: must (the default) says where the move must end; cannot says where it must not end (\"cannot end that move within Engagement Range of them\"), so the conditions after it are negated together.",
    schema: (previous) => withProperties(previous, { polarity: optional({ enum: ["must", "cannot"] }) }),
    normalize: (input, previous) => {
      if (input.polarity === undefined) return previous(input);
      const { polarity, ...rest } = input;
      const value = enumValue(polarity, ["must", "cannot"], "move-must-end.polarity");
      return value === "must" ? previous(rest) : { ...previous(rest), polarity: "cannot" };
    },
  },
  {
    // "ends a move within 8\" of a" + "friendly unengaged unit": the distance is measured to the
    // units of the unit-filter right after it in its clause (compile-unit-filters.ts folds it).
    family: "unit-position",
    description: "As the previous version, plus of following-filter: the distance is to any unit the unit-filter right after this leaf, in the same clause, matches (\"within 8\\\" of a\" + \"friendly unengaged unit\").",
    schema: (previous) => withProperties(previous, { of: widenedEnum(previous, "of", [FOLLOWING_FILTER]) }),
    normalize: (input, previous) => input.of === FOLLOWING_FILTER ? { ...previous({ ...input, of: "this-unit" }), of: FOLLOWING_FILTER } : previous(input),
  },
  {
    // "engaged with one or more" + "friendly GREY KNIGHTS VEHICLE units".
    family: "unit-state",
    description: "As the previous version, plus with following-filter: engaged with any unit the unit-filter right after this leaf, in the same clause, matches.",
    schema: (previous) => withProperties(previous, { with: widenedEnum(previous, "with", [FOLLOWING_FILTER]) }),
    normalize: (input, previous) => input.with === FOLLOWING_FILTER ? { ...previous({ ...input, with: "this-unit" }), with: FOLLOWING_FILTER } : previous(input),
  },
  {
    // "an enemy unit that was engaged with this unit ends a Fall Back move": the state at the start
    // of the phase or turn, not now.
    family: "unit-state",
    description: "As the previous version, plus at: phase-start or turn-start reads the state as it was then (\"that was engaged with this unit\"), not now.",
    schema: (previous) => withProperties(previous, { at: optional({ enum: ["phase-start", "turn-start"], "x-only-when": { states: STATES_AT } }) }),
    normalize: (input, previous) => {
      if (input.at === undefined) return previous(input);
      const { at, ...rest } = input;
      const normalized = previous(rest);
      if (!(normalized.states as string[]).every((state) => (STATES_AT as readonly string[]).includes(state))) {
        throw new TypeError(`unit-state.at reads only ${STATES_AT.join(", ")} at an earlier point.`);
      }
      return { ...normalized, at: enumValue(at, ["phase-start", "turn-start"], "unit-state.at") };
    },
  },
  // "Friendly WORLD EATERS units' melee attacks have +1 A": the units a bare filter before the
  // scope matches (compile-antecedent.ts binds the antecedent; compile-unit-filters.ts folds it).
  antecedentSubject("weapon-property-scope", "\"Friendly X units' melee attacks have\": the units a unit-filter right before it matches"),
  antecedentSubject("ignore-modifiers", "\"Friendly X units can ignore modifiers to …\": the units a unit-filter right before it matches, or a selected unit"),
];

/** A version whose subject also accepts antecedent: an earlier leaf's unit, bound when the record compiles. */
function antecedentSubject(family: string, example: string): FamilyExtension {
  return {
    family,
    description: `As the previous version, plus subject antecedent: ${example}.`,
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
    normalize: (input, previous) => input.subject === ANTECEDENT ? { ...previous({ ...input, subject: "this-unit" }), subject: ANTECEDENT } : previous(input),
  };
}
