import { DESIGNATION_IDS } from "../../translate/designations.js";
import { ANTECEDENT } from "../antecedent-families.js";
import { boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Params, SUBJECT_REF, SUBJECTS_OR_ANTECEDENT, FOLLOWING_FILTER, WINDOW_PHASES, BATTLE_SIZES, UNIT_KEYWORD,
  trueFlag, nonEmptyString, negation, subjectOf, present,
} from "./restrictions-and-predicates-shared.js";

/** Attack, board, round and phase predicates. */

/** The rolls a roll-outcome can name. */
const ROLL_KINDS = ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage", "attacks", "psychic", "surge", "hazard", "any", "resource-die", "blessings-of-khorne", "desperate-escape", "deadly-demise", "all"] as const;

const ATTACK_TYPES = ["ranged", "melee", "psychic"] as const;
const STAT_SIDES = ["attacker", "defender"] as const;
const REDUCERS = ["max", "min"] as const;
const COMPARISONS = ["greater-than", "less-than", "equal-to", "greater-or-equal", "less-or-equal"] as const;
const ATTACK_FILTER_FIELDS = ["attack_type", "shooting_type", "fight_type", "weapon_keyword", "weapon_name", "all_target_same_unit"] as const;
/** Core abilities that select weapons another rule can name (Firing Deck: one ranged weapon of each embarked model). */
const WEAPON_SELECTING_ABILITIES = ["firing-deck"];

/** The attack-filter fields that describe the attack itself. */
function attackFields(input: Params): Params {
  const family = "attack-filter";
  const negated = negation(input, family);
  const keys = present(input, [...ATTACK_FILTER_FIELDS, "negated"]);
  exactKeys(input, keys, family);
  if (keys.filter((key) => key !== "negated").length === 0) throw new TypeError("attack-filter needs at least one filter field.");
  const result: Params = {};
  if (input.attack_type !== undefined) result.attack_type = enumValue(input.attack_type, ATTACK_TYPES, "attack-filter.attack_type");
  if (input.shooting_type !== undefined) result.shooting_type = enumValue(input.shooting_type, ["normal", "assault", "close-quarters", "indirect", "snap"], "attack-filter.shooting_type");
  if (input.fight_type !== undefined) result.fight_type = enumValue(input.fight_type, ["normal", "overrun"], "attack-filter.fight_type");
  if (input.weapon_keyword !== undefined) result.weapon_keyword = nonEmptyString(input.weapon_keyword, "attack-filter.weapon_keyword");
  if (input.weapon_name !== undefined) result.weapon_name = nonEmptyString(input.weapon_name, "attack-filter.weapon_name");
  if (input.all_target_same_unit !== undefined) result.all_target_same_unit = trueFlag(input.all_target_same_unit, "attack-filter.all_target_same_unit");
  return { ...result, ...negated };
}

/** Bound attacks (weapon, target, weapon_selected_for) take attack_type and negated beside them, and nothing else. */
function onlyTypeAndNegation(rest: Params, what: string): Params {
  const extra = Object.keys(rest).filter((key) => key !== "attack_type" && key !== "negated");
  if (extra.length) throw new TypeError(`attack-filter ${what} takes attack_type and negated only, not ${extra.join(", ")}.`);
  // negated alone negates the bound attacks themselves (compile-conditions.ts polarity).
  if (!("attack_type" in rest)) return negation(rest, "attack-filter");
  return attackFields(rest);
}

