import { ANTECEDENT } from "../antecedent-families.js";
import { ENTITY_ID } from "../buff-families.js";
import type { SemanticFamilyDefinition } from "../contracts.js";
import { ROLL_KINDS } from "../dice-families.js";
import { EVENT_SUBJECT, type FamilyExtension, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumValue, exactKeys } from "../family-validation.js";
import { NAMED_ID, antecedentSubject, namedId, refuseWith, weaponName, weaponNameList } from "./shared.js";

/**
 * Versions of the roll families (roll-modifier, reroll, roll-auto-result, roll-prohibition,
 * ignore-modifiers), and the roll-prohibition base family. Each version checks only its own
 * additions and hands the rest of a leaf to the previous version, so every earlier leaf still fits
 * it unchanged.
 */

/** Tests a roll-modifier can change ("subtract 1 from those Desperate Escape tests"), checked as Battle-shock is. */
const TEST_ROLLS = ["hazard", "psychic", "desperate-escape"] as const;

/** Rolls made with a weapon, so a modifier to them can name melee or ranged weapons only. */
const WEAPON_ROLLS = new Set(["hit", "wound", "damage"]);

const WEAPON_TYPES = ["all", "melee", "ranged"] as const;

function weaponType(input: Record<string, unknown>, rolls: readonly unknown[], label: string): Record<string, unknown> {
  if (!("weapon_type" in input)) return {};
  const value = enumValue(input.weapon_type, WEAPON_TYPES, `${label}.weapon_type`);
  if (!rolls.every((roll) => WEAPON_ROLLS.has(String(roll)))) throw new TypeError(`${label}.weapon_type limits Hit, Wound or Damage rolls only.`);
  return { weapon_type: value };
}

/** Whose rolls a roll change or re-roll is about, when the text names a unit other than this one. */
const ROLL_SUBJECTS = ["this-unit", "this-model", "event-subject", "selected-unit", "recipient", ANTECEDENT] as const;

/** A version whose rolls belong to a named unit: subject, which an earlier leaf's unit may bind. */
export function rollSubject(family: string, version: number, example: string): FamilyExtension {
  return {
    family,
    version,
    description: `As the previous version, plus subject: the unit whose rolls these are (${example}); antecedent points back to an earlier leaf's unit. Without it, the rolls are this unit's (or the attacker's, against an attack on this unit).`,
    schema: (previous) => withProperties(previous, { subject: optional({ enum: ROLL_SUBJECTS }) }),
    normalize: (input, previous) => {
      if (input.subject === undefined) return previous(input);
      const { subject, ...rest } = input;
      return { ...previous(rest), subject: enumValue(subject, ROLL_SUBJECTS, `${family}.subject`) };
    },
  };
}

const ROLL = "roll";

/** A roll a named ability makes: its own dice, named by its entity id. */
const ABILITY_ROLL: Schema = {
  type: "object",
  required: ["ability"],
  properties: { ability: { type: "string", pattern: ENTITY_ID.source } },
  additionalProperties: false,
};

/** Whether a roll names one ability's dice. */
const isAbilityRoll = (roll: unknown): roll is { ability: string } => roll !== null && typeof roll === "object" && "ability" in roll;

/** Check an ability roll's id; the previous version never sees it, so its shape is checked here. */
function abilityId(roll: { ability: string }, label: string): string {
  if (Object.keys(roll).length !== 1) throw new TypeError(`${label} roll names one ability, and nothing else.`);
  if (typeof roll.ability !== "string" || !ENTITY_ID.test(roll.ability)) throw new TypeError(`${label} roll.ability is a kebab-case ability id.`);
  return roll.ability;
}

/** A roll property with an ability alternative beside its enum, as the widened roll takes. */
function withAbilityAlternative(schema: Schema, key: string): Schema {
  const property = properties(schema)[key]!;
  const alternatives = Array.isArray(property.anyOf) ? property.anyOf as Schema[] : [property];
  return withProperties(schema, { [key]: { ...property, anyOf: [...alternatives, ABILITY_ROLL] } });
}

/** Stand-in roll for the previous version, which takes only its own kinds; the new roll is restored after. */
const ROLL_STAND_IN = "hit";

const ABILITY_ROLL_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["ability"],
  properties: { ability: { type: "string", pattern: NAMED_ID.source } },
};

/** Rolls a weapon name can limit: the attacker's three rolls and the Hazard roll a weapon causes. */
export const NAMED_WEAPON_ROLLS = ["hit", "wound", "damage", "hazard"] as const;

/** The most dice a re-roll of "up to N" can name. */
const REROLL_MAX = 12;

