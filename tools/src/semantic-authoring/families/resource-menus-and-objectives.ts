import { DESIGNATION_IDS } from "../../translate/designations.js";
import { boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import { isObject, noParameters, present, type Params } from "./containers-and-abilities-shared.js";
import type { FlatFamily } from "./types.js";

/** Risk-reward containers, resource action menus, persistent designations and objective selection. */

/** Keywords as printed, trimmed, upper-cased and deduplicated. */
function keywordArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) throw new TypeError(`${label} is a list of keywords.`);
  return [...new Set(value.map((item) => (item as string).trim().toUpperCase()))];
}

// ── Risk-reward, resource menus, designations and objectives ────────────────────────────────────

const RISK_TESTS = ["battle-shock", "leadership", "hazard", "desperate-escape"] as const;
const DESIGNATION_SCOPES = ["enemy-unit", "objective-marker"] as const;
const DESIGNATION_TIMINGS = ["start-of-first-battle-round", "on-unit-destroyed"] as const;
const DURATIONS_SIMPLE = ["immediate", "until-end-of-phase", "until-end-of-turn"] as const;
const POOL_LIFECYCLE_TRIGGERS = ["round-started", "round-ended"] as const;
const POOL_LIFECYCLE_AMOUNTS = ["all", "variable"] as const;
const OBJECTIVE_ORIGINS = ["this-model", "this-unit"] as const;
const OBJECTIVE_CONTROLLERS = ["your-army", "opponent"] as const;
const OBJECTIVE_CRITERIA = ["controlled-by-unit", "clear-of"] as const;
const OBJECTIVE_CRITERION_UNITS = ["this-unit", "event-subject"] as const;
const DESTROYED_SELECTION_DESTROYERS = ["this-unit", "this-model", "event-subject"] as const;
const MARKED_OBJECTIVES = ["controlled-by-unit", "tagged"] as const;

function nonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`${label} must be a nonblank string.`);
  return value;
}

function riskRewardOpen(input: Params): Params {
  exactKeys(input, ["test", ...present(input, ["reward_choice_label"])], "risk-reward-open");
  const result: Params = { test: enumValue(input.test, RISK_TESTS, "risk-reward-open.test") };
  if ("reward_choice_label" in input) result.reward_choice_label = nonBlank(input.reward_choice_label, "risk-reward-open.reward_choice_label");
  return result;
}

/** A pool_gain or pool_spend: the round boundary, the amount, and an optional label. */
function poolLifecycle(spec: unknown, label: string): Params {
  if (!isObject(spec)) throw new TypeError(`${label} must be an object.`);
  exactKeys(spec, ["trigger", "amount", ...present(spec, ["label"])], label);
  const built: Params = {
    trigger: enumValue(spec.trigger, POOL_LIFECYCLE_TRIGGERS, `${label}.trigger`),
    amount: typeof spec.amount === "number" ? boundedInteger(spec.amount, 1, 999, `${label}.amount`) : enumValue(spec.amount, POOL_LIFECYCLE_AMOUNTS, `${label}.amount`),
  };
  if ("label" in spec) built.label = nonBlank(spec.label, `${label}.label`);
  return built;
}

function resourceActionMenuOpen(input: Params): Params {
  const family = "resource-action-menu-open";
  exactKeys(input, ["menu_id", "pool_id", ...present(input, ["unit_max_manoeuvres_per_phase", "default_manoeuvre_max_per_phase", "pool_gain", "pool_spend"])], family);
  const result: Params = { menu_id: nonBlank(input.menu_id, `${family}.menu_id`), pool_id: nonBlank(input.pool_id, `${family}.pool_id`) };
  if ("unit_max_manoeuvres_per_phase" in input) result.unit_max_manoeuvres_per_phase = boundedInteger(input.unit_max_manoeuvres_per_phase, 1, 20, `${family}.unit_max_manoeuvres_per_phase`);
  if ("default_manoeuvre_max_per_phase" in input) result.default_manoeuvre_max_per_phase = boundedInteger(input.default_manoeuvre_max_per_phase, 1, 20, `${family}.default_manoeuvre_max_per_phase`);
  for (const key of ["pool_gain", "pool_spend"]) if (key in input) result[key] = poolLifecycle(input[key], `${family}.${key}`);
  return result;
}

