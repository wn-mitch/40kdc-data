import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumSet, enumValue, exactKeys } from "./family-validation.js";

/**
 * Batch 7b, containers half: `risk-reward`, `resource-action-menu`, `persistent-designation`,
 * `select-objective` (1/1/3/0 authored records). Each opens the same way `choice-open` and its
 * siblings do: an EFFECT-role opener leaf, folded by `compile-containers.ts`'s container planner
 * into the leaves after it — so these compose with an earlier select-unit/roll/ability-part
 * exactly like the batch-5 containers do, at no extra cost, since they run through the same code.
 *
 * `resource-action-menu` is reduced from the schema's full generality: `shared_usage` and each
 * action's `id`/`label`/`cost`/`duration` are authored; an action's `when` is its own leading
 * EVENT leaf(s), one or several alternatives, reusing `trigger()` — the general `event` family
 * (version 9) now carries the owner/move_types/to/action_kind filters those triggers need, so no
 * closed trigger vocabulary lives here. Eligibility's `requires_keyword`/`excludes_keyword` come
 * from ordinary `unit-keyword` CONDITION leaves in the action's own group (negated ones exclude);
 * `selector_count` comes from a `select-unit` leaf's presence (always 1, the only value any
 * authored record needs so far). `binds_event_variable` and the `requires` array's own two
 * shapes (Battle Focus's own cross-referencing conditions) are still this record's own fixed
 * shape — nothing today reuses a bound event variable generically — see the batch report.
 */

