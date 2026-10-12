import { DICE, type FamilyExtension, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/** Characteristics whose value a dice string can stand for ("has D3+3 A"). */
const DICE_CHARACTERISTICS: readonly string[] = ["A", "S", "D"];
/** The most dice a re-roll of "up to N" can name. */
const REROLL_MAX = 12;
/** The largest total a roll-modifier cap can name. */
const CAP_MAX = 12;

/**
 * Wave 10 dice shapes (alternative pools, a re-roll of several dice, a capped modifier, an
 * unmodified-fail threshold and a dice-valued setter). Every version only widens: a leaf valid in the
 * version before is valid here and means the same.
 */
export const FAMILY_EXTENSIONS_20_DICE_COUNT_CAP_AND_TABLES: readonly FamilyExtension[] = [
  {
    family: "dice-roll",
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
  {
    family: "reroll",
    description: "As the previous version, plus count up to 12 (\"re-roll up to six of the D6\").",
    schema: (previous) => withProperties(previous, { count: { type: "integer", minimum: 1, maximum: REROLL_MAX } }),
    normalize: (input, previous) => {
      const count = input.count;
      if (count === undefined) return previous(input);
      if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > REROLL_MAX) throw new TypeError(`reroll.count must be a whole number from 1 to ${REROLL_MAX}.`);
      return (count as number) > 3 ? standIn(input, "count", 1, previous) : previous(input);
    },
  },
  {
    family: "roll-modifier",
    description: "As the previous version, plus cap: the modifier adds no more than N in total (\"to a maximum of +2\").",
    schema: (previous) => withProperties(previous, { cap: optional({ type: "integer", minimum: 1, maximum: CAP_MAX }) }),
    normalize: (input, previous) => {
      if (input.cap === undefined) return previous(input);
      const cap = input.cap;
      if (!Number.isSafeInteger(cap) || (cap as number) < 1 || (cap as number) > CAP_MAX) throw new TypeError(`roll-modifier.cap must be a whole number from 1 to ${CAP_MAX}.`);
      if (typeof input.value !== "number") throw new TypeError("roll-modifier.cap needs a numeric value to cap.");
      if (input.operation !== "add") throw new TypeError("roll-modifier.cap limits an added bonus (\"to a maximum of +2\"); it needs operation add.");
      if (input.rolls !== undefined) throw new TypeError("roll-modifier.cap belongs to a single roll, not a list of rolls.");
      const { cap: kept, ...rest } = input;
      return { ...previous(rest), cap: kept };
    },
  },
  {
    family: "roll-auto-result",
    description: "As the previous version, plus outcome fails-on: an unmodified roll of N or less always fails (value 1 to 5).",
    schema: (previous) => {
      const outcome = widenedEnum(previous, "outcome", ["fails-on"]);
      const value = properties(previous).value as Schema;
      return withProperties(previous, {
        outcome,
        value: { ...value, minimum: 1, "x-only-when": { outcome: ["succeeds-on", "fails-on"] } },
      });
    },
    normalize: (input, previous) => {
      if (input.outcome !== "fails-on") return previous(input);
      const value = input.value;
      if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 5) throw new TypeError("roll-auto-result.value for fails-on must be a whole number from 1 to 5.");
      if (input.count !== undefined || input.rolls !== undefined) throw new TypeError("roll-auto-result fails-on names one roll and no count.");
      const { value: kept, ...rest } = input;
      return { ...previous({ ...rest, outcome: "auto-pass" }), outcome: "fails-on", value: kept };
    },
  },
  {
    family: "characteristic-set",
    description: "As the previous version, plus a dice string value (\"D3+3\") for the characteristics A, S and D.",
    schema: (previous) => {
      const value = properties(previous).value as Schema;
      return withProperties(previous, { value: { ...value, anyOf: [...(value.anyOf as Schema[]), { type: "string", pattern: DICE.source }] } });
    },
    normalize: (input, previous) => {
      if (typeof input.value !== "string") return previous(input);
      if (!DICE.test(input.value)) throw new TypeError("characteristic-set.value must be an integer, {source}, or a dice string such as D3+3.");
      if (!DICE_CHARACTERISTICS.includes(String(input.characteristic))) throw new TypeError("characteristic-set: only A, S and D take a dice value.");
      return standIn(input, "value", 1, previous);
    },
  },
];