function menuAction(input: Params): Params {
  const family = "menu-action";
  const flags = ["eligibility_engaged_with_bound_at_phase_start", "eligibility_after_bound_hit_roll"];
  exactKeys(input, ["action_id", "label", "cost_amount", ...present(input, ["cost_pool_id", "cost_resource_label", "duration", "repeatable_if_different_unit", "binds_event_variable", ...flags])], family);
  const result: Params = {
    action_id: nonBlank(input.action_id, `${family}.action_id`),
    label: nonBlank(input.label, `${family}.label`),
    cost_amount: boundedInteger(input.cost_amount, 1, 20, `${family}.cost_amount`),
  };
  if ("cost_pool_id" in input) result.cost_pool_id = nonBlank(input.cost_pool_id, `${family}.cost_pool_id`);
  if ("cost_resource_label" in input) result.cost_resource_label = nonBlank(input.cost_resource_label, `${family}.cost_resource_label`);
  if ("duration" in input) result.duration = enumValue(input.duration, DURATIONS_SIMPLE, `${family}.duration`);
  if ("repeatable_if_different_unit" in input) {
    if (input.repeatable_if_different_unit !== true) throw new TypeError(`${family}.repeatable_if_different_unit must be true, or omitted.`);
    result.repeatable_if_different_unit = true;
  }
  if ("binds_event_variable" in input) result.binds_event_variable = nonBlank(input.binds_event_variable, `${family}.binds_event_variable`);
  for (const flag of flags) {
    if (!(flag in input)) continue;
    if (input[flag] !== true) throw new TypeError(`${family}.${flag} must be true, or omitted.`);
    result[flag] = true;
  }
  if (flags.some((flag) => result[flag]) && !result.binds_event_variable) {
    throw new TypeError(`${family}'s eligibility_engaged_with_bound_at_phase_start/eligibility_after_bound_hit_roll need binds_event_variable, the unit they reference.`);
  }
  return result;
}

function persistentDesignationOpen(input: Params): Params {
  const family = "persistent-designation-open";
  exactKeys(input, ["designation", "scope", "timing", "beneficiary"], family);
  return {
    designation: nonBlank(input.designation, `${family}.designation`),
    scope: enumValue(input.scope, DESIGNATION_SCOPES, `${family}.scope`),
    timing: enumValue(input.timing, DESIGNATION_TIMINGS, `${family}.timing`),
    beneficiary: enumValue(input.beneficiary, ["this-model", "this-unit"], `${family}.beneficiary`),
  };
}

function selectObjectiveOpen(input: Params): Params {
  const family = "select-objective-open";
  exactKeys(input, ["bind_as", ...present(input, ["count", "each", "range_inches", "origin", "controlled_by"])], family);
  const result: Params = { bind_as: nonBlank(input.bind_as, `${family}.bind_as`) };
  // each and count answer the same "how many": each wins when both are present, and count goes unchecked.
  if ("each" in input) {
    if (input.each !== true) throw new TypeError(`${family}.each must be true, or omitted.`);
    result.each = true;
  } else if ("count" in input) {
    result.count = boundedInteger(input.count, 1, 12, `${family}.count`);
  }
  if ("range_inches" in input) result.range_inches = boundedInteger(input.range_inches, 1, 48, `${family}.range_inches`);
  if ("origin" in input) result.origin = enumValue(input.origin, OBJECTIVE_ORIGINS, `${family}.origin`);
  if ("controlled_by" in input) result.controlled_by = enumValue(input.controlled_by, OBJECTIVE_CONTROLLERS, `${family}.controlled_by`);
  return result;
}

function objectiveCriterion(input: Params): Params {
  const family = "objective-criterion";
  const criterion = enumValue(input.criterion, OBJECTIVE_CRITERIA, `${family}.criterion`);
  if (criterion === "controlled-by-unit") {
    exactKeys(input, ["criterion", "unit", ...present(input, ["at"])], family);
    return {
      criterion,
      unit: enumValue(input.unit, OBJECTIVE_CRITERION_UNITS, `${family}.unit`),
      ...("at" in input ? { at: enumValue(input.at, ["previous-phase-end"], `${family}.at`) } : {}),
    };
  }
  exactKeys(input, ["criterion", "side", ...present(input, ["keywords", "excluded_keywords"])], family);
  return {
    criterion,
    side: enumValue(input.side, ["friendly", "enemy", "any"], `${family}.side`),
    ...("keywords" in input ? { keywords: keywordArray(input.keywords, `${family}.keywords`) } : {}),
    ...("excluded_keywords" in input ? { excluded_keywords: keywordArray(input.excluded_keywords, `${family}.excluded_keywords`) } : {}),
  };
}

