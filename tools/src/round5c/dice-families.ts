import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumSet, enumValue, exactKeys } from "./family-validation.js";

/**
 * Dice, mortal wounds, and fighting on death. A roll is its own leaf ("roll one D6"); each
 * result band ("on a 4+", "on a 2-5") is a condition that gates the effects of its clause, and
 * the compiler turns the bands into the DSL's dice-gated or dice-table. Fighting on death keeps
 * its roll and eligibility inside itself, because each destroyed model rolls separately.
 */

export const DICE = ["D3", "D6", "2D6"] as const;
export const DICE_FACES: Record<string, number> = { D3: 3, D6: 6, "2D6": 12 };
export const WOUND_COUNTS = ["1", "2", "3", "D3", "D6", "D3+3", "2D6"] as const;
export const MORTAL_RECIPIENTS = ["target", "that-unit", "this-unit", "this-model"] as const;
export const FIGHT_ON_DEATH_TIMING = ["when-its-unit-fights", "after-the-attacking-unit-finishes"] as const;
export const FIGHT_ON_DEATH_ACTS = ["fight", "shoot"] as const;
/** A shooting destroyed model is a plain grant to a named subject; it carries no timing of its own. */
export const FIGHT_ON_DEATH_SUBJECTS = ["this-unit", "this-model"] as const;

/**
 * The shared roll-kind vocabulary for this round's dice families (re-roll, ignore-modifiers,
 * roll-auto-result): every roll named in authored data plus the DSL's own `roll` enum members
 * those families have a use for. Kept as one list so the three families do not drift apart.
 */
export const ROLL_KINDS = [
  "hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage",
  "attacks", "psychic", "surge", "hazard", "any", "resource-die", "blessings-of-khorne",
  "desperate-escape", "deadly-demise", "all",
] as const;

export const IGNORE_SUBJECTS = ["this-unit", "this-model"] as const;
/** ignore-modifiers' own `stats` enum: the model/weapon characteristics plus the three extras the DSL allows there. */
export const IGNORE_STATS = ["M", "T", "Sv", "W", "Ld", "OC", "A", "WS", "BS", "S", "AP", "D", "Range", "detection-range", "psyker-level"] as const;
export const IGNORE_ONLY = ["worsening", "improving"] as const;
/** "all" is this family's own placeholder for no restriction; the DSL's weapon_type has no such value, so the fragment omits it. */
export const WEAPON_TYPES = ["all", "melee", "ranged"] as const;
export const ROLL_AUTO_OUTCOMES = ["succeeds-on", "counts-as-6", "auto-pass"] as const;
/** Rolls that are tests, not attacks; a melee/ranged weapon scope has no meaning for them. */
const TEST_ROLLS = new Set(["battle-shock", "leadership", "desperate-escape"]);
const WEAPON_SCOPED_ROLLS = ROLL_KINDS.filter((roll) => !TEST_ROLLS.has(roll));

