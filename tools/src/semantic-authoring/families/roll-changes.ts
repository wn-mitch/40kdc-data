import { ANTECEDENT } from "../antecedent-families.js";
import { boundedInteger, enumOrSource, enumSet, enumValue, exactKeys, integerOrSource } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Input, KEBAB_ID, SOURCE, BASIC_ROLLS, ROLL_KINDS, WEAPON_TYPES, ROLL_SUBJECTS, ABILITY_ROLL, STATS,
  isAbilityRoll, abilityRoll, pickedRolls, allowedKeys,
} from "./dice-and-core-shared.js";

/** Roll changes: modifiers, re-rolls, ignored modifiers, fixed results, prohibited rolls, roll results and the critical hit threshold. */

// ---------------------------------------------------------------------------------------------
// roll-modifier

const MODIFIER_ROLLS = [...BASIC_ROLLS, "hazard", "psychic", "desperate-escape", "preceding", "manoeuvre", "deadly-demise"] as const;
/**
 * The rolls a `rolls` list takes: the single rolls that need no binding. The compiler lowers the
 * list as one roll-modifier per roll; preceding and manoeuvre are bound one leaf at a time.
 */
const LISTED_MODIFIER_ROLLS = [...BASIC_ROLLS, "hazard", "psychic", "desperate-escape", "deadly-demise"] as const;
/** Rolls made with a weapon, which weapon_type can limit to melee or ranged. */
const WEAPON_ROLLS = ["hit", "wound", "damage"];
/** Rolls a printed weapon name can limit. */
const NAMED_WEAPON_ROLLS = ["hit", "wound", "damage", "hazard"];
const CAP_MAX = 12;

function weaponName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) throw new TypeError(`${label} takes one printed weapon name, with no padding.`);
  return value;
}

function weaponNameList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) throw new TypeError(`${label} names 2 to 8 weapons.`);
  const names = value.map((item) => {
    if (typeof item !== "string" || item.trim() === "" || item !== item.trim()) throw new TypeError(`${label} takes printed weapon names, with no padding.`);
    return item;
  });
  if (new Set(names).size !== names.length) throw new TypeError(`${label} lists a weapon name twice.`);
  return names;
}