function destroyedModelSelection(input: Params): Params {
  exactKeys(input, ["destroyer"], "destroyed-model-selection");
  return { destroyer: enumValue(input.destroyer, DESTROYED_SELECTION_DESTROYERS, "destroyed-model-selection.destroyer") };
}

/** A registered designation id. */
function designation(value: unknown, label: string): string {
  if (typeof value !== "string" || !DESIGNATION_IDS.has(value)) throw new TypeError(`${label} ${JSON.stringify(value)} is not a registered designation.`);
  return value;
}

function markObjective(input: Params): Params {
  const family = "mark-objective";
  exactKeys(input, ["tag", "objective", ...present(input, ["near", "clear"])], family);
  const tag = designation(input.tag, `${family}.tag`);
  const objective = enumValue(input.objective, MARKED_OBJECTIVES, `${family}.objective`);
  if ("near" in input && objective !== "tagged") throw new TypeError(`${family}.near narrows the tagged markers; it needs objective tagged.`);
  if ("clear" in input && input.clear !== true) throw new TypeError(`${family}.clear is true or absent.`);
  // Tagging the markers that already carry the tag changes nothing: only a clear reads them.
  if (objective === "tagged" && input.clear !== true) throw new TypeError(`${family} with objective tagged only clears the tag; set clear true.`);
  return {
    tag,
    objective,
    ...("near" in input ? { near: enumValue(input.near, ["event-subject"], `${family}.near`) } : {}),
    ...(input.clear === true ? { clear: true } : {}),
  };
}

function opposedDesignations(input: Params): Params {
  const family = "opposed-designations";
  exactKeys(input, ["tag", "opposite_tag", "keywords", "opposite_keywords"], family);
  const tag = designation(input.tag, `${family}.tag`);
  const oppositeTag = designation(input.opposite_tag, `${family}.opposite_tag`);
  if (tag === oppositeTag) throw new TypeError(`${family} names two different tags.`);
  const keywords = keywordArray(input.keywords, `${family}.keywords`).sort();
  const opposite = keywordArray(input.opposite_keywords, `${family}.opposite_keywords`).sort();
  if (JSON.stringify(keywords) === JSON.stringify(opposite)) throw new TypeError(`${family} names two different groups.`);
  return { tag, opposite_tag: oppositeTag, keywords, opposite_keywords: opposite };
}

const onFailOpen = noParameters("on-fail-open");

