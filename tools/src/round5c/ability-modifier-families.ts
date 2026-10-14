import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue } from "./family-validation.js";
import { createValidator } from "../schema-loader.js";
import {
  abilityGrantValue, BUFF_SUBJECTS, constTrue, CORE_ABILITY_GRANT_IDS, ENTITY_ID, entityId, nonEmptyString, unitKeywordArray, UNIT_KEYWORD,
} from "./buff-families.js";

/**
 * `ability-modifier` at full expressiveness (every aspect the schema names, including recipients
 * and options, and every `ability` reference shape), plus `ability-record-grant` for the
 * non-core ability records `core-ability-grant`'s fixed enum cannot name. On its own file: this
 * much of the real `ability-modifier` schema (unit-filter recipients, an embedded option effect,
 * uses-only limits) would have pushed buff-families.ts well past the line-count guideline.
 */

/** Aspects with a plain numeric value: everything except widening recipients or adding an option. */
const NUMERIC_ASPECTS = ["range", "uses", "targets", "selections", "concurrent", "duration", "start-round", "end-round", "threshold"] as const;
export const ABILITY_MODIFIER_ASPECTS = [...NUMERIC_ASPECTS, "recipients", "options"] as const;
/** Version 1's aspect enum: numeric aspects only, no recipients/options. Frozen; version 2 replaces it. */
const ABILITY_MODIFIER_ASPECTS_V1 = ["range", "uses", "selections", "concurrent", "threshold", "duration", "start-round"] as const;
const ABILITY_MODIFIER_OPERATIONS = ["add", "subtract", "set", "lift-limit"] as const;
const USES_CAP_PERIODS = ["phase", "turn", "battle-round"] as const;
const NOT_SAME_WINDOWS = ["phase", "turn"] as const;
const FILTER_OWNERS = ["friendly", "enemy", "any"] as const;
const FILTER_LEVELS = ["unit", "model"] as const;
/** An ability keyword tag such as PSYCHIC, written the way the DSL spells a unit keyword. */
const ABILITY_KEYWORD = UNIT_KEYWORD;

const abilityFilterSchema = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    owner: { enum: FILTER_OWNERS },
    all_of: { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 1, uniqueItems: true },
    any_of: { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 1, uniqueItems: true },
    level: { enum: FILTER_LEVELS },
  },
} as const;

/** `{event:"used"}` | `{keyword}` | `{affecting}`: the non-plain-id ways an ability-modifier can name its ability. */
const abilityRefSchema = {
  anyOf: [
    { type: "string", pattern: ENTITY_ID.source },
    { type: "object", required: ["event"], properties: { event: { const: "used" } }, additionalProperties: false },
    { type: "object", required: ["keyword"], properties: { keyword: { type: "string", pattern: ABILITY_KEYWORD.source } }, additionalProperties: false },
    { type: "object", required: ["affecting"], properties: { affecting: abilityFilterSchema }, additionalProperties: false },
  ],
} as const;

const addOptionSchema = {
  type: "object", required: ["name", "effect"], additionalProperties: false,
  properties: { name: { type: "string", minLength: 1 }, effect: { type: "object" } },
} as const;

const capPerSchema = {
  type: "object", required: ["count", "period"], additionalProperties: false,
  properties: { count: { type: "integer", minimum: 1, maximum: 10 }, period: { enum: USES_CAP_PERIODS } },
} as const;

export const ABILITY_MODIFIER_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "ability-modifier",
    version: 1,
    role: "EFFECT",
    label: "Change a named ability",
    description: "Adds to, subtracts from, or sets one measured aspect of a named ability: its range, number of uses, selections, how many can apply at once, threshold, duration, or first usable battle round.",
    starter: { subject: "this-unit", ability: "", aspect: "", operation: "add", value: 1 },
    parameterSchema: {
      type: "object",
      required: ["subject", "ability", "aspect", "operation", "value"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        ability: { type: "string", pattern: ENTITY_ID.source },
        aspect: { enum: ABILITY_MODIFIER_ASPECTS_V1 },
        operation: { enum: ["add", "subtract", "set"] },
        value: { type: "integer", minimum: 1, maximum: 36 },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "ability-modifier",
    version: 2,
    role: "EFFECT",
    label: "Change a named ability",
    description: "Adds to, subtracts from, sets, or lifts the limit on one measured aspect of a named ability, widens who it recipients (aspect: recipients), or adds a new option to it (aspect: options). The ability can be a plain id, the ability a used trigger names, every ability with a keyword, or every ability of the target reaching a filtered audience.",
    starter: { subject: "this-unit", ability: "", aspect: "", operation: "add" },
    parameterSchema: {
      type: "object",
      required: ["subject", "ability", "aspect", "operation"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        ability: abilityRefSchema,
        aspect: { enum: ABILITY_MODIFIER_ASPECTS },
        operation: { enum: ABILITY_MODIFIER_OPERATIONS },
        value: { type: "integer", minimum: 1, maximum: 36, "x-only-when": { aspect: NUMERIC_ASPECTS } },
        cap: { type: "integer", minimum: 1, maximum: 36, "x-only-when": { aspect: NUMERIC_ASPECTS } },
        recipients: { ...abilityFilterSchema, "x-only-when": { aspect: ["recipients"] } },
        add_option: { ...addOptionSchema, "x-only-when": { aspect: ["options"] } },
        cap_per: { ...capPerSchema, "x-only-when": { aspect: ["uses"] } },
        not_same: { enum: NOT_SAME_WINDOWS, "x-only-when": { aspect: ["uses"] } },
        consumes_shared_use: { const: false, "x-only-when": { aspect: ["uses"] } },
      },
      additionalProperties: false,
    },
  },
  {
    id: "ability-record-grant",
    version: 1,
    role: "EFFECT",
    label: "Grant a non-core ability record",
    description: "Gives the target a named ability record from the ability collection (not a core rulebook ability — core-ability-grant names those), optionally its datasheet rating, or as a rules bundle (several rules named as one).",
    starter: { subject: "this-unit", ability: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "ability"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        ability: { type: "string", pattern: ENTITY_ID.source },
        value: { anyOf: [{ type: "integer", minimum: 1, maximum: 36 }, { type: "object", required: ["rating"], properties: { rating: { const: true } }, additionalProperties: false }] },
        rules_bundle: { const: true },
      },
      additionalProperties: false,
    },
  },
];