function normalizeRollModifier(input: Input): Input {
  allowedKeys(input, ["roll", "rolls", "operation", "value", "weapon_type", "subject", "weapon_name", "weapon_names", "cap"],
    "roll-modifier parameters must be roll or rolls, operation, value, and optional weapon_type, subject, weapon_name or weapon_names, and cap only.");
  if (!("rolls" in input) && !("roll" in input)) throw new TypeError("roll-modifier names a roll or rolls.");
  if ("rolls" in input && "roll" in input) throw new TypeError("roll-modifier names a roll or rolls, not both.");
  const operation = enumValue(input.operation, ["add", "subtract", "halve"], "roll-modifier.operation");
  const result: Input = { operation };

  // value: an integer, a source snippet, or that-many; halve takes none.
  if (operation === "halve") {
    if (input.value !== undefined || input.cap !== undefined) throw new TypeError("roll-modifier operation halve takes no value or cap.");
  } else if (input.value === undefined) {
    throw new TypeError("roll-modifier.value is required unless operation is halve.");
  } else if (input.value === "that-many") {
    if (operation !== "add") throw new TypeError("roll-modifier value that-many adds the mortal wounds suffered; it needs operation add.");
    if (input.cap !== undefined || input.rolls !== undefined) throw new TypeError("roll-modifier value that-many takes no cap or rolls.");
    result.value = "that-many";
  } else {
    result.value = integerOrSource(input.value, "roll-modifier.value");
  }

  if (input.cap !== undefined) {
    const cap = input.cap;
    if (!Number.isSafeInteger(cap) || (cap as number) < 1 || (cap as number) > CAP_MAX) throw new TypeError(`roll-modifier.cap must be a whole number from 1 to ${CAP_MAX}.`);
    if (typeof input.value !== "number") throw new TypeError("roll-modifier.cap needs a numeric value to cap.");
    if (operation !== "add") throw new TypeError("roll-modifier.cap limits an added bonus (\"to a maximum of +2\"); it needs operation add.");
    if (input.rolls !== undefined) throw new TypeError("roll-modifier.cap belongs to a single roll, not a list of rolls.");
    result.cap = cap;
  }

  // The rolls weapon_type is checked against: a preceding roll and an ability's roll count as weapon rolls.
  let weaponRolls: readonly unknown[];
  if ("rolls" in input) {
    const rolls = input.rolls;
    if (!Array.isArray(rolls) || rolls.length < 2) throw new TypeError("roll-modifier.rolls lists at least two rolls.");
    const list = rolls.map((roll) => enumValue(roll, LISTED_MODIFIER_ROLLS, "roll-modifier.rolls"));
    if (new Set(list).size !== list.length) throw new TypeError("roll-modifier.rolls lists a roll twice.");
    if ("weapon_name" in input || "weapon_names" in input) throw new TypeError("roll-modifier weapon names cannot combine with rolls.");
    result.rolls = [...list].sort();
    weaponRolls = list;
  } else {
    const roll = input.roll;
    if (roll === "manoeuvre") {
      if (operation !== "add") throw new TypeError("roll-modifier roll manoeuvre adds to the result; it needs operation add.");
      if (input.weapon_type !== undefined) throw new TypeError("roll-modifier roll manoeuvre is not a weapon roll; drop weapon_type.");
      if (input.subject !== "event-subject") throw new TypeError("roll-modifier roll manoeuvre names the performing unit as its subject (event-subject).");
    }
    if (roll === "deadly-demise" && "weapon_type" in input) throw new TypeError("roll-modifier roll deadly-demise is no weapon's roll; drop weapon_type.");
    if ("weapon_name" in input || "weapon_names" in input) {
      if ("weapon_name" in input && "weapon_names" in input) throw new TypeError("roll-modifier.weapon_name cannot combine with weapon_names.");
      if (!(typeof roll === "string" && NAMED_WEAPON_ROLLS.includes(roll))) {
        throw new TypeError(`roll-modifier weapon names need a ${NAMED_WEAPON_ROLLS.join(", ")} roll.`);
      }
    }
    if (isAbilityRoll(roll)) {
      result.roll = abilityRoll(roll, "roll-modifier");
      weaponRolls = ["hit"];
    } else if (typeof roll === "string" && (MODIFIER_ROLLS as readonly string[]).includes(roll)) {
      result.roll = roll;
      weaponRolls = [roll === "preceding" ? "hit" : roll];
    } else {
      result.roll = enumOrSource(roll, BASIC_ROLLS, "roll-modifier.roll");
      weaponRolls = [result.roll];
    }
  }

  if ("weapon_type" in input) {
    result.weapon_type = enumValue(input.weapon_type, WEAPON_TYPES, "roll-modifier.weapon_type");
    if (!weaponRolls.every((roll) => WEAPON_ROLLS.includes(String(roll)))) throw new TypeError("roll-modifier.weapon_type limits Hit, Wound or Damage rolls only.");
  }
  if (input.subject !== undefined) result.subject = enumValue(input.subject, ROLL_SUBJECTS, "roll-modifier.subject");
  if (input.weapon_name !== undefined) result.weapon_name = weaponName(input.weapon_name, "roll-modifier.weapon_name");
  if (input.weapon_names !== undefined) result.weapon_names = weaponNameList(input.weapon_names, "roll-modifier.weapon_names");
  return result;
}

// ---------------------------------------------------------------------------------------------
// reroll

const REROLL_SUBSETS = ["ones", "failed", "all", "ones-and-twos"] as const;
const REROLL_MAX = 12;

function normalizeReroll(input: Input): Input {
  allowedKeys(input, ["roll", "rolls", "subset", "weapon_type", "count", "each", "subject"],
    "reroll parameters must be roll or rolls, subset, weapon_type, and optional count, each and subject only.");
  if ((input.roll === undefined) === (input.rolls === undefined)) throw new TypeError("reroll names exactly one of roll and rolls.");
  const result: Input = {};
  if (input.rolls !== undefined) result.rolls = pickedRolls(input.rolls, "reroll.rolls");
  else if (input.roll === "manoeuvre") result.roll = "manoeuvre";
  else if (isAbilityRoll(input.roll)) result.roll = abilityRoll(input.roll, "reroll");
  else result.roll = enumValue(input.roll, ROLL_KINDS, "reroll.roll");
  result.subset = enumValue(input.subset, REROLL_SUBSETS, "reroll.subset");
  result.weapon_type = enumValue(input.weapon_type, WEAPON_TYPES, "reroll.weapon_type");
  if (input.count !== undefined) {
    const count = input.count;
    if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > REROLL_MAX) throw new TypeError(`reroll.count must be a whole number from 1 to ${REROLL_MAX}.`);
    result.count = count;
  }
  if (input.each !== undefined) {
    if (input.each !== true) throw new TypeError("reroll.each is true or absent.");
    if (input.rolls === undefined) throw new TypeError("reroll.each qualifies a rolls list.");
    result.each = true;
  }
  if (input.subject !== undefined) result.subject = enumValue(input.subject, ROLL_SUBJECTS, "reroll.subject");
  return result;
}

