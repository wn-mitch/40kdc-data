import type { SemanticFamilyDefinition } from "./contracts.js";
import { booleanValue, boundedInteger, enumSet, enumValue, exactKeys } from "./family-validation.js";

/**
 * Families for who an attack involves and what must be true of a unit. Each is one meaning:
 * the attack context is an event, and every predicate names its subject (this unit or the
 * attack's target) and can be negated, so "a unit that is not Below Half-strength" is one
 * leaf and "that targets a CHARACTER unit" is another.
 */

export const ATTACK_DIRECTIONS = ["makes", "targeted"] as const;
export const ATTACK_UNITS = ["this-model", "this-unit", "bearer", "bearers-unit", "that-unit"] as const;
export const ATTACK_TYPES = ["any", "melee", "ranged"] as const;
export const PREDICATE_SUBJECTS = ["this-unit", "target"] as const;
const UNIT_STATES_V1 = ["below-starting-strength", "below-half-strength", "battle-shocked"] as const;
/** Version 2 adds being within Engagement Range of an enemy unit (negated: unengaged). */
const UNIT_STATES_V2 = [...UNIT_STATES_V1, "engaged"] as const;
/** Version 3 adds being on the battlefield, the one state a single model can have. */
export const UNIT_STATES = [...UNIT_STATES_V2, "on-battlefield"] as const;
/** unit-state version 3 subjects: "this model" is only for being on the battlefield. */
export const STATE_SUBJECTS = ["this-model", ...PREDICATE_SUBJECTS] as const;
export const UNIT_MARKS = ["oath-of-moment", "afflicted", "spotted", "hidden", "marked"] as const;
export const POSITION_KINDS = ["closest-eligible", "within", "beyond", "objective-range"] as const;
const DISTANCE_KINDS = ["within", "beyond"] as const;
export const OBJECTIVE_CONTROLLERS = ["any", "you", "opponent"] as const;
export const SELECT_SCOPES = ["enemy", "friendly"] as const;
const UNIT_ACTIVITIES_V1 = ["charged-this-turn", "advanced-this-turn", "remained-stationary", "fought-this-phase", "selected-to-shoot-this-phase"] as const;
/** Version 2 adds being selected to move this phase. Selected to fight is fought this phase. */
export const UNIT_ACTIVITIES = [...UNIT_ACTIVITIES_V1, "selected-to-move-this-phase"] as const;
const SELECT_DISTANCES = ["any", "within"] as const;
const MAX_INCHES = 48;

/** A unit keyword as the DSL writes it: uppercase words, without markdown emphasis. */
const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;

const subjectAndNegation = {
  subject: { enum: PREDICATE_SUBJECTS },
  negated: { type: "boolean" },
} as const;

