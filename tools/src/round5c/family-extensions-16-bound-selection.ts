import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/** A selection name: the bind_as of an earlier selection, or the name one selection binds. */
const SELECTION_NAME = { type: "string", pattern: "^[a-z][a-z0-9_-]*$", minLength: 1, maxLength: 40 };

/**
 * Wave-9 bound selections: a select-unit can bind the unit or model it selects under a name
 * (bind_as), and a later select-unit can measure its distance from that selection (within_of) or
 * require it to be visible to that selection (visible_to). "Select one enemy unit within 8\" of
 * that model" names the earlier selection, which the compiler checks (compile-bound-selection.ts).
 */
export const FAMILY_EXTENSIONS_16_BOUND_SELECTION: readonly FamilyExtension[] = [
  {
    family: "select-unit",
    description: "As the previous version, plus bind_as (names this selection for a later selection to refer to), within_of (the distance is measured from the named selection; requires distance within), and visible_to (visible to the named selection).",
    schema: (previous) => withProperties(previous, {
      bind_as: optional(SELECTION_NAME),
      within_of: optional(SELECTION_NAME),
      visible_to: optional(SELECTION_NAME),
    }),
    normalize: (input, previous) => {
      const { bind_as: bindAs, within_of: withinOf, visible_to: visibleTo, ...rest } = input;
      if (withinOf !== undefined && rest.distance !== "within") throw new TypeError("select-unit.within_of measures a distance, so it needs distance within.");
      const normalized = previous(rest);
      return {
        ...normalized,
        ...(bindAs !== undefined ? { bind_as: selectionName(bindAs, "select-unit.bind_as") } : {}),
        ...(withinOf !== undefined ? { within_of: selectionName(withinOf, "select-unit.within_of") } : {}),
        ...(visibleTo !== undefined ? { visible_to: selectionName(visibleTo, "select-unit.visible_to") } : {}),
      };
    },
  },
];

export function selectionName(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]*$/.test(value) || value.length > 40) throw new TypeError(`${field} is a lowercase selection name.`);
  return value;
}
