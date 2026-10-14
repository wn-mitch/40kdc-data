import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumSet, enumValue, exactKeys } from "./family-validation.js";

/**
 * Batch 7b, effects half: `test` (a forced Leadership/Battle-shock/Hazard/Desperate Escape test —
 * 111 authored records, the highest-value gap in the sweep), `test-exemption`, `destruction-rule`,
 * `datasheet-swap`, `characteristic-resolution`, `borrow-weapons`, `select-weapon`. All seven are
 * flat single effects; `compile-test-effects.ts` compiles them.
 *
 * `test`/`test-exemption` share one target vocabulary (`TARGET_ENUM` + the `range`/`within_inches`/
 * `of`/`of_owner`+`of_keywords`/`require_keywords`/`exclude_keywords` filter fields), because the
 * authored `test` corpus targets everything from a fixed role (`selected-unit`, `defender`,
 * `event-subject`, …) to "enemy units within 6\" of this model" to "enemy units within 12\" of a
 * friendly HERETIC ASTARTES unit" (`of` naming another filter, not just a fixed role) — the same
 * `owner`+`within` filter `targeting-restriction` and `select-units` already build, just spelled
 * directly as the effect's own `target`.
 */

export const TARGET_ENUM = [
  "this-unit", "this-model", "attacker", "defender", "event-subject", "event-object",
  "stratagem-target", "selected-unit", "recipient", "bearer-transport", "ability-unit", "enemy", "friendly",
] as const;
const FILTERED_TARGETS = new Set(["enemy", "friendly"]);
export const TARGET_RANGES = ["engagement", "inches", "any"] as const;
export const TARGET_OF = ["this-model", "event-object"] as const;
export const TARGET_OF_OWNERS = ["friendly", "enemy"] as const;

export const targetFilterProperties = {
  target: { enum: TARGET_ENUM },
  range: { enum: TARGET_RANGES, "x-only-when": { target: ["enemy", "friendly"] } },
  within_inches: { type: "integer", minimum: 1, maximum: 48, "x-only-when": { range: ["inches"] } },
  of: { enum: TARGET_OF, "x-only-when": { range: ["inches", "engagement"] } },
  // The "of" reference can itself be a friendly/enemy keyword filter, not just a fixed role
  // (terror-made-manifest-chaos-space-marines: "within 12\" of a friendly HERETIC ASTARTES unit").
  of_owner: { enum: TARGET_OF_OWNERS, "x-only-when": { range: ["inches", "engagement"] } },
  of_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true, "x-only-when": { of_owner: TARGET_OF_OWNERS } },
  // require_keywords/exclude_keywords narrow the filter itself (all_of/none_of on it), so — like
  // range — they only mean anything once target is enemy or friendly.
  require_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true, "x-only-when": { target: ["enemy", "friendly"] } },
  exclude_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true, "x-only-when": { target: ["enemy", "friendly"] } },
} as const;

export function normalizeTargetFilter(input: Record<string, unknown>, prefix: string): {
  keys: string[]; target: string; range?: string; within_inches?: number; of?: string;
  of_owner?: string; of_keywords?: string[]; require_keywords?: string[]; exclude_keywords?: string[];
} {
  const target = enumValue(input.target, TARGET_ENUM, `${prefix}.target`);
  const filtered = FILTERED_TARGETS.has(target);
  const keys = ["target"];
  const result: ReturnType<typeof normalizeTargetFilter> = { keys, target };
  if (filtered) {
    result.range = enumValue(input.range, TARGET_RANGES, `${prefix}.range`);
    keys.push("range");
    if (result.range === "inches") {
      result.within_inches = boundedInteger(input.within_inches, 1, 48, `${prefix}.within_inches`);
      keys.push("within_inches");
    }
    if (result.range !== "any" && "of" in input && "of_owner" in input) {
      throw new TypeError(`${prefix}.of and ${prefix}.of_owner are mutually exclusive.`);
    }
    if (result.range !== "any" && "of" in input) {
      result.of = enumValue(input.of, TARGET_OF, `${prefix}.of`);
      keys.push("of");
    }
    if (result.range !== "any" && "of_owner" in input) {
      result.of_owner = enumValue(input.of_owner, TARGET_OF_OWNERS, `${prefix}.of_owner`);
      keys.push("of_owner");
      if ("of_keywords" in input) {
        result.of_keywords = enumSet(input.of_keywords, (input.of_keywords as string[]) ?? [], `${prefix}.of_keywords`);
        keys.push("of_keywords");
      }
    } else if ("of_keywords" in input) {
      throw new TypeError(`${prefix}.of_keywords only applies with ${prefix}.of_owner.`);
    }
    if ("require_keywords" in input) {
      result.require_keywords = enumSet(input.require_keywords, (input.require_keywords as string[]) ?? [], `${prefix}.require_keywords`);
      keys.push("require_keywords");
    }
    if ("exclude_keywords" in input) {
      result.exclude_keywords = enumSet(input.exclude_keywords, (input.exclude_keywords as string[]) ?? [], `${prefix}.exclude_keywords`);
      keys.push("exclude_keywords");
    }
  } else if ("range" in input || "within_inches" in input || "of" in input || "of_owner" in input || "require_keywords" in input || "exclude_keywords" in input) {
    throw new TypeError(`${prefix}.range/within_inches/of/of_owner/require_keywords/exclude_keywords only apply when target is enemy or friendly.`);
  }
  return result;
}

