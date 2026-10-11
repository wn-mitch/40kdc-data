import { type FamilyExtension, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/** The unit an event names: the enemy unit a move-ended or selected trigger is about. */
const EVENT_SUBJECT = "event-subject";
const THIS_MODEL = "this-model";
const ENGAGED = "engaged";
const ON_BATTLEFIELD = "on-battlefield";

/**
 * The move-end requirement follow-up round of family extensions (wave 10):
 * - move-end-nearest version 3: the destination can be the enemy unit the trigger names
 *   (to: event-subject), "as close as possible to that enemy unit". The unit comes from the event,
 *   not from a unit-filter after the leaf, and the end takes no per-model form and no instead_of.
 * - unit-state version 15: a this-model subject can be engaged (the model is in Engagement Range).
 *   Only that alone-state, not negated, with no with or at is new; every other input, including the
 *   this-model states the previous version accepts (on the battlefield, embarked), goes to the previous
 *   version unchanged.
 */
export const FAMILY_EXTENSIONS_16_MOVE_END_REQUIREMENT_FOLLOWUP: readonly FamilyExtension[] = [
  {
    // "must end that move as close as possible to that enemy unit" (the unit the trigger names).
    family: "move-end-nearest",
    description: "As the previous version, and to: event-subject ends the move as close as possible to the enemy unit the trigger names. It takes no per and no instead_of.",
    schema: (previous) => withProperties(previous, { to: widenedEnum(previous, "to", [EVENT_SUBJECT]) }),
    normalize: (input, previous) => {
      if (input.to !== EVENT_SUBJECT) return previous(input);
      if (input.per !== undefined) throw new TypeError("move-end-nearest.per applies to an objective destination; a move-end nearest the enemy unit names no per-model form.");
      if (input.instead_of !== undefined) throw new TypeError("move-end-nearest.instead_of has no form with a move-end to the enemy unit the trigger names.");
      for (const key of Object.keys(input)) {
        if (key !== "to") throw new TypeError(`move-end-nearest.${key} is not a parameter of version 3 with to: event-subject.`);
      }
      return { to: EVENT_SUBJECT };
    },
  },
  {
    // "cannot end that move within Engagement Range of them": the model holder's own engagement.
    family: "unit-state",
    description: "As the previous version, plus a this-model subject may be engaged (alone, not negated, with no with or at): \"that model is within Engagement Range\". Other inputs are the previous version's.",
    schema: (previous) => previous,
    normalize: (input, previous) => {
      if (input.subject !== THIS_MODEL) return previous(input);
      // Only an engaged this-model condition is new; every other this-model input is the previous version's answer.
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      if (!(states.length === 1 && states[0] === ENGAGED)) return previous(input);
      if (input.negated !== false) throw new TypeError("unit-state: an engaged this-model condition is not negated.");
      if (input.with !== undefined) throw new TypeError("unit-state: an engaged this-model condition takes no with.");
      if (input.at !== undefined) throw new TypeError("unit-state: an engaged this-model condition takes no at.");
      // The previous version refuses an engaged this-model condition; on-battlefield stands in for the check, and the states are restored.
      return standIn(input, "states", [ON_BATTLEFIELD], previous);
    },
  },
];
