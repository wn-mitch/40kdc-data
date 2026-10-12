import type { SemanticFamilyDefinition } from "./contracts.js";
import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/** The units the unit-filter before a leaf names ("one or more X are on the battlefield", "no other friendly units"); compile-antecedent.ts FILTERED_UNITS. */
const FILTERED_UNITS = "filtered-units";
const THIS_MODEL = "this-model";
const ENGAGED = "engaged";

/**
 * A base family: "excluding" in "(excluding units with X that are not Y and are not within Z)". The
 * conditions after it, up to the closing parenthesis, are one group, and the units meeting all of
 * them are excluded (compile-condition-exclusions.ts). Takes no parameters.
 */
export const CONDITION_EXCLUSION_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "condition-exclusion",
    version: 1,
    role: "CONDITION",
    label: "Excluding units that",
    description: "Qualifies the conditions that follow it, up to the closing parenthesis (or the end of the sentence): the units meeting all of them are excluded. Takes no parameters.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export const FAMILY_EXTENSIONS_20_UNIT_STATE_AND_PRESENCE_VALUES: readonly FamilyExtension[] = [
  {
    family: "unit-state",
    description: "As the previous version, plus subject filtered-units (\"one or more Neurotyrants are on the battlefield\", \"no other friendly units are engaged with that unit\"); and a this-model subject may be engaged with negated, with and at, as a this-unit subject may (\"if this model is not within Engagement Range of one or more enemy units\").",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [FILTERED_UNITS]) }),
    normalize: (input, previous) => {
      if (input.subject === FILTERED_UNITS) return standIn(input, "subject", "this-unit", previous);
      const states = Array.isArray(input.states) ? input.states as unknown[] : [];
      if (input.subject === THIS_MODEL && states.length === 1 && states[0] === ENGAGED) {
        // A this-model engaged condition is checked as a this-unit one (negated, with, at); the subject is put back.
        if (input.with === THIS_MODEL) throw new TypeError("unit-state: a model cannot be engaged with itself.");
        return standIn(input, "subject", "this-unit", previous);
      }
      return previous(input);
    },
  },
  {
    family: "unit-position",
    description: "As the previous version, plus subject filtered-units: the units the unit-filter before this leaf names (\"one or more friendly OFFICER models\" + \"within 6\\\"\"). The position holds when any of them meets it, or none of them, when negated.",
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [FILTERED_UNITS]) }),
    normalize: (input, previous) => input.subject === FILTERED_UNITS ? standIn(input, "subject", "this-unit", previous) : previous(input),
  },
  {
    family: "unit-filter",
    description: "As the previous version, plus other_than event-subject: \"other\" means other than the unit the trigger names, not the unit with the ability (\"no other friendly units\" when a unit is selected to shoot).",
    schema: (previous) => withProperties(previous, { other_than: optional({ enum: ["event-subject"], "x-only-when": { other: [true] } }) }),
    normalize: (input, previous) => {
      if (input.other_than === undefined) return previous(input);
      const { other_than: otherThan, ...rest } = input;
      if (otherThan !== "event-subject") throw new TypeError("unit-filter.other_than names event-subject.");
      if (rest.other !== true) throw new TypeError("unit-filter.other_than needs other: true.");
      return { ...previous(rest), other_than: "event-subject" };
    },
  },
];
