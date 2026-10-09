import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue, exactKeys } from "./family-validation.js";

/**
 * Named equipment conditions (wave 10). `named-weapon` counts the weapons a model or a unit's
 * models carry under one printed name; `unit-wargear` tests for a wargear item (a wargear.json
 * record, not a weapon) on the unit, or on at least some of its models. Both are CONDITIONs.
 * Weapon names and wargear ids are different key spaces, so they are two families.
 */

const WARGEAR_ID = { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" };
const MODEL_STATES = ["carry", "lack"] as const;

const MODELS_SCHEMA = {
  type: "object",
  required: ["at_least", "state"],
  properties: {
    at_least: { type: "integer", minimum: 1, maximum: 30 },
    state: { enum: [...MODEL_STATES] },
  },
  additionalProperties: false,
};

export const NAMED_WARGEAR_LOADOUT_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "named-weapon",
    version: 1,
    role: "CONDITION",
    label: "Model or unit carries a weapon with a printed name in an exact number",
    description: "Holds when this model carries exactly count weapons with the printed name (subject this-model), or when at least at_least models in this unit each carry exactly count such weapons (state carry) or each carry fewer than count (state lack, count 1 meaning none). Names are printed weapon names, not wargear ids.",
    starter: { subject: "this-model", name: "", count: 1 },
    parameterSchema: {
      type: "object",
      required: ["subject", "name", "count"],
      properties: {
        subject: { enum: ["this-model", "this-unit"] },
        name: { type: "string", minLength: 1, maxLength: 80 },
        count: { type: "integer", minimum: 1, maximum: 12 },
        models: MODELS_SCHEMA,
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "unit-wargear",
    version: 1,
    role: "CONDITION",
    label: "Unit has a wargear item, on the unit or on some of its models",
    description: "Holds when this unit has the wargear item (a wargear.json id). With models, at least at_least models in the unit carry the item (state carry) or lack it (state lack).",
    starter: { subject: "this-unit", wargear: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "wargear"],
      properties: {
        subject: { enum: ["this-unit"] },
        wargear: WARGEAR_ID,
        models: MODELS_SCHEMA,
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise a named-weapon or unit-wargear leaf, or return null for other families. */
export function normalizeNamedWargearParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family === "named-weapon") return normalizeNamedWeapon(input);
  if (family === "unit-wargear") return normalizeUnitWargear(input);
  return null;
}

function normalizeNamedWeapon(input: Record<string, unknown>): Record<string, unknown> {
  exactKeys(input, ["subject", "name", "count", ...optionalKeys(input)], "named-weapon");
  const subject = enumValue(input.subject, ["this-model", "this-unit"], "named-weapon.subject");
  if (subject === "this-model" && input.models !== undefined) throw new TypeError("named-weapon this-model takes no models quantifier.");
  if (subject === "this-unit" && input.models === undefined) throw new TypeError("named-weapon this-unit needs a models quantifier.");
  return {
    subject,
    name: printedName(input.name, "named-weapon.name"),
    count: boundedInteger(input.count, 1, 12, "named-weapon.count"),
    ...(input.models !== undefined ? { models: normalizeModels(input.models, "named-weapon.models") } : {}),
    ...negatedField(input),
  };
}

function normalizeUnitWargear(input: Record<string, unknown>): Record<string, unknown> {
  exactKeys(input, ["subject", "wargear", ...optionalKeys(input)], "unit-wargear");
  const subject = enumValue(input.subject, ["this-unit"], "unit-wargear.subject");
  if (typeof input.wargear !== "string" || !new RegExp(WARGEAR_ID.pattern).test(input.wargear)) {
    throw new TypeError("unit-wargear.wargear is a kebab-case wargear id.");
  }
  return {
    subject,
    wargear: input.wargear,
    ...(input.models !== undefined ? { models: normalizeModels(input.models, "unit-wargear.models") } : {}),
    ...negatedField(input),
  };
}

function normalizeModels(value: unknown, label: string): { at_least: number; state: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is an object with at_least and state.`);
  const models = value as Record<string, unknown>;
  exactKeys(models, ["at_least", "state"], label);
  return {
    at_least: boundedInteger(models.at_least, 1, 30, `${label}.at_least`),
    state: enumValue(models.state, [...MODEL_STATES], `${label}.state`),
  };
}

/** A printed weapon name, trimmed, with typographic hyphens (U+2010 to U+2012) written as ASCII. */
function printedName(value: unknown, label: string): string {
  const name = typeof value === "string" ? value.trim().replace(/[‐-‒]/g, "-") : "";
  if (name.length === 0 || name.length > 80) throw new TypeError(`${label} is the printed weapon name, 1 to 80 characters.`);
  return name;
}

function optionalKeys(input: Record<string, unknown>): string[] {
  return ["models", "negated"].filter((key) => key in input);
}

function negatedField(input: Record<string, unknown>): Record<string, unknown> {
  return "negated" in input ? { negated: input.negated === true } : {};
}
