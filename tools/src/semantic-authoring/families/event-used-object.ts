import type { FamilyExtension } from "../family-extension-helpers.js";
import { optional, withProperties } from "../family-extension-helpers.js";
import { enumValue } from "../family-validation.js";
import { FILTERED_UNITS, NAMED_ID, namedId } from "./shared.js";

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
  {
    // "When a friendly X unit within 12\" of that model is targeted with a Stratagem"; "with the Fire Overwatch/Heroic Intervention Stratagem".
    family: "event",
    version: 36,
    description: `As the previous version, plus, on a used event, object ${FILTERED_UNITS} (the rule is aimed at a unit the unit-filter right before names, with an optional within distance between them) and ids: two or more rules, any one of which was used ("the Fire Overwatch/Heroic Intervention Stratagem"); ids replaces id.`,
    schema: (previous) => {
      const object = (previous.properties as Record<string, Schema>).object!;
      return withProperties(previous, {
        object: { ...object, enum: [...(object.enum as string[]), FILTERED_UNITS] },
        ids: optional({ type: "array", items: { type: "string", pattern: NAMED_ID.source }, minItems: 2, uniqueItems: true, "x-only-when": { kind: ["used"] } }),
      });
    },
    normalize: (input, previous) => {
      const { ids, ...rest } = input;
      const filtered = input.object === FILTERED_UNITS;
      if ((filtered || ids !== undefined) && input.kind !== "used") throw new TypeError(`event.ids and object ${FILTERED_UNITS} describe a used event.`);
      if (ids !== undefined && input.id !== undefined) throw new TypeError("event.ids lists the rules instead of id; name one or the other.");
      // The previous version checks the rest with this unit standing in for the filtered object.
      const normalized = previous(filtered ? { ...rest, object: "this-unit" } : rest);
      if (filtered) normalized.object = FILTERED_UNITS;
      if (ids === undefined) return normalized;
      if (!Array.isArray(ids) || ids.length < 2) throw new TypeError("event.ids lists two or more rules; one rule is id.");
      const list = ids.map((id) => namedId(id, "event.ids"));
      if (new Set(list).size !== list.length) throw new TypeError("event.ids names a rule twice.");
      return { ...normalized, ids: list };
    },
  },
];
