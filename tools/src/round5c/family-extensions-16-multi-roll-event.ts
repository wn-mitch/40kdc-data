import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";
import { rollSubject } from "./family-extensions-11.js";
import { TRIGGER_ROLL_KINDS } from "./dice-families.js";
import { enumSet, enumValue } from "./family-validation.js";

/**
 * Wave-10 multi-roll events: one moment over a list of roll kinds ("after making a Hit roll, Wound
 * roll or saving throw"), and the roll-auto-result that names the roll a moment changed. As in the
 * other extension files, each version checks only its own additions and hands the rest on.
 */

/** The moments a roll names: a roll before it is made, or after it is made. */
const ROLL_MOMENTS = ["before-roll", "after-roll"] as const;

const EVENT_ROLLS: FamilyExtension = {
  // One leaf for a list of roll kinds; triggerLeaves() (compile-triggers.ts) lowers it to one trigger per kind.
  family: "event",
  description: "As the previous version, plus rolls: two or more roll kinds one before-roll or after-roll moment covers (\"after making a Hit roll, Wound roll or saving throw\"), which lowers to one trigger per kind. roll takes only the kinds a DSL trigger can name (no any, all, attacks, surge or resource-die).",
  schema: (previous) => withProperties(previous, {
    rolls: optional({ type: "array", items: { enum: TRIGGER_ROLL_KINDS }, minItems: 2, uniqueItems: true, "x-only-when": { kind: ROLL_MOMENTS } }),
  }),
  normalize: (input, previous) => {
    if (!("rolls" in input)) {
      if (ROLL_MOMENTS.includes(input.kind as typeof ROLL_MOMENTS[number]) && input.roll !== undefined) enumValue(input.roll, TRIGGER_ROLL_KINDS, "event.roll");
      return previous(input);
    }
    const { rolls, ...rest } = input;
    if (rest.roll !== undefined) throw new TypeError("event names roll or rolls, not both.");
    if (!ROLL_MOMENTS.includes(rest.kind as typeof ROLL_MOMENTS[number])) throw new TypeError("event.rolls applies to a before-roll or after-roll moment.");
    const kinds = enumSet(rolls, TRIGGER_ROLL_KINDS, "event.rolls");
    if (kinds.length < 2) throw new TypeError("event.rolls lists two or more roll kinds; a single kind is event.roll.");
    // The previous version checks kind and subject with one roll; the list replaces that roll afterwards.
    const { roll: _roll, ...normalized } = previous({ ...rest, roll: kinds[0] });
    return { ...normalized, rolls: kinds };
  },
};

export const FAMILY_EXTENSIONS_16_MULTI_ROLL_EVENT: readonly FamilyExtension[] = [
  EVENT_ROLLS,
  // "Change the result of that roll to an unmodified 6": subject names whose roll it is, so a
  // "this model" roll targets that model rather than the unit.
  rollSubject("roll-auto-result", "\"after making a Hit roll … change the result of that roll\": the model whose roll it is"),
];
