import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { boundedInteger, enumValue } from "../family-validation.js";
import { isObject, namedId } from "./shared.js";

/** Characteristics a number of dice can equal: whole numbers a model prints. */
const COUNT_STATS = ["M", "T", "W", "OC", "A"];
/** Whose characteristic: the model the enclosing selection selected, or the model with the ability. */
const COUNT_STAT_OF = ["selected", "this-model"];

/**
 * Versions of dice-roll, choice-open and named-option: dice a rule rolls and options a player
 * picks. Each version checks only its own additions and hands the rest of a leaf to the previous
 * version, so every earlier leaf still fits it unchanged.
 */

/** The DSL's dice-requirement types: a pair, triple, single die or run at or above min_value. */
const DICE_REQUIREMENT_TYPES = ["pair", "triple", "single", "run"] as const;

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
const ROLL_KINDS = ["psychic", "hazard", "leadership", "battle-shock", "desperate-escape", "channelling"] as const;

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
    // "Select one Synaptic Imperative, even if you have already selected that imperative this battle".
    family: "choice-open",
    version: 3,
    description: "As the previous version, and ignore_consumed: the pick may take an option a once-per-battle selection already used (\"even if you have already selected that imperative this battle\"). Only an optionless pick an ability-activate names takes it.",
    schema: (previous) => withProperties(previous, { ignore_consumed: optional({ const: true }) }),
    normalize: (input, previous) => {
      if (!("ignore_consumed" in input)) return previous(input);
      const { ignore_consumed: ignore, ...rest } = input;
      if (ignore !== true) throw new TypeError("choice-open.ignore_consumed is true or omitted.");
      const result = previous(rest);
      if (result.or_random !== undefined) throw new TypeError("choice-open.ignore_consumed is a pick by the player, not a random one.");
      return { ...result, ignore_consumed: true };
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
  {
    // "that unit suffers D3+1 mortal wounds and one model in it regains up to that many lost wounds".
    family: "regain-wounds",
    version: 7,
    description: "As the previous version, plus amount that-many: as many wounds as the mortal wounds printed before it in its sentence, from the same roll (\"suffers D3+1 mortal wounds and … regains up to that many lost wounds\").",
    schema: (previous) => withProperties(previous, { amount: widenedEnum(previous, "amount", ["that-many"]) }),
    normalize: (input, previous) => input.amount === "that-many" ? standIn(input, "amount", "1", previous) : previous(input),
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
  {
    // "Each time a melee attack is allocated to a model in this unit, after the attacking unit has finished making its
    // attacks, roll one D6 (to a maximum of six D6 per attacking unit)".
    family: "dice-roll",
    version: 8,
    description: "As the previous version, plus per_model allocated-attack: one die for each attack the attacking unit allocated to a model in this unit, rolled once it has finished making its attacks; the attack moment before the roll says which attacks count. max_dice caps the dice (\"to a maximum of six D6\"). It takes no count.",
    schema: (previous) => withProperties(previous, {
      per_model: widenedEnum(previous, "per_model", ["allocated-attack"]),
      max_dice: optional({ type: "integer", minimum: 1, maximum: 30 }),
    }),
    normalize: (input, previous) => {
      if (input.per_model !== "allocated-attack") {
        if (input.max_dice !== undefined) throw new TypeError("dice-roll.max_dice caps the dice of per_model allocated-attack only.");
        return previous(input);
      }
      const { per_model: _perModel, max_dice: maxDice, ...rest } = input;
      if (rest.count !== undefined) throw new TypeError("dice-roll.per_model allocated-attack rolls one die per allocated attack; it takes no count.");
      return { ...previous(rest), per_model: "allocated-attack", ...(maxDice === undefined ? {} : { max_dice: boundedInteger(maxDice, 1, 30, "dice-roll.max_dice") }) };
    },
  },
  {
    // "Roll D3+3: your unit suffers that number of mortal wounds".
    family: "dice-roll",
    version: 9,
    description: "As the previous version, plus plus: a number printed as part of the roll (\"roll D3+3\" is dice D3, plus 3); the result bands and any effect that reads the result read the roll with it added. It takes one die: no count, per_model, alternative or kind.",
    schema: (previous) => withProperties(previous, { plus: optional({ type: "integer", minimum: 1, maximum: 12 }) }),
    normalize: (input, previous) => {
      if (input.plus === undefined) return previous(input);
      const { plus, ...rest } = input;
      for (const key of ["count", "per_model", "alternative", "kind"]) {
        if (rest[key] !== undefined) throw new TypeError(`dice-roll.plus is printed on one die; it takes no ${key}.`);
      }
      return { ...previous(rest), plus: boundedInteger(plus, 1, 12, "dice-roll.plus") };
    },
  },
  {
    // As many dice as a model's characteristic (a D6 for each point of the selected model's Toughness).
    family: "dice-roll",
    version: 10,
    description: "As the previous version, plus count_stat: as many dice as a characteristic of a model (as many D6 as the selected model's Toughness): stat (M, T, W, OC or A) and of (selected: the model the enclosing selection selected; this-model: the model with the ability). It takes no count, per_model, alternative, plus or kind.",
    schema: (previous) => withProperties(previous, {
      count_stat: optional({ type: "object", additionalProperties: false, required: ["stat", "of"], properties: { stat: { enum: COUNT_STATS }, of: { enum: COUNT_STAT_OF } } }),
    }),
    normalize: (input, previous) => {
      if (input.count_stat === undefined) return previous(input);
      const { count_stat: countStat, ...rest } = input;
      for (const key of ["count", "per_model", "alternative", "plus", "kind"]) {
        if (rest[key] !== undefined) throw new TypeError(`dice-roll.count_stat sets how many dice; it takes no ${key}.`);
      }
      if (countStat === null || typeof countStat !== "object" || Array.isArray(countStat) || Object.keys(countStat).some((key) => key !== "stat" && key !== "of")) throw new TypeError("dice-roll.count_stat is {stat, of}.");
      const stat = countStat as Record<string, unknown>;
      return { ...previous(rest), count_stat: { stat: enumValue(stat.stat, COUNT_STATS, "dice-roll.count_stat.stat"), of: enumValue(stat.of, COUNT_STAT_OF, "dice-roll.count_stat.of") } };
    },
  },
  {
    // "this model can issue 1 Order to that unit, regardless of how many Orders it has already issued this turn".
    family: "issue-orders-open",
    version: 2,
    description: "As the previous version, plus recipient: antecedent (the Order goes to the unit the moment before it names, not to an eligible unit the officer picks) and counts_toward_limit: false (the Order does not count toward the Orders the officer can issue this turn).",
    schema: (previous) => withProperties(previous, {
      recipient: optional({ enum: ["antecedent"] }),
      counts_toward_limit: optional({ enum: [false] }),
    }),
    normalize: (input, previous) => {
      const { recipient, counts_toward_limit: counts, ...rest } = input;
      if (recipient === undefined && counts === undefined) return previous(input);
      const result = previous(rest);
      if (recipient !== undefined) result.recipient = enumValue(recipient, ["antecedent"], "issue-orders-open.recipient");
      if (counts !== undefined) {
        if (counts !== false) throw new TypeError("issue-orders-open.counts_toward_limit is false, for an Order outside the officer's limit; leave it out otherwise.");
        result.counts_toward_limit = false;
      }
      return result;
    },
  },
];
