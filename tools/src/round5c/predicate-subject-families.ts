import type { SemanticFamilyDefinition } from "./contracts.js";
import { booleanValue, enumSet, enumValue, exactKeys, boundedInteger } from "./family-validation.js";
import { UNIT_KEYWORD } from "./buff-families.js";

/**
 * Unit-state, unit-keyword, unit-activity, unit-mark and unit-position — the predicates that
 * name a unit and something true of it — split out of `targeting-families.ts` (batch 6) once
 * that file had no headroom left for widening four of their subject vocabularies. `attack`,
 * `select-unit`, `instead`, and the four EFFECT families (eligibility-permission,
 * targeting-restriction, counts-as, rule-state, damage-reduction) stay there.
 */

/** Version 1-3 subjects: only the attack's own two parties. */
export const PREDICATE_SUBJECTS = ["this-unit", "target"] as const;
/**
 * Version 4/3/2 (unit-state/unit-activity/unit-keyword) widen `subject` to every unit-ref role
 * that shows up in authored data beyond the attack's own two parties: the model itself, the
 * unit that acted (event-subject), what an effect targets (recipient), and a unit the ability
 * selected earlier (selected-unit). `attacker` already reads via the attack leaf, but a
 * predicate can also ask about it directly ("if the attacking unit is below half-strength").
 */
export const WIDE_SUBJECTS = ["this-unit", "this-model", "target", "attacker", "event-subject", "recipient", "selected-unit"] as const;

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
const UNIT_ACTIVITIES_V1 = ["charged-this-turn", "advanced-this-turn", "remained-stationary", "fought-this-phase", "selected-to-shoot-this-phase"] as const;
/** Version 2 adds being selected to move this phase. Selected to fight is fought this phase. */
export const UNIT_ACTIVITIES = [...UNIT_ACTIVITIES_V1, "selected-to-move-this-phase"] as const;
const MAX_INCHES = 48;

const subjectAndNegation = {
  subject: { enum: PREDICATE_SUBJECTS },
  negated: { type: "boolean" },
} as const;
const wideSubjectAndNegation = {
  subject: { enum: WIDE_SUBJECTS },
  negated: { type: "boolean" },
} as const;