const RISK_TESTS = ["battle-shock", "leadership", "hazard", "desperate-escape"] as const;
const DESIGNATION_SCOPES = ["enemy-unit", "objective-marker"] as const;
const DESIGNATION_TIMINGS = ["start-of-first-battle-round", "on-unit-destroyed"] as const;
const DURATIONS_SIMPLE = ["immediate", "until-end-of-phase", "until-end-of-turn"] as const;
/** resource-action-menu-open's pool_gain/pool_spend: a sibling ability-part, independent of any one action, that populates or clears the menu's pool at a round boundary (Battle Focus). */
const POOL_LIFECYCLE_TRIGGERS = ["round-started", "round-ended"] as const;
const POOL_LIFECYCLE_AMOUNTS = ["all", "variable"] as const;
const poolLifecycleSchema = {
  type: "object",
  required: ["trigger", "amount"],
  properties: {
    trigger: { enum: POOL_LIFECYCLE_TRIGGERS },
    amount: { anyOf: [{ type: "integer", minimum: 1 }, { enum: POOL_LIFECYCLE_AMOUNTS }] },
    label: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;
// The DSL's own objective-selector.origin enum spells these "bearer"/"bearer-unit"; the leaf
// spells them the way every other family's subject does ("this-model"/"this-unit"), mapped
// across at compile time.
const OBJECTIVE_ORIGINS = ["this-model", "this-unit"] as const;
const OBJECTIVE_CONTROLLERS = ["your-army", "opponent"] as const;

export const GAP_CONTAINER_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "risk-reward-open",
    version: 1,
    role: "EFFECT",
    label: "Risk a test for a reward",
    description: "Opens a risk-reward: the first sentence after it, led by an on-fail-open leaf, is what happens on a failed test; every sentence after that is the reward (one effect, or a choice among several).",
    starter: { test: "" },
    parameterSchema: { type: "object", required: ["test"], properties: { test: { enum: RISK_TESTS } }, additionalProperties: false },
    deprecated: true,
  },
  {
    id: "risk-reward-open",
    version: 2,
    role: "EFFECT",
    label: "Risk a test for a reward",
    description: "Opens a risk-reward: the first sentence after it, led by an on-fail-open leaf, is what happens on a failed test; every sentence after that is the reward (one effect, or a choice among several). reward_choice_label names that choice, when the reward has more than one option (Dark Pacts' \"Dark Pact ability\").",
    starter: { test: "" },
    parameterSchema: {
      type: "object",
      required: ["test"],
      properties: { test: { enum: RISK_TESTS }, reward_choice_label: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
  {
    id: "on-fail-open",
    version: 1,
    role: "EVENT",
    label: "On a failed risk-reward test",
    description: "Marks the sentence after it as risk-reward's on_fail effect.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    id: "resource-action-menu-open",
    version: 1,
    role: "EFFECT",
    label: "Open a resource-action menu",
    description: "Opens a resource-action-menu: every sentence after it, each led by a menu-action leaf, is one action.",
    starter: { menu_id: "", pool_id: "" },
    parameterSchema: {
      type: "object",
      required: ["menu_id", "pool_id"],
      properties: {
        menu_id: { type: "string", minLength: 1 }, pool_id: { type: "string", minLength: 1 },
        unit_max_manoeuvres_per_phase: { type: "integer", minimum: 1 },
        default_manoeuvre_max_per_phase: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "resource-action-menu-open",
    version: 2,
    role: "EFFECT",
    label: "Open a resource-action menu",
    description: "Opens a resource-action-menu: every sentence after it, each led by a menu-action leaf, is one action. pool_gain/pool_spend describe the sibling ability-parts that populate and clear the pool (Battle Focus: gain a variable number of tokens each round-started, spend all of them at round-ended) — the menu itself carries no lifecycle of its own; see the schema's own $comment.",
    starter: { menu_id: "", pool_id: "" },
    parameterSchema: {
      type: "object",
      required: ["menu_id", "pool_id"],
      properties: {
        menu_id: { type: "string", minLength: 1 }, pool_id: { type: "string", minLength: 1 },
        unit_max_manoeuvres_per_phase: { type: "integer", minimum: 1 },
        default_manoeuvre_max_per_phase: { type: "integer", minimum: 1 },
        pool_gain: poolLifecycleSchema, pool_spend: poolLifecycleSchema,
      },
      additionalProperties: false,
    },
  },
  {
    id: "menu-action",
    version: 1,
    role: "EVENT",
    label: "One resource-action-menu action",
    description: "Opens one action of the enclosing resource-action-menu: id, label, its cost, and (optionally) how long it lasts. The leaf(s) right after it are the action's own trigger (its `when`, one or several alternatives); the effect leaves after that are what it does.",
    starter: { action_id: "", label: "", cost_amount: null },
    parameterSchema: {
      type: "object",
      required: ["action_id", "label", "cost_amount"],
      properties: {
        action_id: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 },
        cost_amount: { type: "integer", minimum: 1 }, cost_pool_id: { type: "string", minLength: 1 },
        cost_resource_label: { type: "string", minLength: 1 }, duration: { enum: DURATIONS_SIMPLE },
        repeatable_if_different_unit: { type: "boolean" },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "menu-action",
    version: 2,
    role: "EVENT",
    label: "One resource-action-menu action",
    description: "Opens one action of the enclosing resource-action-menu: id, label, its cost, and (optionally) how long it lasts. Leading unit-keyword CONDITION leaves and a select-unit leaf (if any) set its eligibility; the EVENT leaf(s) after those are the action's own trigger (its `when`, one or several alternatives); the effect leaves after that are what it does. binds_event_variable names the acting unit for a later eligibility check to reference (Battle Focus's Opportunity Seized/Fade Back); the two eligibility_* flags are that one record's own two requires shapes (engaged with the bound unit at phase start; after the bound unit's Hit roll, in your opponent's shooting phase) — not a general vocabulary, see the batch report.",
    starter: { action_id: "", label: "", cost_amount: null },
    parameterSchema: {
      type: "object",
      required: ["action_id", "label", "cost_amount"],
      properties: {
        action_id: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 },
        cost_amount: { type: "integer", minimum: 1 }, cost_pool_id: { type: "string", minLength: 1 },
        cost_resource_label: { type: "string", minLength: 1 }, duration: { enum: DURATIONS_SIMPLE },
        repeatable_if_different_unit: { type: "boolean" },
        binds_event_variable: { type: "string", minLength: 1 },
        eligibility_engaged_with_bound_at_phase_start: { type: "boolean" },
        eligibility_after_bound_hit_roll: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "persistent-designation-open",
    version: 1,
    role: "EFFECT",
    label: "Designate and remember a unit or marker",
    description: "Opens a persistent-designation: select one enemy unit or objective marker (once, at the named timing) and remember it for the rest of the battle; the effect leaves after it apply to the bearer or the bearer's unit each time the remembered relation holds.",
    starter: { designation: "", scope: "", timing: "", beneficiary: "this-model" },
    parameterSchema: {
      type: "object",
      required: ["designation", "scope", "timing", "beneficiary"],
      properties: {
        designation: { type: "string", minLength: 1 },
        scope: { enum: DESIGNATION_SCOPES },
        timing: { enum: DESIGNATION_TIMINGS },
        // The DSL's own consumer.beneficiary enum spells these "bearer"/"unit"; the leaf spells
        // them the way every other family's subject does, and the compiler maps them across.
        beneficiary: { enum: ["this-model", "this-unit"] },
      },
      additionalProperties: false,
    },
  },
  {
    id: "select-objective-open",
    version: 1,
    role: "EFFECT",
    label: "Select an objective marker",
    description: "Opens a select-objective: the effect leaves after it apply to the selected objective marker (an aura's centre, a designation's subject).",
    starter: { bind_as: "" },
    parameterSchema: {
      type: "object",
      required: ["bind_as"],
      properties: {
        bind_as: { type: "string", minLength: 1 },
        count: { type: "integer", minimum: 1 },
        each: { type: "boolean" },
        range_inches: { type: "integer", minimum: 1 },
        origin: { enum: OBJECTIVE_ORIGINS },
        controlled_by: { enum: OBJECTIVE_CONTROLLERS },
      },
      additionalProperties: false,
    },
  },
];

export function normalizeGapContainerParameters(family: string, input: Record<string, unknown>, version = 1): Record<string, unknown> | null {
  switch (family) {
    case "risk-reward-open": {
      const hasLabel = "reward_choice_label" in input;
      if (hasLabel && version < 2) throw new TypeError("risk-reward-open.reward_choice_label needs version 2.");
      const keys = ["test", ...(hasLabel ? ["reward_choice_label"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { test: enumValue(input.test, RISK_TESTS, "risk-reward-open.test") };
      if (hasLabel) {
        if (typeof input.reward_choice_label !== "string" || !input.reward_choice_label) throw new TypeError("risk-reward-open.reward_choice_label must be a nonblank string.");
        result.reward_choice_label = input.reward_choice_label;
      }
      return result;
    }
    case "on-fail-open":
      exactKeys(input, [], family);
      return {};
    case "resource-action-menu-open": {
      const v2Keys = ["pool_gain", "pool_spend"];
      const usedV2 = v2Keys.filter((key) => key in input);
      if (usedV2.length && version < 2) throw new TypeError(`resource-action-menu-open.${usedV2[0]} needs version 2.`);
      const keys = ["menu_id", "pool_id", ...["unit_max_manoeuvres_per_phase", "default_manoeuvre_max_per_phase", ...usedV2].filter((key) => key in input)];
      exactKeys(input, keys, family);
      if (typeof input.menu_id !== "string" || !input.menu_id) throw new TypeError("resource-action-menu-open.menu_id must be a nonblank string.");
      if (typeof input.pool_id !== "string" || !input.pool_id) throw new TypeError("resource-action-menu-open.pool_id must be a nonblank string.");
      const result: Record<string, unknown> = { menu_id: input.menu_id, pool_id: input.pool_id };
      if ("unit_max_manoeuvres_per_phase" in input) result.unit_max_manoeuvres_per_phase = boundedInteger(input.unit_max_manoeuvres_per_phase, 1, 20, "resource-action-menu-open.unit_max_manoeuvres_per_phase");
      if ("default_manoeuvre_max_per_phase" in input) result.default_manoeuvre_max_per_phase = boundedInteger(input.default_manoeuvre_max_per_phase, 1, 20, "resource-action-menu-open.default_manoeuvre_max_per_phase");
      for (const key of ["pool_gain", "pool_spend"]) {
        if (!(key in input)) continue;
        const spec = input[key];
        if (spec === null || typeof spec !== "object" || Array.isArray(spec)) throw new TypeError(`resource-action-menu-open.${key} must be an object.`);
        const record = spec as Record<string, unknown>;
        exactKeys(record, ["trigger", "amount", ...("label" in record ? ["label"] : [])], `resource-action-menu-open.${key}`);
        const trigger = enumValue(record.trigger, POOL_LIFECYCLE_TRIGGERS, `resource-action-menu-open.${key}.trigger`);
        const amount = typeof record.amount === "number" ? boundedInteger(record.amount, 1, 999, `resource-action-menu-open.${key}.amount`) : enumValue(record.amount, POOL_LIFECYCLE_AMOUNTS, `resource-action-menu-open.${key}.amount`);
        const built: Record<string, unknown> = { trigger, amount };
        if ("label" in record) {
          if (typeof record.label !== "string" || !record.label) throw new TypeError(`resource-action-menu-open.${key}.label must be a nonblank string.`);
          built.label = record.label;
        }
        result[key] = built;
      }
      return result;
    }
    case "menu-action": {
      const v2Keys = ["binds_event_variable", "eligibility_engaged_with_bound_at_phase_start", "eligibility_after_bound_hit_roll"];
      const usedV2 = v2Keys.filter((key) => key in input);
      if (usedV2.length && version < 2) throw new TypeError(`menu-action.${usedV2[0]} needs version 2.`);
      const optional = ["cost_pool_id", "cost_resource_label", "duration", "repeatable_if_different_unit", ...usedV2].filter((key) => key in input);
      exactKeys(input, ["action_id", "label", "cost_amount", ...optional], family);
      if (typeof input.action_id !== "string" || !input.action_id) throw new TypeError("menu-action.action_id must be a nonblank string.");
      if (typeof input.label !== "string" || !input.label) throw new TypeError("menu-action.label must be a nonblank string.");
      const result: Record<string, unknown> = { action_id: input.action_id, label: input.label, cost_amount: boundedInteger(input.cost_amount, 1, 20, "menu-action.cost_amount") };
      if ("cost_pool_id" in input) {
        if (typeof input.cost_pool_id !== "string" || !input.cost_pool_id) throw new TypeError("menu-action.cost_pool_id must be a nonblank string.");
        result.cost_pool_id = input.cost_pool_id;
      }
      if ("cost_resource_label" in input) {
        if (typeof input.cost_resource_label !== "string" || !input.cost_resource_label) throw new TypeError("menu-action.cost_resource_label must be a nonblank string.");
        result.cost_resource_label = input.cost_resource_label;
      }
      if ("duration" in input) result.duration = enumValue(input.duration, DURATIONS_SIMPLE, "menu-action.duration");
      if ("repeatable_if_different_unit" in input) {
        if (input.repeatable_if_different_unit !== true) throw new TypeError("menu-action.repeatable_if_different_unit must be true, or omitted.");
        result.repeatable_if_different_unit = true;
      }
      if ("binds_event_variable" in input) {
        if (typeof input.binds_event_variable !== "string" || !input.binds_event_variable) throw new TypeError("menu-action.binds_event_variable must be a nonblank string.");
        result.binds_event_variable = input.binds_event_variable;
      }
      for (const flag of ["eligibility_engaged_with_bound_at_phase_start", "eligibility_after_bound_hit_roll"]) {
        if (flag in input) {
          if (input[flag] !== true) throw new TypeError(`menu-action.${flag} must be true, or omitted.`);
          result[flag] = true;
        }
      }
      if ((result.eligibility_engaged_with_bound_at_phase_start || result.eligibility_after_bound_hit_roll) && !result.binds_event_variable) {
        throw new TypeError("menu-action's eligibility_engaged_with_bound_at_phase_start/eligibility_after_bound_hit_roll need binds_event_variable, the unit they reference.");
      }
      return result;
    }
    case "persistent-designation-open":
      exactKeys(input, ["designation", "scope", "timing", "beneficiary"], family);
      if (typeof input.designation !== "string" || !input.designation) throw new TypeError("persistent-designation-open.designation must be a nonblank string.");
      return {
        designation: input.designation,
        scope: enumValue(input.scope, DESIGNATION_SCOPES, "persistent-designation-open.scope"),
        timing: enumValue(input.timing, DESIGNATION_TIMINGS, "persistent-designation-open.timing"),
        beneficiary: enumValue(input.beneficiary, ["this-model", "this-unit"], "persistent-designation-open.beneficiary"),
      };
    case "select-objective-open": {
      const optional = ["count", "each", "range_inches", "origin", "controlled_by"].filter((key) => key in input);
      exactKeys(input, ["bind_as", ...optional], family);
      if (typeof input.bind_as !== "string" || !input.bind_as) throw new TypeError("select-objective-open.bind_as must be a nonblank string.");
      const result: Record<string, unknown> = { bind_as: input.bind_as };
      // `each` takes precedence over `count` when both are present, rather than refusing the
      // combination outright: the two are alternatives on the same "how many" question, not a
      // hard conflict, and treating them as mutually exclusive would make every sampled
      // combination invalid (the coverage sweep sets every optional property at once).
      if ("each" in input) {
        if (input.each !== true) throw new TypeError("select-objective-open.each must be true, or omitted.");
        result.each = true;
      } else if ("count" in input) {
        result.count = boundedInteger(input.count, 1, 12, "select-objective-open.count");
      }
      if ("range_inches" in input) result.range_inches = boundedInteger(input.range_inches, 1, 48, "select-objective-open.range_inches");
      if ("origin" in input) result.origin = enumValue(input.origin, OBJECTIVE_ORIGINS, "select-objective-open.origin");
      if ("controlled_by" in input) result.controlled_by = enumValue(input.controlled_by, OBJECTIVE_CONTROLLERS, "select-objective-open.controlled_by");
      return result;
    }
    default:
      return null;
  }
}