function normalizeAttackFilter(input: Params): Params {
  if ("weapon_selected_for" in input) {
    const { weapon_selected_for: selectedFor, ...others } = input;
    enumValue(selectedFor, WEAPON_SELECTING_ABILITIES, "attack-filter.weapon_selected_for");
    return { ...onlyTypeAndNegation(others, "weapon_selected_for"), weapon_selected_for: selectedFor };
  }
  if ("target" in input) {
    // The attacks target the unit the Stratagem's WHEN moment named.
    const { target, ...others } = input;
    enumValue(target, ["that-unit"], "attack-filter.target");
    return { ...onlyTypeAndNegation(others, "target that-unit"), target: "that-unit" };
  }
  const { weapon, of, ...rest } = input;
  if ("weapon" in input) {
    // The weapons an earlier keyword grant gave a keyword; the keyword comes from the grant at compile time.
    if (weapon !== ANTECEDENT) throw new TypeError(`attack-filter.weapon is ${ANTECEDENT} or absent.`);
    const extra = Object.keys(input).filter((key) => key !== "weapon" && key !== "attack_type" && key !== "negated");
    if (extra.length) throw new TypeError(`attack-filter weapon antecedent names the weapons an earlier grant gave a keyword; ${extra.join(", ")} cannot narrow them.`);
    const { weapon_keyword: _keyword, ...checked } = attackFields({ ...rest, weapon_keyword: "Antecedent" });
    return { ...checked, weapon: ANTECEDENT };
  }
  if ("of" in input) {
    // The attacks of an earlier shooting moment, which are ranged.
    if (of !== ANTECEDENT) throw new TypeError(`attack-filter.of is ${ANTECEDENT} or absent.`);
    const extra = Object.keys(rest).filter((key) => key !== "attack_type");
    if (extra.length) throw new TypeError(`attack-filter of antecedent names the attacks of an earlier shooting moment; ${extra.join(", ")} cannot narrow them.`);
    if (rest.attack_type !== undefined && rest.attack_type !== "ranged") {
      throw new TypeError(`attack-filter of antecedent names the attacks of an earlier shooting moment, which are ranged, not ${String(rest.attack_type)}.`);
    }
    return { ...(Object.keys(rest).length ? attackFields(rest) : {}), of: ANTECEDENT };
  }
  return attackFields(input);
}

function normalizeAttackCompare(input: Params): Params {
  const family = "attack-compare";
  const negated = negation(input, family);
  const rightKind = enumValue(input.right_kind, ["stat", "value"], "attack-compare.right_kind");
  const right = rightKind === "stat" ? ["right_of", "right_stat", ...present(input, ["right_reduce"])] : ["right_value"];
  exactKeys(input, ["left_of", "left_stat", ...present(input, ["left_reduce"]), "comparison", "right_kind", ...right, ...present(input, ["negated"])], family);
  const result: Params = {
    left_of: enumValue(input.left_of, STAT_SIDES, "attack-compare.left_of"),
    left_stat: nonEmptyString(input.left_stat, "attack-compare.left_stat"),
    comparison: enumValue(input.comparison, COMPARISONS, "attack-compare.comparison"),
    right_kind: rightKind,
  };
  if (input.left_reduce !== undefined) result.left_reduce = enumValue(input.left_reduce, REDUCERS, "attack-compare.left_reduce");
  if (rightKind === "stat") {
    result.right_of = enumValue(input.right_of, STAT_SIDES, "attack-compare.right_of");
    result.right_stat = nonEmptyString(input.right_stat, "attack-compare.right_stat");
    if (input.right_reduce !== undefined) result.right_reduce = enumValue(input.right_reduce, REDUCERS, "attack-compare.right_reduce");
  } else if (typeof input.right_value !== "number") {
    throw new TypeError("attack-compare.right_value must be a number.");
  } else {
    result.right_value = input.right_value;
  }
  return { ...result, ...negated };
}

function normalizeVisible(input: Params): Params {
  const negated = negation(input, "visible");
  const subject = subjectOf(input, SUBJECTS_OR_ANTECEDENT);
  exactKeys(input, present(input, ["subject", "to", "fully", "blocked_by", "negated"]), "visible");
  const result: Params = { ...subject };
  if (input.to !== undefined) result.to = enumValue(input.to, [...SUBJECTS_OR_ANTECEDENT, FOLLOWING_FILTER], "visible.to");
  if (input.fully !== undefined) result.fully = trueFlag(input.fully, "visible.fully");
  if (input.blocked_by !== undefined) result.blocked_by = enumValue(input.blocked_by, SUBJECT_REF, "visible.blocked_by");
  return { ...result, ...negated };
}

function normalizeDesignatedFilter(input: Params): Params {
  const family = "designated-filter";
  const negated = negation(input, family);
  const subject = subjectOf(input, SUBJECTS_OR_ANTECEDENT);
  exactKeys(input, [...present(input, ["subject"]), "tag", ...present(input, ["by", "count_min", "count_max", "negated"])], family);
  const tag = nonEmptyString(input.tag, "designated-filter.tag");
  if (!DESIGNATION_IDS.has(tag) && !UNIT_KEYWORD.test(tag)) throw new TypeError("designated-filter.tag must be a registered designation id.");
  const result: Params = { ...subject, tag };
  if (input.by !== undefined) result.by = enumValue(input.by, [...SUBJECT_REF, FOLLOWING_FILTER], "designated-filter.by");
  if (input.count_min !== undefined) result.count_min = boundedInteger(input.count_min, 0, 20, "designated-filter.count_min");
  if (input.count_max !== undefined) result.count_max = boundedInteger(input.count_max, 0, 20, "designated-filter.count_max");
  return { ...result, ...negated };
}

