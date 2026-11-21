import { ANTECEDENT } from "../antecedent-families.js";
import { enumSet } from "../family-validation.js";

/** The roll vocabulary, schema pieces and checks the dice-and-core families share. */

export type Input = Record<string, unknown>;

export const KEBAB = "^[a-z0-9][a-z0-9-]*[a-z0-9]$";
export const KEBAB_ID = new RegExp(KEBAB, "u");

export const SOURCE = {
  type: "object",
  required: ["source"],
  properties: { source: { type: "string", minLength: 1 } },
  additionalProperties: false,
};

/** The rolls the first roll families named. */
export const BASIC_ROLLS = ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"] as const;

/** The shared roll-kind vocabulary of re-roll, ignore-modifiers, roll-auto-result and roll-prohibition. */
export const ROLL_KINDS = [
  "hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage",
  "attacks", "psychic", "surge", "hazard", "any", "resource-die", "blessings-of-khorne",
  "desperate-escape", "deadly-demise", "all",
] as const;

export const WEAPON_TYPES = ["all", "melee", "ranged"] as const;

/** Whose rolls a roll change, re-roll or fixed result is about. */
export const ROLL_SUBJECTS = ["this-unit", "this-model", "event-subject", "selected-unit", "recipient", ANTECEDENT] as const;

export const ABILITY_ROLL = {
  type: "object",
  required: ["ability"],
  properties: { ability: { type: "string", pattern: KEBAB } },
  additionalProperties: false,
};

export const STATS = ["M", "T", "Sv", "W", "Ld", "OC", "A", "WS", "BS", "S", "AP", "D", "Range", "detection-range", "psyker-level"] as const;

/** A unit keyword as the families check it: ASCII capitals. */
export const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;

/** A keyword printed after one apostrophe ('ARDMOB). */
export const LEADING_APOSTROPHE = /^'(?=\p{Lu})[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;

export const isAbilityRoll = (roll: unknown): roll is Input => roll !== null && typeof roll === "object" && "ability" in roll;

/** A named ability's roll, {ability: id}. */
export function abilityRoll(roll: Input, label: string): Input {
  if (Object.keys(roll).length !== 1) throw new TypeError(`${label} roll names one ability, and nothing else.`);
  if (typeof roll.ability !== "string" || !KEBAB_ID.test(roll.ability)) throw new TypeError(`${label} roll.ability is a kebab-case ability id.`);
  return roll;
}

/** Two or more rolls, in the vocabulary's order. */
export function pickedRolls(value: unknown, label: string): string[] {
  const rolls = enumSet(value, ROLL_KINDS, label);
  if (rolls.length < 2) throw new TypeError(`${label} lists two or more rolls; name a single one as roll.`);
  return rolls;
}

export function allowedKeys(input: Input, keys: readonly string[], message: string): void {
  for (const key of Object.keys(input)) if (!keys.includes(key)) throw new TypeError(message);
}
export const KEYWORD_LIST = { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true };
export const FIXED_SUBJECTS = ["this-unit", "this-model"] as const;

/** A non-empty list of distinct strings, as given. */
export const stringList = (value: unknown, label: string) => enumSet(value, (value as string[]) ?? [], label);
