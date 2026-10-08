import { DESIGNATION_IDS } from "../translate/designations.js";
import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/**
 * Wave-9 affected-by-ability-relation: a designation that one unit applies to another (a Bondsman's
 * affected unit), and a unit filter that names the units carrying such a designation. Each version
 * checks only its own additions and hands the rest of a leaf to the previous version.
 */

/** Who applied a designation an apply-mark tags: the unit with the ability, its selected unit, or the moment's unit. */
const APPLIER = ["this-unit", "this-model", "selected-unit", "event-subject"] as const;

/** Who applied a designation a unit-filter names: a unit, not a model. */
const FILTER_APPLIER = ["this-unit", "selected-unit", "event-subject"] as const;

/** Kebab-case, as every registered designation id is; the registry check follows in normalize. */
const DESIGNATION_PATTERN = "^[a-z0-9][a-z0-9-]*[a-z0-9]$";

export const FAMILY_EXTENSIONS_13_AFFECTED_BY: readonly FamilyExtension[] = [
  {
    // "Those models are affected by that Bondsman ability": the tagged unit records who tagged it.
    family: "apply-mark",
    description: "As the previous version, plus by: the unit that applied the designation (this-unit, this-model, selected-unit or event-subject). The designation ends at the record's printed duration (compile-designation-expiry.ts), so a by with no printed duration is refused at compile time.",
    schema: (previous) => withProperties(previous, { by: optional({ enum: [...APPLIER] }) }),
    normalize: (input, previous) => {
      if (input.by === undefined) return previous(input);
      const { by, ...rest } = input;
      return { ...previous(rest), by: enumValue(by, [...APPLIER], "apply-mark.by") };
    },
  },
  {
    // "While a model is affected by this ability": the units a Bondsman applied a designation to.
    family: "unit-filter",
    description: "As the previous version, plus designated: a registered designation the unit carries, and designated_by: the unit that applied it (this-unit, selected-unit or event-subject). designated_by needs designated.",
    schema: (previous) => withProperties(previous, {
      designated: optional({ type: "string", pattern: DESIGNATION_PATTERN }),
      designated_by: optional({ enum: [...FILTER_APPLIER] }),
    }),
    normalize: (input, previous) => {
      if (input.designated === undefined && input.designated_by === undefined) return previous(input);
      const { designated, designated_by: by, ...rest } = input;
      if (designated === undefined) throw new TypeError("unit-filter.designated_by needs designated.");
      if (typeof designated !== "string" || !DESIGNATION_IDS.has(designated)) throw new TypeError(`unit-filter.designated ${JSON.stringify(designated)} is not a registered designation.`);
      const normalized = previous(rest);
      return { ...normalized, designated, ...(by === undefined ? {} : { designated_by: enumValue(by, [...FILTER_APPLIER], "unit-filter.designated_by") }) };
    },
  },
];
