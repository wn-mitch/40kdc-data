import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";
import type { SemanticFamilyDefinition } from "./contracts.js";
import { NAMED_RANGES } from "./named-ranges.js";

/**
 * Engagement relations (wave 10). "engaged with nothing except your FORTIFICATIONS" is a marker
 * leaf, `engagement-exclusive`, that qualifies the engaged state after it (compile-engagement-exclusive.ts).
 * "is within Engagement Range of one or more" takes the Engagement Range itself as its distance:
 * unit-position range_ref engagement, measured to this unit, this model or the following filter.
 */

/** A base family: the leaf takes no parameters; the state it qualifies is its following unit-state. */
export const ENGAGEMENT_RELATION_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "engagement-exclusive",
    version: 1,
    role: "CONDITION",
    label: "Engaged with only",
    description: "Qualifies the engaged state that follows: engaged with the named units and no others (\"only within Engagement Range of one or more FORTIFICATIONS from your army\"). Takes no parameters.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/** The distance a unit-position range_ref engagement names: the Engagement Range, which no aura carries. */
const NAMED_RANGE_REFS = [...Object.keys(NAMED_RANGES), "engagement"];
const ENGAGEMENT_OF = ["this-unit", "this-model", "following-filter"];

export const FAMILY_EXTENSIONS_16_ENGAGEMENT_RELATION: readonly FamilyExtension[] = [
  {
    family: "unit-position",
    description: "As the previous version, and range_ref engagement measures a within distance of the Engagement Range itself, to this unit, this model or the following filter's units. A named Synapse or Contagion range is unchanged.",
    schema: (previous) => withProperties(previous, {
      range_ref: optional({ enum: NAMED_RANGE_REFS, "x-only-when": { kind: ["within"] } }),
    }),
    normalize: (input, previous) => {
      if (input.range_ref !== "engagement") return previous(input);
      const { range_ref: _rangeRef, ...rest } = input;
      if (rest.kind !== "within") throw new TypeError("unit-position.range_ref measures a within distance; beyond a named range is not authored.");
      if ("inches" in rest) throw new TypeError("unit-position takes range_ref or inches, not both.");
      if ("wholly" in rest) throw new TypeError("unit-position.range_ref cannot be wholly within a named range.");
      if (typeof rest.of !== "string" || !ENGAGEMENT_OF.includes(rest.of)) {
        throw new TypeError(`unit-position.range_ref engagement takes of ${ENGAGEMENT_OF.join(", ")}; of matching-unit has no DSL form.`);
      }
      // The previous version checks subject, of and negated with a stand-in distance; the stand-in is not kept.
      const { inches: _standIn, ...checked } = previous({ ...rest, inches: 1 });
      return { ...checked, range_ref: "engagement" };
    },
  },
];