/** The largest total a roll-modifier cap can name. */
const CAP_MAX = 12;

/** The roll a Deadly Demise ability makes when its bearer is destroyed. */
const DEADLY_DEMISE = "deadly-demise";

/**
 * Roll prohibition. "Do not roll <roll> …" forbids the named roll; the "Instead" sentence after it says
 * what happens in its place (compile.ts, the instead loop). The leaf names no subject: the roll is not
 * made at all, so there is no recipient. Its DSL form is the replacement alone (no roll-prohibition output).
 */
export const ROLL_PROHIBITION_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "roll-prohibition",
    version: 1,
    role: "EFFECT",
    label: "Do not roll",
    description: "\"Do not roll <roll> …\": the named roll is not made. The \"Instead\" after it, with its own effect, says what happens in its place. Takes only the roll it forbids.",
    starter: { roll: "" },
    parameterSchema: {
      type: "object",
      required: ["roll"],
      properties: { roll: { enum: ROLL_KINDS } },
      additionalProperties: false,
    },
  },
];

/** roll-prohibition@1 parameters: the roll it forbids, from the shared roll vocabulary. */
export function normalizeRollProhibitionParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "roll-prohibition") return null;
  exactKeys(input, ["roll"], family);
  return { roll: enumValue(input.roll, ROLL_KINDS, "roll-prohibition.roll") };
}

