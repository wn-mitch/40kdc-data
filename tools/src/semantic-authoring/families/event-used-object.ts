import type { FamilyExtension } from "../family-extension-helpers.js";
import { withProperties } from "../family-extension-helpers.js";
import { enumValue } from "../family-validation.js";

/** The units an Order (or other used rule) can be aimed at: this unit or this model. */
const USED_OBJECTS = ["this-unit", "this-model"] as const;

type Schema = Record<string, unknown>;

/**
 * "When that unit is issued an Order", "each time an Order is issued to this unit": the unit a used
 * rule is aimed at, not the one that used it. object names the receiving unit; subject, when given,
 * still names who used the rule.
 */
export const EVENT_USED_OBJECT_EXTENSIONS: readonly FamilyExtension[] = [
  {
    family: "event",
    version: 35,
    description: `As the previous version, plus object on a used event: the unit the used rule is aimed at (${USED_OBJECTS.join(", ")}), as in "when this unit is issued an Order". subject, when given, still names who used it.`,
    schema: (previous) => {
      const object = (previous.properties as Record<string, Schema>).object!;
      const when = object["x-only-when"] as { kind: string[] };
      return withProperties(previous, { object: { ...object, "x-only-when": { ...when, kind: [...when.kind, "used"] } } });
    },
    normalize: (input, previous) => {
      if (input.kind !== "used" || input.object === undefined) return previous(input);
      const { object, ...rest } = input;
      return { ...previous(rest), object: enumValue(object, USED_OBJECTS, "event.object") };
    },
  },
];