export const DICE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "dice-roll",
    version: 1,
    role: "EVENT",
    label: "Roll dice",
    description: "\"Roll one D6\": the result bands that follow (on a 4+, on a 2-5) say what happens for each result.",
    starter: { dice: "" },
    parameterSchema: { type: "object", required: ["dice"], properties: { dice: { enum: DICE } }, additionalProperties: false },
    deprecated: true,
  },
  {
    id: "dice-roll",
    version: 2,
    role: "EVENT",
    label: "Roll dice",
    description: "\"Roll one D6\": the result bands that follow (on a 4+, on a 2-5) say what happens for each result. A named roll_var binds the roll (the DSL's phase-4 `roll` container) so a single result band compiles its dice-gated from that binding instead of rolling again.",
    starter: { dice: "" },
    parameterSchema: {
      type: "object",
      required: ["dice"],
      properties: { dice: { enum: DICE }, roll_var: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
  {
    id: "roll-result",
    version: 1,
    role: "CONDITION",
    label: "On a roll of",
    description: "The result band of the roll: \"on a 4+\" is 4 to 6 on a D6, \"on a 2-5\" is 2 to 5, \"on a 6\" is 6 to 6.",
    starter: { from: null, to: null },
    parameterSchema: {
      type: "object",
      required: ["from", "to"],
      properties: { from: { type: "integer", minimum: 1, maximum: 12 }, to: { type: "integer", minimum: 1, maximum: 12 } },
      additionalProperties: false,
    },
  },
  {
    id: "mortal-wounds",
    version: 1,
    role: "EFFECT",
    label: "Mortal wounds",
    description: "A unit suffers mortal wounds: the attack's target, the unit selected earlier (\"that unit\"), this unit, or this model.",
    starter: { recipient: "", count: "" },
    parameterSchema: {
      type: "object",
      required: ["recipient", "count"],
      properties: { recipient: { enum: MORTAL_RECIPIENTS }, count: { enum: WOUND_COUNTS } },
      additionalProperties: false,
    },
  },
  {
    id: "fight-on-death",
    version: 1,
    role: "EFFECT",
    label: "Fights after being destroyed",
    description: "\"Do not remove it from play; that destroyed model can fight …\": when its unit fights, or after the attacking unit finishes. A roll and a \"has not fought\" condition before it limit which destroyed models do.",
    starter: { timing: "" },
    parameterSchema: { type: "object", required: ["timing"], properties: { timing: { enum: FIGHT_ON_DEATH_TIMING } }, additionalProperties: false },
    deprecated: true,
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
        subject: { enum: FIGHT_ON_DEATH_SUBJECTS, "x-only-when": { act: ["shoot"] } },
      },
      additionalProperties: false,
    },
  },
  {
    id: "ignore-modifiers",
    version: 1,
    role: "EFFECT",
    label: "Ignore modifiers",
    description: "Ignores modifiers to named characteristics or rolls (all of them, or only worsening or improving ones); with no stats or rolls named, every one of that kind is covered.",
    starter: { subject: "this-unit", what: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "what"],
      properties: {
        subject: { enum: IGNORE_SUBJECTS },
        what: { enum: ["characteristics", "rolls"] },
        stats: { type: "array", items: { enum: IGNORE_STATS }, minItems: 1, uniqueItems: true, "x-only-when": { what: ["characteristics"] } },
        rolls: { type: "array", items: { enum: ROLL_KINDS }, minItems: 1, uniqueItems: true, "x-only-when": { what: ["rolls"] } },
        only: { enum: IGNORE_ONLY },
        weapon_type: { enum: WEAPON_TYPES },
      },
      additionalProperties: false,
    },
  },
  {
    id: "roll-auto-result",
    version: 1,
    role: "EFFECT",
    label: "Fix a roll's result",
    description: "A roll always succeeds only on an unmodified N+, always counts as an unmodified 6, or automatically passes (a Battle-shock or similar test).",
    starter: { roll: "", outcome: "" },
    parameterSchema: {
      type: "object",
      required: ["roll", "outcome"],
      properties: {
        roll: { enum: ROLL_KINDS },
        outcome: { enum: ROLL_AUTO_OUTCOMES },
        value: { type: "integer", minimum: 2, maximum: 6, "x-only-when": { outcome: ["succeeds-on"] } },
        weapon_type: { enum: WEAPON_TYPES, "x-only-when": { roll: WEAPON_SCOPED_ROLLS } },
      },
      additionalProperties: false,
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
  },
];

