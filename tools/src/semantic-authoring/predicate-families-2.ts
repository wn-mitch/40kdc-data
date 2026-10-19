import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, booleanValue, enumValue, exactKeys } from "./family-validation.js";
import { nonEmptyString } from "./buff-families.js";
import { PHASES, TURNS } from "./core-families.js";
import { SUBJECT_REF } from "./predicate-families.js";
import { DESIGNATION_IDS } from "../translate/designations.js";
import { ROLL_KINDS } from "./dice-families.js";

/**
 * More new predicate families (batch 6), split from `predicate-families.ts` to keep both files
 * well under the line ceiling: attack-time and board/army predicates, plus `phase-window` (the
 * 633-record gap of `phase-is`/`player-turn-is` used outside a trigger) and the three zero-record
 * phase-4 conditions (`battle-size`, `guided`, `moved-over`) that shipped schema/describer support
 * this round but no family. Each compiles in `compile-conditions.ts`.
 */

const ATTACK_TYPES = ["ranged", "melee", "psychic"] as const;
const SHOOTING_TYPES = ["normal", "assault", "close-quarters", "indirect", "snap"] as const;
const FIGHT_TYPES = ["normal", "overrun"] as const;
const STAT_SIDES = ["attacker", "defender"] as const;
const COMPARISONS = ["greater-than", "less-than", "equal-to", "greater-or-equal", "less-or-equal"] as const;
const HISTORY_WINDOWS = ["phase", "turn", "round", "battle", "previous-turn"] as const;
const BATTLE_SIZES = ["incursion", "strike-force", "onslaught"] as const;
const ROLL_OUTCOMES = ["success", "failure", "critical"] as const;

const withSubjectAndNegation = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  required,
  properties: { subject: { enum: SUBJECT_REF }, negated: { type: "boolean" }, ...properties },
  additionalProperties: false,
});

function subjectOptional(input: Record<string, unknown>): string | undefined {
  return "subject" in input ? enumValue(input.subject, SUBJECT_REF, "subject") : undefined;
}

