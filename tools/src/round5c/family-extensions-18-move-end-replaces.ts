import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * The eighteenth round of family extensions: a cannot-end restriction can replace the usual end
 * threshold. The replacement's move kinds come from the trigger, not the leaf (move_types stays
 * restricted to MOVE_SUBSET in version 3, so it cannot name ingress or surge).
 */
export const FAMILY_EXTENSIONS_18_MOVE_END_REPLACES: readonly FamilyExtension[] = [
  {
    // "can end that move more than 6\" horizontally from all enemy units (instead of more than 8\")".
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
