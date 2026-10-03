import { type FamilyExtension, optional, properties, standIn, withProperties } from "./family-extension-helpers.js";
import { boundedInteger, enumValue } from "./family-validation.js";

/**
 * The sixth round of family extensions: faction procedure text that composes from DSL shapes the
 * leaves could not yet name — a roll's kind (a Psychic test is 2D6 against its Warp Charge), army
 * limits per battle size or in points (allied inclusion), a pool's amount per battle size, and a
 * menu that may instead be rolled for. As in the earlier rounds, a version checks only its own
 * additions and hands the rest to the previous version.
 */

/** Roll kinds a dice-roll leaf may name, from the DSL's roll-kind: the tests a rule asks for by name. */
export const ROLL_KINDS = ["psychic", "hazard", "leadership", "battle-shock", "desperate-escape", "channelling"] as const;
export const BATTLE_SIZES = ["incursion", "strike-force", "onslaught"] as const;
export const ARMY_MEASURES = ["units", "models", "points"] as const;
const FACTION_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
const RANDOM_DICE = ["D3", "D6"] as const;

const battleSizeSchema = (maximum: number) => ({
  type: "object",
  required: [...BATTLE_SIZES],
  properties: Object.fromEntries(BATTLE_SIZES.map((size) => [size, { type: "integer", minimum: 0, maximum }])),
  additionalProperties: false,
});

/** One value per battle size ("6 / 10 / 14 Resurgence points"), each within 0..maximum. */
export function battleSizeValue(value: unknown, maximum: number, label: string): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} is a number, or an object with incursion, strike-force and onslaught.`);
  const keys = Object.keys(value);
  if (keys.length !== BATTLE_SIZES.length || !BATTLE_SIZES.every((size) => keys.includes(size))) {
    throw new TypeError(`${label} names exactly incursion, strike-force and onslaught.`);
  }
  return Object.fromEntries(BATTLE_SIZES.map((size) => [size, boundedInteger((value as Record<string, unknown>)[size], 0, maximum, `${label}.${size}`)]));
}

const isObject = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value);

export const FAMILY_EXTENSIONS_6: readonly FamilyExtension[] = [
  {
    // "take a Psychic test (roll 2D6 …)": the roll is a named test, which the DSL's roll carries as its kind.
    family: "dice-roll",
    description: "As the previous version, and kind names the test the roll is (\"take a Psychic test\" is dice 2D6, kind psychic; the result band that follows is its Warp Charge: \"on a 7+\").",
    schema: (previous) => withProperties(previous, { kind: optional({ enum: ROLL_KINDS }) }),
    normalize: (input, previous) => {
      if (!("kind" in input)) return previous(input);
      const { kind, ...rest } = input;
      return { ...previous(rest), kind: enumValue(kind, ROLL_KINDS, "dice-roll.kind") };
    },
  },
  {
    // "You can include Deathwatch units in your army … The combined points value of such units
    // cannot exceed 500 points": a composition limit counted in points, per battle size, or per unit.
    family: "army-construction",
    description: "As the previous version, and max may be one value per battle size ({incursion, strike-force, onslaught}); measure says what max counts (units, models or points; default units); per_keywords applies max once per unit with those keywords (\"one per INQUISITOR\"); faction names the allied faction a composition rule admits (kebab-case faction id).",
    schema: (previous) => {
      const max = properties(previous).max!;
      return withProperties(previous, {
        max: { anyOf: [{ ...max, maximum: 5000 }, battleSizeSchema(5000)] },
        measure: optional({ enum: ARMY_MEASURES }),
        per_keywords: optional({ type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true }),
        faction: optional({ type: "string", pattern: FACTION_ID.source }),
      });
    },
    normalize: (input, previous) => {
      const { max, measure, per_keywords: per, faction, ...rest } = input;
      const added = measure !== undefined || per !== undefined || faction !== undefined || (max !== undefined && (isObject(max) || Number(max) > 20));
      if (!added) return previous(input);
      const result: Record<string, unknown> = { ...previous(rest) };
      if (max !== undefined) {
        result.max = isObject(max) ? battleSizeValue(max, 5000, "army-construction.max") : boundedInteger(max, 0, 5000, "army-construction.max");
      }
      if (measure !== undefined) result.measure = enumValue(measure, ARMY_MEASURES, "army-construction.measure");
      if (measure !== "points" && result.max !== undefined && !isObject(result.max) && Number(result.max) > 20) {
        throw new TypeError("army-construction.max above 20 counts points; set measure: points.");
      }
      if (per !== undefined) {
        // The previous version checks a keyword list as with_keywords does.
        result.per_keywords = (previous({ rule: rest.rule, with_keywords: per }) as { with_keywords: string[] }).with_keywords;
      }
      if (faction !== undefined) {
        if (typeof faction !== "string" || !FACTION_ID.test(faction)) throw new TypeError("army-construction.faction is a kebab-case faction id.");
        result.faction = faction;
      }
      if ((result.measure !== undefined || result.per_keywords !== undefined) && result.rule !== "composition") {
        throw new TypeError("army-construction.measure and per_keywords go with rule: composition.");
      }
      return result;
    },
  },
  {
    // "you start the battle with 6 / 10 / 14 Resurgence points, depending on the battle size".
    family: "resource-gain",
    description: "As the previous version, and amount may be one value per battle size ({incursion, strike-force, onslaught}).",
    schema: (previous) => {
      const amount = properties(previous).amount!;
      return withProperties(previous, { amount: { anyOf: [...(amount.anyOf as unknown[]), battleSizeSchema(100)] } });
    },
    normalize: (input, previous) => {
      if (!isObject(input.amount) || "source" in (input.amount as Record<string, unknown>)) return previous(input);
      return { ...standIn(input, "amount", 1, previous), amount: battleSizeValue(input.amount, 100, "resource-gain.amount") };
    },
  },
  {
    // "either select one from the list below, or randomly select two by rolling two D6".
    family: "choice-open",
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
];
