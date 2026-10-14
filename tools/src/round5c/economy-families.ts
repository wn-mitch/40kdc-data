import type { SemanticFamilyDefinition } from "./contracts.js";
import {
  boundedInteger, booleanValue, enumOrSource, enumOrSourceSchema, enumSet, enumValue, integerOrSource, integerOrSourceSchema,
  sourceQualifiedSchema, sourceQualified, type SourceQualifiedValue,
} from "./family-validation.js";
import { DESIGNATION_IDS } from "../translate/designations.js";

/**
 * Resource pools, stratagem costs, sticky objectives, designations, and army-construction rules
 * (roster-building limits, not in-game effects, but compiled to the same `army-rule` fragment).
 */

const POOL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** A few known pool ids for the leaf form and audit to sample; normalize accepts any matching id, not only these. */
const KNOWN_POOL_IDS = ["command-point", "miracle-dice-pool", "pain-token-pool", "blood-tithe-pool", "yp-pool", "battle-focus-pool", "fate-dice-pool"] as const;
const poolIdSchema = { anyOf: [{ enum: KNOWN_POOL_IDS }, sourceQualifiedSchema] };

/** A resource pool id: a plain kebab-case id (command-point included), or an exact source snippet. */
function poolId(value: unknown, label: string): string | SourceQualifiedValue {
  if (typeof value === "string" && POOL_ID_PATTERN.test(value)) return value;
  const source = sourceQualified(value, label);
  if (source) return source;
  throw new TypeError(`${label} must be a kebab-case resource pool id or an exact source snippet.`);
}

/** A single dice-allocation requirement (`dice-requirement` in the DSL): pair/triple/single/run at or above a value. */
const DICE_REQUIREMENT_TYPES = ["pair", "triple", "single", "run"] as const;
/** Which of resource-spend's mutually exclusive face/requirement fields apply, if either. */
const SPEND_GATES = ["none", "face", "requirement"] as const;
const COST_OF = ["stratagem", "manoeuvre", "ability"] as const;
const COST_OPERATIONS = ["increase", "decrease", "set", "multiply", "waive"] as const;
const COST_APPLIES_TO = ["targeting-this-unit", "used-by-this-unit", "the-triggering-use", "any"] as const;
const ENTITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

const RESOURCE_DIE_OPERATIONS = ["add", "substitute"] as const;
const RESOURCE_DIE_VALUE_WORDS = ["rolled", "highest"] as const;
const RESOURCE_DIE_ROLLS = [
  "hit", "wound", "save", "damage", "charge", "advance", "battle-shock", "leadership", "hazard", "psychic",
  "normal-move", "surge", "dark-pact", "blessings-of-khorne", "manoeuvre", "channelling", "any", "all",
] as const;

/** Every tag apply-mark may set, read live from the registry so a new designation needs no family change. */
const MARK_TAGS = [...DESIGNATION_IDS] as readonly string[];
const DESIGNATE_SUBJECTS = ["this-unit", "this-model", "selected-unit"] as const;

export const ARMY_RULES = [
  "warlord-required", "warlord-forbidden", "unique", "enhancement-forbidden", "enhancement-slot",
  "attachment", "composition", "faction-forbidden", "single-chapter", "detachment-forbidden", "detachment-tag-exclusive",
] as const;

function keySet(input: Record<string, unknown>, required: readonly string[], optional: readonly string[], family: string): void {
  const keys = Object.keys(input);
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) if (!allowed.has(key)) throw new TypeError(`${family} parameters must be one of: ${[...allowed].join(", ")}.`);
  for (const key of required) if (!(key in input)) throw new TypeError(`${family} parameters must include ${key}.`);
}

function keywordArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a nonempty list of keywords.`);
  return value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) throw new TypeError(`${label} must list nonblank keyword strings.`);
    return item;
  });
}

export const ECONOMY_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "resource-gain",
    version: 1,
    role: "EFFECT",
    label: "Gain a resource",
    description: "Gains an amount of a named resource pool; command-point becomes CP.",
    starter: { pool: "", amount: null },
    parameterSchema: {
      type: "object",
      required: ["pool", "amount"],
      properties: { pool: poolIdSchema, amount: integerOrSourceSchema },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "resource-gain",
    version: 2,
    role: "EFFECT",
    label: "Gain a resource",
    description: "Gains an amount of a named resource pool (command-point becomes CP), or a variable/any amount the rules don't fix. label is the player-facing singular noun for one unit of the pool (Aeldari's \"Battle Focus token\"), only when the rules give the pool one.",
    starter: { pool: "", amount: null },
    parameterSchema: {
      type: "object",
      required: ["pool", "amount"],
      properties: {
        pool: poolIdSchema,
        amount: { anyOf: [...integerOrSourceSchema.anyOf, { const: "variable" }, { const: "any" }] },
        label: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "resource-spend",
    version: 1,
    role: "EFFECT",
    label: "Spend a resource",
    description:
      "Spends an amount from a named resource pool, or all of it. spend_gate optionally requires the spent dice " +
      "to show a named face, or to form a pair/triple/single/run at or above a minimum value (face and the " +
      "requirement are mutually exclusive, so spend_gate says which — or neither — applies).",
    starter: { pool: "", amount: null },
    parameterSchema: {
      type: "object",
      required: ["pool", "amount"],
      properties: {
        pool: poolIdSchema,
        amount: { anyOf: [...integerOrSourceSchema.anyOf, { const: "all" }] },
        spend_gate: { enum: SPEND_GATES },
        face: { type: "integer", minimum: 1, maximum: 6, "x-only-when": { spend_gate: ["face"] } },
        requirement_type: { enum: DICE_REQUIREMENT_TYPES, "x-only-when": { spend_gate: ["requirement"] } },
        requirement_min: { type: "integer", minimum: 1, maximum: 6, "x-only-when": { spend_gate: ["requirement"] } },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "resource-spend",
    version: 2,
    role: "EFFECT",
    label: "Spend a resource",
    description:
      "Spends an amount from a named resource pool, or all of it. spend_gate optionally requires the spent dice " +
      "to show a named face, or to form a pair/triple/single/run at or above a minimum value (face and the " +
      "requirement are mutually exclusive, so spend_gate says which — or neither — applies). label is the " +
      "player-facing singular noun for one unit of the pool (Aeldari's \"Battle Focus token\"), only when the " +
      "rules give the pool one.",
    starter: { pool: "", amount: null },
    parameterSchema: {
      type: "object",
      required: ["pool", "amount"],
      properties: {
        pool: poolIdSchema,
        amount: { anyOf: [...integerOrSourceSchema.anyOf, { const: "all" }] },
        label: { type: "string", minLength: 1 },
        spend_gate: { enum: SPEND_GATES },
        face: { type: "integer", minimum: 1, maximum: 6, "x-only-when": { spend_gate: ["face"] } },
        requirement_type: { enum: DICE_REQUIREMENT_TYPES, "x-only-when": { spend_gate: ["requirement"] } },
        requirement_min: { type: "integer", minimum: 1, maximum: 6, "x-only-when": { spend_gate: ["requirement"] } },
      },
      additionalProperties: false,
    },
  },
  {
    id: "resource-die",
    version: 1,
    role: "EFFECT",
    label: "Add or substitute a pool die",
    description: "Adds a die to a resource pool, or discards one from it to replace a named roll.",
    starter: { pool: "", operation: "" },
    parameterSchema: {
      type: "object",
      required: ["pool", "operation"],
      properties: {
        pool: poolIdSchema,
        operation: { enum: RESOURCE_DIE_OPERATIONS },
        value: { anyOf: [{ type: "integer", minimum: 1, maximum: 6 }, { enum: RESOURCE_DIE_VALUE_WORDS }] },
        rolls: { type: "array", items: { enum: RESOURCE_DIE_ROLLS }, minItems: 1, uniqueItems: true },
      },
      additionalProperties: false,
    },
  },
  {
    id: "stratagem-cost",
    version: 1,
    role: "EFFECT",
    label: "Change what a Stratagem, manoeuvre or ability costs",
    description: "Increases, decreases, sets, multiplies or waives the CP cost; amount is required unless waive.",
    starter: { of: "", operation: "" },
    parameterSchema: {
      type: "object",
      required: ["of", "operation"],
      properties: {
        of: { enum: COST_OF },
        operation: { enum: COST_OPERATIONS },
        amount: { type: "integer", minimum: 0 },
        applies_to: { enum: COST_APPLIES_TO },
        id: { anyOf: [{ enum: ["cunning-ambush", "rapid-fire"] }, { type: "string", pattern: ENTITY_ID_PATTERN.source }] },
      },
      additionalProperties: false,
    },
  },
  {
    id: "apply-mark",
    version: 1,
    role: "EFFECT",
    label: "Tag a unit",
    description: "Applies (or clears) a designation tag on the target.",
    starter: { subject: "this-unit", tag: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "tag"],
      properties: {
        subject: enumOrSourceSchema(DESIGNATE_SUBJECTS),
        tag: enumOrSourceSchema(MARK_TAGS),
        clear: { const: true },
      },
      additionalProperties: false,
    },
  },
  {
    id: "army-construction",
    version: 1,
    role: "EFFECT",
    label: "Army-construction rule",
    description: "A roster-building rule: warlord/enhancement/composition/attachment limits that apply when mustering the army.",
    starter: { rule: "" },
    parameterSchema: {
      type: "object",
      required: ["rule"],
      properties: {
        rule: { enum: ARMY_RULES },
        with_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true },
        max: { type: "integer", minimum: 0 },
        led_by: { anyOf: [{ enum: ["Chapter Master"] }, { type: "string", minLength: 1 }] },
      },
      additionalProperties: false,
    },
  },
];

export function normalizeEconomyParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case "resource-gain": {
      keySet(input, ["pool", "amount"], ["label"], family);
      const result: Record<string, unknown> = {
        pool: poolId(input.pool, "resource-gain.pool"),
        amount: input.amount === "variable" || input.amount === "any" ? input.amount : integerOrSource(input.amount, "resource-gain.amount"),
      };
      if (input.label !== undefined) {
        if (typeof input.label !== "string" || !input.label) throw new TypeError("resource-gain.label must be a nonblank string.");
        result.label = input.label;
      }
      return result;
    }
    case "resource-spend": {
      keySet(input, ["pool", "amount"], ["label", "spend_gate", "face", "requirement_type", "requirement_min"], family);
      const result: Record<string, unknown> = {
        pool: poolId(input.pool, "resource-spend.pool"),
        amount: input.amount === "all" ? "all" : integerOrSource(input.amount, "resource-spend.amount"),
      };
      if (input.label !== undefined) {
        if (typeof input.label !== "string" || !input.label) throw new TypeError("resource-spend.label must be a nonblank string.");
        result.label = input.label;
      }
      const hasFace = input.face !== undefined;
      const hasType = input.requirement_type !== undefined;
      const hasMin = input.requirement_min !== undefined;
      if (hasFace && (hasType || hasMin)) throw new TypeError("resource-spend: face and requirement_type/requirement_min are mutually exclusive.");
      if (hasType !== hasMin) throw new TypeError("resource-spend: requirement_type and requirement_min must be given together.");
      // spend_gate is an optional, self-consistency-checked hint (which field pair, if either, is set);
      // it never appears in the compiled DSL, which reads face/requirement_type/requirement_min directly.
      if (input.spend_gate !== undefined) {
        const gate = enumValue(input.spend_gate, SPEND_GATES, "resource-spend.spend_gate");
        if (gate === "none" && (hasFace || hasType)) throw new TypeError("resource-spend.spend_gate none conflicts with face or requirement.");
        if (gate === "face" && !hasFace) throw new TypeError("resource-spend.spend_gate face needs a face.");
        if (gate === "requirement" && !hasType) throw new TypeError("resource-spend.spend_gate requirement needs requirement_type and requirement_min.");
      }
      if (hasFace) result.face = boundedInteger(input.face, 1, 6, "resource-spend.face");
      if (hasType) {
        result.requirement_type = enumValue(input.requirement_type, DICE_REQUIREMENT_TYPES, "resource-spend.requirement_type");
        result.requirement_min = boundedInteger(input.requirement_min, 1, 6, "resource-spend.requirement_min");
      }
      return result;
    }
    case "resource-die": {
      keySet(input, ["pool", "operation"], ["value", "rolls"], family);
      const result: Record<string, unknown> = {
        pool: poolId(input.pool, "resource-die.pool"),
        operation: enumValue(input.operation, RESOURCE_DIE_OPERATIONS, "resource-die.operation"),
      };
      if (input.value !== undefined) {
        result.value = typeof input.value === "number"
          ? boundedInteger(input.value, 1, 6, "resource-die.value")
          : enumValue(input.value, RESOURCE_DIE_VALUE_WORDS, "resource-die.value");
      }
      if (input.rolls !== undefined) result.rolls = enumSet(input.rolls, RESOURCE_DIE_ROLLS, "resource-die.rolls");
      return result;
    }
    case "stratagem-cost": {
      keySet(input, ["of", "operation"], ["amount", "applies_to", "id"], family);
      const operation = enumValue(input.operation, COST_OPERATIONS, "stratagem-cost.operation");
      const result: Record<string, unknown> = { of: enumValue(input.of, COST_OF, "stratagem-cost.of"), operation };
      if (operation !== "waive") {
        if (input.amount === undefined) throw new TypeError("stratagem-cost.amount is required unless operation is waive.");
        const amount = boundedInteger(input.amount, operation === "multiply" ? 2 : 0, 20, "stratagem-cost.amount");
        result.amount = amount;
      } else if (input.amount !== undefined) {
        throw new TypeError("stratagem-cost.amount must be omitted when operation is waive.");
      }
      if (input.applies_to !== undefined) result.applies_to = enumValue(input.applies_to, COST_APPLIES_TO, "stratagem-cost.applies_to");
      if (input.id !== undefined) {
        if (typeof input.id !== "string" || !ENTITY_ID_PATTERN.test(input.id)) throw new TypeError("stratagem-cost.id must be a kebab-case entity id.");
        result.id = input.id;
      }
      return result;
    }
    case "apply-mark": {
      keySet(input, ["subject", "tag"], ["clear"], family);
      const result: Record<string, unknown> = {
        subject: enumOrSource(input.subject, DESIGNATE_SUBJECTS, "apply-mark.subject"),
        tag: enumOrSource(input.tag, MARK_TAGS, "apply-mark.tag"),
      };
      if (input.clear !== undefined) {
        if (booleanValue(input.clear, "apply-mark.clear") !== true) throw new TypeError("apply-mark.clear must be true, or omitted.");
        result.clear = true;
      }
      return result;
    }
    case "army-construction": {
      keySet(input, ["rule"], ["with_keywords", "max", "led_by"], family);
      const result: Record<string, unknown> = { rule: enumValue(input.rule, ARMY_RULES, "army-construction.rule") };
      if (input.with_keywords !== undefined) result.with_keywords = keywordArray(input.with_keywords, "army-construction.with_keywords");
      if (input.max !== undefined) result.max = boundedInteger(input.max, 0, 20, "army-construction.max");
      if (input.led_by !== undefined) {
        if (typeof input.led_by !== "string" || input.led_by.trim().length === 0) throw new TypeError("army-construction.led_by must be a nonblank string.");
        result.led_by = input.led_by;
      }
      return result;
    }
    default:
      return null;
  }
}