export const PREDICATE_FAMILIES_2: readonly SemanticFamilyDefinition[] = [
  {
    id: "attack-filter",
    version: 1,
    role: "CONDITION",
    label: "The attack being resolved matches",
    description: "Requires the attack being resolved to be of a type, shooting or fight kind, a named or keyword weapon, or that every attack this phase targets the same unit.",
    starter: { attack_type: "ranged" },
    parameterSchema: {
      type: "object",
      required: [],
      properties: {
        attack_type: { enum: ATTACK_TYPES },
        shooting_type: { enum: SHOOTING_TYPES },
        fight_type: { enum: FIGHT_TYPES },
        weapon_keyword: { type: "string", minLength: 1 },
        weapon_name: { type: "string", minLength: 1 },
        all_target_same_unit: { const: true },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "attack-compare",
    version: 1,
    role: "CONDITION",
    label: "Compare an attack's stats",
    description: "Compares the attacker's or the target's named characteristic (optionally the highest or lowest of several) against the other side's, or against a fixed value.",
    starter: { left_of: "attacker", left_stat: "S", comparison: "greater-than", right_kind: "stat", right_of: "defender", right_stat: "T" },
    parameterSchema: {
      type: "object",
      required: ["left_of", "left_stat", "comparison", "right_kind"],
      properties: {
        left_of: { enum: STAT_SIDES },
        left_stat: { type: "string", minLength: 1 },
        left_reduce: { enum: ["max", "min"] },
        comparison: { enum: COMPARISONS },
        right_kind: { enum: ["stat", "value"] },
        right_of: { enum: STAT_SIDES, "x-only-when": { right_kind: ["stat"] } },
        right_stat: { type: "string", minLength: 1, "x-only-when": { right_kind: ["stat"] } },
        right_reduce: { enum: ["max", "min"], "x-only-when": { right_kind: ["stat"] } },
        right_value: { type: "number", "x-only-when": { right_kind: ["value"] } },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "visible",
    version: 1,
    role: "CONDITION",
    label: "Unit's visibility",
    description: "Requires a unit to be (fully, if set) visible to another, or names the unit whose model blocks the view instead.",
    starter: {},
    parameterSchema: withSubjectAndNegation({ to: { enum: SUBJECT_REF }, fully: { const: true }, blocked_by: { enum: SUBJECT_REF } }),
  },
  {
    id: "designated-filter",
    version: 1,
    role: "CONDITION",
    label: "Unit carries a designation",
    description: "Requires a unit to carry a named designation (any registered tag, not only the five original marks), optionally applied by a named unit, or counts how many carry it.",
    starter: { tag: "" },
    parameterSchema: withSubjectAndNegation({
      tag: { type: "string", minLength: 1 },
      by: { enum: SUBJECT_REF },
      count_min: { type: "integer", minimum: 0, maximum: 20 },
      count_max: { type: "integer", minimum: 0, maximum: 20 },
    }, ["tag"]),
  },
  {
    id: "battle-round",
    version: 1,
    role: "CONDITION",
    label: "Battle round is within a range",
    description: "Requires the current battle round to be a fixed round, or within a range (\"from the third battle round onward\").",
    starter: { min: 1 },
    parameterSchema: {
      type: "object",
      required: [],
      minProperties: 1,
      properties: { min: { type: "integer", minimum: 1, maximum: 5 }, max: { type: "integer", minimum: 1, maximum: 5 } },
      additionalProperties: false,
    },
  },
  {
    id: "battle-size",
    version: 1,
    role: "CONDITION",
    label: "Battle size is",
    description: "Requires the battle to be played at a named battle size (Incursion, Strike Force, or Onslaught).",
    starter: { size: "strike-force" },
    parameterSchema: { type: "object", required: ["size"], properties: { size: { enum: BATTLE_SIZES }, negated: { type: "boolean" } }, additionalProperties: false },
  },
  {
    id: "guided",
    version: 1,
    role: "CONDITION",
    label: "Unit is Guided",
    description: "Requires a unit to be Guided (has For the Greater Good, is not an Observer, and is targeting one or more Spotted units).",
    starter: {},
    parameterSchema: withSubjectAndNegation({}),
  },
  {
    id: "moved-over",
    version: 1,
    role: "CONDITION",
    label: "Unit was moved over",
    description: "\"That unit it moved over during that move\", \"a unit this model moved across this phase\": the subject unit's models were moved across by `by` during the move just made (omit `window`), or within a wider window (phase, turn, round, battle, or the previous turn) when the wording says so explicitly. This is the condition on a unit selected by proximity to a move, not the move itself.",
    starter: { by: "this-model" },
    parameterSchema: withSubjectAndNegation({ by: { enum: SUBJECT_REF }, window: { enum: HISTORY_WINDOWS } }, ["by"]),
  },
  {
    id: "roll-outcome",
    version: 1,
    role: "CONDITION",
    label: "A roll came out this way",
    description: "Requires a named roll (the Wound roll, a Hit roll, a Leadership test, ...) to have come out a given way — success, failure or a critical result. `source` binds the roll to an earlier EVENT leaf's binds_event_variable, when the ability needs a specific roll rather than the most recent one of that kind.",
    starter: { roll: "hit", result: "success" },
    parameterSchema: {
      type: "object",
      required: ["roll", "result"],
      properties: {
        roll: { enum: ROLL_KINDS },
        result: { enum: ROLL_OUTCOMES },
        source: { type: "string", minLength: 1 },
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "phase-window",
    version: 1,
    role: "CONDITION",
    label: "During a phase or turn",
    description: "Gates an effect by phase and/or whose turn it is, outside of a trigger's own moment (\"during the Fight phase\", \"in your opponent's turn\").",
    starter: { phase: "shooting" },
    parameterSchema: {
      type: "object",
      required: [],
      minProperties: 1,
      properties: { phase: { enum: PHASES.filter((phase) => phase !== "any") }, turn: { enum: TURNS } },
      additionalProperties: false,
    },
  },
];

const KNOWN_FAMILIES_2 = new Set(PREDICATE_FAMILIES_2.map((family) => family.id));

/** Validate and canonicalise one of this file's predicate families, or return null for other families. */
export function normalizePredicateParameters2(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  // Bail out before touching `input.subject`: another family's subject vocabulary (e.g.
  // unit-state's "target") is not a member of this module's SUBJECT_REF and must not throw here.
  if (!KNOWN_FAMILIES_2.has(family)) return null;
  const negated = "negated" in input ? { negated: booleanValue(input.negated, `${family}.negated`) } : {};
  const subject = subjectOptional(input);
  const withSubject = subject === undefined ? {} : { subject };
  switch (family) {
    case "attack-filter": {
      const keys = ["attack_type", "shooting_type", "fight_type", "weapon_keyword", "weapon_name", "all_target_same_unit", "negated"].filter((key) => key in input);
      exactKeys(input, keys, family);
      if (keys.filter((key) => key !== "negated").length === 0) throw new TypeError("attack-filter needs at least one filter field.");
      const result: Record<string, unknown> = {};
      if (input.attack_type !== undefined) result.attack_type = enumValue(input.attack_type, ATTACK_TYPES, "attack-filter.attack_type");
      if (input.shooting_type !== undefined) result.shooting_type = enumValue(input.shooting_type, SHOOTING_TYPES, "attack-filter.shooting_type");
      if (input.fight_type !== undefined) result.fight_type = enumValue(input.fight_type, FIGHT_TYPES, "attack-filter.fight_type");
      if (input.weapon_keyword !== undefined) result.weapon_keyword = nonEmptyString(input.weapon_keyword, "attack-filter.weapon_keyword");
      if (input.weapon_name !== undefined) result.weapon_name = nonEmptyString(input.weapon_name, "attack-filter.weapon_name");
      if (input.all_target_same_unit !== undefined) result.all_target_same_unit = trueFlag(input.all_target_same_unit, "attack-filter.all_target_same_unit");
      return { ...result, ...negated };
    }
    case "attack-compare": {
      const rightKind = enumValue(input.right_kind, ["stat", "value"], "attack-compare.right_kind");
      const keys = ["left_of", "left_stat", ...(input.left_reduce !== undefined ? ["left_reduce"] : []), "comparison", "right_kind",
        ...(rightKind === "stat" ? ["right_of", "right_stat", ...(input.right_reduce !== undefined ? ["right_reduce"] : [])] : ["right_value"]),
        ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = {
        left_of: enumValue(input.left_of, STAT_SIDES, "attack-compare.left_of"),
        left_stat: nonEmptyString(input.left_stat, "attack-compare.left_stat"),
        comparison: enumValue(input.comparison, COMPARISONS, "attack-compare.comparison"),
        right_kind: rightKind,
      };
      if (input.left_reduce !== undefined) result.left_reduce = enumValue(input.left_reduce, ["max", "min"], "attack-compare.left_reduce");
      if (rightKind === "stat") {
        result.right_of = enumValue(input.right_of, STAT_SIDES, "attack-compare.right_of");
        result.right_stat = nonEmptyString(input.right_stat, "attack-compare.right_stat");
        if (input.right_reduce !== undefined) result.right_reduce = enumValue(input.right_reduce, ["max", "min"], "attack-compare.right_reduce");
      } else if (typeof input.right_value !== "number") throw new TypeError("attack-compare.right_value must be a number.");
      else result.right_value = input.right_value;
      return { ...result, ...negated };
    }
    case "visible": {
      const keys = [...(subject === undefined ? [] : ["subject"]), ...(input.to !== undefined ? ["to"] : []), ...(input.fully !== undefined ? ["fully"] : []),
        ...(input.blocked_by !== undefined ? ["blocked_by"] : []), ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { ...withSubject };
      if (input.to !== undefined) result.to = enumValue(input.to, SUBJECT_REF, "visible.to");
      if (input.fully !== undefined) result.fully = trueFlag(input.fully, "visible.fully");
      if (input.blocked_by !== undefined) result.blocked_by = enumValue(input.blocked_by, SUBJECT_REF, "visible.blocked_by");
      return { ...result, ...negated };
    }
    case "designated-filter": {
      const keys = [...(subject === undefined ? [] : ["subject"]), "tag", ...(input.by !== undefined ? ["by"] : []),
        ...(input.count_min !== undefined ? ["count_min"] : []), ...(input.count_max !== undefined ? ["count_max"] : []), ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      const tag = nonEmptyString(input.tag, "designated-filter.tag");
      if (!DESIGNATION_IDS.has(tag) && !/^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u.test(tag)) throw new TypeError("designated-filter.tag must be a registered designation id.");
      const result: Record<string, unknown> = { ...withSubject, tag };
      if (input.by !== undefined) result.by = enumValue(input.by, SUBJECT_REF, "designated-filter.by");
      if (input.count_min !== undefined) result.count_min = boundedInteger(input.count_min, 0, 20, "designated-filter.count_min");
      if (input.count_max !== undefined) result.count_max = boundedInteger(input.count_max, 0, 20, "designated-filter.count_max");
      return { ...result, ...negated };
    }
    case "battle-round": {
      const keys = [...(input.min !== undefined ? ["min"] : []), ...(input.max !== undefined ? ["max"] : [])];
      exactKeys(input, keys, family);
      if (keys.length === 0) throw new TypeError("battle-round needs min, max, or both.");
      const result: Record<string, unknown> = {};
      if (input.min !== undefined) result.min = boundedInteger(input.min, 1, 5, "battle-round.min");
      if (input.max !== undefined) result.max = boundedInteger(input.max, 1, 5, "battle-round.max");
      return result;
    }
    case "battle-size":
      exactKeys(input, "negated" in input ? ["size", "negated"] : ["size"], family);
      return { size: enumValue(input.size, BATTLE_SIZES, "battle-size.size"), ...negated };
    case "guided":
      exactKeys(input, [...(subject === undefined ? [] : ["subject"]), ...(("negated" in input) ? ["negated"] : [])], family);
      return { ...withSubject, ...negated };
    case "moved-over": {
      const keys = [...(subject === undefined ? [] : ["subject"]), "by", ...(input.window !== undefined ? ["window"] : []), ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { ...withSubject, by: enumValue(input.by, SUBJECT_REF, "moved-over.by") };
      if (input.window !== undefined) result.window = enumValue(input.window, HISTORY_WINDOWS, "moved-over.window");
      return { ...result, ...negated };
    }
    case "roll-outcome": {
      const keys = ["roll", "result", ...(input.source !== undefined ? ["source"] : []), ...(("negated" in input) ? ["negated"] : [])];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = {
        roll: enumValue(input.roll, ROLL_KINDS, "roll-outcome.roll"),
        result: enumValue(input.result, ROLL_OUTCOMES, "roll-outcome.result"),
      };
      if (input.source !== undefined) result.source = nonEmptyString(input.source, "roll-outcome.source");
      return { ...result, ...negated };
    }
    case "phase-window": {
      const keys = [...(input.phase !== undefined ? ["phase"] : []), ...(input.turn !== undefined ? ["turn"] : [])];
      exactKeys(input, keys, family);
      if (keys.length === 0) throw new TypeError("phase-window needs a phase, a turn, or both.");
      const result: Record<string, unknown> = {};
      if (input.phase !== undefined) result.phase = enumValue(input.phase, PHASES.filter((phase) => phase !== "any"), "phase-window.phase");
      if (input.turn !== undefined) result.turn = enumValue(input.turn, TURNS, "phase-window.turn");
      return result;
    }
    default:
      return null;
  }
}

/** A presence flag whose only legal value is true (the DSL field is absent, never false). */
function trueFlag(value: unknown, label: string): true {
  if (value === true) return true;
  throw new TypeError(`${label} must be true.`);
}
