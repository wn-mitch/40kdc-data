import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, booleanValue, enumValue, exactKeys } from "./family-validation.js";
import { ENTITY_ID_PATTERN } from "./core-families.js";
import { UNIT_KEYWORD } from "./buff-families.js";
import { SUBJECT_REF } from "./predicate-families.js";

/**
 * Batch 7a's remaining new predicate families: unit composition (model-profile, loadout,
 * eligible, resource) and mission-card board state (operation-markers, engagement-fronts,
 * destroyed-while-on-objective, destroyed-in-tagged-terrain). Compiled in
 * `compile-conditions.ts`'s `condition()`, each under its own family id.
 */

const UNIFORM = ["ranged", "melee"] as const;
const ELIGIBLE_TO = ["shoot", "declare-charge", "fight", "start-action", "be-selected"] as const;
const ELIGIBLE_AT = ["now", "opponents-previous-turn-end"] as const;
const OWNERS = ["friendly", "enemy"] as const;
const OBJECTIVE_ROLES = ["central", "expansion"] as const;

const withSubjectAndNegation = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  required,
  properties: { subject: { enum: SUBJECT_REF }, negated: { type: "boolean" }, ...properties },
  additionalProperties: false,
});

function subjectOptional(input: Record<string, unknown>): string | undefined {
  return "subject" in input ? enumValue(input.subject, SUBJECT_REF, "subject") : undefined;
}