const TEST_KINDS = ["battle-shock", "leadership", "hazard", "desperate-escape"] as const;
/** The common `scaling` block's own `of` vocabulary (schemas/$defs/common.schema.json#/$defs/scaling-source). */
const SCALING_SOURCES = [
  "enemy-models-in-range", "friendly-models-in-range", "models-in-bearer-unit", "models-in-or-embarked-in-bearer",
  "models-embarked-in-bearer", "embarked-models-oc", "models-equipped-with", "enemy-units-in-range", "wounds-lost", "battle-round",
] as const;
const SCALING_ROUNDING = ["down", "up"] as const;
const scalingProperties = {
  scaling_per: { type: "integer", minimum: 1 },
  scaling_of: { enum: SCALING_SOURCES },
  scaling_round: { enum: SCALING_ROUNDING },
  scaling_max_value: { type: "integer" },
} as const;
const TEST_EXEMPTION_KINDS = ["battle-shock", "leadership", "desperate-escape"] as const;
const EXEMPTION_WINDOWS = ["phase", "turn", "battle-round"] as const;
const FIXED_SUBJECTS = ["this-unit", "this-model"] as const;
const STAT_ENUM = ["M", "T", "Sv", "W", "Ld", "OC", "A", "WS", "BS", "S", "AP", "D", "Range", "detection-range", "psyker-level"] as const;
const RESOLUTION_RULES = ["majority", "highest", "lowest"] as const;
const RESOLUTION_TIE = ["highest", "lowest"] as const;
const RESOLUTION_APPLIES_TO = ["wound-roll", "all"] as const;
const WEAPON_TYPES = ["melee", "ranged"] as const;

