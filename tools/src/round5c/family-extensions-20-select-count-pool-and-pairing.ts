import type { FamilyExtension } from "./family-extension-helpers.js";
import { selectionName } from "./family-extensions-16-bound-selection.js";

/**
 * select-unit with a within_of and no distance of its own: "select one TRANSPORT that unit is
 * wholly within 6\" of" after a bound selection. The relation to the named selection is carried by
 * a candidate leaf (unit-position or eligible) that follows the select, so the select itself
 * measures nothing. Earlier versions require distance within for within_of; this one does not.
 */
export const FAMILY_EXTENSIONS_20_SELECT_COUNT_POOL_AND_PAIRING: readonly FamilyExtension[] = [
  {
    family: "select-unit",
    description: "As the previous version, plus within_of on a select whose distance is any: the relation to the named selection is carried by a candidate leaf (unit-position or eligible) that follows the select. within_of no longer requires distance within.",
    schema: (previous) => previous,
    normalize: (input, previous) => {
      const { within_of: withinOf, ...rest } = input;
      if (withinOf === undefined || rest.distance === "within") return previous(input);
      return { ...previous(rest), within_of: selectionName(withinOf, "select-unit.within_of") };
    },
  },
];
