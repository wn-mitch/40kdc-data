import type { SemanticFamilyDefinition } from "./contracts.js";
import { keywordList } from "./family-extension-helpers.js";
import { FOLLOWING_FILTER } from "./families/shared.js";
import { boundedInteger, enumValue } from "./family-validation.js";

/**
 * `army-includes` (wave 8): what the army holds, as a condition. "If your army includes any X
 * units" names its units by the unit-filter right after it; "If every model in your army has the
 * X keyword" names the keyword inline, because "has the X keyword" is not unit-filter wording.
 * Lowered to the DSL's `army-includes` condition in compile-army.ts.
 */

const QUANTIFIERS = ["some", "every"] as const;

export const ARMY_INCLUDES_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "army-includes",
    version: 1,
    role: "CONDITION",
    label: "Your army includes",
    description: "Your army includes units, read when mustering. quantifier some (\"If your army includes any/a\"): with following-filter names the units by the unit-filter right after the leaf; min (2 or more) for \"more than one\". quantifier every (\"If every model in your army has the X keyword\"): keywords (every one) or any_keywords (at least one of them), with level model.",
    starter: { quantifier: "some", with: FOLLOWING_FILTER },
    parameterSchema: {
      type: "object",
      required: ["quantifier"],
      properties: {
        quantifier: { enum: QUANTIFIERS },
        with: { enum: [FOLLOWING_FILTER], "x-only-when": { quantifier: ["some"] } },
        keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true, "x-optional": true, "x-only-when": { quantifier: ["every"] } },
        any_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, uniqueItems: true, "x-optional": true, "x-only-when": { quantifier: ["every"] } },
        level: { enum: ["model"], "x-only-when": { quantifier: ["every"] } },
        min: { type: "integer", minimum: 2, maximum: 10, "x-optional": true, "x-only-when": { quantifier: ["some"] } },
      },
      additionalProperties: false,
    },
  },
];

export function normalizeArmyIncludesParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "army-includes") return null;
  const allowed = ["quantifier", "with", "keywords", "any_keywords", "level", "min"];
  const stray = Object.keys(input).filter((key) => !allowed.includes(key));
  if (stray.length) throw new TypeError(`army-includes has no parameter ${stray[0]}.`);
  const quantifier = enumValue(input.quantifier, QUANTIFIERS, "army-includes.quantifier");
  if (quantifier === "some") {
    for (const key of ["keywords", "any_keywords", "level"]) if (key in input) throw new TypeError(`army-includes some names its units by the unit-filter after it, not ${key}.`);
    if (input.with !== FOLLOWING_FILTER) throw new TypeError("army-includes some names its units by with: following-filter.");
    return { quantifier, with: FOLLOWING_FILTER, ...(input.min !== undefined ? { min: boundedInteger(input.min, 2, 10, "army-includes.min") } : {}) };
  }
  if ("with" in input) throw new TypeError("army-includes every names its keyword inline, not by a following filter.");
  if ("min" in input) throw new TypeError("army-includes every counts every model; it takes no min.");
  if (input.level !== "model") throw new TypeError("army-includes every is about every model: level model.");
  const keywords = input.keywords === undefined ? undefined : keywordList(input.keywords, "army-includes.keywords", 1);
  const any = input.any_keywords === undefined ? undefined : keywordList(input.any_keywords, "army-includes.any_keywords", 2);
  if (keywords === undefined && any === undefined) throw new TypeError("army-includes every names keywords or any_keywords.");
  if (keywords !== undefined && any !== undefined) throw new TypeError("army-includes every names keywords or any_keywords, not both.");
  return { quantifier, level: "model", ...(keywords ? { keywords } : {}), ...(any ? { any_keywords: any } : {}) };
}
