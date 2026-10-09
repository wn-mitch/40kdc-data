import { type FamilyExtension, optional, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/** The objective destinations version 2 adds; following-filter is the version 1 unit destination. */
const OBJECTIVE_TO = ["closest-objective-marker", "selected-objective"] as const;
const TO_VALUES = ["following-filter", ...OBJECTIVE_TO] as const;

/**
 * The move-end requirement round of family extensions (wave 10):
 * - move-end-nearest version 2: the destination can be an objective marker (any one, or the one a
 *   select-objective bound), per unit or per model, and instead_of names the closest enemy unit the
 *   move need not end closer to.
 * - move-must-end version 4: a cannot-end restriction can replace the usual end threshold. Its move
 *   kinds come from the trigger, not the leaf (move_types stays restricted to MOVE_SUBSET in version 3).
 */
export const FAMILY_EXTENSIONS_16_MOVE_END_REQUIREMENT: readonly FamilyExtension[] = [
  {
    // "must end that move as close as possible to the closest objective marker"
    family: "move-end-nearest",
    description: "As the previous version, and to may be closest-objective-marker (any objective marker) or selected-objective (the objective a select-objective bound). per (unit or model) applies to an objective destination only. instead_of closest-enemy-unit names the enemy unit the move is not required to end closer to, with any destination.",
    schema: (previous) => withProperties(previous, {
      to: widenedEnum(previous, "to", [...OBJECTIVE_TO]),
      per: optional({ enum: ["unit", "model"], "x-only-when": { to: [...OBJECTIVE_TO] } }),
      instead_of: optional({ const: "closest-enemy-unit" }),
    }),
    normalize: (input) => {
      const allowed = ["to", "per", "instead_of"];
      for (const key of Object.keys(input)) {
        if (!allowed.includes(key)) throw new TypeError(`move-end-nearest.${key} is not a parameter of version 2.`);
      }
      const to = enumValue(input.to, TO_VALUES, "move-end-nearest.to");
      const result: Record<string, unknown> = { to };
      if (input.per !== undefined) {
        if (to === "following-filter") throw new TypeError("move-end-nearest.per applies only to an objective destination.");
        result.per = enumValue(input.per, ["unit", "model"], "move-end-nearest.per");
      }
      if (input.instead_of !== undefined) {
        if (input.instead_of !== "closest-enemy-unit") throw new TypeError("move-end-nearest.instead_of must be closest-enemy-unit.");
        result.instead_of = "closest-enemy-unit";
      }
      return result;
    },
  },
  {
    // "can end that move more than 6\" horizontally from all enemy units (instead of more than 8\")"
    family: "move-must-end",
    description: "As the previous version, plus replaces: true, for a cannot restriction that replaces the usual end threshold (\"instead of more than 8\\\"\"). Its move kinds come from the trigger. Absent, the restriction adds to the usual rules.",
    schema: (previous) => withProperties(previous, {
      replaces: optional({ const: true, "x-only-when": { polarity: ["cannot"] } }),
    }),
    normalize: (input, previous) => {
      if (input.replaces === undefined) return previous(input);
      if (input.replaces !== true) throw new TypeError("move-must-end.replaces must be true, or omitted.");
      if (input.polarity !== "cannot") throw new TypeError("move-must-end.replaces applies only to polarity cannot.");
      const { replaces: _replaces, ...rest } = input;
      return { ...previous(rest), replaces: true };
    },
  },
];