export const ROLL_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "add 1 to Advance and Charge rolls": the same change to every listed roll.
    family: "roll-modifier",
    version: 2,
    description: "As the previous version, or rolls: the same change to each of two or more named rolls (\"add 1 to Advance and Charge rolls\") in place of roll.",
    schema: (previous) => {
      const { required, ...rest } = previous;
      return withProperties({ ...rest, required: (required as string[]).filter((key) => key !== "roll") }, {
        roll: optional(properties(previous).roll!),
        rolls: optional({ type: "array", items: { enum: ROLL_KINDS }, minItems: 2, uniqueItems: true }),
      });
    },
    normalize: (input, previous) => {
      if (!("rolls" in input)) {
        if (!("roll" in input)) throw new TypeError("roll-modifier names a roll or rolls.");
        return previous(input);
      }
      if ("roll" in input) throw new TypeError("roll-modifier names a roll or rolls, not both.");
      const { rolls, ...rest } = input;
      if (!Array.isArray(rolls) || rolls.length < 2) throw new TypeError("roll-modifier.rolls lists at least two rolls.");
      const list = rolls.map((roll) => enumValue(roll, ROLL_KINDS, "roll-modifier.rolls"));
      if (new Set(list).size !== list.length) throw new TypeError("roll-modifier.rolls lists a roll twice.");
      // Each roll is checked as the previous version checks its one roll.
      for (const roll of list) previous({ ...rest, roll });
      const { roll: _roll, ...normalized } = previous({ ...rest, roll: list[0] });
      return { ...normalized, rolls: [...list].sort() };
    },
  },
  {
    // "subtract 1 from each of those Desperate Escape tests", "melee attacks have -1 to Wound rolls".
    family: "roll-modifier",
    version: 3,
    description: "As the previous version, and roll can also be a Hazardous, Psychic or Desperate Escape test; weapon_type limits a Hit, Wound or Damage roll change to melee or ranged weapons.",
    schema: (previous) => withProperties(previous, {
      roll: optional(widenedEnum(previous, "roll", TEST_ROLLS)),
      weapon_type: optional({ enum: WEAPON_TYPES }),
    }),
    normalize: (input, previous) => {
      const { weapon_type: _type, ...rest } = input;
      const rolls = Array.isArray(rest.rolls) ? rest.rolls as unknown[] : [rest.roll];
      const scope = weaponType(input, rolls, "roll-modifier");
      const normalized = (TEST_ROLLS as readonly unknown[]).includes(rest.roll) ? standIn(rest, "roll", "battle-shock", previous) : previous(rest);
      return { ...normalized, ...scope };
    },
  },
  {
    // "adding 1 to the result", "with +1 to that roll", "subtracting 1 from that test".
    family: "roll-modifier",
    version: 4,
    description: "As the previous version, and roll can be preceding: the roll or test the record made just before, bound when the record compiles.",
    schema: (previous) => withProperties(previous, { roll: optional(widenedEnum(previous, "roll", ["preceding"])) }),
    normalize: (input, previous) => input.roll === "preceding" ? standIn(input, "roll", "hit", previous) : previous(input),
  },
  rollSubject("roll-modifier", 5, "\"add 1 to Charge rolls made for that unit\", \"that enemy unit has -2 to Charge rolls\""),
  /**
   * Own-dice manoeuvre roll: "each time a unit performs an Agile Manoeuvre that involves rolling a
   * D6, add 1 to the result". The roll is the performing unit's own manoeuvre roll, so its subject
   * is the triggering unit (event-subject) and is required: without one the change would land on
   * the rule holder. Refusals are for what the compiler cannot bind
   * (compile-manoeuvre-own-roll.ts).
   */
  {
    family: "roll-modifier",
    version: 6,
    description: "As the previous version, and roll can be manoeuvre: the performing unit's Agile Manoeuvre roll, which takes the triggering unit as its subject (\"add 1 to the result of an Agile Manoeuvre roll\").",
    schema: (previous) => withProperties(previous, { roll: widenedEnum(previous, "roll", ["manoeuvre"]) }),
    normalize: (input, previous) => {
      if (input.roll !== "manoeuvre") return previous(input);
      if (input.operation === "subtract") throw new TypeError("roll-modifier roll manoeuvre adds to the result; it cannot subtract.");
      if (input.weapon_type !== undefined) throw new TypeError("roll-modifier roll manoeuvre is not a weapon roll; drop weapon_type.");
      if ("rolls" in input) throw new TypeError("roll-modifier roll manoeuvre names one roll, not rolls.");
      if (input.subject !== EVENT_SUBJECT) throw new TypeError("roll-modifier roll manoeuvre names the performing unit as its subject (event-subject).");
      return standIn(input, "roll", "hit", previous);
    },
  },
  /**
   * Named-ability roll scope: a roll that belongs to one named ability (its own dice). The previous
   * version gets a stand-in value it accepts where it cannot take the new one. The compiler checks
   * what each form binds (compile-ability-roll.ts).
   */
  {
    // A modifier to the dice one named ability rolls.
    family: "roll-modifier",
    version: 7,
    description: "As the previous version, and roll can be an object {ability: id}: the dice that named ability rolls.",
    schema: (previous) => withAbilityAlternative(previous, ROLL),
    normalize: (input, previous) => {
      if (!isAbilityRoll(input[ROLL])) return previous(input);
      abilityId(input[ROLL], "roll-modifier");
      return standIn(input, ROLL, ROLL_STAND_IN, previous);
    },
  },
  {
    // "+1 to hazard rolls made for its X and Y weapons".
    family: "roll-modifier",
    version: 8,
    description: "As the previous version, plus weapon_name (one printed weapon name) or weapon_names (two to eight): the modifier applies to the roll made for those weapons (\"+1 to hazard rolls made for its X and Y weapons\"). It needs a hit, wound, damage or hazard roll, and takes no rolls; weapon_name and weapon_names exclude each other.",
    schema: (previous) => withProperties(previous, {
      weapon_name: optional({ type: "string", minLength: 1 }),
      weapon_names: optional({ type: "array", items: { type: "string", minLength: 1 }, minItems: 2, maxItems: 8, uniqueItems: true }),
    }),
    normalize: (input, previous) => {
      if (!("weapon_name" in input) && !("weapon_names" in input)) return previous(input);
      refuseWith(input, ["rolls"], "roll-modifier weapon names");
      if ("weapon_name" in input && "weapon_names" in input) throw new TypeError("roll-modifier.weapon_name cannot combine with weapon_names.");
      if (!(NAMED_WEAPON_ROLLS as readonly unknown[]).includes(input.roll)) {
        throw new TypeError(`roll-modifier weapon names need a ${NAMED_WEAPON_ROLLS.join(", ")} roll.`);
      }
      const { weapon_name: name, weapon_names: names, ...rest } = input;
      return {
        ...previous(rest),
        ...(name !== undefined ? { weapon_name: weaponName(name, "roll-modifier.weapon_name") } : {}),
        ...(names !== undefined ? { weapon_names: weaponNameList(names, "roll-modifier.weapon_names") } : {}),
      };
    },
  },
  {
    family: "roll-modifier",
    version: 9,
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
  /**
   * The Deadly Demise roll ("add 1 to the Deadly Demise roll if ..."). The DSL's roll-modifier
   * already names `deadly-demise`; the leaf family did not. The roll takes no weapon scope: it is
   * no weapon's roll. It is named by `roll` alone, not listed in `rolls`.
   */
  {
    family: "roll-modifier",
    version: 10,
    description: "As the previous version, and roll can be deadly-demise: the roll a Deadly Demise ability makes when its bearer is destroyed. It takes no weapon_type.",
    schema: (previous) => withProperties(previous, { roll: widenedEnum(previous, "roll", [DEADLY_DEMISE]) }),
    normalize: (input, previous) => {
      if (input.roll !== DEADLY_DEMISE) return previous(input);
      if ("weapon_type" in input) throw new TypeError("roll-modifier roll deadly-demise is no weapon's roll; drop weapon_type.");
      if ("rolls" in input) throw new TypeError("roll-modifier names a roll or rolls, not both.");
      return standIn(input, "roll", ROLL_STAND_IN, previous);
    },
  },
  {
    // "can re-roll hit rolls and wound rolls"; "re-roll one Hit roll, one Wound roll and one Damage roll".
    family: "reroll",
    version: 4,
    description: "As the previous version, plus each: with rolls, every listed roll can be re-rolled (\"re-roll Hit rolls and Wound rolls\"), not one picked from them; a count applies to each roll.",
    schema: (previous) => withProperties(previous, { each: optional({ const: true }) }),
    normalize: (input, previous) => {
      if (input.each === undefined) return previous(input);
      const { each, ...rest } = input;
      if (each !== true) throw new TypeError("reroll.each is true or absent.");
      if (rest.rolls === undefined) throw new TypeError("reroll.each qualifies a rolls list.");
      return { ...previous(rest), each: true };
    },
  },
  rollSubject("reroll", 5, "\"you can re-roll Charge rolls made for that unit\""),
  /**
   * A named ability's own roll, and the dice of a manoeuvre on a re-roll (compile-ability-roll.ts,
   * compile-manoeuvre-own-roll.ts).
   */
  {
    // A re-roll of a manoeuvre's own dice (roll manoeuvre), or of the dice one named ability rolls (roll {ability}).
    family: "reroll",
    version: 6,
    description: "As the previous version, and roll can be manoeuvre (the performing unit's own Agile Manoeuvre roll, bound by a manoeuvre moment in the same clause) or an object {ability: id} (the dice a named ability rolls).",
    schema: (previous) => {
      const { enum: values, ...rest } = properties(previous)[ROLL]!;
      return withProperties(previous, { [ROLL]: { ...rest, anyOf: [{ enum: [...(values as string[]), "manoeuvre"] }, ABILITY_ROLL] } });
    },
    normalize: (input, previous) => {
      if (input[ROLL] === "manoeuvre") return standIn(input, ROLL, ROLL_STAND_IN, previous);
      if (isAbilityRoll(input[ROLL])) {
        abilityId(input[ROLL], "reroll");
        return standIn(input, ROLL, ROLL_STAND_IN, previous);
      }
      return previous(input);
    },
  },
  {
    family: "reroll",
    version: 7,
    description: "As the previous version, plus count up to 12 (\"re-roll up to six of the D6\").",
    schema: (previous) => withProperties(previous, { count: { type: "integer", minimum: 1, maximum: REROLL_MAX } }),
    normalize: (input, previous) => {
      const count = input.count;
      if (count === undefined) return previous(input);
      if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > REROLL_MAX) throw new TypeError(`reroll.count must be a whole number from 1 to ${REROLL_MAX}.`);
      return (count as number) > 3 ? standIn(input, "count", 1, previous) : previous(input);
    },
  },
  /**
   * The roll a multi-roll moment changed.
   */
  // "Change the result of that roll to an unmodified 6": subject names whose roll it is, so a
  // "this model" roll targets that model rather than the unit.
  rollSubject("roll-auto-result", 3, "\"after making a Hit roll … change the result of that roll\": the model whose roll it is"),
  {
    family: "roll-auto-result",
    version: 4,
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
  /**
   * The prohibited roll can be a named ability's own roll ({ability: id}): "do not roll to gain a
   * Blood Tithe point" forbids that ability's roll. The DSL form is a roll-result pass on that roll
   * (compile-roll-prohibition.ts).
   */
  {
    // "do not roll to gain a Blood Tithe point": the roll a named ability makes is the one forbidden.
    family: "roll-prohibition",
    version: 2,
    description: "As the previous version, and roll can be a named ability's own roll, {ability: id}: the roll that ability makes.",
    schema: (previous) => withProperties(previous, {
      roll: { anyOf: [properties(previous).roll!, ABILITY_ROLL_SCHEMA] },
    }),
    normalize: (input, previous) => {
      if (input.roll === null || typeof input.roll !== "object") return previous(input);
      exactKeys(input, ["roll"], "roll-prohibition");
      exactKeys(input.roll as Record<string, unknown>, ["ability"], "roll-prohibition.roll");
      return { roll: { ability: namedId((input.roll as { ability: unknown }).ability, "roll-prohibition.roll.ability") } };
    },
  },
  antecedentSubject("ignore-modifiers", 3, "\"Friendly X units can ignore modifiers to …\": the units a unit-filter right before it matches, or a selected unit"),
];
