import { type FamilyExtension, optional, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/** The objective destinations version 2 adds; following-filter is the version 1 unit destination. */
const OBJECTIVE_TO = ["closest-objective-marker", "selected-objective"] as const;
const TO_VALUES = ["following-filter", ...OBJECTIVE_TO] as const;

/**
 * The eighteenth round of family extensions: a move-end nearest can end as close as possible to an
 * objective marker (any one, or the one a select-objective bound), per unit or per model, and can
 * name the closest enemy unit as the place it need not be closer than ("instead of").
 */
export const FAMILY_EXTENSIONS_18_MOVE_END_NEAREST: readonly FamilyExtension[] = [
  {
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
];
