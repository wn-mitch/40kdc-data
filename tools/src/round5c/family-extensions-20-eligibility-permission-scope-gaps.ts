import { EVENT_SUBJECT, type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { boundedInteger } from "./family-validation.js";

/** The widest fight reach a leaf may name, in inches. */
const MAX_REACH = 12;

/**
 * Fight eligibility with a reach or an order. `reach` ("any models in it that are within 3" of an
 * enemy model are eligible to fight") is how far from the unit a model may be and still count as
 * eligible to fight. `next` ("must be the next unit you select to fight") puts the unit first in the
 * fight order. Both apply only to a fight permission that grants (allow true).
 */
const FIGHT_REACH_AND_NEXT: FamilyExtension = {
  family: "eligibility-permission",
  description: `As the previous version, plus reach (1 to ${MAX_REACH} inches: models that far from an enemy are eligible to fight) and next (true: the unit must be the next one selected to fight). Both only with activity fight and allow true.`,
  schema: (previous) => withProperties(previous, {
    reach: optional({ type: "integer", minimum: 1, maximum: MAX_REACH, "x-only-when": { activity: ["fight"] } }),
    next: optional({ const: true, "x-only-when": { activity: ["fight"] } }),
  }),
  normalize: (input, previous) => {
    if (input.reach === undefined && input.next === undefined) return previous(input);
    const { reach, next, ...rest } = input;
    if (rest.activity !== "fight") throw new TypeError("eligibility-permission.reach and next apply only to activity: fight.");
    if (rest.allow !== true) throw new TypeError("eligibility-permission.reach and next need allow: true.");
    // The previous version checks the rest of the leaf; the new keys are checked against their own values here.
    const normalized = previous(rest);
    return {
      ...normalized,
      ...(reach !== undefined ? { reach: boundedInteger(reach, 1, MAX_REACH, "eligibility-permission.reach") } : {}),
      ...(next !== undefined ? (() => { if (next !== true) throw new TypeError("eligibility-permission.next must be true."); return { next: true }; })() : {}),
    };
  },
};

/** "Do not make an Advance roll for it" under a move-ended trigger: the unit the event names. */
const NO_ADVANCE_ROLL_EVENT_SUBJECT: FamilyExtension = {
  family: "no-advance-roll",
  description: `As the previous version, and the subject can be the triggering unit (${EVENT_SUBJECT}), the unit a move-ended event names.`,
  schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [EVENT_SUBJECT]) }),
  normalize: (input, previous) => input.subject === EVENT_SUBJECT ? standIn(input, "subject", "this-unit", previous) : previous(input),
};

export const FAMILY_EXTENSIONS_20_ELIGIBILITY_PERMISSION_SCOPE_GAPS: readonly FamilyExtension[] = [FIGHT_REACH_AND_NEXT, NO_ADVANCE_ROLL_EVENT_SUBJECT];