// ---------------------------------------------------------------------------------------------
// ignore-modifiers

const IGNORE_ONLY = ["worsening", "improving"] as const;
const EXCEPTABLE_ROLLS = ROLL_KINDS.filter((roll) => roll !== "all" && roll !== "any");

function normalizeIgnoreModifiers(input: Input): Input {
  const { except_rolls: except, ...rest } = input;
  const subject = enumValue(rest.subject, ["this-unit", "this-model", ANTECEDENT], "ignore-modifiers.subject");
  const kinds = enumSet(rest.what, ["characteristics", "rolls"], "ignore-modifiers.what");
  const allowed = ["subject", "what", "only", "weapon_type", ...(kinds.includes("characteristics") ? ["stats"] : []), ...(kinds.includes("rolls") ? ["rolls"] : [])];
  allowedKeys(rest, allowed, "ignore-modifiers parameters must be subject, what, only, weapon_type, except_rolls, and stats/rolls only for the kinds what names.");
  const result: Input = { subject, what: kinds };
  if (rest.stats !== undefined) result.stats = enumSet(rest.stats, STATS, "ignore-modifiers.stats");
  if (kinds.includes("rolls")) result.rolls = enumSet(rest.rolls, ROLL_KINDS, "ignore-modifiers.rolls");
  if (rest.only !== undefined) result.only = enumValue(rest.only, IGNORE_ONLY, "ignore-modifiers.only");
  if (rest.weapon_type !== undefined) result.weapon_type = enumValue(rest.weapon_type, WEAPON_TYPES, "ignore-modifiers.weapon_type");
  if (except === undefined) return result;
  const rolls = Array.isArray(result.rolls) ? result.rolls : [];
  if (!rolls.some((roll) => roll === "all" || roll === "any")) throw new TypeError("ignore-modifiers.except_rolls leaves rolls out of an \"any roll\" list: rolls must be all or any.");
  return { ...result, except_rolls: enumSet(except, EXCEPTABLE_ROLLS, "ignore-modifiers.except_rolls") };
}

// ---------------------------------------------------------------------------------------------
// roll-auto-result

const AUTO_OUTCOMES = ["succeeds-on", "counts-as-6", "auto-pass", "fails-on", "chosen"] as const;
const DARK_PACT = "dark-pact";
/** Rolls that are tests, not attacks; a melee/ranged weapon scope has no meaning for them. */
const TEST_ROLLS = new Set(["battle-shock", "leadership", "desperate-escape"]);