export const MISSION_PREDICATE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "model-profile",
    version: 1,
    role: "CONDITION",
    label: "Model uses a datasheet profile",
    description: "Requires a model to use a named datasheet model profile (a named character's own profile, not a generic Triarchal Menhir).",
    starter: { profile: "" },
    parameterSchema: withSubjectAndNegation({ profile: { type: "string", pattern: ENTITY_ID_PATTERN.source } }, ["profile"]),
  },
  {
    id: "loadout",
    version: 1,
    role: "CONDITION",
    label: "Unit is uniformly equipped",
    description: "Requires every model in a unit (or every model of a keyword) to carry identical ranged or melee weapons.",
    starter: { uniform: "ranged" },
    parameterSchema: withSubjectAndNegation({ model_keyword: { type: "string", pattern: UNIT_KEYWORD.source }, uniform: { enum: UNIFORM } }, ["uniform"]),
  },
  {
    id: "eligible",
    version: 1,
    role: "CONDITION",
    label: "Unit is eligible to",
    description: "Requires a unit or model to be eligible to shoot, declare a charge, fight, start an action, or (with a named ability) be selected, optionally as of the end of the opponent's previous turn.",
    starter: { to: "shoot" },
    parameterSchema: withSubjectAndNegation({
      to: { enum: ELIGIBLE_TO },
      source_ability_id: { type: "string", pattern: ENTITY_ID_PATTERN.source, "x-only-when": { to: ["be-selected"] } },
      source_ability_owner: { enum: OWNERS, "x-only-when": { to: ["be-selected"] } },
      at: { enum: ELIGIBLE_AT },
    }, ["to"]),
  },
  {
    id: "resource",
    version: 1,
    role: "CONDITION",
    label: "Resource pool holds",
    description: "Requires a named resource pool to hold at least, or at most, an amount, or to have unused capacity below its maximum (optionally as of the end of the opponent's previous turn).",
    starter: { pool: "", at_least: 1 },
    parameterSchema: {
      type: "object",
      required: ["pool"],
      properties: {
        pool: { type: "string", minLength: 1 },
        at_least: { type: "integer", minimum: 0 },
        at_most: { type: "integer", minimum: 0 },
        below_max: { const: true },
        source_ability_id: { type: "string", pattern: ENTITY_ID_PATTERN.source, "x-only-when": { below_max: ["true"] } },
        source_ability_owner: { enum: OWNERS, "x-only-when": { below_max: ["true"] } },
        at: { enum: ELIGIBLE_AT },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "operation-markers",
    version: 1,
    role: "CONDITION",
    label: "Operation markers on the battlefield",
    description: "Mission cards: a count of friendly or opponent operation markers on the battlefield, optionally with a friendly unit (and no enemy unit) in the same terrain area, or within range of the opponent's home objective.",
    starter: { side: "friendly", count_min: 1 },
    parameterSchema: {
      type: "object",
      required: [],
      properties: {
        side: { enum: OWNERS.map((owner) => (owner === "enemy" ? "opponent" : owner)) },
        count_min: { type: "integer", minimum: 0 },
        count_max: { type: "integer", minimum: 0 },
        friendly_unit_in_same_terrain_area: { const: true },
        no_enemy_in_terrain_area: { const: true },
        within_range_of: { const: "opponent-home-objective" },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "engagement-fronts",
    version: 1,
    role: "CONDITION",
    label: "Engaged on multiple fronts",
    description: "Mission cards: you are engaged on at least this many fronts.",
    starter: { count_min: 2 },
    parameterSchema: { type: "object", required: ["count_min"], properties: { count_min: { type: "integer", minimum: 0 }, negated: { type: "boolean" } }, additionalProperties: false },
  },
  {
    id: "destroyed-while-on-objective",
    version: 1,
    role: "CONDITION",
    label: "Enemy units destroyed on an objective",
    description: "Mission cards: a count of enemy units destroyed on (or by a unit on) an objective, optionally narrowed to central or expansion objectives or to units that started the turn there.",
    starter: { count_min: 1 },
    parameterSchema: {
      type: "object",
      required: [],
      properties: {
        count_min: { type: "integer", minimum: 0 },
        objective_role: { enum: OBJECTIVE_ROLES },
        destroyer_on_objective: { const: true },
        victim_on_objective: { const: true },
        victim_started_turn_on_objective: { const: true },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "destroyed-in-tagged-terrain",
    version: 1,
    role: "CONDITION",
    label: "Enemy units destroyed in tagged terrain",
    description: "Mission cards: a count of enemy units destroyed in (or that started the turn in) terrain tagged with a designation.",
    starter: { count_min: 1 },
    parameterSchema: {
      type: "object",
      required: [],
      properties: {
        count_min: { type: "integer", minimum: 0 },
        tag: { type: "string", minLength: 1 },
        at_start_of_turn: { const: true },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
];

function trueFlag(value: unknown, label: string): true {
  if (value === true) return true;
  throw new TypeError(`${label} must be true.`);
}

/** Validate and canonicalise one mission-predicate family's parameters, or return null for other families. */
export function normalizeMissionPredicateParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  const negated = "negated" in input ? { negated: booleanValue(input.negated, `${family}.negated`) } : {};
  switch (family) {
    case "model-profile": {
      const subject = subjectOptional(input);
      exactKeys(input, [...(subject === undefined ? [] : ["subject"]), "profile", ...(("negated" in input) ? ["negated"] : [])], family);
      const profile = String(input.profile ?? "");
      if (!ENTITY_ID_PATTERN.test(profile)) throw new TypeError("model-profile.profile must be a kebab-case entity id.");
      return { ...(subject === undefined ? {} : { subject }), profile, ...negated };
    }
    case "loadout": {
      const subject = subjectOptional(input);
      const keys = [...(subject === undefined ? [] : ["subject"]), ...("model_keyword" in input ? ["model_keyword"] : []), "uniform", ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { ...(subject === undefined ? {} : { subject }), uniform: enumValue(input.uniform, UNIFORM, "loadout.uniform") };
      if ("model_keyword" in input) {
        const keyword = String(input.model_keyword ?? "").toUpperCase();
        if (!UNIT_KEYWORD.test(keyword)) throw new TypeError("loadout.model_keyword must be a unit keyword.");
        result.model_keyword = keyword;
      }
      return { ...result, ...negated };
    }
    case "eligible": {
      const subject = subjectOptional(input);
      const to = enumValue(input.to, ELIGIBLE_TO, "eligible.to");
      const forSelection = to === "be-selected";
      const keys = [...(subject === undefined ? [] : ["subject"]), "to",
        ...(forSelection && "source_ability_id" in input ? ["source_ability_id"] : []), ...(forSelection && "source_ability_owner" in input ? ["source_ability_owner"] : []),
        ...("at" in input ? ["at"] : []), ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { ...(subject === undefined ? {} : { subject }), to };
      if (forSelection && "source_ability_id" in input) {
        const abilityId = String(input.source_ability_id ?? "");
        if (!ENTITY_ID_PATTERN.test(abilityId)) throw new TypeError("eligible.source_ability_id must be a kebab-case entity id.");
        result.source_ability_id = abilityId;
      }
      if (forSelection && "source_ability_owner" in input) result.source_ability_owner = enumValue(input.source_ability_owner, OWNERS, "eligible.source_ability_owner");
      if ("at" in input) result.at = enumValue(input.at, ELIGIBLE_AT, "eligible.at");
      return { ...result, ...negated };
    }
    case "resource": {
      const keys = ["pool", ...(["at_least", "at_most", "below_max", "source_ability_id", "source_ability_owner", "at"].filter((key) => key in input)), ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      if (!("at_least" in input) && !("at_most" in input) && !("below_max" in input)) throw new TypeError("resource needs at_least, at_most, or below_max.");
      const result: Record<string, unknown> = { pool: String(input.pool ?? "") };
      if (!result.pool) throw new TypeError("resource.pool must be a nonempty string.");
      if ("at_least" in input) result.at_least = boundedInteger(input.at_least, 0, 999, "resource.at_least");
      if ("at_most" in input) result.at_most = boundedInteger(input.at_most, 0, 999, "resource.at_most");
      if ("below_max" in input) result.below_max = trueFlag(input.below_max, "resource.below_max");
      if ("source_ability_id" in input) {
        const abilityId = String(input.source_ability_id ?? "");
        if (!ENTITY_ID_PATTERN.test(abilityId)) throw new TypeError("resource.source_ability_id must be a kebab-case entity id.");
        result.source_ability_id = abilityId;
      }
      if ("source_ability_owner" in input) result.source_ability_owner = enumValue(input.source_ability_owner, OWNERS, "resource.source_ability_owner");
      if ("at" in input) result.at = enumValue(input.at, ELIGIBLE_AT, "resource.at");
      return { ...result, ...negated };
    }
    case "operation-markers": {
      const optional = ["side", "count_min", "count_max", "friendly_unit_in_same_terrain_area", "no_enemy_in_terrain_area", "within_range_of"].filter((key) => key in input);
      exactKeys(input, [...optional, ...(("negated" in input) ? ["negated"] : [])], family);
      const result: Record<string, unknown> = {};
      if ("side" in input) result.side = enumValue(input.side, ["friendly", "opponent"], "operation-markers.side");
      if ("count_min" in input) result.count_min = boundedInteger(input.count_min, 0, 20, "operation-markers.count_min");
      if ("count_max" in input) result.count_max = boundedInteger(input.count_max, 0, 20, "operation-markers.count_max");
      if ("friendly_unit_in_same_terrain_area" in input) result.friendly_unit_in_same_terrain_area = trueFlag(input.friendly_unit_in_same_terrain_area, "operation-markers.friendly_unit_in_same_terrain_area");
      if ("no_enemy_in_terrain_area" in input) result.no_enemy_in_terrain_area = trueFlag(input.no_enemy_in_terrain_area, "operation-markers.no_enemy_in_terrain_area");
      if ("within_range_of" in input) result.within_range_of = enumValue(input.within_range_of, ["opponent-home-objective"], "operation-markers.within_range_of");
      return { ...result, ...negated };
    }
    case "engagement-fronts":
      exactKeys(input, "negated" in input ? ["count_min", "negated"] : ["count_min"], family);
      return { count_min: boundedInteger(input.count_min, 0, 6, "engagement-fronts.count_min"), ...negated };
    case "destroyed-while-on-objective": {
      const optional = ["count_min", "objective_role", "destroyer_on_objective", "victim_on_objective", "victim_started_turn_on_objective"].filter((key) => key in input);
      exactKeys(input, [...optional, ...(("negated" in input) ? ["negated"] : [])], family);
      const result: Record<string, unknown> = {};
      if ("count_min" in input) result.count_min = boundedInteger(input.count_min, 0, 20, "destroyed-while-on-objective.count_min");
      if ("objective_role" in input) result.objective_role = enumValue(input.objective_role, OBJECTIVE_ROLES, "destroyed-while-on-objective.objective_role");
      if ("destroyer_on_objective" in input) result.destroyer_on_objective = trueFlag(input.destroyer_on_objective, "destroyed-while-on-objective.destroyer_on_objective");
      if ("victim_on_objective" in input) result.victim_on_objective = trueFlag(input.victim_on_objective, "destroyed-while-on-objective.victim_on_objective");
      if ("victim_started_turn_on_objective" in input) result.victim_started_turn_on_objective = trueFlag(input.victim_started_turn_on_objective, "destroyed-while-on-objective.victim_started_turn_on_objective");
      return { ...result, ...negated };
    }
    case "destroyed-in-tagged-terrain": {
      const optional = ["count_min", "tag", "at_start_of_turn"].filter((key) => key in input);
      exactKeys(input, [...optional, ...(("negated" in input) ? ["negated"] : [])], family);
      const result: Record<string, unknown> = {};
      if ("count_min" in input) result.count_min = boundedInteger(input.count_min, 0, 20, "destroyed-in-tagged-terrain.count_min");
      if ("tag" in input) {
        const tag = String(input.tag ?? "");
        if (!tag) throw new TypeError("destroyed-in-tagged-terrain.tag must be a nonempty string.");
        result.tag = tag;
      }
      if ("at_start_of_turn" in input) result.at_start_of_turn = trueFlag(input.at_start_of_turn, "destroyed-in-tagged-terrain.at_start_of_turn");
      return { ...result, ...negated };
    }
    default:
      return null;
  }
}