/** An ability reference in its normalized shape: a plain id, or one of the three object forms. */
function abilityRef(value: unknown, label: string): string | { event: "used" } | { keyword: string } | { affecting: Record<string, unknown> } {
  if (typeof value === "string") return entityId(value, label);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value as object);
    const v = value as Record<string, unknown>;
    if (keys.length === 1 && keys[0] === "event" && v.event === "used") return { event: "used" };
    if (keys.length === 1 && keys[0] === "keyword") return { keyword: abilityKeyword(v.keyword, label) };
    if (keys.length === 1 && keys[0] === "affecting") return { affecting: abilityFilter(v.affecting, `${label}.affecting`) };
  }
  throw new TypeError(`${label} must be an entity id, {event: "used"}, {keyword}, or {affecting}.`);
}

function abilityKeyword(value: unknown, label: string): string {
  if (typeof value === "string" && ABILITY_KEYWORD.test(value)) return value;
  throw new TypeError(`${label}.keyword must be a unit-keyword-style ability keyword such as PSYCHIC.`);
}

/** The recipients/affecting unit filter, in its normalized shape: at least one of owner, all_of, any_of, level. */
function abilityFilter(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be a unit filter object.`);
  const allowed = ["owner", "all_of", "any_of", "level"];
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length === 0 || !keys.every((key) => allowed.includes(key))) throw new TypeError(`${label} may only set owner, all_of, any_of, level.`);
  const result: Record<string, unknown> = {};
  if (Object.hasOwn(v, "owner")) result.owner = enumValue(v.owner, FILTER_OWNERS, `${label}.owner`);
  if (Object.hasOwn(v, "all_of")) result.all_of = unitKeywordArray(v.all_of, `${label}.all_of`);
  if (Object.hasOwn(v, "any_of")) result.any_of = unitKeywordArray(v.any_of, `${label}.any_of`);
  if (Object.hasOwn(v, "level")) result.level = enumValue(v.level, FILTER_LEVELS, `${label}.level`);
  return result;
}

let effectNodeValidate: ((data: unknown) => boolean) & { errors?: unknown } | null = null;

/** Validate an embedded option effect against the real DSL effect-node schema (AJV), not a closed family shape. */
function validEffectNode(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an effect object.`);
  if (!effectNodeValidate) {
    const ajv = createValidator();
    const found = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/effect-node");
    if (!found) throw new Error("effect-node schema fragment is not registered in the validator.");
    effectNodeValidate = found as unknown as ((data: unknown) => boolean) & { errors?: unknown };
  }
  if (!effectNodeValidate(value)) {
    throw new TypeError(`${label} is not a valid effect node: ${JSON.stringify(effectNodeValidate.errors)}`);
  }
  return value as Record<string, unknown>;
}

function abilityOption(value: unknown, label: string): { name: string; effect: Record<string, unknown> } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be {name, effect}.`);
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes("name") || !keys.includes("effect")) throw new TypeError(`${label} must contain exactly name and effect.`);
  return { name: nonEmptyString(v.name, `${label}.name`), effect: validEffectNode(v.effect, `${label}.effect`) };
}

function usesCapPer(value: unknown, label: string): { count: number; period: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be {count, period}.`);
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes("count") || !keys.includes("period")) throw new TypeError(`${label} must contain exactly count and period.`);
  return { count: boundedInteger(v.count, 1, 10, `${label}.count`), period: enumValue(v.period, USES_CAP_PERIODS, `${label}.period`) };
}

function constFalse(value: unknown, label: string): false {
  if (value === false) return false;
  throw new TypeError(`${label} must be false.`);
}