function normalizeRollAutoResult(input: Input): Input {
  const outcome = input.outcome;
  if (outcome !== "chosen" && input.values !== undefined) throw new TypeError("roll-auto-result.values names the results of outcome chosen only.");
  const subject = input.subject === undefined ? {} : { subject: enumValue(input.subject, ROLL_SUBJECTS, "roll-auto-result.subject") };
  if (outcome === "chosen") {
    exactKeys(input, ["roll", "outcome", "values", ...(input.subject === undefined ? [] : ["subject"])], "roll-auto-result");
    const values = input.values;
    if (!Array.isArray(values) || values.length < 2 || !values.every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 6)
      || new Set(values).size !== values.length) {
      throw new TypeError("roll-auto-result.values for chosen must be two or more different whole numbers from 1 to 6.");
    }
    const roll = enumValue(input.roll, [...ROLL_KINDS, DARK_PACT], "roll-auto-result.roll");
    return { roll, outcome, values: [...values].sort((a, b) => a - b), ...subject };
  }
  if (input.roll === DARK_PACT && outcome !== "auto-pass") throw new TypeError("roll-auto-result dark-pact is an automatic pass of that test.");
  if (outcome === "fails-on") {
    const value = input.value;
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 5) throw new TypeError("roll-auto-result.value for fails-on must be a whole number from 1 to 5.");
    if (input.count !== undefined || input.rolls !== undefined) throw new TypeError("roll-auto-result fails-on names one roll and no count.");
  }
  const picked = input.rolls !== undefined;
  if ((input.roll === undefined) === !picked) throw new TypeError("roll-auto-result names exactly one of roll and rolls.");
  const rolls = picked ? pickedRolls(input.rolls, "roll-auto-result.rolls") : null;
  const roll = rolls ? null : input.roll === DARK_PACT ? DARK_PACT : enumValue(input.roll, ROLL_KINDS, "roll-auto-result.roll");
  const checked = enumValue(outcome, AUTO_OUTCOMES, "roll-auto-result.outcome");
  const allowed = [picked ? "rolls" : "roll", "outcome", "weapon_type", "count", "subject", ...(checked === "succeeds-on" || checked === "fails-on" ? ["value"] : [])];
  allowedKeys(input, allowed, "roll-auto-result parameters must be roll (or rolls), outcome, weapon_type, count, subject, and value only when outcome is succeeds-on or fails-on.");
  if (input.count !== undefined && input.count !== 1) throw new TypeError("roll-auto-result.count can only be 1.");
  if (picked && input.count !== 1) throw new TypeError("roll-auto-result.rolls is a pick of one roll; it needs count 1.");
  const result: Input = { ...(rolls ? { rolls } : { roll }), outcome: checked, ...(input.count === 1 ? { count: 1 } : {}), ...subject };
  if (checked === "succeeds-on") result.value = boundedInteger(input.value, 2, 6, "roll-auto-result.value");
  if (checked === "fails-on") result.value = input.value;
  if (input.weapon_type !== undefined) {
    const weaponType = enumValue(input.weapon_type, WEAPON_TYPES, "roll-auto-result.weapon_type");
    // A Dark Pact test is a Leadership test.
    const tested = (rolls ?? [roll === DARK_PACT ? "leadership" : roll as string]);
    if (weaponType !== "all" && tested.some((item) => TEST_ROLLS.has(item))) throw new TypeError(`roll-auto-result.weapon_type has no meaning for the ${roll === DARK_PACT ? "leadership" : roll} test.`);
    result.weapon_type = weaponType;
  }
  return result;
}

