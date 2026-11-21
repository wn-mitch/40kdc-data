import { ANTECEDENT } from "../antecedent-families.js";
import { boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import { type Input, FIXED_SUBJECTS } from "./dice-and-core-shared.js";

/** Dice rolls, dice counts and mortal wounds, the end of an attack sequence, fighting on death and destruction rules. */

// ---------------------------------------------------------------------------------------------
// dice-roll

const DICE = ["D3", "D6", "2D6"] as const;
const DICE_ROLL_KINDS = ["psychic", "hazard", "leadership", "battle-shock", "desperate-escape", "channelling"] as const;
const PER_MODEL = ["this-unit", "target", "selected", "allocated-attack"] as const;
const COUNT_STATS = ["M", "T", "W", "OC", "A"] as const;
const COUNT_STAT_OF = ["selected", "this-model"] as const;

function normalizeDiceRoll(input: Input): Input {
  if (input.count_stat !== undefined) {
    for (const key of ["count", "per_model", "alternative", "plus", "kind"]) {
      if (input[key] !== undefined) throw new TypeError(`dice-roll.count_stat sets how many dice; it takes no ${key}.`);
    }
    const countStat = input.count_stat;
    if (countStat === null || typeof countStat !== "object" || Array.isArray(countStat) || Object.keys(countStat).some((key) => key !== "stat" && key !== "of")) throw new TypeError("dice-roll.count_stat is {stat, of}.");
  }
  if (input.plus !== undefined) {
    for (const key of ["count", "per_model", "alternative", "kind"]) {
      if (input[key] !== undefined) throw new TypeError(`dice-roll.plus is printed on one die; it takes no ${key}.`);
    }
  }
  // "rolling two additional D6 if X": extra dice of the roll before, under the condition leaf after.
  if (input.plus_if !== undefined) {
    if (input.plus_if !== true) throw new TypeError("dice-roll.plus_if must be true.");
    for (const key of ["per_model", "roll_var", "kind", "alternative", "max_dice", "plus", "count_stat"]) {
      if (input[key] !== undefined) throw new TypeError(`dice-roll.plus_if adds dice to the roll before it; it takes no ${key}.`);
    }
  }
  const perModel = input.per_model;
  if (input.max_dice !== undefined && perModel !== "allocated-attack") throw new TypeError("dice-roll.max_dice caps the dice of per_model allocated-attack only.");
  if (perModel === "allocated-attack" && input.count !== undefined) throw new TypeError("dice-roll.per_model allocated-attack rolls one die per allocated attack; it takes no count.");
  if (perModel === "selected" && input.count !== undefined) throw new TypeError("dice-roll.per_model selected rolls one die per selected model; it takes no count.");
  if (input.alternative !== undefined) {
    if (input.alternative !== true) throw new TypeError("dice-roll.alternative must be true.");
    if (input.roll_var !== undefined) throw new TypeError("dice-roll: an alternative pool cannot also bind a roll_var.");
  }
  const optionalKeys = ["roll_var", "count", "per_model", "kind", "alternative", "max_dice", "plus", "count_stat", "plus_if"].filter((key) => key in input);
  exactKeys(input, ["dice", ...optionalKeys], "dice-roll");
  const result: Input = { dice: enumValue(input.dice, DICE, "dice-roll.dice") };
  if ("count" in input) {
    if (!Number.isSafeInteger(input.count) || (input.count as number) < 2 || (input.count as number) > 30) throw new TypeError("dice-roll.count must be a whole number of dice from 2 to 30; leave it out for one die.");
    result.count = input.count;
  }
  if ("per_model" in input) {
    if ("count" in input) throw new TypeError("dice-roll rolls a count of dice or one die per model, not both.");
    result.per_model = enumValue(perModel, PER_MODEL, "dice-roll.per_model");
  }
  if ("roll_var" in input) {
    if (typeof input.roll_var !== "string" || !input.roll_var) throw new TypeError("dice-roll.roll_var must be a nonblank string.");
    result.roll_var = input.roll_var;
  }
  if ("kind" in input) result.kind = enumValue(input.kind, DICE_ROLL_KINDS, "dice-roll.kind");
  if (input.alternative !== undefined) result.alternative = true;
  if (input.plus_if !== undefined) result.plus_if = true;
  if (input.max_dice !== undefined) result.max_dice = boundedInteger(input.max_dice, 1, 30, "dice-roll.max_dice");
  if (input.plus !== undefined) result.plus = boundedInteger(input.plus, 1, 12, "dice-roll.plus");
  if (input.count_stat !== undefined) {
    const stat = input.count_stat as Input;
    result.count_stat = { stat: enumValue(stat.stat, COUNT_STATS, "dice-roll.count_stat.stat"), of: enumValue(stat.of, COUNT_STAT_OF, "dice-roll.count_stat.of") };
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// mortal-wounds

const WOUND_COUNTS = ["1", "2", "3", "D3", "D6", "D3+3", "2D6"] as const;
const MORTAL_RECIPIENTS = ["target", "that-unit", "this-unit", "this-model", ANTECEDENT, "event-subject"] as const;
/** Any dice amount plus a number: 2D3, D3+1. */
const DICE_AMOUNT = "^\\d*D(3|6)(\\+\\d+)?$";
const SELECTION_NAME = /^[a-z][a-z0-9_-]*$/;

function normalizeMortalWounds(input: Input): Input {
  const { max, selection, ...rest } = input;
  if (selection !== undefined && !["that-unit", ANTECEDENT].includes(String(rest.recipient))) {
    throw new TypeError("mortal-wounds.selection names which selected unit recipient that-unit or antecedent is; it takes no other recipient.");
  }
  if (max !== undefined && (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 20)) throw new TypeError("mortal-wounds max is a whole number from 1 to 20.");
  exactKeys(rest, ["recipient", "count"], "mortal-wounds");
  const recipient = enumValue(rest.recipient, MORTAL_RECIPIENTS, "mortal-wounds.recipient");
  const count = rest.count;
  let canonical: string;
  if (count === "rating" || (WOUND_COUNTS as readonly unknown[]).includes(count)) canonical = count as string;
  else if (typeof count === "string" && new RegExp(DICE_AMOUNT, "u").test(count.trim().toUpperCase())) canonical = count.trim().toUpperCase();
  else canonical = enumValue(count, WOUND_COUNTS, "mortal-wounds.count");
  const result: Input = { recipient, count: canonical };
  if (max !== undefined) result.max = max;
  if (selection !== undefined) {
    if (typeof selection !== "string" || !SELECTION_NAME.test(selection) || selection.length > 40) throw new TypeError("mortal-wounds.selection is a lowercase selection name.");
    result.selection = selection;
  }
  return result;
}

const FIGHT_ON_DEATH_TIMING = ["when-its-unit-fights", "after-the-attacking-unit-finishes"] as const;
const FIGHT_ON_DEATH_ACTS = ["fight", "shoot"] as const;
export const DICE_AND_DAMAGE_FAMILIES: readonly FlatFamily[] = [
  {
    id: "mortal-wound-source",
    version: 1,
    role: "CONDITION",
    label: "Mortal wounds from a psychic attack",
    description: "The mortal wounds this record's earlier mortal-wounds leaves inflict are inflicted by a psychic attack. It qualifies every mortal-wounds leaf before it in the record and needs at least one.",
    starter: { psychic: true },
    parameterSchema: { type: "object", required: ["psychic"], properties: { psychic: { const: true } }, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, ["psychic"], "mortal-wound-source");
      if (input.psychic !== true) throw new TypeError("mortal-wound-source.psychic is true: the mortal wounds are inflicted by a psychic attack.");
      return { psychic: true };
    },
  },
  {
    id: "fight-on-death",
    version: 2,
    role: "EFFECT",
    label: "Fights or shoots after being destroyed",
    description: "\"Do not remove it from play; that destroyed model can fight or shoot …\": fighting names its timing (when its unit fights, or after the attacking unit finishes); shooting is a plain grant to a named subject, with no timing of its own. A roll and a \"has not fought\" condition before it limit which destroyed models fight.",
    starter: { act: "fight", timing: "" },
    parameterSchema: {
      type: "object",
      required: ["act"],
      properties: {
        act: { enum: FIGHT_ON_DEATH_ACTS },
        timing: { enum: FIGHT_ON_DEATH_TIMING, "x-only-when": { act: ["fight"] } },
        subject: { enum: FIXED_SUBJECTS, "x-only-when": { act: ["shoot"] } },
      },
      additionalProperties: false,
    },
    normalize: (input) => {
      const act = enumValue(input.act, FIGHT_ON_DEATH_ACTS, "fight-on-death.act");
      if (act === "fight") {
        exactKeys(input, ["act", "timing"], "fight-on-death");
        return { act, timing: enumValue(input.timing, FIGHT_ON_DEATH_TIMING, "fight-on-death.timing") };
      }
      exactKeys(input, ["act", "subject"], "fight-on-death");
      return { act, subject: enumValue(input.subject, FIXED_SUBJECTS, "fight-on-death.subject") };
    },
  },
  {
    id: "dice-count-option",
    version: 1,
    role: "EFFECT",
    label: "Or roll more dice",
    description: "The player can roll count dice instead of the one D6 the dice-roll right before it rolls, each result applying on the roll's table; distinct: a repeated result is re-rolled (\"keep re-rolling duplicate results\"). A dice-count-rolled condition gates what applies only when the player rolled count dice.",
    starter: { count: 2 },
    parameterSchema: {
      type: "object",
      required: ["count"],
      properties: { count: { type: "integer", minimum: 2, maximum: 6 }, distinct: { const: true } },
      additionalProperties: false,
    },
    normalize: (input) => {
      exactKeys(input, "distinct" in input ? ["count", "distinct"] : ["count"], "dice-count-option");
      if ("distinct" in input && input.distinct !== true) throw new TypeError("dice-count-option.distinct is true or absent.");
      return { count: boundedInteger(input.count, 2, 6, "dice-count-option.count"), ...(input.distinct === true ? { distinct: true } : {}) };
    },
  },
  {
    id: "dice-count-rolled",
    version: 1,
    role: "CONDITION",
    label: "If you rolled that many dice",
    description: "Holds when the player took the record's dice-count option and rolled count dice (\"if you rolled two D6\"); count is the option's.",
    starter: { count: 2 },
    parameterSchema: { type: "object", required: ["count"], properties: { count: { type: "integer", minimum: 2, maximum: 6 } }, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, ["count"], "dice-count-rolled");
      return { count: boundedInteger(input.count, 2, 6, "dice-count-rolled.count") };
    },
  },
  {
    id: "end-attack-sequence",
    version: 1,
    role: "EFFECT",
    label: "End the attack sequence",
    description: "The attack sequence ends for that attack; parameterless, and always the attacker's attack.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, [], "end-attack-sequence");
      return {};
    },
  },
  {
    id: "dice-roll",
    version: 11,
    role: "EVENT",
    label: "Roll dice",
    description: "\"Roll one D6\", \"roll six D6\", or \"roll one D6 for each model in this unit\": the result bands that follow (on a 4+, for each 5+) say what happens for each result. count is how many dice are rolled when it is more than one. per_model rolls one die for each model of this unit or the target, for each model the enclosing model selection selects (selected: \"for each X model you select, roll one D6\"; it needs a select-unit of models before it), or for each attack the attacking unit allocated to a model in this unit once it has finished making its attacks (allocated-attack; the attack moment before the roll says which attacks count, and max_dice caps the dice: \"to a maximum of six D6\"); it takes no count. count_stat rolls as many dice as a characteristic of a model (as many D6 as the selected model's Toughness): stat (M, T, W, OC or A) and of (selected: the model the enclosing selection selected; this-model: the model with the ability); it takes no count, per_model, alternative, plus or kind. plus is a number printed as part of the roll (\"roll D3+3\" is dice D3, plus 3): the result bands and any effect that reads the result read the roll with it added; it takes one die: no count, per_model, alternative or kind. kind names the test the roll is (\"take a Psychic test\" is dice 2D6, kind psychic; the result band that follows is its Warp Charge: \"on a 7+\"). alternative: this roll replaces the roll before it when the condition leaf right after it holds (\"or roll four D6 if X\"); it binds no roll_var. plus_if: these dice (count of them, or one) are added to the per-model or counted roll before it when the condition leaf right after it holds (\"rolling two additional D6 if you spent YP during this use\"); same die, and no per_model, roll_var, kind, alternative, max_dice, plus or count_stat. A named roll_var binds the roll (the DSL's phase-4 `roll` container) so a single result band compiles its dice-gated from that binding instead of rolling again.",
    starter: { dice: "" },
    parameterSchema: {
      type: "object",
      required: ["dice"],
      properties: {
        dice: { enum: DICE },
        count: { type: "integer", minimum: 2, maximum: 30 },
        per_model: { enum: PER_MODEL },
        roll_var: { type: "string", minLength: 1 },
        kind: { enum: DICE_ROLL_KINDS, "x-optional": true },
        alternative: { const: true, "x-optional": true },
        plus_if: { const: true, "x-optional": true },
        max_dice: { type: "integer", minimum: 1, maximum: 30, "x-optional": true },
        plus: { type: "integer", minimum: 1, maximum: 12, "x-optional": true },
        count_stat: {
          type: "object",
          additionalProperties: false,
          required: ["stat", "of"],
          properties: { stat: { enum: COUNT_STATS }, of: { enum: COUNT_STAT_OF } },
          "x-optional": true,
        },
      },
      additionalProperties: false,
    },
    normalize: normalizeDiceRoll,
  },
  {
    id: "mortal-wounds",
    version: 7,
    role: "EFFECT",
    label: "Mortal wounds",
    description: "A unit suffers mortal wounds: the attack's target, the unit selected earlier (\"that unit\"), this unit, this model, the unit whose action fired the trigger (event-subject: \"that unit suffers D3 mortal wounds\" after \"each time an enemy unit ends a Charge move\"), or antecedent: the unit an earlier leaf of the record introduced, bound when the record compiles. count is a number, a dice amount plus a number (2D3, D3+1), or rating: the value the unit's datasheet prints for this ability (the X of Deadly Demise X). max: no more than this many mortal wounds in total (\"to a maximum of 6 mortal wounds\"). selection: the bind_as of the select-unit a that-unit or antecedent recipient names when the record selects several units (\"that X unit suffers D3 mortal wounds\").",
    starter: { recipient: "", count: "" },
    parameterSchema: {
      type: "object",
      required: ["recipient", "count"],
      properties: {
        recipient: { enum: MORTAL_RECIPIENTS },
        count: { anyOf: [{ enum: WOUND_COUNTS }, { type: "string", pattern: DICE_AMOUNT }, { const: "rating" }] },
        max: { type: "integer", minimum: 1, maximum: 20, "x-optional": true },
        selection: {
          type: "string", pattern: "^[a-z][a-z0-9_-]*$", minLength: 1, maxLength: 40,
          "x-only-when": { recipient: ["that-unit", ANTECEDENT] }, "x-optional": true,
        },
      },
      additionalProperties: false,
    },
    normalize: normalizeMortalWounds,
  },
  {
    id: "destruction-rule",
    version: 1,
    role: "EFFECT",
    label: "Counts as destroyed only with another",
    description: "The target unit counts as destroyed only once another named unit is also destroyed.",
    starter: { target: "", also: "" },
    parameterSchema: { type: "object", required: ["target", "also"], properties: { target: { enum: FIXED_SUBJECTS }, also: { enum: FIXED_SUBJECTS } }, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, ["target", "also"], "destruction-rule");
      return { target: enumValue(input.target, FIXED_SUBJECTS, "destruction-rule.target"), also: enumValue(input.also, FIXED_SUBJECTS, "destruction-rule.also") };
    },
  },
];