export const TARGETING_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "attack",
    version: 1,
    role: "EVENT",
    label: "Each time an attack is made",
    description: "An attack made by the named model or unit, or an attack that targets it, optionally only melee or only ranged. What the attack targets is a separate condition.",
    starter: { direction: "", unit: "", attack_type: "" },
    parameterSchema: {
      type: "object",
      required: ["direction", "unit", "attack_type"],
      properties: { direction: { enum: ATTACK_DIRECTIONS }, unit: { enum: ATTACK_UNITS }, attack_type: { enum: ATTACK_TYPES } },
      additionalProperties: false,
    },
  },
  {
    id: "unit-state",
    version: 1,
    role: "CONDITION",
    label: "Unit is (or is not) in a state",
    description: "This unit or the attack's target is below its Starting Strength, Below Half-strength, or Battle-shocked. Several states mean any of them.",
    starter: { states: [], subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["states", "subject", "negated"],
      properties: { states: { type: "array", items: { enum: UNIT_STATES_V1 }, minItems: 1, uniqueItems: true }, ...subjectAndNegation },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "unit-state",
    version: 2,
    role: "CONDITION",
    label: "Unit is (or is not) in a state",
    description: "This unit or the attack's target is below its Starting Strength, Below Half-strength, Battle-shocked, or within Engagement Range of an enemy unit (negated: unengaged). Several states mean any of them.",
    starter: { states: [], subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["states", "subject", "negated"],
      properties: { states: { type: "array", items: { enum: UNIT_STATES_V2 }, minItems: 1, uniqueItems: true }, ...subjectAndNegation },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "unit-state",
    version: 3,
    role: "CONDITION",
    label: "Unit is (or is not) in a state",
    description: "This model, this unit or the attack's target is below its Starting Strength, Below Half-strength, Battle-shocked, within Engagement Range of an enemy unit (negated: unengaged), or on the battlefield. Several states mean any of them; this model can only be on the battlefield.",
    starter: { states: [], subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["states", "subject", "negated"],
      properties: { states: { type: "array", items: { enum: UNIT_STATES }, minItems: 1, uniqueItems: true }, subject: { enum: STATE_SUBJECTS }, negated: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    id: "unit-keyword",
    version: 1,
    role: "CONDITION",
    label: "Unit has (or lacks) a keyword",
    description: "This unit or the attack's target has one of the keywords, for example CHARACTER, or MONSTER or VEHICLE. A unit that can FLY has the FLY keyword.",
    starter: { keywords: [], subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["keywords", "subject", "negated"],
      properties: { keywords: { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 1, uniqueItems: true }, ...subjectAndNegation },
      additionalProperties: false,
    },
  },
  {
    id: "unit-activity",
    version: 1,
    role: "CONDITION",
    label: "Unit has (or has not) acted",
    description: "This unit or the attack's target charged or Advanced this turn, Remained Stationary, fought this phase, or was selected to shoot this phase.",
    starter: { activity: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["activity", "subject", "negated"],
      properties: { activity: { enum: UNIT_ACTIVITIES_V1 }, ...subjectAndNegation },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "unit-activity",
    version: 2,
    role: "CONDITION",
    label: "Unit has (or has not) acted",
    description: "This unit or the attack's target charged or Advanced this turn, Remained Stationary, fought (or was selected to fight) this phase, or was selected to shoot or to move this phase.",
    starter: { activity: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["activity", "subject", "negated"],
      properties: { activity: { enum: UNIT_ACTIVITIES }, ...subjectAndNegation },
      additionalProperties: false,
    },
  },
  {
    id: "unit-mark",
    version: 1,
    role: "CONDITION",
    label: "Unit carries (or lacks) a mark",
    description: "This unit or the attack's target carries a named mark, such as the Oath of Moment target or Afflicted.",
    starter: { mark: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["mark", "subject", "negated"],
      properties: { mark: { enum: UNIT_MARKS }, ...subjectAndNegation },
      additionalProperties: false,
    },
  },
  {
    id: "unit-position",
    version: 1,
    role: "CONDITION",
    label: "Unit's position",
    description: "The attack's target is the closest eligible target, or within or more than a distance away; or a unit is within range of an objective marker.",
    starter: { kind: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["kind", "subject", "negated"],
      properties: {
        kind: { enum: POSITION_KINDS },
        inches: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { kind: DISTANCE_KINDS } },
        controlled_by: { enum: OBJECTIVE_CONTROLLERS, "x-only-when": { kind: ["objective-range"] } },
        ...subjectAndNegation,
      },
      additionalProperties: false,
    },
  },
  {
    id: "target-is-selected",
    version: 1,
    role: "CONDITION",
    label: "Target is the selected unit",
    description: "The attack targets the unit selected earlier in the ability (\"that unit\" after \"select one enemy unit\").",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    id: "select-unit",
    version: 1,
    role: "EVENT",
    label: "Select a unit",
    description: "The ability selects one enemy or friendly unit, optionally within a distance or visible, and later wording refers to it as \"that unit\".",
    starter: { scope: "", distance: "", visible: false },
    parameterSchema: {
      type: "object",
      required: ["scope", "distance", "visible"],
      properties: {
        scope: { enum: SELECT_SCOPES },
        distance: { enum: SELECT_DISTANCES },
        inches: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { distance: ["within"] } },
        visible: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "instead",
    version: 1,
    role: "COMBINATOR",
    label: "Instead",
    description: "The effect in this clause replaces an earlier effect of the same kind when this clause's condition holds; it does not add to it.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function keywordList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("unit-keyword.keywords must list at least one keyword.");
  const keywords = value.map((item) => {
    if (typeof item !== "string") throw new TypeError("unit-keyword.keywords must be strings.");
    const keyword = item.replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`unit-keyword keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(keywords).size !== keywords.length) throw new TypeError("unit-keyword.keywords lists a keyword twice.");
  return keywords.sort();
}

/** Validate and canonicalise one targeting family's parameters, or return null for other families. */
export function normalizeTargetingParameters(family: string, input: Record<string, unknown>, version = 1): Record<string, unknown> | null {
  const predicate = (label: string) => ({ subject: enumValue(input.subject, PREDICATE_SUBJECTS, `${label}.subject`), negated: booleanValue(input.negated, `${label}.negated`) });
  switch (family) {
    case "attack":
      exactKeys(input, ["direction", "unit", "attack_type"], family);
      return {
        direction: enumValue(input.direction, ATTACK_DIRECTIONS, "attack.direction"),
        unit: enumValue(input.unit, ATTACK_UNITS, "attack.unit"),
        attack_type: enumValue(input.attack_type, ATTACK_TYPES, "attack.attack_type"),
      };
    case "unit-state": {
      exactKeys(input, ["states", "subject", "negated"], family);
      const states = enumSet(input.states, version >= 3 ? UNIT_STATES : version === 2 ? UNIT_STATES_V2 : UNIT_STATES_V1, "unit-state.states");
      if (version < 3) return { states, ...predicate(family) };
      const subject = enumValue(input.subject, STATE_SUBJECTS, "unit-state.subject");
      if (subject === "this-model" && states.some((state) => state !== "on-battlefield")) throw new TypeError("unit-state: only being on the battlefield can be said of this model; use this unit for the other states.");
      return { states, subject, negated: booleanValue(input.negated, "unit-state.negated") };
    }
    case "unit-keyword":
      exactKeys(input, ["keywords", "subject", "negated"], family);
      return { keywords: keywordList(input.keywords), ...predicate(family) };
    case "unit-activity":
      exactKeys(input, ["activity", "subject", "negated"], family);
      return { activity: enumValue(input.activity, version >= 2 ? UNIT_ACTIVITIES : UNIT_ACTIVITIES_V1, "unit-activity.activity"), ...predicate(family) };
    case "unit-mark":
      exactKeys(input, ["mark", "subject", "negated"], family);
      return { mark: enumValue(input.mark, UNIT_MARKS, "unit-mark.mark"), ...predicate(family) };
    case "unit-position": {
      const kind = enumValue(input.kind, POSITION_KINDS, "unit-position.kind");
      const common = predicate(family);
      // Only objective range has a meaning for this unit; the rest measure the attack's target.
      if (kind !== "objective-range" && common.subject !== "target") throw new TypeError(`unit-position ${kind} describes the attack's target; its subject must be target.`);
      if ((DISTANCE_KINDS as readonly string[]).includes(kind)) {
        exactKeys(input, ["kind", "inches", "subject", "negated"], family);
        return { kind, inches: boundedInteger(input.inches, 1, MAX_INCHES, "unit-position.inches"), ...common };
      }
      if (kind === "objective-range") {
        exactKeys(input, ["kind", "controlled_by", "subject", "negated"], family);
        return { kind, controlled_by: enumValue(input.controlled_by, OBJECTIVE_CONTROLLERS, "unit-position.controlled_by"), ...common };
      }
      exactKeys(input, ["kind", "subject", "negated"], family);
      return { kind, ...common };
    }
    case "target-is-selected":
    case "instead":
      exactKeys(input, [], family);
      return {};
    case "select-unit": {
      const distance = enumValue(input.distance, SELECT_DISTANCES, "select-unit.distance");
      exactKeys(input, distance === "within" ? ["scope", "distance", "inches", "visible"] : ["scope", "distance", "visible"], family);
      return {
        scope: enumValue(input.scope, SELECT_SCOPES, "select-unit.scope"),
        distance,
        ...(distance === "within" ? { inches: boundedInteger(input.inches, 1, MAX_INCHES, "select-unit.inches") } : {}),
        visible: booleanValue(input.visible, "select-unit.visible"),
      };
    }
    default:
      return null;
  }
}
