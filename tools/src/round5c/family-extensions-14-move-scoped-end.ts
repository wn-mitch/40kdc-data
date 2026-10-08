import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";
import { enumSet } from "./family-validation.js";
import { MOVE_SUBSET } from "./movement-families.js";

/**
 * Wave-9 move-must-end move_types: the restriction covers only the listed kinds of move, as in
 * "unless it made a Charge move, cannot end that move within Engagement Range of them". Absent, the
 * restriction covers every move its trigger names.
 */
export const FAMILY_EXTENSIONS_14_MOVE_SCOPED_END: readonly FamilyExtension[] = [
  {
    family: "move-must-end",
    description: "As the previous version, plus move_types: the restriction covers only the listed move kinds (\"cannot end a Normal or Advance move within Engagement Range of them\"). Absent, it covers every move the trigger names.",
    schema: (previous) => withProperties(previous, {
      move_types: optional({ type: "array", items: { enum: [...MOVE_SUBSET] }, minItems: 1, uniqueItems: true }),
    }),
    normalize: (input, previous) => {
      if (input.move_types === undefined) return previous(input);
      const { move_types: moveTypes, ...rest } = input;
      return { ...previous(rest), move_types: enumSet(moveTypes, MOVE_SUBSET, "move-must-end.move_types") };
    },
  },
];
