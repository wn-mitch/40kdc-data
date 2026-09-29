import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumSet, enumValue, exactKeys } from "./family-validation.js";

/**
 * Batch 5 (containers): the leaf families that wrap the effects around them into a DSL container
 * node, instead of compiling to one effect on their own. `compile-containers.ts` reads these
 * leaves and does the wrapping; this file only carries their registry shape.
 *
 * - `aura-range` (CONDITION) and `leader-target` (CONDITION) wrap the rest of an ordinary
 *   ability's effects, the same way `select-unit` already wraps into `select-units`.
 * - `rules-bundle-marker` (RESTRICTION) is a flag: the whole ability's body becomes a
 *   `rules-bundle` instead of a bare effect or sequence.
 * - `for-each-unit-select` (EVENT) is `select-unit`'s looping sibling: `{type:'for-each-unit'}`
 *   instead of `{type:'select-units'}`.
 * - `choice-open`, `stance-select-open`, `issue-orders-open` and `dice-pool-allocation-open`
 *   (EFFECT) open a container whose options are every leaf sentence after them: `compile.ts`
 *   folds those sentences into the container node at the opener's own position, so the result
 *   composes with an earlier select-unit/for-each-unit-select, an earlier roll, and ability parts
 *   exactly the way any other single effect leaf does. `named-option` (EVENT) gives an option its
 *   `name` (and, under dice-pool-allocation, its dice requirement) where the schema needs one.
 * - `stance-selection-capacity` (EFFECT) is a flat leaf: it needs no wrapping.
 */

const AURA_SIDES = ["friendly", "enemy"] as const;
const STANCE_MODES = ["re-selectable", "consumable"] as const;
const STANCE_SCOPES = ["army", "unit"] as const;
const DICE_REQUIREMENT_TYPES = ["pair", "triple", "single", "run"] as const;

