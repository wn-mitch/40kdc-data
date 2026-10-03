import { EVENT_SUBJECT, type FamilyExtension, standIn, withProperties, widenedEnum } from "./family-extension-helpers.js";

/**
 * The seventh round of family extensions. As in the earlier rounds, a version checks only its own
 * additions and hands the rest to the previous version.
 */
export const FAMILY_EXTENSIONS_7: readonly FamilyExtension[] = [
  {
    // "Each time an enemy unit ends a Charge move, … that unit suffers D3 mortal wounds": the unit
    // whose action fired the trigger, which the DSL's mortal-wounds target names as event-subject.
    family: "mortal-wounds",
    description: "As the previous version, and the recipient can be event-subject: the unit whose action fired the trigger (\"that unit suffers D3 mortal wounds\" after \"each time an enemy unit ends a Charge move\").",
    schema: (previous) => withProperties(previous, { recipient: widenedEnum(previous, "recipient", [EVENT_SUBJECT]) }),
    normalize: (input, previous) => input.recipient === EVENT_SUBJECT ? standIn(input, "recipient", "this-unit", previous) : previous(input),
  },
];