export function normalizeDiceParameters(family: string, input: Record<string, unknown>, version = 1): Record<string, unknown> | null {
  switch (family) {
    case "dice-roll": {
      const keys = version >= 2 && "roll_var" in input ? ["dice", "roll_var"] : ["dice"];
      exactKeys(input, keys, family);
      const result: Record<string, unknown> = { dice: enumValue(input.dice, DICE, "dice-roll.dice") };
      if (version >= 2 && "roll_var" in input) {
        if (typeof input.roll_var !== "string" || !input.roll_var) throw new TypeError("dice-roll.roll_var must be a nonblank string.");
        result.roll_var = input.roll_var;
      }
      return result;
    }
    case "roll-result": {
      exactKeys(input, ["from", "to"], family);
      const from = boundedInteger(input.from, 1, 12, "roll-result.from");
      const to = boundedInteger(input.to, from, 12, "roll-result.to");
      return { from, to };
    }
    case "mortal-wounds":
      exactKeys(input, ["recipient", "count"], family);
      return { recipient: enumValue(input.recipient, MORTAL_RECIPIENTS, "mortal-wounds.recipient"), count: enumValue(input.count, WOUND_COUNTS, "mortal-wounds.count") };
    case "fight-on-death": {
      if (version === 1) {
        exactKeys(input, ["timing"], family);
        return { timing: enumValue(input.timing, FIGHT_ON_DEATH_TIMING, "fight-on-death.timing") };
      }
      const act = enumValue(input.act, FIGHT_ON_DEATH_ACTS, "fight-on-death.act");
      if (act === "fight") {
        exactKeys(input, ["act", "timing"], family);
        return { act, timing: enumValue(input.timing, FIGHT_ON_DEATH_TIMING, "fight-on-death.timing") };
      }
      exactKeys(input, ["act", "subject"], family);
      return { act, subject: enumValue(input.subject, FIGHT_ON_DEATH_SUBJECTS, "fight-on-death.subject") };
    }
    case "ignore-modifiers": {
      const subject = enumValue(input.subject, IGNORE_SUBJECTS, "ignore-modifiers.subject");
      const what = enumValue(input.what, ["characteristics", "rolls"], "ignore-modifiers.what");
      const allowed = new Set(["subject", "what", "only", "weapon_type", what === "characteristics" ? "stats" : "rolls"]);
      for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw new TypeError(`ignore-modifiers parameters must be subject, what, only, weapon_type, and ${what === "characteristics" ? "stats" : "rolls"} only.`);
      }
      const result: Record<string, unknown> = { subject, what };
      if (what === "rolls") result.rolls = enumSet(input.rolls, ROLL_KINDS, "ignore-modifiers.rolls");
      else if (input.stats !== undefined) result.stats = enumSet(input.stats, IGNORE_STATS, "ignore-modifiers.stats");
      if (input.only !== undefined) result.only = enumValue(input.only, IGNORE_ONLY, "ignore-modifiers.only");
      if (input.weapon_type !== undefined) result.weapon_type = enumValue(input.weapon_type, WEAPON_TYPES, "ignore-modifiers.weapon_type");
      return result;
    }
    case "roll-auto-result": {
      const roll = enumValue(input.roll, ROLL_KINDS, "roll-auto-result.roll");
      const outcome = enumValue(input.outcome, ROLL_AUTO_OUTCOMES, "roll-auto-result.outcome");
      const allowed = new Set(["roll", "outcome", "weapon_type", ...(outcome === "succeeds-on" ? ["value"] : [])]);
      for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw new TypeError(`roll-auto-result parameters must be roll, outcome, weapon_type, and value only when outcome is succeeds-on.`);
      }
      const result: Record<string, unknown> = { roll, outcome };
      if (outcome === "succeeds-on") result.value = boundedInteger(input.value, 2, 6, "roll-auto-result.value");
      if (input.weapon_type !== undefined) {
        const weaponType = enumValue(input.weapon_type, WEAPON_TYPES, "roll-auto-result.weapon_type");
        if (weaponType !== "all" && TEST_ROLLS.has(roll)) throw new TypeError(`roll-auto-result.weapon_type has no meaning for the ${roll} test.`);
        result.weapon_type = weaponType;
      }
      return result;
    }
    case "end-attack-sequence":
      exactKeys(input, [], family);
      return {};
    default:
      return null;
  }
}
