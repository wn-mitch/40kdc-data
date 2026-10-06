import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { FOLLOWING_FILTER } from "./family-extensions-11.js";
import { boundedInteger, enumValue } from "./family-validation.js";

/**
 * Family versions for Stratagems with several targets ("One X unit and one Y unit within 6\" of
 * it"). Each version checks only its own additions and hands the rest of a leaf to the previous
 * version, so every earlier leaf moves across unchanged.
 */

/** A unit-filter that picks among the Stratagem's own targets rather than among all units. */
export const AMONG_TARGETS = "stratagem-targets";
/** How many of the matching targets an among-filter names. */
export const TARGET_PICKS = ["one", "every", "any"] as const;
/** A condition in TARGET about every target named before it ("that have not been selected …"). */
export const EACH_TARGET = "each-target";

const AMONG_FILTER: FamilyExtension = {
  // "your **VEHICLE** unit", "one of those units", "both of those units" after two targets.
  family: "unit-filter",
  description: "As the previous version, plus among and targets, always together. among stratagem-targets: the filter picks among this Stratagem's targets (\"your **VEHICLE** unit\", \"that **TRANSPORT**\", \"those units\"), not among all units. targets: one = the single target it matches; every = all matching targets (all of them, in a condition: \"both of those units\"); any = any one matching target (in a condition: \"one of those units\"; an effect or moment applies to each). Side any when no side is printed.",
  schema: (previous) => withProperties(previous, {
    among: optional({ const: AMONG_TARGETS }),
    targets: optional({ enum: [...TARGET_PICKS], "x-only-when": { among: [AMONG_TARGETS] } }),
  }),
  normalize: (input, previous) => {
    if (!("among" in input) && !("targets" in input)) return previous(input);
    const { among, targets, ...rest } = input;
    if (among !== AMONG_TARGETS) throw new TypeError(`unit-filter.among must be ${AMONG_TARGETS}, with targets.`);
    const picked = enumValue(targets, TARGET_PICKS, "unit-filter.targets");
    return { ...previous(rest), among: AMONG_TARGETS, targets: picked };
  },
};

const EXACT_COUNT: FamilyExtension = {
  // "Two **SKITARII** units from your army".
  family: "stratagem-target",
  description: "As the previous version, plus count exactly with count_exact (2-10): exactly that many units, each meeting the same restrictions (\"Two **X** units\").",
  schema: (previous) => withProperties(previous, {
    count: widenedEnum(previous, "count", ["exactly"]),
    count_exact: { type: "integer", minimum: 2, maximum: 10, "x-only-when": { count: ["exactly"] } },
  }),
  normalize: (input, previous) => {
    if (input.count !== "exactly") {
      if ("count_exact" in input) throw new TypeError("stratagem-target.count_exact needs count exactly.");
      return previous(input);
    }
    const { count_exact: exact, ...rest } = input;
    const normalized = previous({ ...rest, count: "one" });
    return { ...normalized, count: "exactly", count_exact: boundedInteger(exact, 2, 10, "stratagem-target.count_exact") };
  },
};

const VISIBLE_TO_FILTER: FamilyExtension = {
  // "visible to your **PSYKER** model": the observer is the unit-filter right after the leaf.
  family: "visible",
  description: "As the previous version, plus to following-filter: visible to any unit or model the unit-filter right after this leaf, in the same clause, matches (\"visible to\" + \"your **PSYKER** model\").",
  schema: (previous) => withProperties(previous, { to: widenedEnum(previous, "to", [FOLLOWING_FILTER]) }),
  normalize: (input, previous) => input.to === FOLLOWING_FILTER ? standIn(input, "to", "this-unit", previous) : previous(input),
};

/** act-after-move and no-advance-roll whose unit an earlier leaf introduced ("it", "your **X** unit"). */
function subjectAntecedent(family: string, example: string): FamilyExtension {
  return {
    family,
    description: `As the previous version, plus subject antecedent: the unit an earlier leaf introduced (${example}).`,
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
    normalize: (input, previous) => input.subject === ANTECEDENT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  };
}

const EACH_TARGET_ACTIVITY: FamilyExtension = {
  // "One **X** unit and one **Y** unit … that have not been selected to shoot this phase".
  family: "unit-activity",
  description: "As the previous version, plus subject each-target: every Stratagem target named before it in TARGET, for a relative clause with plural agreement after coordinated targets (\"One **X** unit and one **Y** unit that have not been selected …\").",
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EACH_TARGET]) }),
  normalize: (input, previous) => input.subject === EACH_TARGET ? standIn(input, "subject", "this-unit", previous) : previous(input),
};

export const FAMILY_EXTENSIONS_W8_MULTI: readonly FamilyExtension[] = [
  AMONG_FILTER,
  EXACT_COUNT,
  VISIBLE_TO_FILTER,
  subjectAntecedent("act-after-move", "\"your **VEHICLE** unit\" + \"is eligible to shoot and declare a charge in a turn in which it Fell Back\""),
  subjectAntecedent("no-advance-roll", "\"do not make an Advance roll for it\""),
  EACH_TARGET_ACTIVITY,
];