export const CONTAINER_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "aura-range",
    version: 1,
    role: "CONDITION",
    label: "Within an aura",
    description: "Wraps the ability's effects in a persistent aura: friendly or enemy units within a range, optionally limited to unit keywords. \"Contagions of Nurgle affect enemy units within 6\\\" of this model.\"",
    starter: { side: "", inches: null },
    parameterSchema: {
      type: "object",
      required: ["side", "inches"],
      properties: {
        side: { enum: AURA_SIDES },
        inches: { type: "integer", minimum: 1, maximum: 24 },
        keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true },
      },
      additionalProperties: false,
    },
  },
  {
    id: "leader-target",
    version: 1,
    role: "CONDITION",
    label: "The attached leader model",
    description: "Wraps the ability's effects onto the leader model attached to this unit, instead of the bearer, for as long as it leads. \"While this model is leading a unit, the attached Character model has the Fights First ability.\"",
    starter: {},
    parameterSchema: {
      type: "object",
      properties: { leader_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true } },
      additionalProperties: false,
    },
  },
  {
    id: "rules-bundle-marker",
    version: 1,
    role: "RESTRICTION",
    label: "Is a rules bundle",
    description: "The ability's whole body is a named bundle of rules that another ability grants by name, rather than an effect fired on its own (Sororitas and penitent enhancement bundles).",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    id: "for-each-unit-select",
    version: 1,
    role: "EVENT",
    label: "For each unit",
    description: "The ability resolves its effects separately for every matching enemy or friendly unit, instead of once for a single selected unit. The DSL's for-each-unit selector has no visibility gate, unlike select-unit.",
    starter: { scope: "", distance: "" },
    parameterSchema: {
      type: "object",
      required: ["scope", "distance"],
      properties: {
        scope: { enum: ["enemy", "friendly"] },
        distance: { enum: ["any", "within"] },
        inches: { type: "integer", minimum: 1, maximum: 48, "x-only-when": { distance: ["within"] } },
      },
      additionalProperties: false,
    },
  },
  {
    id: "choice-open",
    version: 1,
    role: "EFFECT",
    label: "Choose one of the following",
    description: "Opens a choice: every later sentence's effect becomes one option (min/max default to one). Composes with an earlier select-unit/for-each-unit-select, an earlier roll, and ability parts the same way any other effect leaf does.",
    starter: {},
    parameterSchema: {
      type: "object",
      properties: {
        choice_label: { type: "string", minLength: 1 },
        min_choices: { type: "integer", minimum: 0 },
        max_choices: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "stance-select-open",
    version: 1,
    role: "EFFECT",
    label: "Select a stance",
    description: "Opens a stance-select: every later sentence must open with a named-option leaf giving that stance's name; its effect is that option's bundle (Gladius Combat Doctrines, Admech Doctrina Imperatives). Composes with an earlier select-unit/for-each-unit-select, an earlier roll, and ability parts the same way any other effect leaf does.",
    starter: { scope: "", mode: "" },
    parameterSchema: {
      type: "object",
      required: ["scope", "mode"],
      properties: {
        scope: { enum: STANCE_SCOPES },
        mode: { enum: STANCE_MODES },
        min_choices: { type: "integer", minimum: 0 },
        max_choices: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "issue-orders-open",
    version: 1,
    role: "EFFECT",
    label: "Issue Orders",
    description: "Opens an issue-orders: every later sentence must open with a named-option leaf giving that Order's name; its effect is what the Order does (Astra Militarum Voice of Command).",
    starter: {},
    parameterSchema: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1 },
        range: { type: "integer", minimum: 1, maximum: 48 },
        eligible_keyword: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "dice-pool-allocation-open",
    version: 1,
    role: "EFFECT",
    label: "Allocate a dice pool",
    description: "Opens a dice-pool-allocation: every later sentence must open with a named-option leaf carrying that option's dice requirement; its effect is what spending that requirement does.",
    starter: { pool_count: null, pool_die: "" },
    parameterSchema: {
      type: "object",
      required: ["pool_count", "pool_die", "max_activations"],
      properties: {
        pool_count: { type: "integer", minimum: 1 },
        pool_die: { type: "string", minLength: 1 },
        max_activations: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "named-option",
    version: 1,
    role: "EVENT",
    label: "Named option",
    description: "Opens one option of the enclosing stance-select, issue-orders or dice-pool-allocation with its name; under dice-pool-allocation it also carries the option's dice requirement.",
    starter: { label: "" },
    parameterSchema: {
      type: "object",
      required: ["label"],
      properties: {
        label: { type: "string", minLength: 1 },
        requirement_type: { enum: DICE_REQUIREMENT_TYPES },
        requirement_min_value: { type: "integer", minimum: 1, maximum: 6, "x-only-when": { requirement_type: DICE_REQUIREMENT_TYPES } },
      },
      additionalProperties: false,
    },
  },
  {
    id: "stance-selection-capacity",
    version: 1,
    role: "EFFECT",
    label: "Extra stance selections",
    description: "Widens how many times a named stance-select's options may be picked: pooled across any option, or pinned to one named option (Gladius Task Force's Codex Discipline).",
    starter: { stance_id: "", additional_selections: null, allocation: "" },
    parameterSchema: {
      type: "object",
      required: ["stance_id", "additional_selections", "allocation"],
      properties: {
        scope: { enum: STANCE_SCOPES },
        stance_id: { type: "string", minLength: 1 },
        additional_selections: { type: "integer", minimum: 1 },
        allocation: { enum: ["choose-one-option", "fixed-option"] },
        option_id: { type: "string", minLength: 1, "x-only-when": { allocation: ["fixed-option"] } },
      },
      additionalProperties: false,
    },
  },
];

export function normalizeContainerParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case "aura-range": {
      const keys = ["side", "inches", ...("keywords" in input ? ["keywords"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { side: enumValue(input.side, AURA_SIDES, "aura-range.side"), inches: boundedInteger(input.inches, 1, 24, "aura-range.inches") };
      if ("keywords" in input) result.keywords = enumSet(input.keywords, (input.keywords as string[]) ?? [], "aura-range.keywords");
      return result;
    }
    case "leader-target": {
      const keys = "leader_keywords" in input ? ["leader_keywords"] : [];
      exactKeys(input, keys, family);
      if ("leader_keywords" in input) return { leader_keywords: enumSet(input.leader_keywords, (input.leader_keywords as string[]) ?? [], "leader-target.leader_keywords") };
      return {};
    }
    case "rules-bundle-marker":
      exactKeys(input, [], family);
      return {};
    case "for-each-unit-select":
      exactKeys(input, ["scope", "distance", ...("inches" in input ? ["inches"] : [])], family);
      return {
        scope: enumValue(input.scope, ["enemy", "friendly"], "for-each-unit-select.scope"),
        distance: enumValue(input.distance, ["any", "within"], "for-each-unit-select.distance"),
        ...("inches" in input ? { inches: boundedInteger(input.inches, 1, 48, "for-each-unit-select.inches") } : {}),
      };
    case "choice-open": {
      const keys = ["choice_label", "min_choices", "max_choices"].filter((key) => key in input);
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = {};
      if ("choice_label" in input) result.choice_label = String(input.choice_label);
      if ("min_choices" in input) result.min_choices = boundedInteger(input.min_choices, 0, 99, "choice-open.min_choices");
      if ("max_choices" in input) result.max_choices = boundedInteger(input.max_choices, 1, 99, "choice-open.max_choices");
      return result;
    }
    case "stance-select-open": {
      const keys = ["scope", "mode", "min_choices", "max_choices"].filter((key) => key in input);
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { scope: enumValue(input.scope, STANCE_SCOPES, "stance-select-open.scope"), mode: enumValue(input.mode, STANCE_MODES, "stance-select-open.mode") };
      if ("min_choices" in input) result.min_choices = boundedInteger(input.min_choices, 0, 99, "stance-select-open.min_choices");
      if ("max_choices" in input) result.max_choices = boundedInteger(input.max_choices, 1, 99, "stance-select-open.max_choices");
      return result;
    }
    case "issue-orders-open": {
      const keys = ["count", "range", "eligible_keyword"].filter((key) => key in input);
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = {};
      if ("count" in input) result.count = boundedInteger(input.count, 1, 99, "issue-orders-open.count");
      if ("range" in input) result.range = boundedInteger(input.range, 1, 48, "issue-orders-open.range");
      if ("eligible_keyword" in input) result.eligible_keyword = String(input.eligible_keyword);
      return result;
    }
    case "dice-pool-allocation-open":
      exactKeys(input, ["pool_count", "pool_die", "max_activations"], family);
      return {
        pool_count: boundedInteger(input.pool_count, 1, 99, "dice-pool-allocation-open.pool_count"),
        pool_die: String(input.pool_die),
        max_activations: boundedInteger(input.max_activations, 1, 99, "dice-pool-allocation-open.max_activations"),
      };
    case "named-option": {
      const keys = ["label", ...("requirement_type" in input ? ["requirement_type", "requirement_min_value"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { label: String(input.label) };
      if ("requirement_type" in input) {
        result.requirement_type = enumValue(input.requirement_type, DICE_REQUIREMENT_TYPES, "named-option.requirement_type");
        result.requirement_min_value = boundedInteger(input.requirement_min_value, 1, 6, "named-option.requirement_min_value");
      }
      return result;
    }
    case "stance-selection-capacity": {
      const keys = ["stance_id", "additional_selections", "allocation", ...("scope" in input ? ["scope"] : []), ...("option_id" in input ? ["option_id"] : [])];
      exactKeys(input, keys, family);
      const allocation = enumValue(input.allocation, ["choose-one-option", "fixed-option"], "stance-selection-capacity.allocation");
      if (allocation === "fixed-option" && !("option_id" in input)) throw new TypeError("stance-selection-capacity.option_id is required when allocation is fixed-option.");
      if (allocation !== "fixed-option" && "option_id" in input) throw new TypeError("stance-selection-capacity.option_id only applies when allocation is fixed-option.");
      const result: Record<string, unknown> = {
        stance_id: String(input.stance_id),
        additional_selections: boundedInteger(input.additional_selections, 1, 99, "stance-selection-capacity.additional_selections"),
        allocation,
      };
      if ("scope" in input) result.scope = enumValue(input.scope, STANCE_SCOPES, "stance-selection-capacity.scope");
      if ("option_id" in input) result.option_id = String(input.option_id);
      return result;
    }
    default:
      return null;
  }
}
