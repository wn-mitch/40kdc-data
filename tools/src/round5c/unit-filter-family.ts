import type { SemanticFamilyDefinition } from "./contracts.js";
import { booleanValue, boundedInteger, enumValue, exactKeys } from "./family-validation.js";
import { UNIT_KEYWORD } from "./buff-families.js";

/**
 * The "who" of an aura or a selection, on its own leaf: "friendly **ADEPTUS CUSTODES** unit",
 * "enemy **VEHICLE** unit", "friendly Beast Snagga units". One subject vocabulary serves both,
 * so the range ("within 6\" of this unit") and the selection ("select one") stay wordings that
 * repeat across factions. The compiler folds a unit-filter into the aura-range after it or the
 * select-unit before it (compile-unit-filters.ts).
 *
 * Also here, the two versions that read their side from a unit-filter: aura-range v3 and
 * select-unit v2, where side and scope become optional.
 */

const FILTER_SIDES = ["friendly", "enemy", "any"] as const;
const KEYWORD_MATCH = ["all", "any"] as const;
const AURA_SIDES = ["friendly", "enemy"] as const;
const SELECT_SCOPES = ["enemy", "friendly"] as const;
const SELECT_DISTANCES = ["any", "within"] as const;
const AURA_OF = ["this-unit", "this-model"] as const;

export const UNIT_FILTER_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "unit-filter",
    version: 1,
    role: "CONDITION",
    label: "Which units",
    description: "The units an aura reaches or a selection may pick: friendly, enemy or any, optionally with unit keywords (all of them, or any one with match any), keywords they must not have, and that they must be visible. It names no range or count: the aura-range after it or the select-unit before it does.",
    starter: { side: "" },
    parameterSchema: {
      type: "object",
      required: ["side"],
      properties: {
        side: { enum: FILTER_SIDES },
        keywords: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
        match: { enum: KEYWORD_MATCH },
        excluded_keywords: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
        visible: { const: true },
      },
      additionalProperties: false,
    },
  },
];

/** Unit keywords as the rules print them: markdown dropped, upper case, each once. */
function keywords(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must list at least one keyword.`);
  const list = value.map((item) => {
    if (typeof item !== "string") throw new TypeError(`${label} must be strings.`);
    const keyword = item.replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort();
}

export function normalizeUnitFilterParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "unit-filter") return null;
  exactKeys(input, ["side", ...["keywords", "match", "excluded_keywords", "visible"].filter((key) => key in input)], family);
  const result: Record<string, unknown> = { side: enumValue(input.side, FILTER_SIDES, "unit-filter.side") };
  if ("keywords" in input) result.keywords = keywords(input.keywords, "unit-filter.keywords");
  if ("match" in input) {
    if (((result.keywords as string[] | undefined) ?? []).length < 2) throw new TypeError("unit-filter.match only chooses between two or more keywords.");
    result.match = enumValue(input.match, KEYWORD_MATCH, "unit-filter.match");
  }
  if ("excluded_keywords" in input) result.excluded_keywords = keywords(input.excluded_keywords, "unit-filter.excluded_keywords");
  if ("visible" in input) {
    if (!booleanValue(input.visible, "unit-filter.visible")) throw new TypeError("unit-filter.visible is true or absent.");
    result.visible = true;
  }
  return result;
}

/** aura-range v3: the range alone; side and keywords come from a unit-filter unless given here as in v2. */
export const AURA_RANGE_V3: SemanticFamilyDefinition = {
  id: "aura-range",
  version: 3,
  role: "CONDITION",
  label: "Within an aura",
  description: "As version 2, but side can be left out: then the leaf is only the range (\"within 6\\\" of this unit\", measured from this unit or this model, wholly or not) and the unit-filter before it says which units the aura reaches. Right after a selection (\"select one visible enemy unit within 6\\\" of this unit\") the same range is that selection's distance.",
  starter: { inches: null },
  parameterSchema: {
    type: "object",
    required: ["inches"],
    properties: {
      side: { enum: AURA_SIDES },
      inches: { type: "integer", minimum: 1, maximum: 24 },
      keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true },
      range_cap_inches: { type: "integer", minimum: 1, maximum: 24 },
      of: { enum: AURA_OF },
      wholly: { const: true },
    },
    additionalProperties: false,
  },
};

export function normalizeAuraRangeV3(input: Record<string, unknown>): Record<string, unknown> {
  exactKeys(input, ["inches", ...["side", "keywords", "range_cap_inches", "of", "wholly"].filter((key) => key in input)], "aura-range");
  if ("keywords" in input && !("side" in input)) throw new TypeError("aura-range.keywords belong to the unit-filter when side is left out.");
  const result: Record<string, unknown> = { inches: boundedInteger(input.inches, 1, 24, "aura-range.inches") };
  if ("side" in input) result.side = enumValue(input.side, AURA_SIDES, "aura-range.side");
  if ("keywords" in input) result.keywords = keywords(input.keywords, "aura-range.keywords");
  if ("range_cap_inches" in input) result.range_cap_inches = boundedInteger(input.range_cap_inches, 1, 24, "aura-range.range_cap_inches");
  if ("of" in input) result.of = enumValue(input.of, AURA_OF, "aura-range.of");
  if ("wholly" in input) {
    if (input.wholly !== true) throw new TypeError("aura-range.wholly is true or absent.");
    result.wholly = true;
  }
  return result;
}

/** select-unit v2: scope can be left out when a unit-filter right after the selection says it. */
export const SELECT_UNIT_V2: SemanticFamilyDefinition = {
  id: "select-unit",
  version: 2,
  role: "EVENT",
  label: "Select a unit",
  description: "As version 1, but scope can be left out (\"select one\"): then the unit-filter right after it (\"friendly WRAITH CONSTRUCT unit\") says which units can be selected.",
  starter: { distance: "", visible: false },
  parameterSchema: {
    type: "object",
    required: ["distance", "visible"],
    properties: {
      scope: { enum: SELECT_SCOPES },
      distance: { enum: SELECT_DISTANCES },
      inches: { type: "integer", minimum: 1, maximum: 48, "x-only-when": { distance: ["within"] } },
      visible: { type: "boolean" },
    },
    additionalProperties: false,
  },
};

export function normalizeSelectUnitV2(input: Record<string, unknown>): Record<string, unknown> {
  const distance = enumValue(input.distance, SELECT_DISTANCES, "select-unit.distance");
  exactKeys(input, [...("scope" in input ? ["scope"] : []), "distance", ...(distance === "within" ? ["inches"] : []), "visible"], "select-unit");
  return {
    ...("scope" in input ? { scope: enumValue(input.scope, SELECT_SCOPES, "select-unit.scope") } : {}),
    distance,
    ...(distance === "within" ? { inches: boundedInteger(input.inches, 1, 48, "select-unit.inches") } : {}),
    visible: booleanValue(input.visible, "select-unit.visible"),
  };
}
