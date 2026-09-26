import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumSet, enumValue, exactKeys } from "./family-validation.js";

/** Effect families added after the original registry; each maps to one DSL effect. */

const SUBJECTS = ["this-unit", "this-model", "bearer"] as const;
/** Model characteristics, then weapon characteristics; only the weapon ones can be limited to melee or ranged. */
export const MODEL_CHARACTERISTICS = ["M", "T", "Sv", "W", "Ld", "OC"] as const;
export const WEAPON_CHARACTERISTICS = ["A", "WS", "BS", "S", "AP", "D"] as const;
const CHARACTERISTICS = [...MODEL_CHARACTERISTICS, ...WEAPON_CHARACTERISTICS] as const;
/** Whose characteristic: a model or unit's (and its weapons'), or the attack being made. */
const CHARACTERISTIC_SUBJECTS = [...SUBJECTS, "attack"] as const;
const CHARACTERISTIC_OPERATIONS = ["add", "subtract", "improve", "worsen"] as const;
const WEAPON_SCOPES = ["all", "melee", "ranged"] as const;

export const MOVES = ["advance", "fall-back"] as const;
export const ACTS = ["shoot", "charge"] as const;

/** Amounts as GW prints them; plain numbers become numbers in the DSL. */
export const WOUND_AMOUNTS = ["1", "2", "3", "D3", "D6", "D3+3"] as const;

export const EFFECT_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "sticky-objective",
    version: 1,
    role: "EFFECT",
    label: "Sticky objective",
    description: "\"That objective marker remains under your control until your opponent's Level of Control over it is greater than yours at the end of a phase.\" Being within range of it is a separate condition.",
    starter: {},
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    id: "no-advance-roll",
    version: 1,
    role: "EFFECT",
    label: "No Advance roll",
    description: "\"Do not make an Advance roll for it\". What happens instead (add 6\" to Move) is its own leaf; the \"instead\" between them joins rather than replaces.",
    starter: { subject: "" },
    parameterSchema: { type: "object", required: ["subject"], properties: { subject: { enum: SUBJECTS } }, additionalProperties: false },
  },
  {
    id: "act-after-move",
    version: 1,
    role: "EFFECT",
    label: "Shoot or charge after advancing or falling back",
    description: "A unit that Advanced or Fell Back this turn is still eligible to shoot, declare a charge, or both. Pick every move and action the wording names.",
    starter: { subject: "", moves: [], acts: [] },
    parameterSchema: {
      type: "object",
      required: ["subject", "moves", "acts"],
      properties: {
        subject: { enum: SUBJECTS },
        moves: { type: "array", items: { enum: MOVES }, minItems: 1, uniqueItems: true },
        acts: { type: "array", items: { enum: ACTS }, minItems: 1, uniqueItems: true },
      },
      additionalProperties: false,
    },
  },
  {
    id: "characteristic-modifier",
    version: 2,
    role: "EFFECT",
    label: "Change characteristics",
    description: "Adds, subtracts, improves or worsens one or more characteristics, for example the Armour Penetration of melee weapons, or the Strength of the attack being made. Setting a value is a different leaf.",
    starter: { subject: "", characteristics: [], operation: "", value: null, weapon_type: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "characteristics", "operation", "value", "weapon_type"],
      properties: {
        subject: { enum: CHARACTERISTIC_SUBJECTS },
        characteristics: { type: "array", items: { enum: CHARACTERISTICS }, minItems: 1, uniqueItems: true },
        operation: { enum: CHARACTERISTIC_OPERATIONS },
        value: { type: "integer", minimum: 1, maximum: 20 },
        // Which weapons carry the change; melee or ranged only for weapon characteristics.
        weapon_type: { enum: WEAPON_SCOPES },
      },
      additionalProperties: false,
    },
  },
  {
    id: "regain-wounds",
    version: 1,
    role: "EFFECT",
    label: "Regain lost wounds",
    description: "A model regains lost wounds (heals). Adding to the Wounds characteristic is a different leaf.",
    starter: { subject: "", amount: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "amount"],
      properties: { subject: { enum: SUBJECTS }, amount: { enum: WOUND_AMOUNTS } },
      additionalProperties: false,
    },
  },
];

export function normalizeEffectParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  switch (family) {
    case "sticky-objective":
      exactKeys(input, [], family);
      return {};
    case "no-advance-roll":
      exactKeys(input, ["subject"], family);
      return { subject: enumValue(input.subject, SUBJECTS, "no-advance-roll.subject") };
    case "act-after-move":
      exactKeys(input, ["subject", "moves", "acts"], family);
      return { subject: enumValue(input.subject, SUBJECTS, "act-after-move.subject"), moves: enumSet(input.moves, MOVES, "act-after-move.moves"), acts: enumSet(input.acts, ACTS, "act-after-move.acts") };
    case "characteristic-modifier": {
      exactKeys(input, ["subject", "characteristics", "operation", "value", "weapon_type"], family);
      const characteristics = enumSet(input.characteristics, CHARACTERISTICS, "characteristic-modifier.characteristics");
      const weaponType = enumValue(input.weapon_type, WEAPON_SCOPES, "characteristic-modifier.weapon_type");
      const subject = enumValue(input.subject, CHARACTERISTIC_SUBJECTS, "characteristic-modifier.subject");
      if (weaponType !== "all" && characteristics.some((item) => (MODEL_CHARACTERISTICS as readonly string[]).includes(item))) {
        throw new TypeError("characteristic-modifier: only weapon characteristics (A, WS, BS, S, AP, D) can be limited to melee or ranged weapons.");
      }
      // An attack is already melee or ranged by its attack leaf; saying it here too would say it twice.
      if (subject === "attack" && weaponType !== "all") throw new TypeError("characteristic-modifier: the attack's own leaf says melee or ranged; use weapon type all.");
      return { subject, characteristics, operation: enumValue(input.operation, CHARACTERISTIC_OPERATIONS, "characteristic-modifier.operation"), value: boundedInteger(input.value, 1, 20, "characteristic-modifier.value"), weapon_type: weaponType };
    }
    case "regain-wounds":
      exactKeys(input, ["subject", "amount"], family);
      return { subject: enumValue(input.subject, SUBJECTS, "regain-wounds.subject"), amount: enumValue(input.amount, WOUND_AMOUNTS, "regain-wounds.amount") };
    default:
      return null;
  }
}