export const RESOURCE_MENUS_AND_OBJECTIVES_FAMILIES: readonly FlatFamily[] = [
  {
    id: "risk-reward-open",
    version: 2,
    role: "EFFECT",
    label: "Risk a test for a reward",
    description: "Opens a risk-reward: the first sentence after it, led by an on-fail-open leaf, is what happens on a failed test; every sentence after that is the reward (one effect, or a choice among several). reward_choice_label names that choice, when the reward has more than one option (Dark Pacts' \"Dark Pact ability\").",
    starter: {test: ""},
    parameterSchema: {type: "object", required: ["test"], properties: {test: {enum: ["battle-shock", "leadership", "hazard", "desperate-escape"]}, reward_choice_label: {type: "string", minLength: 1}}, additionalProperties: false},
    normalize: riskRewardOpen,
  },
  {
    id: "on-fail-open",
    version: 1,
    role: "EVENT",
    label: "On a failed risk-reward test",
    description: "Marks the sentence after it as risk-reward's on_fail effect.",
    starter: {},
    parameterSchema: {type: "object", properties: {}, additionalProperties: false},
    normalize: onFailOpen,
  },
  {
    id: "resource-action-menu-open",
    version: 2,
    role: "EFFECT",
    label: "Open a resource-action menu",
    description: "Opens a resource-action-menu: every sentence after it, each led by a menu-action leaf, is one action. pool_gain/pool_spend describe the sibling ability-parts that populate and clear the pool (Battle Focus: gain a variable number of tokens each round-started, spend all of them at round-ended) — the menu itself carries no lifecycle of its own; see the schema's own $comment.",
    starter: {menu_id: "", pool_id: ""},
    parameterSchema: {type: "object", required: ["menu_id", "pool_id"], properties: {menu_id: {type: "string", minLength: 1}, pool_id: {type: "string", minLength: 1}, unit_max_manoeuvres_per_phase: {type: "integer", minimum: 1}, default_manoeuvre_max_per_phase: {type: "integer", minimum: 1}, pool_gain: {type: "object", required: ["trigger", "amount"], properties: {trigger: {enum: ["round-started", "round-ended"]}, amount: {anyOf: [{type: "integer", minimum: 1}, {enum: ["all", "variable"]}]}, label: {type: "string", minLength: 1}}, additionalProperties: false}, pool_spend: {type: "object", required: ["trigger", "amount"], properties: {trigger: {enum: ["round-started", "round-ended"]}, amount: {anyOf: [{type: "integer", minimum: 1}, {enum: ["all", "variable"]}]}, label: {type: "string", minLength: 1}}, additionalProperties: false}}, additionalProperties: false},
    normalize: resourceActionMenuOpen,
  },
  {
    id: "menu-action",
    version: 2,
    role: "EVENT",
    label: "One resource-action-menu action",
    description: "Opens one action of the enclosing resource-action-menu: id, label, its cost, and (optionally) how long it lasts. Leading unit-keyword CONDITION leaves and a select-unit leaf (if any) set its eligibility; the EVENT leaf(s) after those are the action's own trigger (its `when`, one or several alternatives); the effect leaves after that are what it does. binds_event_variable names the acting unit for a later eligibility check to reference (Battle Focus's Opportunity Seized/Fade Back); the two eligibility_* flags are that one record's own two requires shapes (engaged with the bound unit at phase start; after the bound unit's Hit roll, in your opponent's shooting phase) — not a general vocabulary, see the batch report.",
    starter: {action_id: "", label: "", cost_amount: null},
    parameterSchema: {type: "object", required: ["action_id", "label", "cost_amount"], properties: {action_id: {type: "string", minLength: 1}, label: {type: "string", minLength: 1}, cost_amount: {type: "integer", minimum: 1}, cost_pool_id: {type: "string", minLength: 1}, cost_resource_label: {type: "string", minLength: 1}, duration: {enum: ["immediate", "until-end-of-phase", "until-end-of-turn"]}, repeatable_if_different_unit: {type: "boolean"}, binds_event_variable: {type: "string", minLength: 1}, eligibility_engaged_with_bound_at_phase_start: {type: "boolean"}, eligibility_after_bound_hit_roll: {type: "boolean"}}, additionalProperties: false},
    normalize: menuAction,
  },
  {
    id: "persistent-designation-open",
    version: 1,
    role: "EFFECT",
    label: "Designate and remember a unit or marker",
    description: "Opens a persistent-designation: select one enemy unit or objective marker (once, at the named timing) and remember it for the rest of the battle; the effect leaves after it apply to the bearer or the bearer's unit each time the remembered relation holds.",
    starter: {designation: "", scope: "", timing: "", beneficiary: "this-model"},
    parameterSchema: {type: "object", required: ["designation", "scope", "timing", "beneficiary"], properties: {designation: {type: "string", minLength: 1}, scope: {enum: ["enemy-unit", "objective-marker"]}, timing: {enum: ["start-of-first-battle-round", "on-unit-destroyed"]}, beneficiary: {enum: ["this-model", "this-unit"]}}, additionalProperties: false},
    normalize: persistentDesignationOpen,
  },
  {
    id: "select-objective-open",
    version: 1,
    role: "EFFECT",
    label: "Select an objective marker",
    description: "Opens a select-objective: the effect leaves after it apply to the selected objective marker (an aura's centre, a designation's subject).",
    starter: {bind_as: ""},
    parameterSchema: {type: "object", required: ["bind_as"], properties: {bind_as: {type: "string", minLength: 1}, count: {type: "integer", minimum: 1}, each: {type: "boolean"}, range_inches: {type: "integer", minimum: 1}, origin: {enum: ["this-model", "this-unit"]}, controlled_by: {enum: ["your-army", "opponent"]}}, additionalProperties: false},
    normalize: selectObjectiveOpen,
  },
  {
    id: "objective-criterion",
    version: 2,
    role: "CONDITION",
    label: "Which objective markers a selection can take",
    description: "A qualifier on the objective markers a select-objective-open right before it can select. controlled-by-unit: the marker that unit was controlling when the rule was triggered (\"that: your unit was controlling when it was destroyed\"), or, with at previous-phase-end, at the end of the previous phase (\"that your unit was controlling at the end of the previous phase\"). clear-of: no unit of side (with every keywords, none of excluded_keywords) within range of the marker (\"has no enemy units (excluding AIRCRAFT units) within range of it\").",
    starter: {criterion: ""},
    parameterSchema: {type: "object", required: ["criterion"], properties: {criterion: {enum: ["controlled-by-unit", "clear-of"]}, unit: {enum: ["this-unit", "event-subject"], "x-only-when": {criterion: ["controlled-by-unit"]}}, at: {enum: ["previous-phase-end"], "x-only-when": {criterion: ["controlled-by-unit"]}, "x-optional": true}, side: {enum: ["friendly", "enemy", "any"], "x-only-when": {criterion: ["clear-of"]}}, keywords: {type: "array", items: {type: "string", minLength: 1}, minItems: 1, uniqueItems: true, "x-only-when": {criterion: ["clear-of"]}, "x-optional": true}, excluded_keywords: {type: "array", items: {type: "string", minLength: 1}, minItems: 1, uniqueItems: true, "x-only-when": {criterion: ["clear-of"]}, "x-optional": true}}, additionalProperties: false},
    normalize: objectiveCriterion,
  },
  {
    id: "destroyed-model-selection",
    version: 1,
    role: "CONDITION",
    label: "A selection among the destroyed models' units",
    description: "\"Select one of those destroyed models; that destroyed model's unit …\": the select-unit right before it takes only a unit that lost a model to the triggering attacks, which destroyer made. The selected unit is the destroyed model's unit.",
    starter: {destroyer: ""},
    parameterSchema: {type: "object", required: ["destroyer"], properties: {destroyer: {enum: ["this-unit", "this-model", "event-subject"]}}, additionalProperties: false},
    normalize: destroyedModelSelection,
  },
  {
    id: "mark-objective",
    version: 1,
    role: "EFFECT",
    label: "Tag (or untag) objective markers",
    description: "\"If your unit is controlling an objective, that objective is snared\": objective controlled-by-unit tags each marker this unit controls. Objective tagged with clear true removes the tag from the markers that carry it (the objective stops being snared); near event-subject keeps only the tagged marker within range of the moment's unit.",
    starter: {tag: "", objective: ""},
    parameterSchema: {type: "object", required: ["tag", "objective"], properties: {tag: {type: "string", minLength: 1}, objective: {enum: ["controlled-by-unit", "tagged"]}, near: {enum: ["event-subject"], "x-only-when": {objective: ["tagged"]}, "x-optional": true}, clear: {const: true, "x-optional": true}}, additionalProperties: false},
    normalize: markObjective,
  },
  {
    id: "opposed-designations",
    version: 1,
    role: "EFFECT",
    label: "Two groups hold opposite designations",
    description: "\"While K units are winning, J units are losing, and vice versa\": each time the record tags one group (friendly units with keywords, or with opposite_keywords) with tag or opposite_tag, the other group takes the other tag, and each group drops the tag it stops holding.",
    starter: {tag: "", opposite_tag: "", keywords: [], opposite_keywords: []},
    parameterSchema: {type: "object", required: ["tag", "opposite_tag", "keywords", "opposite_keywords"], properties: {tag: {type: "string", minLength: 1}, opposite_tag: {type: "string", minLength: 1}, keywords: {type: "array", items: {type: "string", minLength: 1}, minItems: 1, uniqueItems: true}, opposite_keywords: {type: "array", items: {type: "string", minLength: 1}, minItems: 1, uniqueItems: true}}, additionalProperties: false},
    normalize: opposedDesignations,
  },
];