export const ROLL_CHANGES_FAMILIES: readonly FlatFamily[] = [
  {
    id: "critical-hit-threshold",
    version: 1,
    role: "EFFECT",
    label: "Change critical-hit threshold",
    description: "Changes the unmodified result needed for a Critical Hit, not the Hit roll needed to score a hit.",
    starter: { value: null },
    parameterSchema: {
      type: "object",
      required: ["value"],
      properties: {
        roll: { anyOf: [{ enum: BASIC_ROLLS }, SOURCE] },
        value: { anyOf: [{ type: "integer" }, SOURCE, { const: "source" }] },
      },
      additionalProperties: false,
    },
    normalize: (input) => {
      if (!Object.keys(input).every((key) => key === "roll" || key === "value") || !Object.hasOwn(input, "value")) {
        throw new TypeError("critical-hit-threshold parameters must contain value and optional roll only.");
      }
      const value = input.value === "source" ? "source" : integerOrSource(input.value, "critical-hit-threshold.value");
      return input.roll === undefined ? { value } : { roll: enumOrSource(input.roll, BASIC_ROLLS, "critical-hit-threshold.roll"), value };
    },
  },
  {
    id: "roll-modifier",
    version: 13,
    role: "EFFECT",
    label: "Change a roll",
    description: "Adds to, subtracts from, or halves a named roll. roll is a Hit, Wound, Charge, Advance, save, Leadership, Battle-shock or Damage roll, a Hazardous, Psychic or Desperate Escape test, preceding (the roll or test the record made just before, bound when the record compiles), manoeuvre (the performing unit's Agile Manoeuvre roll, which adds and takes event-subject as its subject), deadly-demise (the roll a Deadly Demise ability makes when its bearer is destroyed), or {ability: id} (the dice that named ability rolls); rolls instead applies the same change to each of two or more named rolls (\"add 1 to Advance and Charge rolls\"). value is a number or that-many: as many as the mortal wounds printed before it in its sentence, from the same roll (it needs operation add, and takes no cap or rolls). halve takes no value or cap. weapon_type limits a Hit, Wound or Damage roll change to melee or ranged weapons; weapon_name (one printed name) or weapon_names (two to eight) limit a hit, wound, damage or hazard roll to those weapons (\"+1 to hazard rolls made for its X and Y weapons\"). cap: the modifier adds no more than N in total (\"to a maximum of +2\"). subject: the unit whose rolls these are (\"add 1 to Charge rolls made for that unit\"); antecedent points back to an earlier leaf's unit. Without it, the rolls are this unit's (or the attacker's, against an attack on this unit).",
    starter: { roll: "", operation: "", value: null },
    parameterSchema: {
      type: "object",
      required: ["operation"],
      properties: {
        roll: { anyOf: [{ enum: MODIFIER_ROLLS }, SOURCE, ABILITY_ROLL], "x-optional": true },
        operation: { enum: ["add", "subtract", "halve"] },
        value: { anyOf: [{ type: "integer" }, SOURCE, { const: "that-many" }], "x-optional": true },
        rolls: { type: "array", items: { enum: LISTED_MODIFIER_ROLLS }, minItems: 2, uniqueItems: true, "x-optional": true },
        weapon_type: { enum: WEAPON_TYPES, "x-optional": true },
        subject: { enum: ROLL_SUBJECTS, "x-optional": true },
        weapon_name: { type: "string", minLength: 1, "x-optional": true },
        weapon_names: { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, maxItems: 8, uniqueItems: true, "x-optional": true },
        cap: { type: "integer", minimum: 1, maximum: CAP_MAX, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeRollModifier,
  },
  {
    id: "reroll",
    version: 8,
    role: "EFFECT",
    label: "Re-roll a roll",
    description: "Repeats Hit, Wound, or another named roll; subset says which results may be re-rolled (ones, ones-and-twos: a failed roll of 1 or 2, failed, or all), count how many rolls, up to 12 (\"re-roll one Hit roll\", \"re-roll up to six of the D6\"), and weapon_type whether only melee or ranged weapons' rolls count. rolls can list several rolls instead of roll: the player picks one of them (\"re-roll one Hit roll, one Wound roll or one Damage roll\"), or with each, every listed roll can be re-rolled (\"re-roll Hit rolls and Wound rolls\") and a count applies to each. roll can be manoeuvre (the performing unit's own Agile Manoeuvre roll, bound by a manoeuvre moment in the same clause) or an object {ability: id} (the dice a named ability rolls). subject: the unit whose rolls these are (\"you can re-roll Charge rolls made for that unit\"); antecedent points back to an earlier leaf's unit. Without it, the rolls are this unit's (or the attacker's, against an attack on this unit).",
    starter: { roll: "", subset: "", weapon_type: "all" },
    parameterSchema: {
      type: "object",
      required: ["subset", "weapon_type"],
      properties: {
        roll: { anyOf: [{ enum: [...ROLL_KINDS, "manoeuvre"] }, ABILITY_ROLL] },
        rolls: { type: "array", minItems: 2, uniqueItems: true, items: { enum: ROLL_KINDS } },
        subset: { enum: REROLL_SUBSETS },
        count: { type: "integer", minimum: 1, maximum: REROLL_MAX },
        weapon_type: { enum: WEAPON_TYPES },
        each: { const: true, "x-optional": true },
        subject: { enum: ROLL_SUBJECTS, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeReroll,
  },
  {
    id: "ignore-modifiers",
    version: 4,
    role: "EFFECT",
    label: "Ignore modifiers",
    description: "Ignores modifiers to named characteristics and/or rolls (all of them, or only worsening or improving ones). `what` lists the kinds one list names (\"BS, Hit rolls and Wound rolls\" is both); with no stats named, every characteristic is covered. except_rolls: the rolls an \"any roll\" list leaves out, whose modifiers still apply (\"any roll or test made for it (excluding modifiers to saving throws)\"); only with rolls all or any. The subject can be antecedent: the units a unit-filter right before it matches, or a selected unit (\"Friendly X units can ignore modifiers to …\").",
    starter: { subject: "this-unit", what: [] },
    parameterSchema: {
      type: "object",
      required: ["subject", "what"],
      properties: {
        subject: { enum: ["this-unit", "this-model", ANTECEDENT] },
        what: { type: "array", items: { enum: ["characteristics", "rolls"] }, minItems: 1, uniqueItems: true },
        stats: { type: "array", items: { enum: STATS }, minItems: 1, uniqueItems: true },
        rolls: { type: "array", items: { enum: ROLL_KINDS }, minItems: 1, uniqueItems: true },
        only: { enum: IGNORE_ONLY },
        weapon_type: { enum: WEAPON_TYPES },
        except_rolls: { type: "array", items: { enum: EXCEPTABLE_ROLLS }, minItems: 1, uniqueItems: true, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeIgnoreModifiers,
  },
  {
    id: "roll-result",
    version: 3,
    role: "CONDITION",
    label: "On a roll of",
    description: "A minimum result (\"on a 2+\") names only from; the dice leaf supplies the upper bound. An explicit band (\"on a 2-5\") or exact result (\"on a 6\") also names to. unmodified true: the band reads the die before any modifier (\"on an unmodified 6\"); after a moment that is a roll, with no dice of the ability's own between, it narrows that moment to those faces.",
    starter: { from: null },
    parameterSchema: {
      type: "object",
      required: ["from"],
      properties: {
        from: { type: "integer", minimum: 1, maximum: 12 },
        to: { type: "integer", minimum: 1, maximum: 12 },
        unmodified: { const: true, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: (input) => {
      const { unmodified, ...rest } = input;
      if ("unmodified" in input && unmodified !== true) throw new TypeError("roll-result.unmodified is true or absent.");
      const hasUpperBound = "to" in rest;
      exactKeys(rest, hasUpperBound ? ["from", "to"] : ["from"], "roll-result");
      const from = boundedInteger(rest.from, 1, 12, "roll-result.from");
      return {
        from,
        ...(hasUpperBound ? { to: boundedInteger(rest.to, from, 12, "roll-result.to") } : {}),
        ...("unmodified" in input ? { unmodified: true } : {}),
      };
    },
  },
  {
    id: "roll-auto-result",
    version: 6,
    role: "EFFECT",
    label: "Fix a roll's result",
    description: "A roll always succeeds only on an unmodified N+ (succeeds-on, value 2 to 6), always fails on an unmodified N or less (fails-on, value 1 to 5, one roll and no count), always counts as an unmodified 6, or automatically passes (a Battle-shock or similar test); or the player picks its result from values, two or more of 1 to 6, in place of rolling it (chosen: roll, values and optionally subject only). `count: 1` names a single roll the player picks, and `rolls` lists several rolls to pick it from (\"change the result of one Hit roll, one Wound roll or one saving throw to an unmodified 6\"). roll can be dark-pact: the Leadership test a Dark Pact requires, which only passes automatically or is chosen. subject: the unit whose roll it is (\"after making a Hit roll … change the result of that roll\": the model whose roll it is); antecedent points back to an earlier leaf's unit. Without it, the rolls are this unit's (or the attacker's, against an attack on this unit).",
    starter: { roll: "", outcome: "" },
    parameterSchema: {
      type: "object",
      required: ["outcome"],
      properties: {
        roll: { enum: [...ROLL_KINDS, DARK_PACT] },
        rolls: { type: "array", minItems: 2, uniqueItems: true, items: { enum: ROLL_KINDS } },
        outcome: { enum: AUTO_OUTCOMES },
        value: { type: "integer", minimum: 1, maximum: 6, "x-only-when": { outcome: ["succeeds-on", "fails-on"] } },
        count: { const: 1 },
        weapon_type: { enum: WEAPON_TYPES, "x-only-when": { roll: ROLL_KINDS.filter((roll) => !TEST_ROLLS.has(roll)) } },
        subject: { enum: ROLL_SUBJECTS, "x-optional": true },
        values: { type: "array", items: { type: "integer", minimum: 1, maximum: 6 }, minItems: 2, uniqueItems: true, "x-only-when": { outcome: ["chosen"] }, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeRollAutoResult,
  },
  {
    id: "roll-prohibition",
    version: 2,
    role: "EFFECT",
    label: "Do not roll",
    description: "\"Do not roll <roll> …\": the named roll is not made. The \"Instead\" after it, with its own effect, says what happens in its place. Takes only the roll it forbids, which can be a named ability's own roll, {ability: id}: the roll that ability makes (\"do not roll to gain a Blood Tithe point\").",
    starter: { roll: "" },
    parameterSchema: {
      type: "object",
      required: ["roll"],
      properties: { roll: { anyOf: [{ enum: ROLL_KINDS }, ABILITY_ROLL] } },
      additionalProperties: false,
    },
    normalize: (input) => {
      exactKeys(input, ["roll"], "roll-prohibition");
      if (input.roll === null || typeof input.roll !== "object") return { roll: enumValue(input.roll, ROLL_KINDS, "roll-prohibition.roll") };
      exactKeys(input.roll as Input, ["ability"], "roll-prohibition.roll");
      const ability = (input.roll as Input).ability;
      if (typeof ability !== "string" || !KEBAB_ID.test(ability)) throw new TypeError("roll-prohibition.roll.ability is a kebab-case ability, Stratagem, manoeuvre or action id.");
      return { roll: { ability } };
    },
  },
];
