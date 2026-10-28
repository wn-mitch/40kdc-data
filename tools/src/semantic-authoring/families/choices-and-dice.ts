import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { boundedInteger, enumValue } from "../family-validation.js";
import { isObject, namedId } from "./shared.js";

/**
 * Versions of dice-roll, choice-open and named-option: dice a rule rolls and options a player
 * picks. Each version checks only its own additions and hands the rest of a leaf to the previous
 * version, so every earlier leaf still fits it unchanged.
 */

/** The DSL's dice-requirement types: a pair, triple, single die or run at or above min_value. */
export const DICE_REQUIREMENT_TYPES = ["pair", "triple", "single", "run"] as const;

const requirementSchema = {
  type: "object",
  required: ["type", "min_value"],
  properties: { type: { enum: DICE_REQUIREMENT_TYPES }, min_value: { type: "integer", minimum: 1, maximum: 6 } },
  additionalProperties: false,
};

function requirement(value: unknown, label: string): { type: string; min_value: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} is an object with type and min_value.`);
  const { type, min_value: minValue, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length) throw new TypeError(`${label} has only type and min_value.`);
  return { type: enumValue(type, DICE_REQUIREMENT_TYPES, `${label}.type`), min_value: boundedInteger(minValue, 1, 6, `${label}.min_value`) };
}

/** Roll kinds a dice-roll leaf may name, from the DSL's roll-kind: the tests a rule asks for by name. */
export const ROLL_KINDS = ["psychic", "hazard", "leadership", "battle-shock", "desperate-escape", "channelling"] as const;

const RANDOM_DICE = ["D3", "D6"] as const;

export const CHOICE_AND_DICE_EXTENSIONS: readonly FamilyExtension[] = [
  /**
   * A roll's kind: a Psychic test is 2D6 against its Warp Charge.
   */
  {
    // "take a Psychic test (roll 2D6 …)": the roll is a named test, which the DSL's roll carries as its kind.
    family: "dice-roll",
    version: 5,
    description: "As the previous version, and kind names the test the roll is (\"take a Psychic test\" is dice 2D6, kind psychic; the result band that follows is its Warp Charge: \"on a 7+\").",
    schema: (previous) => withProperties(previous, { kind: optional({ enum: ROLL_KINDS }) }),
    normalize: (input, previous) => {
      if (!("kind" in input)) return previous(input);
      const { kind, ...rest } = input;
      return { ...previous(rest), kind: enumValue(kind, ROLL_KINDS, "dice-roll.kind") };
    },
  },
  {
    family: "dice-roll",
    version: 6,
    description: "As the previous version, plus alternative: this roll replaces the roll before it when the condition leaf right after it holds (\"or roll four D6 if X\").",
    schema: (previous) => withProperties(previous, { alternative: optional({ const: true }) }),
    normalize: (input, previous) => {
      if (input.alternative === undefined) return previous(input);
      if (input.alternative !== true) throw new TypeError("dice-roll.alternative must be true.");
      if (input.roll_var !== undefined) throw new TypeError("dice-roll: an alternative pool cannot also bind a roll_var.");
      const { alternative, ...rest } = input;
      return { ...previous(rest), alternative };
    },
  },
  /**
   * A menu that may instead be rolled for.
   */
  {
    // "either select one from the list below, or randomly select two by rolling two D6".
    family: "choice-open",
    version: 2,
    description: "As the previous version, and or_random says the options may instead be picked at random: {dice, count} rolls count dice (D3 or D6) and applies the option numbered by each result, the options being numbered in order from 1 to the die's faces.",
    schema: (previous) => withProperties(previous, {
      or_random: optional({
        type: "object", required: ["dice", "count"],
        properties: { dice: { enum: RANDOM_DICE }, count: { type: "integer", minimum: 1, maximum: 3 } },
        additionalProperties: false,
      }),
    }),
    normalize: (input, previous) => {
      if (!("or_random" in input)) return previous(input);
      const { or_random: random, ...rest } = input;
      if (!isObject(random)) throw new TypeError("choice-open.or_random is an object with dice and count.");
      const { dice, count, ...extra } = random as Record<string, unknown>;
      if (Object.keys(extra).length) throw new TypeError("choice-open.or_random has only dice and count.");
      return { ...previous(rest), or_random: { dice: enumValue(dice, RANDOM_DICE, "choice-open.or_random.dice"), count: boundedInteger(count, 1, 3, "choice-open.or_random.count") } };
    },
  },
  {
    // "a double 4 or higher, or any triple": the option activates if any one requirement is met.
    family: "named-option",
    version: 2,
    description: "As the previous version, or with requirement_any_of instead of requirement_type and requirement_min_value: two or more dice requirements, any one of which activates the option (\"a double 4 or higher, or any triple\" is a pair from 4 or a triple from 1).",
    schema: (previous) => withProperties(previous, { requirement_any_of: optional({ type: "array", items: requirementSchema, minItems: 2 }) }),
    normalize: (input, previous) => {
      if (!("requirement_any_of" in input)) return previous(input);
      const { requirement_any_of: anyOf, ...rest } = input;
      if ("requirement_type" in rest || "requirement_min_value" in rest) throw new TypeError("named-option names one requirement or requirement_any_of, not both.");
      if (!Array.isArray(anyOf) || anyOf.length < 2) throw new TypeError("named-option.requirement_any_of lists two or more requirements; one is requirement_type.");
      const list = anyOf.map((item, index) => requirement(item, `named-option.requirement_any_of[${index}]`));
      if (new Set(list.map((item) => `${item.type}:${item.min_value}`)).size !== list.length) throw new TypeError("named-option.requirement_any_of lists a requirement twice.");
      return { ...previous(rest), requirement_any_of: list };
    },
  },
  {
    // Stable semantic identity for menu options. The compiler falls back to source order only for
    // older reviewed leaves that predate this field; display labels are never used as ids.
    family: "named-option",
    version: 3,
    description: "As the previous version, plus an optional reviewed option_id used as the stable identity of a named option.",
    schema: (previous) => withProperties(previous, { option_id: optional({ type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" }) }),
    normalize: (input, previous) => {
      if (input.option_id === undefined) return previous(input);
      const { option_id: optionId, ...rest } = input;
      return { ...previous(rest), option_id: namedId(optionId, "named-option.option_id") };
    },
  },
  {
    // "that model regains all of its lost wounds".
    family: "regain-wounds",
    version: 5,
    description: "As the previous version, plus amount all: every lost wound is regained (\"regains all of its lost wounds\").",
    schema: (previous) => withProperties(previous, { amount: widenedEnum(previous, "amount", ["all"]) }),
    normalize: (input, previous) => input.amount === "all" ? standIn(input, "amount", "1", previous) : previous(input),
  },
  /**
   * "For each X model you select, roll one D6": one roll per model of the model selection the roll
   * sits in, which already applies its effect to each selected model.
   */
  {
    family: "dice-roll",
    version: 7,
    description: "As the previous version, plus per_model selected: one die for each model the enclosing model selection selects (\"for each X model you select, roll one D6\"). It needs a select-unit of models before it, and takes no count.",
    schema: (previous) => withProperties(previous, { per_model: widenedEnum(previous, "per_model", ["selected"]) }),
    normalize: (input, previous) => {
      if (input.per_model !== "selected") return previous(input);
      const { per_model: _perModel, ...rest } = input;
      if (rest.count !== undefined) throw new TypeError("dice-roll.per_model selected rolls one die per selected model; it takes no count.");
      return { ...previous(rest), per_model: "selected" };
    },
  },
];