export const TEST_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "test",
    version: 1,
    role: "EFFECT",
    label: "Force a test",
    description: "The target must take a Battle-shock, Leadership, Hazard, or Desperate Escape test, optionally with a characteristic modifier, several times (count/per).",
    starter: { target: "", test: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "test"],
      properties: { ...targetFilterProperties, test: { enum: TEST_KINDS }, modifier: { type: "integer" }, count: { type: "integer", minimum: 1 }, per: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "test",
    version: 2,
    role: "EFFECT",
    label: "Force a test",
    description: "The target must take a Battle-shock, Leadership, Hazard, or Desperate Escape test, optionally with a characteristic modifier, several times (count/per), or scaled up per a named count (Powers of da WAAAGH!: -1 for every 10 models in the bearer's unit).",
    starter: { target: "", test: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "test"],
      properties: {
        ...targetFilterProperties, test: { enum: TEST_KINDS }, modifier: { type: "integer" }, count: { type: "integer", minimum: 1 }, per: { type: "string", minLength: 1 },
        ...scalingProperties,
      },
      additionalProperties: false,
    },
  },
  {
    id: "test-exemption",
    version: 1,
    role: "EFFECT",
    label: "Exempt from a test",
    description: "The target does not need to take a named test again within a window (no further Battle-shock tests this phase).",
    starter: { target: "", test: "", window: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "test", "window"],
      properties: { ...targetFilterProperties, test: { enum: TEST_EXEMPTION_KINDS }, window: { enum: EXEMPTION_WINDOWS } },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "test-exemption",
    version: 2,
    role: "EFFECT",
    label: "Exempt from a test",
    description: "The target does not need to take a named test again within a window (no further Battle-shock tests this phase).",
    starter: { target: "", test: "", window: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "test", "window"],
      properties: { ...targetFilterProperties, test: { enum: TEST_EXEMPTION_KINDS }, window: { enum: EXEMPTION_WINDOWS } },
      additionalProperties: false,
    },
  },
  {
    id: "destruction-rule",
    version: 1,
    role: "EFFECT",
    label: "Counts as destroyed only with another",
    description: "The target unit counts as destroyed only once another named unit is also destroyed.",
    starter: { target: "", also: "" },
    parameterSchema: { type: "object", required: ["target", "also"], properties: { target: { enum: FIXED_SUBJECTS }, also: { enum: FIXED_SUBJECTS } }, additionalProperties: false },
  },
  {
    id: "datasheet-swap",
    version: 1,
    role: "EFFECT",
    label: "Swap datasheet",
    description: "The target unit uses another datasheet from now on (profile, keywords, abilities), keeping its wounds and position.",
    starter: { target: "", datasheet: "" },
    parameterSchema: { type: "object", required: ["target", "datasheet"], properties: { target: { enum: FIXED_SUBJECTS }, datasheet: { type: "string", minLength: 1 } }, additionalProperties: false },
  },
  {
    id: "characteristic-resolution",
    version: 1,
    role: "EFFECT",
    label: "Resolve a mixed characteristic",
    description: "How a characteristic that differs between the target's models is resolved: the value most models have (with a tie-break), or the highest/lowest.",
    starter: { target: "", stat: "", rule: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "stat", "rule"],
      properties: {
        target: { enum: FIXED_SUBJECTS }, stat: { enum: STAT_ENUM }, rule: { enum: RESOLUTION_RULES },
        tie: { enum: RESOLUTION_TIE, "x-only-when": { rule: ["majority"] } },
        applies_to: { enum: RESOLUTION_APPLIES_TO }, incoming: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "borrow-weapons",
    version: 1,
    role: "EFFECT",
    label: "Fire another model's weapon (Firing Deck)",
    description: "The target (a Transport) uses one ranged weapon from each of up to max_models models embarked within it; those models cannot shoot.",
    starter: { target: "", max_models: null },
    parameterSchema: {
      type: "object",
      required: ["target", "max_models"],
      properties: {
        target: { enum: FIXED_SUBJECTS }, max_models: { type: "integer", minimum: 1 }, weapon_type: { enum: WEAPON_TYPES },
        exclude_weapon_keyword: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true },
      },
      additionalProperties: false,
    },
  },
  {
    id: "select-weapon",
    version: 1,
    role: "EFFECT",
    label: "Select and bind a weapon",
    description: "Pick one (or count) of the target's weapons and bind it; later weapon-qualified effects refer to it by the bound name.",
    starter: { target: "", bind_as: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "bind_as"],
      properties: {
        target: { enum: FIXED_SUBJECTS }, count: { type: "integer", minimum: 1 }, weapon_type: { enum: WEAPON_TYPES },
        weapon_keyword: { type: "string", minLength: 1 }, bind_as: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
];

export function normalizeTestParameters(family: string, input: Record<string, unknown>, version = 1): Record<string, unknown> | null {
  switch (family) {
    case "test": {
      const filter = normalizeTargetFilter(input, "test");
      const scalingKeys = Object.keys(scalingProperties).filter((key) => key in input);
      if (scalingKeys.length && version < 2) throw new TypeError(`test.${scalingKeys[0]} needs version 2.`);
      if ((filter.of_owner !== undefined || filter.of_keywords !== undefined) && version < 2) throw new TypeError("test.of_owner needs version 2.");
      const keys = [...filter.keys, "test", ...(["modifier", "count", "per", ...scalingKeys].filter((key) => key in input))];
      exactKeys(input, keys, family);
      const { keys: _keys, ...rest } = filter;
      const result: Record<string, unknown> = { ...rest, test: enumValue(input.test, TEST_KINDS, "test.test") };
      if ("modifier" in input) result.modifier = boundedInteger(input.modifier, -20, 20, "test.modifier");
      if ("count" in input) result.count = boundedInteger(input.count, 1, 20, "test.count");
      if ("per" in input) {
        if (typeof input.per !== "string" || !input.per) throw new TypeError("test.per must be a nonblank string.");
        result.per = input.per;
      }
      if (scalingKeys.length) {
        if (!("scaling_per" in input) || !("scaling_of" in input)) throw new TypeError("test.scaling_per and test.scaling_of must be given together.");
        result.scaling_per = boundedInteger(input.scaling_per, 1, 999, "test.scaling_per");
        result.scaling_of = enumValue(input.scaling_of, SCALING_SOURCES, "test.scaling_of");
        if ("scaling_round" in input) result.scaling_round = enumValue(input.scaling_round, SCALING_ROUNDING, "test.scaling_round");
        if ("scaling_max_value" in input) result.scaling_max_value = boundedInteger(input.scaling_max_value, -999, 999, "test.scaling_max_value");
      }
      return result;
    }
    case "test-exemption": {
      const filter = normalizeTargetFilter(input, "test-exemption");
      if ((filter.of_owner !== undefined || filter.of_keywords !== undefined) && version < 2) throw new TypeError("test-exemption.of_owner needs version 2.");
      exactKeys(input, [...filter.keys, "test", "window"], family);
      const { keys: _keys, ...rest } = filter;
      return { ...rest, test: enumValue(input.test, TEST_EXEMPTION_KINDS, "test-exemption.test"), window: enumValue(input.window, EXEMPTION_WINDOWS, "test-exemption.window") };
    }
    case "destruction-rule":
      exactKeys(input, ["target", "also"], family);
      return { target: enumValue(input.target, FIXED_SUBJECTS, "destruction-rule.target"), also: enumValue(input.also, FIXED_SUBJECTS, "destruction-rule.also") };
    case "datasheet-swap":
      exactKeys(input, ["target", "datasheet"], family);
      if (typeof input.datasheet !== "string" || !input.datasheet) throw new TypeError("datasheet-swap.datasheet must be a nonblank string.");
      return { target: enumValue(input.target, FIXED_SUBJECTS, "datasheet-swap.target"), datasheet: input.datasheet };
    case "characteristic-resolution": {
      const rule = enumValue(input.rule, RESOLUTION_RULES, "characteristic-resolution.rule");
      const keys = ["target", "stat", "rule", ...(rule === "majority" ? ["tie"] : []), ...(["applies_to", "incoming"].filter((key) => key in input))];
      exactKeys(input, keys, family);
      if (rule === "majority" && !("tie" in input)) throw new TypeError("characteristic-resolution.tie is required when rule is majority.");
      if (rule !== "majority" && "tie" in input) throw new TypeError("characteristic-resolution.tie only applies when rule is majority.");
      const result: Record<string, unknown> = { target: enumValue(input.target, FIXED_SUBJECTS, "characteristic-resolution.target"), stat: enumValue(input.stat, STAT_ENUM, "characteristic-resolution.stat"), rule };
      if (rule === "majority") result.tie = enumValue(input.tie, RESOLUTION_TIE, "characteristic-resolution.tie");
      if ("applies_to" in input) result.applies_to = enumValue(input.applies_to, RESOLUTION_APPLIES_TO, "characteristic-resolution.applies_to");
      if ("incoming" in input) {
        if (input.incoming !== true) throw new TypeError("characteristic-resolution.incoming must be true, or omitted.");
        result.incoming = true;
      }
      return result;
    }
    case "borrow-weapons": {
      const keys = ["target", "max_models", ...(["weapon_type", "exclude_weapon_keyword"].filter((key) => key in input))];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { target: enumValue(input.target, FIXED_SUBJECTS, "borrow-weapons.target"), max_models: boundedInteger(input.max_models, 1, 12, "borrow-weapons.max_models") };
      if ("weapon_type" in input) result.weapon_type = enumValue(input.weapon_type, WEAPON_TYPES, "borrow-weapons.weapon_type");
      if ("exclude_weapon_keyword" in input) result.exclude_weapon_keyword = enumSet(input.exclude_weapon_keyword, (input.exclude_weapon_keyword as string[]) ?? [], "borrow-weapons.exclude_weapon_keyword");
      return result;
    }
    case "select-weapon": {
      const keys = ["target", "bind_as", ...(["count", "weapon_type", "weapon_keyword"].filter((key) => key in input))];
      exactKeys(input, keys, family);
      if (typeof input.bind_as !== "string" || !input.bind_as) throw new TypeError("select-weapon.bind_as must be a nonblank string.");
      const result: Record<string, unknown> = { target: enumValue(input.target, FIXED_SUBJECTS, "select-weapon.target"), bind_as: input.bind_as };
      if ("count" in input) result.count = boundedInteger(input.count, 1, 12, "select-weapon.count");
      if ("weapon_type" in input) result.weapon_type = enumValue(input.weapon_type, WEAPON_TYPES, "select-weapon.weapon_type");
      if ("weapon_keyword" in input) {
        if (typeof input.weapon_keyword !== "string" || !input.weapon_keyword) throw new TypeError("select-weapon.weapon_keyword must be a nonblank string.");
        result.weapon_keyword = input.weapon_keyword;
      }
      return result;
    }
    default:
      return null;
  }
}