function normalizeBattleRound(input: Params): Params {
  if ("rounds" in input) {
    // Any one of two or more listed rounds, in place of min and max.
    const { rounds, ...rest } = input;
    if (Object.keys(rest).length) throw new TypeError("battle-round lists rounds or gives min and max, not both.");
    if (!Array.isArray(rounds) || rounds.length < 2) throw new TypeError("battle-round.rounds lists at least two rounds.");
    for (const round of rounds) boundedInteger(round, 1, 5, "battle-round.rounds");
    if (new Set(rounds).size !== rounds.length) throw new TypeError("battle-round.rounds lists a round twice.");
    return { rounds: [...rounds as number[]].sort((left, right) => left - right) };
  }
  const keys = present(input, ["min", "max"]);
  exactKeys(input, keys, "battle-round");
  if (keys.length === 0) throw new TypeError("battle-round needs min, max, or both.");
  const result: Params = {};
  if (input.min !== undefined) result.min = boundedInteger(input.min, 1, 5, "battle-round.min");
  if (input.max !== undefined) result.max = boundedInteger(input.max, 1, 5, "battle-round.max");
  return result;
}

function normalizeBattleSize(input: Params): Params {
  const negated = negation(input, "battle-size");
  exactKeys(input, ["size", ...present(input, ["negated"])], "battle-size");
  return { size: enumValue(input.size, BATTLE_SIZES, "battle-size.size"), ...negated };
}

function normalizeGuided(input: Params): Params {
  const negated = negation(input, "guided");
  const subject = subjectOf(input, SUBJECTS_OR_ANTECEDENT);
  exactKeys(input, present(input, ["subject", "negated"]), "guided");
  return { ...subject, ...negated };
}

function normalizeMovedOver(input: Params): Params {
  const negated = negation(input, "moved-over");
  const subject = subjectOf(input);
  exactKeys(input, [...present(input, ["subject"]), "by", ...present(input, ["window", "negated"])], "moved-over");
  const result: Params = { ...subject, by: enumValue(input.by, SUBJECT_REF, "moved-over.by") };
  if (input.window !== undefined) result.window = enumValue(input.window, ["phase", "turn", "round", "battle", "previous-turn"], "moved-over.window");
  return { ...result, ...negated };
}

function normalizeRollOutcome(input: Params): Params {
  const negated = negation(input, "roll-outcome");
  exactKeys(input, ["roll", "result", ...present(input, ["source", "negated"])], "roll-outcome");
  const result: Params = {
    roll: enumValue(input.roll, ROLL_KINDS, "roll-outcome.roll"),
    result: enumValue(input.result, ["success", "failure", "critical"], "roll-outcome.result"),
  };
  if (input.source !== undefined) result.source = nonEmptyString(input.source, "roll-outcome.source");
  return { ...result, ...negated };
}

function normalizePhaseWindow(input: Params): Params {
  const keys = present(input, ["phase", "turn"]);
  exactKeys(input, keys, "phase-window");
  if (keys.length === 0) throw new TypeError("phase-window needs a phase, a turn, or both.");
  const result: Params = {};
  if (input.phase !== undefined) result.phase = enumValue(input.phase, [...WINDOW_PHASES, "any"], "phase-window.phase");
  if (input.turn !== undefined) result.turn = enumValue(input.turn, ["your", "opponent", "either"], "phase-window.turn");
  return result;
}


