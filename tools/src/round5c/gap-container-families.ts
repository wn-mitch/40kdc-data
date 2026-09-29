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
 * EVENT leaf (reusing `trigger()`, the same fragment an ability's own trigger uses), and its
 * `eligibility`/`binds_event_variable` are out of scope for this batch (the one authored record,
 * Aeldari's Battle Focus, needs both and is not reproduced exactly — see the batch report).
 */

const RISK_TESTS = ["battle-shock", "leadership", "hazard", "desperate-escape"] as const;
const DESIGNATION_SCOPES = ["enemy-unit", "objective-marker"] as const;
const DESIGNATION_TIMINGS = ["start-of-first-battle-round", "on-unit-destroyed"] as const;
const DURATIONS_SIMPLE = ["immediate", "until-end-of-phase", "until-end-of-turn"] as const;
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
  },
  {
    id: "menu-action",
    version: 1,
    role: "EVENT",
    label: "One resource-action-menu action",
    description: "Opens one action of the enclosing resource-action-menu: id, label, its cost, and (optionally) how long it lasts. The leaf right after it is the action's own trigger (its `when`); the effect leaves after that are what it does.",
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

export function normalizeGapContainerParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case "risk-reward-open":
      exactKeys(input, ["test"], family);
      return { test: enumValue(input.test, RISK_TESTS, "risk-reward-open.test") };
    case "on-fail-open":
      exactKeys(input, [], family);
      return {};
    case "resource-action-menu-open": {
      const keys = ["menu_id", "pool_id", ...["unit_max_manoeuvres_per_phase", "default_manoeuvre_max_per_phase"].filter((key) => key in input)];
      exactKeys(input, keys, family);
      if (typeof input.menu_id !== "string" || !input.menu_id) throw new TypeError("resource-action-menu-open.menu_id must be a nonblank string.");
      if (typeof input.pool_id !== "string" || !input.pool_id) throw new TypeError("resource-action-menu-open.pool_id must be a nonblank string.");
      const result: Record<string, unknown> = { menu_id: input.menu_id, pool_id: input.pool_id };
      if ("unit_max_manoeuvres_per_phase" in input) result.unit_max_manoeuvres_per_phase = boundedInteger(input.unit_max_manoeuvres_per_phase, 1, 20, "resource-action-menu-open.unit_max_manoeuvres_per_phase");
      if ("default_manoeuvre_max_per_phase" in input) result.default_manoeuvre_max_per_phase = boundedInteger(input.default_manoeuvre_max_per_phase, 1, 20, "resource-action-menu-open.default_manoeuvre_max_per_phase");
      return result;
    }
    case "menu-action": {
      const optional = ["cost_pool_id", "cost_resource_label", "duration", "repeatable_if_different_unit"].filter((key) => key in input);
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
