import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue, exactKeys } from "./family-validation.js";
import { optional } from "./family-extension-helpers.js";

/**
 * Counting qualifiers: "for each" / "for every 5" on an amount, the cap on a scaled amount, which
 * unit a counted model belongs to, and how many models an added unit contains. Each is a
 * CONDITION-role qualifier that folds into the leaf it qualifies (`compile-count-scale.ts`,
 * `compile-model-state.ts`) and gates nothing.
 */

/**
 * What a count-scale counts. following-filter: the units or models the unit-filter right after it
 * names, narrowed by the range and membership leaves after that filter. following-items: one count
 * per bulleted item whose conditions all hold ("for each of the following conditions you satisfy").
 */
export const COUNT_SCALE_COUNTS = ["following-filter", "following-items"] as const;
/** in: a model of that unit; embarked-in: a model embarked within it; in-or-embarked-in: either. */
export const MEMBERSHIP_RELATIONS = ["in", "embarked-in", "in-or-embarked-in"] as const;
/** The unit or Transport the counted models belong to. */
export const MEMBERSHIP_OF = ["this-unit", "this-model"] as const;

export const COUNT_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "count-scale",
    version: 1,
    role: "CONDITION",
    label: "Amount per counted thing",
    description: "\"for each\" (per 1) or \"for every N\" (per N): the amount of the effect in its sentence (the effect before this leaf, else the first effect after it) applies once per `per` of what it counts. counts following-filter (the default) counts the units or models the unit-filter right after this leaf names, narrowed by the aura-range or membership leaves after that filter; following-items counts the bulleted items after it whose conditions all hold (per must be 1). \"(rounding down)\" is a connective: the count is always rounded down.",
    starter: { per: 1 },
    parameterSchema: {
      type: "object",
      required: ["per"],
      properties: {
        per: { type: "integer", minimum: 1, maximum: 20 },
        counts: optional({ enum: COUNT_SCALE_COUNTS }),
      },
      additionalProperties: false,
    },
  },
  {
    id: "scale-cap",
    version: 1,
    role: "CONDITION",
    label: "Cap on a scaled amount",
    description: "\"(to a maximum of +3 A)\", \"(to a maximum of 3)\": the amount a count-scale in the same clause scales never exceeds `max`. A cap on a total of mortal wounds stays mortal-wounds.max.",
    starter: { max: 1 },
    parameterSchema: {
      type: "object",
      required: ["max"],
      properties: { max: { type: "integer", minimum: 1, maximum: 99 } },
      additionalProperties: false,
    },
  },
  {
    id: "membership",
    version: 1,
    role: "CONDITION",
    label: "Counted model belongs to a unit",
    description: "Which unit the models of the model-level unit-filter beside it belong to (right before or right after it, with only unit-owners between): \"in this unit\" / \"in your unit\" {in, this-unit}; \"embarked within this model\" {embarked-in, this-model}; \"embarked within this unit\" {embarked-in, this-unit}; \"in this unit (or embarked within this model)\" {in-or-embarked-in, this-unit}.",
    starter: { relation: "", of: "" },
    parameterSchema: {
      type: "object",
      required: ["relation", "of"],
      properties: {
        relation: { enum: MEMBERSHIP_RELATIONS },
        of: { enum: MEMBERSHIP_OF },
      },
      additionalProperties: false,
    },
  },
  {
    id: "unit-size",
    version: 1,
    role: "CONDITION",
    label: "Models in an added unit",
    description: "\"contains 1 model\": the unit the add-unit before it adds has this many models; a count-scale after it (\"for each model in this unit\") scales that number.",
    starter: { models: 1 },
    parameterSchema: {
      type: "object",
      required: ["models"],
      properties: { models: { type: "integer", minimum: 1, maximum: 20 } },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise a counting leaf's parameters, or return null for other families. */
export function normalizeCountParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case "count-scale": {
      exactKeys(input, ["per", ...("counts" in input ? ["counts"] : [])], family);
      const per = boundedInteger(input.per, 1, 20, "count-scale.per");
      if (!("counts" in input)) return { per };
      const counts = enumValue(input.counts, COUNT_SCALE_COUNTS, "count-scale.counts");
      if (counts === "following-items" && per !== 1) throw new TypeError("count-scale counts following-items one item at a time; per must be 1.");
      return { per, counts };
    }
    case "scale-cap":
      exactKeys(input, ["max"], family);
      return { max: boundedInteger(input.max, 1, 99, "scale-cap.max") };
    case "membership": {
      exactKeys(input, ["relation", "of"], family);
      const relation = enumValue(input.relation, MEMBERSHIP_RELATIONS, "membership.relation");
      const of = enumValue(input.of, MEMBERSHIP_OF, "membership.of");
      if (relation === "in" && of === "this-model") throw new TypeError("membership: a model is not in this model; name this-unit, or embarked-in this-model.");
      if (relation === "in-or-embarked-in" && of !== "this-unit") throw new TypeError("membership in-or-embarked-in names this-unit (its models, or the models embarked within it).");
      return { relation, of };
    }
    case "unit-size":
      exactKeys(input, ["models"], family);
      return { models: boundedInteger(input.models, 1, 20, "unit-size.models") };
    default:
      return null;
  }
}