export const ATTACK_AND_ROUND_PREDICATES_FAMILIES: readonly FlatFamily[] = [
  {
    id: "attack-compare",
    version: 1,
    role: "CONDITION",
    label: "Compare an attack's stats",
    description: "Compares the attacker's or the target's named characteristic (optionally the highest or lowest of several) against the other side's, or against a fixed value.",
    starter: { left_of: "attacker", left_stat: "S", comparison: "greater-than", right_kind: "stat", right_of: "defender", right_stat: "T" },
    parameterSchema: {
      type: "object", required: ["left_of", "left_stat", "comparison", "right_kind"], additionalProperties: false,
      properties: {
        left_of: { enum: ["attacker", "defender"] },
        left_stat: { type: "string", minLength: 1 },
        left_reduce: { enum: ["max", "min"] },
        comparison: { enum: ["greater-than", "less-than", "equal-to", "greater-or-equal", "less-or-equal"] },
        right_kind: { enum: ["stat", "value"] },
        right_of: { enum: ["attacker", "defender"], "x-only-when": { right_kind: ["stat"] } },
        right_stat: { type: "string", minLength: 1, "x-only-when": { right_kind: ["stat"] } },
        right_reduce: { enum: ["max", "min"], "x-only-when": { right_kind: ["stat"] } },
        right_value: { type: "number", "x-only-when": { right_kind: ["value"] } },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeAttackCompare,
  },
  {
    id: "battle-size",
    version: 1,
    role: "CONDITION",
    label: "Battle size is",
    description: "Requires the battle to be played at a named battle size (Incursion, Strike Force, or Onslaught).",
    starter: { size: "strike-force" },
    parameterSchema: {
      type: "object", required: ["size"], additionalProperties: false,
      properties: {
        size: { enum: ["incursion", "strike-force", "onslaught"] },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeBattleSize,
  },
  {
    id: "moved-over",
    version: 1,
    role: "CONDITION",
    label: "Unit was moved over",
    description: "\"That unit it moved over during that move\", \"a unit this model moved across this phase\": the subject unit's models were moved across by `by` during the move just made (omit `window`), or within a wider window (phase, turn, round, battle, or the previous turn) when the wording says so explicitly. This is the condition on a unit selected by proximity to a move, not the move itself.",
    starter: { by: "this-model" },
    parameterSchema: {
      type: "object", required: ["by"], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF] },
        negated: { type: "boolean" },
        by: { enum: [...SUBJECT_REF] },
        window: { enum: ["phase", "turn", "round", "battle", "previous-turn"] },
      },
    },
    normalize: normalizeMovedOver,
  },
  {
    id: "roll-outcome",
    version: 1,
    role: "CONDITION",
    label: "A roll came out this way",
    description: "Requires a named roll (the Wound roll, a Hit roll, a Leadership test, ...) to have come out a given way — success, failure or a critical result. `source` binds the roll to an earlier EVENT leaf's binds_event_variable, when the ability needs a specific roll rather than the most recent one of that kind.",
    starter: { roll: "hit", result: "success" },
    parameterSchema: {
      type: "object", required: ["roll", "result"], additionalProperties: false,
      properties: {
        roll: { enum: [...ROLL_KINDS] },
        result: { enum: ["success", "failure", "critical"] },
        source: { type: "string", minLength: 1 },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeRollOutcome,
  },
  {
    id: "guided",
    version: 2,
    role: "CONDITION",
    label: "Unit is Guided",
    description: "Requires a unit to be Guided (has For the Greater Good, is not an Observer, and is targeting one or more Spotted units). subject can be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles.",
    starter: {},
    parameterSchema: {
      type: "object", required: [], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF, ANTECEDENT] },
        negated: { type: "boolean" },
      },
    },
    normalize: normalizeGuided,
  },
  {
    id: "battle-round",
    version: 2,
    role: "CONDITION",
    label: "Battle round is within a range",
    description: "Requires the current battle round to be a fixed round, within a range (\"from the third battle round onward\"), or, with rounds in place of min and max, any one of two or more listed battle rounds (\"in the first, third and fifth battle rounds\").",
    starter: { min: 1 },
    parameterSchema: {
      type: "object", required: [], additionalProperties: false, minProperties: 1,
      properties: {
        min: { type: "integer", minimum: 1, maximum: 5 },
        max: { type: "integer", minimum: 1, maximum: 5 },
        rounds: { type: "array", items: { type: "integer", minimum: 1, maximum: 5 }, minItems: 2, uniqueItems: true, "x-optional": true },
      },
    },
    normalize: normalizeBattleRound,
  },
  {
    id: "phase-window",
    version: 2,
    role: "CONDITION",
    label: "During a phase or turn",
    description: "Gates an effect by phase and/or whose turn it is, outside of a trigger's own moment (\"during the Fight phase\", \"in your opponent's turn\"). phase any is \"in any phase\": with turn either it gates nothing; with your or opponent it is that player's turn.",
    starter: { phase: "shooting" },
    parameterSchema: {
      type: "object", required: [], minProperties: 1, additionalProperties: false,
      properties: {
        phase: { enum: ["command", "movement", "shooting", "charge", "fight", "any"] },
        turn: { enum: ["your", "opponent", "either"] },
      },
    },
    normalize: normalizePhaseWindow,
  },
  {
    id: "visible",
    version: 3,
    role: "CONDITION",
    label: "Unit's visibility",
    description: "Requires a unit to be (fully, if set) visible to another, or names the unit whose model blocks the view instead. subject and to can be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles. to can be following-filter: visible to any unit or model the unit-filter right after this leaf, in the same clause, matches (\"visible to\" + \"your **PSYKER** model\").",
    starter: {},
    parameterSchema: {
      type: "object", required: [], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF, ANTECEDENT] },
        negated: { type: "boolean" },
        to: { enum: ["this-unit", "this-model", "model-in-this-unit", "attacker", "defender", "event-subject", "event-object", "selected-unit", "recipient", "antecedent", "following-filter"] },
        fully: { const: true },
        blocked_by: { enum: [...SUBJECT_REF] },
      },
    },
    normalize: normalizeVisible,
  },
  {
    id: "attack-filter",
    version: 5,
    role: "CONDITION",
    label: "The attack being resolved matches",
    description: "Requires the attack being resolved to be of a type, shooting or fight kind, a named or keyword weapon, or that every attack this phase targets the same unit. It can instead name bound attacks: of antecedent, the attacks an earlier moment of the record introduced (\"those attacks\", \"those ranged attacks\": the attacks a shooting selection goes on to make, or the attacks of a shooting that has just resolved), with at most attack_type ranged beside it; weapon antecedent, the attacks made with the weapons an earlier keyword grant gave that keyword (\"each time an attack is made with such a weapon\"; the grant's weapon type sets attack_type); target that-unit, the attacks target the unit the Stratagem's WHEN moment named as the target of the enemy unit's attacks (\"ranged attacks that target that X unit\" under \"just after an enemy unit has selected its targets\"); weapon_selected_for, the attacks are made with the weapons that core ability selected (firing-deck: \"weapons selected for the Firing Deck ability\"). weapon, target and weapon_selected_for take attack_type and negated beside them, and nothing else.",
    starter: { attack_type: "ranged" },
    parameterSchema: {
      type: "object", required: [], additionalProperties: false,
      properties: {
        attack_type: { enum: ["ranged", "melee", "psychic"] },
        shooting_type: { enum: ["normal", "assault", "close-quarters", "indirect", "snap"] },
        fight_type: { enum: ["normal", "overrun"] },
        weapon_keyword: { type: "string", minLength: 1 },
        weapon_name: { type: "string", minLength: 1 },
        all_target_same_unit: { const: true },
        negated: { type: "boolean" },
        of: { enum: ["antecedent"], "x-optional": true },
        weapon: { enum: ["antecedent"], "x-optional": true },
        target: { enum: ["that-unit"], "x-optional": true },
        weapon_selected_for: { enum: ["firing-deck"], "x-optional": true },
      },
    },
    normalize: normalizeAttackFilter,
  },
  {
    id: "designated-filter",
    version: 3,
    role: "CONDITION",
    label: "Unit carries a designation",
    description: "Requires a unit to carry a named designation (any registered tag, not only the five original marks), optionally applied by a named unit, or counts how many carry it. by following-filter: the designation was applied by a unit the unit-filter right after the leaf names (\"was marked by an Observer unit that has the Markerlight keyword\"). subject can be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles.",
    starter: { tag: "" },
    parameterSchema: {
      type: "object", required: ["tag"], additionalProperties: false,
      properties: {
        subject: { enum: [...SUBJECT_REF, ANTECEDENT] },
        negated: { type: "boolean" },
        tag: { type: "string", minLength: 1 },
        by: { enum: ["this-unit", "this-model", "model-in-this-unit", "attacker", "defender", "event-subject", "event-object", "selected-unit", "recipient", "following-filter"] },
        count_min: { type: "integer", minimum: 0, maximum: 20 },
        count_max: { type: "integer", minimum: 0, maximum: 20 },
      },
    },
    normalize: normalizeDesignatedFilter,
  },
];
