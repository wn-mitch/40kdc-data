import { type FamilyExtension, optional, properties, type Schema, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 destruction by the triggering attacks: "if those attacks destroyed an enemy unit", "if
 * one or more enemy models were destroyed by those attacks". The two activities name what was
 * destroyed; `named` places the unit-filter that names it (before or after the verb, or none),
 * `container` says a model's unit is named after it, and `destroyer` says who made the attacks.
 * A destruction leaf takes no subject. Lowering: compile-triggering-destruction.ts.
 */
export const DESTRUCTION_ACTIVITIES = ["destroyed-units-by-triggering-attacks", "destroyed-models-by-triggering-attacks"] as const;
export const DESTROYERS = ["this-unit", "event-subject", "stratagem-target"] as const;
const NAMED = ["before", "after", "none"] as const;
const CONTAINER = ["after", "none"] as const;
const DESTRUCTION_PARAMETERS = ["named", "container", "destroyer"] as const;

export const FAMILY_EXTENSIONS_17_TRIGGERING_DESTRUCTION: readonly FamilyExtension[] = [
  {
    family: "unit-activity",
    description: "As the previous version, plus two destruction activities (destroyed-units-by-triggering-attacks, destroyed-models-by-triggering-attacks) with named (before, after or none), container (after or none), and destroyer (this-unit, event-subject or stratagem-target); a destruction leaf takes no subject.",
    schema: (previous) => {
      const property = properties(previous).activities!;
      const items = property.items as Schema;
      const extended = withProperties(previous, {
        activities: { ...property, items: { ...items, enum: [...(items.enum as string[]), ...DESTRUCTION_ACTIVITIES] } },
        named: optional({ enum: [...NAMED] }),
        container: optional({ enum: [...CONTAINER] }),
        destroyer: optional({ enum: [...DESTROYERS] }),
      });
      return { ...extended, required: (previous.required as string[]).filter((key) => key !== "subject") };
    },
    normalize: (input, previous) => {
      const listed = Array.isArray(input.activities) ? input.activities as unknown[] : [];
      const destruction = listed.filter((activity) => (DESTRUCTION_ACTIVITIES as readonly unknown[]).includes(activity));
      if (destruction.length === 0) {
        if (DESTRUCTION_PARAMETERS.some((key) => key in input)) throw new TypeError("unit-activity named, container and destroyer belong to a triggering destruction activity.");
        if (input.subject === undefined) throw new TypeError("unit-activity needs a subject unless it is a triggering destruction activity.");
        return previous(input);
      }
      if (listed.length !== 1) throw new TypeError("destroyed-by-triggering-attacks: one destruction activity per leaf.");
      if (input.subject !== undefined) throw new TypeError("unit-activity destruction activities take no subject; destroyer names who made the attacks.");
      if (!(DESTROYERS as readonly unknown[]).includes(input.destroyer)) throw new TypeError("unit-activity destruction activity needs destroyer: this-unit, event-subject or stratagem-target.");
      if (!(NAMED as readonly unknown[]).includes(input.named)) throw new TypeError("unit-activity destruction activity needs named: before, after or none.");
      if (!(CONTAINER as readonly unknown[]).includes(input.container)) throw new TypeError("unit-activity destruction activity needs container: after or none.");
      const { named, container, destroyer, ...rest } = input;
      // The previous version checks the shared parameters (negated) with a known activity standing in.
      const { subject: _subject, ...normalized } = previous({ ...rest, activities: ["remained-stationary"], subject: "this-unit" });
      return { ...normalized, activities: [destruction[0]], named, container, destroyer };
    },
  },
];