/** Validate and canonicalise parameters for ability-modifier and ability-record-grant, or null otherwise. */
export function normalizeAbilityModifierParameters(
  family: string,
  input: Record<string, unknown>,
  version: number,
): Record<string, unknown> | null {
  if (family === "ability-modifier" && version === 1) {
    const keys = Object.keys(input);
    const expected = ["subject", "ability", "aspect", "operation", "value"];
    if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
      throw new TypeError(`ability-modifier parameters must be exactly: ${expected.join(", ")}.`);
    }
    return {
      subject: enumValue(input.subject, BUFF_SUBJECTS, "ability-modifier.subject"),
      ability: entityId(input.ability, "ability-modifier.ability"),
      aspect: enumValue(input.aspect, ABILITY_MODIFIER_ASPECTS_V1, "ability-modifier.aspect"),
      operation: enumValue(input.operation, ["add", "subtract", "set"], "ability-modifier.operation"),
      value: boundedInteger(input.value, 1, 36, "ability-modifier.value"),
    };
  }
  if (family === "ability-modifier") {
    const ability = abilityRef(input.ability, "ability-modifier.ability");
    const aspect = enumValue(input.aspect, ABILITY_MODIFIER_ASPECTS, "ability-modifier.aspect");
    const operation = enumValue(input.operation, ABILITY_MODIFIER_OPERATIONS, "ability-modifier.operation");
    const numeric = (NUMERIC_ASPECTS as readonly string[]).includes(aspect);
    const usesAspect = aspect === "uses";
    const base = ["subject", "ability", "aspect", "operation"];
    const optional = [
      ...(numeric ? ["value", "cap"] : []),
      ...(aspect === "recipients" ? ["recipients"] : []),
      ...(aspect === "options" ? ["add_option"] : []),
      ...(usesAspect ? ["cap_per", "not_same", "consumes_shared_use"] : []),
    ];
    const keys = Object.keys(input);
    if (!base.every((key) => keys.includes(key)) || !keys.every((key) => base.includes(key) || optional.includes(key))) {
      throw new TypeError(`ability-modifier parameters for aspect ${aspect} must contain ${base.join(", ")}, and optional ${optional.join(", ") || "none"} only.`);
    }
    if (numeric && !Object.hasOwn(input, "value")) throw new TypeError("ability-modifier.value is required for this aspect.");
    if (aspect === "recipients" && !Object.hasOwn(input, "recipients")) throw new TypeError("ability-modifier.recipients is required for the recipients aspect.");
    if (aspect === "options" && !Object.hasOwn(input, "add_option")) throw new TypeError("ability-modifier.add_option is required for the options aspect.");
    return {
      subject: enumValue(input.subject, BUFF_SUBJECTS, "ability-modifier.subject"),
      ability,
      aspect,
      operation,
      ...(Object.hasOwn(input, "value") ? { value: boundedInteger(input.value, 1, 36, "ability-modifier.value") } : {}),
      ...(Object.hasOwn(input, "cap") ? { cap: boundedInteger(input.cap, 1, 36, "ability-modifier.cap") } : {}),
      ...(Object.hasOwn(input, "recipients") ? { recipients: abilityFilter(input.recipients, "ability-modifier.recipients") } : {}),
      ...(Object.hasOwn(input, "add_option") ? { add_option: abilityOption(input.add_option, "ability-modifier.add_option") } : {}),
      ...(Object.hasOwn(input, "cap_per") ? { cap_per: usesCapPer(input.cap_per, "ability-modifier.cap_per") } : {}),
      ...(Object.hasOwn(input, "not_same") ? { not_same: enumValue(input.not_same, NOT_SAME_WINDOWS, "ability-modifier.not_same") } : {}),
      ...(Object.hasOwn(input, "consumes_shared_use") ? { consumes_shared_use: constFalse(input.consumes_shared_use, "ability-modifier.consumes_shared_use") } : {}),
    };
  }
  if (family === "ability-record-grant") {
    const optional = ["value", "rules_bundle"];
    const keys = Object.keys(input);
    if (!Object.hasOwn(input, "subject") || !Object.hasOwn(input, "ability") || !keys.every((key) => key === "subject" || key === "ability" || optional.includes(key))) {
      throw new TypeError("ability-record-grant parameters must contain subject and ability, and optional value/rules_bundle only.");
    }
    const ability = entityId(input.ability, "ability-record-grant.ability");
    if ((CORE_ABILITY_GRANT_IDS as readonly string[]).includes(ability)) {
      throw new TypeError(`ability-record-grant.ability "${ability}" is a core ability; use core-ability-grant instead.`);
    }
    return {
      subject: enumValue(input.subject, BUFF_SUBJECTS, "ability-record-grant.subject"),
      ability,
      ...(Object.hasOwn(input, "value") ? { value: abilityGrantValue(input.value, "ability-record-grant.value") } : {}),
      ...(Object.hasOwn(input, "rules_bundle") ? { rules_bundle: constTrue(input.rules_bundle, "ability-record-grant.rules_bundle") } : {}),
    };
  }
  return null;
}
