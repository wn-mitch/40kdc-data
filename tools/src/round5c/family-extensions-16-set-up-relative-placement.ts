import type { FamilyExtension } from "./family-extension-helpers.js";

/**
 * Set-up relative placement (wave 10). "within Engagement Range of the destroyed model's unit" is the
 * permission an add-unit grants when a sentence says "If you do, that unit can be set up within
 * Engagement Range of …". The destroyed unit is the event object, so unit-position range_ref engagement
 * takes of event-object as well as the three subjects the previous version names.
 */

const EVENT_OBJECT = "event-object";

export const FAMILY_EXTENSIONS_16_SET_UP_RELATIVE_PLACEMENT: readonly FamilyExtension[] = [
  {
    family: "unit-position",
    description: "As the previous version, and range_ref engagement also measures a within distance of the Engagement Range to the event object (the destroyed unit or model). The add-unit permission it lowers to is allow_engagement_with.",
    schema: (previous) => previous,
    normalize: (input, previous) => {
      if (input.range_ref !== "engagement" || input.of !== EVENT_OBJECT) return previous(input);
      // The previous version checks subject, kind, distance and negation with this unit as the stand-in measure, then the measure is restored.
      const { of: _of, ...rest } = input;
      return { ...previous({ ...rest, of: "this-unit" }), of: EVENT_OBJECT };
    },
  },
];