export const PREDICATE_SUBJECT_FAMILIES: readonly SemanticFamilyDefinition[] = [
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
    deprecated: true,
  },
  {
    id: "unit-state",
    version: 4,
    role: "CONDITION",
    label: "Unit is (or is not) in a state",
    description: "As version 3, but the subject can also be the attacking unit, the unit that triggered the ability, the effect's recipient, or a unit the ability selected earlier.",
    starter: { states: [], subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["states", "subject", "negated"],
      properties: { states: { type: "array", items: { enum: UNIT_STATES }, minItems: 1, uniqueItems: true }, ...wideSubjectAndNegation },
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
    deprecated: true,
  },
  {
    id: "unit-keyword",
    version: 2,
    role: "CONDITION",
    label: "Unit has (or lacks) a keyword",
    description: "As version 1, but the subject can also be this model, the attacking unit, the unit that triggered the ability, the effect's recipient, or a unit the ability selected earlier.",
    starter: { keywords: [], subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["keywords", "subject", "negated"],
      properties: { keywords: { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 1, uniqueItems: true }, ...wideSubjectAndNegation },
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
    deprecated: true,
  },
  {
    id: "unit-activity",
    version: 3,
    role: "CONDITION",
    label: "Unit has (or has not) acted",
    description: "As version 2, but the subject can also be the attacking unit, the unit that triggered the ability, the effect's recipient, or a unit the ability selected earlier.",
    starter: { activity: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["activity", "subject", "negated"],
      properties: { activity: { enum: UNIT_ACTIVITIES }, ...wideSubjectAndNegation },
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
    deprecated: true,
  },
  {
    id: "unit-position",
    version: 2,
    role: "CONDITION",
    label: "Unit's position",
    description: "As version 1; a closest-eligible check can also name whose closest it is (default the attacker) and a maximum range, and objective-range's subject can also be the attacking unit, the unit that triggered the ability, the effect's recipient, or a unit the ability selected earlier. Within/beyond still describe the attack's target.",
    starter: { kind: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["kind", "subject", "negated"],
      properties: {
        kind: { enum: POSITION_KINDS },
        inches: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { kind: DISTANCE_KINDS } },
        controlled_by: { enum: OBJECTIVE_CONTROLLERS, "x-only-when": { kind: ["objective-range"] } },
        to: { enum: WIDE_SUBJECTS, "x-only-when": { kind: ["closest-eligible"] } },
        range: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { kind: ["closest-eligible"] } },
        ...wideSubjectAndNegation,
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "unit-position",
    version: 3,
    role: "CONDITION",
    label: "Unit's position",
    description: "As version 2; within/beyond now take the same wide subject as objective-range and closest-eligible, not only the attack's target — \"while this unit is within 6\" of an objective marker\" names the unit directly, not the attack it may not even be part of.",
    starter: { kind: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["kind", "subject", "negated"],
      properties: {
        kind: { enum: POSITION_KINDS },
        inches: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { kind: DISTANCE_KINDS } },
        controlled_by: { enum: OBJECTIVE_CONTROLLERS, "x-only-when": { kind: ["objective-range"] } },
        to: { enum: WIDE_SUBJECTS, "x-only-when": { kind: ["closest-eligible"] } },
        range: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { kind: ["closest-eligible"] } },
        ...wideSubjectAndNegation,
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "unit-position",
    version: 4,
    role: "CONDITION",
    label: "Unit's position",
    description: "Where a unit is. within/beyond say what the distance is measured from with `of`: \"one enemy unit within 24\" of this unit\" is subject selected-unit, of this-unit; \"a unit within 8\" of that enemy unit\" (the unit whose move triggered the ability) is of event-subject. objective-range and closest-eligible are as version 3.",
    starter: { kind: "", subject: "", negated: false },
    parameterSchema: {
      type: "object",
      required: ["kind", "subject", "negated"],
      properties: {
        kind: { enum: POSITION_KINDS },
        inches: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { kind: DISTANCE_KINDS } },
        of: { enum: WIDE_SUBJECTS, "x-only-when": { kind: DISTANCE_KINDS } },
        controlled_by: { enum: OBJECTIVE_CONTROLLERS, "x-only-when": { kind: ["objective-range"] } },
        to: { enum: WIDE_SUBJECTS, "x-only-when": { kind: ["closest-eligible"] } },
        range: { type: "integer", minimum: 1, maximum: MAX_INCHES, "x-only-when": { kind: ["closest-eligible"] } },
        ...wideSubjectAndNegation,
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

/** Validate and canonicalise one unit-predicate family's parameters, or return null for other families. */
export function normalizePredicateSubjectParameters(family: string, input: Record<string, unknown>, version = 1): Record<string, unknown> | null {
  const wide = (label: string) => ({ subject: enumValue(input.subject, WIDE_SUBJECTS, `${label}.subject`), negated: booleanValue(input.negated, `${label}.negated`) });
  const legacy = (label: string) => ({ subject: enumValue(input.subject, PREDICATE_SUBJECTS, `${label}.subject`), negated: booleanValue(input.negated, `${label}.negated`) });
  switch (family) {
    case "unit-state": {
      exactKeys(input, ["states", "subject", "negated"], family);
      const states = enumSet(input.states, version >= 3 ? UNIT_STATES : version === 2 ? UNIT_STATES_V2 : UNIT_STATES_V1, "unit-state.states");
      if (version < 3) return { states, ...legacy(family) };
      const subject = enumValue(input.subject, version >= 4 ? WIDE_SUBJECTS : STATE_SUBJECTS, "unit-state.subject");
      if (subject === "this-model" && states.some((state) => state !== "on-battlefield")) throw new TypeError("unit-state: only being on the battlefield can be said of this model; use this unit for the other states.");
      return { states, subject, negated: booleanValue(input.negated, "unit-state.negated") };
    }
    case "unit-keyword":
      exactKeys(input, ["keywords", "subject", "negated"], family);
      return { keywords: keywordList(input.keywords), ...(version >= 2 ? wide(family) : legacy(family)) };
    case "unit-activity":
      exactKeys(input, ["activity", "subject", "negated"], family);
      return { activity: enumValue(input.activity, version >= 2 ? UNIT_ACTIVITIES : UNIT_ACTIVITIES_V1, "unit-activity.activity"), ...(version >= 3 ? wide(family) : legacy(family)) };
    case "unit-mark":
      exactKeys(input, ["mark", "subject", "negated"], family);
      return { mark: enumValue(input.mark, UNIT_MARKS, "unit-mark.mark"), ...legacy(family) };
    case "unit-position": {
      const kind = enumValue(input.kind, POSITION_KINDS, "unit-position.kind");
      const common = version >= 2 ? wide(family) : legacy(family);
      // Only objective-range and (from version 2) closest-eligible have a meaning for a subject
      // other than the attack's target in version 1/2; version 3 widens within/beyond too — "this
      // unit is within 6\" of an objective marker" names the unit directly.
      const subjectFree = version >= 3
        ? kind === "objective-range" || kind === "closest-eligible" || (DISTANCE_KINDS as readonly string[]).includes(kind)
        : version >= 2 ? kind === "objective-range" || kind === "closest-eligible" : kind === "objective-range";
      if (!subjectFree && common.subject !== "target") throw new TypeError(`unit-position ${kind} describes the attack's target; its subject must be target.`);
      if ((DISTANCE_KINDS as readonly string[]).includes(kind)) {
        // Version 4: what the distance is measured from is required, never assumed.
        exactKeys(input, ["kind", "inches", "subject", "negated", ...(version >= 4 ? ["of"] : [])], family);
        return {
          kind, inches: boundedInteger(input.inches, 1, MAX_INCHES, "unit-position.inches"),
          ...(version >= 4 ? { of: enumValue(input.of, WIDE_SUBJECTS, "unit-position.of") } : {}), ...common,
        };
      }
      if (kind === "objective-range") {
        exactKeys(input, ["kind", "controlled_by", "subject", "negated"], family);
        return { kind, controlled_by: enumValue(input.controlled_by, OBJECTIVE_CONTROLLERS, "unit-position.controlled_by"), ...common };
      }
      // closest-eligible: version 2 adds optional to/range.
      const optional = [...(version >= 2 && "to" in input ? ["to"] : []), ...(version >= 2 && "range" in input ? ["range"] : [])];
      exactKeys(input, ["kind", "subject", "negated", ...optional], family);
      const result: Record<string, unknown> = { kind, ...common };
      if ("to" in input) result.to = enumValue(input.to, WIDE_SUBJECTS, "unit-position.to");
      if ("range" in input) result.range = boundedInteger(input.range, 1, MAX_INCHES, "unit-position.range");
      return result;
    }
    case "target-is-selected":
      exactKeys(input, [], family);
      return {};
    default:
      return null;
  }
}
