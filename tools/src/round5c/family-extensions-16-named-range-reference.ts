import { ANTECEDENT } from "./antecedent-families.js";
import { type FamilyExtension, keywordList, KEYWORD_ITEMS, optional, withProperties } from "./family-extension-helpers.js";
import { NAMED_RANGES } from "./named-ranges.js";

/**
 * Named-range references: "inside Synapse Range of your host" and "inside Contagion Range of this
 * unit". The distance is the named range's aura (`range_ref`), not a number of inches, and the
 * leaf says only which units are measured to. A matching unit can exclude keywords (`of_excluded_keywords`)
 * for "(excluding NEUROGAUNT units)".
 */

const RANGE_NAMES = Object.keys(NAMED_RANGES);
const EXCLUDED_KEYWORDS_SCHEMA = { type: "array", items: KEYWORD_ITEMS, minItems: 1, uniqueItems: true, "x-only-when": { of: ["matching-unit"] } };
const NAMED_OF = ["this-unit", "this-model", "matching-unit"];

export const FAMILY_EXTENSIONS_16_NAMED_RANGE_REFERENCE: readonly FamilyExtension[] = [
  {
    // "inside Synapse Range of your host": the distance is a named range, measured to units of the army.
    family: "unit-position",
    description: "As the previous version, plus range_ref: within a named range (contagion or synapse) instead of inches. The named range's aura carries its anchor; of says whose units are measured to (this-unit, this-model, or matching-unit with of_side). of_excluded_keywords, on of matching-unit, excludes units that have any of the keywords.",
    schema: (previous) => withProperties(previous, {
      range_ref: optional({ enum: RANGE_NAMES, "x-only-when": { kind: ["within"] } }),
      of_excluded_keywords: optional(EXCLUDED_KEYWORDS_SCHEMA),
    }),
    normalize: (input, previous) => {
      const { range_ref: rangeRef, of_excluded_keywords: excluded, ...rest } = input;
      if (excluded !== undefined && rest.of !== "matching-unit") throw new TypeError("unit-position.of_excluded_keywords goes with of: matching-unit.");
      if (rangeRef === undefined) {
        if (excluded === undefined) return previous(input);
        return { ...previous(rest), of_excluded_keywords: keywordList(excluded, "unit-position.of_excluded_keywords", 1) };
      }
      if (typeof rangeRef !== "string" || !RANGE_NAMES.includes(rangeRef)) throw new TypeError(`unit-position.range_ref names one of ${RANGE_NAMES.join(", ")}.`);
      if (rest.kind !== "within") throw new TypeError("unit-position.range_ref measures a within distance; beyond a named range is not authored.");
      if ("inches" in rest) throw new TypeError("unit-position takes range_ref or inches, not both.");
      if ("wholly" in rest) throw new TypeError("unit-position.range_ref cannot be wholly within a named range.");
      if (typeof rest.of !== "string" || !NAMED_OF.includes(rest.of)) throw new TypeError(`unit-position.range_ref needs of: ${NAMED_OF.join(", ")}.`);
      if (rest.of === "matching-unit" && rest.of_side === undefined) throw new TypeError("unit-position.range_ref on of matching-unit needs of_side.");
      if (rest.of === "matching-unit" && rest.of_other !== undefined) throw new TypeError("unit-position.range_ref does not take of_other.");
      if (rest.of !== "matching-unit" && rest.of_side !== undefined) throw new TypeError("unit-position.of_side goes with of: matching-unit.");
      // The previous version checks subject, of, of_side, of_keywords and negated with a stand-in distance; the stand-in is not kept.
      const { inches: _standIn, ...checked } = previous({ ...rest, inches: 1 });
      return {
        ...checked,
        range_ref: rangeRef,
        ...(excluded !== undefined ? { of_excluded_keywords: keywordList(excluded, "unit-position.of_excluded_keywords", 1) } : {}),
      };
    },
  },
  {
    // "that foe unit has the effect … and sits inside Contagion Range of your host" / "that unit is inside Synapse Range of your host".
    family: "counts-as",
    description: "As the previous version, plus range_ref synapse with of_side friendly: the target counts as within a named range of your host (\"that unit is inside Synapse Range of your host\"). Takes no within and no region; the subject is the antecedent, this unit or this model.",
    schema: (previous) => withProperties(previous, {
      range_ref: optional({ enum: ["synapse"] }),
      of_side: optional({ enum: ["friendly"], "x-only-when": { range_ref: ["synapse"] } }),
    }),
    normalize: (input, previous) => {
      if (!("range_ref" in input)) {
        if ("of_side" in input) throw new TypeError("counts-as.of_side goes with range_ref.");
        return previous(input);
      }
      if ("within" in input) throw new TypeError("counts-as takes within, region or range_ref, not within and range_ref.");
      if ("region" in input) throw new TypeError("counts-as takes within, region or range_ref, not region and range_ref.");
      if (input.range_ref !== "synapse") throw new TypeError(`counts-as.range_ref ${JSON.stringify(input.range_ref)} is not a grantable named range.`);
      if (input.of_side !== "friendly") throw new TypeError("counts-as.range_ref names whose units the range is measured to: of_side friendly.");
      const subject = input.subject;
      if (subject !== ANTECEDENT && subject !== "this-unit" && subject !== "this-model") throw new TypeError(`counts-as.subject ${JSON.stringify(subject)} cannot take a named range.`);
      return { subject, range_ref: "synapse", of_side: "friendly" };
    },
  },
];
