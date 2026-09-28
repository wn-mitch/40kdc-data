import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue, exactKeys, integerOrSource, integerOrSourceSchema } from "./family-validation.js";
import { normalizeEffectParameters } from "./effect-families.js";

/**
 * The first effect buffs: set a characteristic, give weapons an ability, Feel No Pain, an
 * invulnerable save, Fights First, and the first characteristic modifier. Each names whose
 * models it changes.
 */

const weaponGrantKeywords = [
  "Devastating Wounds", "Lethal Hits", "Twin-linked", "Assault", "Heavy", "Pistol", "Torrent", "Blast",
  "Ignores Cover", "Precision", "Hazardous", "Indirect Fire", "Extra Attacks", "Psychic", "One Shot", "Lance",
] as const;

/** Weapon abilities that carry a value, written the way the DSL's keyword-grant spells them. */
const parameterizedWeaponKeyword = /^(?:(?:Sustained Hits|Rapid Fire|Melta) (?:[1-9]|D3|D6)|Anti-[A-Z][A-Za-z -]*[A-Za-z] [2-6]\+)$/u;

const WEAPON_TYPES = ["all", "melee", "ranged"] as const;
/** Version 1 subjects. "The bearer" is the model, so later versions spell it this-model. */
const SUBJECTS_WITH_BEARER = ["this-unit", "this-model", "bearer"] as const;
const BUFF_SUBJECTS = ["this-unit", "this-model"] as const;
const FNP_AGAINST = ["all", "mortal", "psychic", "psychic-and-mortal"] as const;
const CHARACTERISTICS = ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"] as const;

export const BUFF_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "characteristic-set",
    version: 1,
    role: "EFFECT",
    label: "Set a characteristic",
    description: "Sets a model or unit characteristic to a source-specified value.",
    starter: { subject: "bearer", characteristic: "", value: null },
    parameterSchema: {
      type: "object",
      required: ["subject", "characteristic", "value"],
      properties: {
        subject: { enum: ["bearer", "this-model", "this-unit"] },
        characteristic: { enum: ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"] },
        value: integerOrSourceSchema,
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "characteristic-set",
    version: 2,
    role: "EFFECT",
    label: "Set a characteristic",
    description: "Sets a model or unit characteristic to a source-specified value. \"The bearer\" is this model.",
    starter: { subject: "this-model", characteristic: "", value: null },
    parameterSchema: {
      type: "object",
      required: ["subject", "characteristic", "value"],
      properties: {
        subject: { enum: ["this-model", "this-unit"] },
        characteristic: { enum: CHARACTERISTICS },
        value: integerOrSourceSchema,
      },
      additionalProperties: false,
    },
  },
  {
    id: "weapon-ability-grant",
    version: 1,
    role: "EFFECT",
    label: "Give weapons an ability",
    description: "Weapons equipped by the specified models gain a named, parameter-free weapon ability. This is not a unit keyword.",
    starter: { subject: "this-unit", keyword: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "keyword"],
      properties: {
        subject: { enum: ["this-unit", "this-model", "bearer"] },
        keyword: { enum: weaponGrantKeywords },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "weapon-ability-grant",
    version: 2,
    role: "EFFECT",
    label: "Give weapons an ability",
    description: "Weapons equipped by the specified models gain a named weapon ability, optionally only melee or only ranged weapons. This is not a unit keyword.",
    starter: { subject: "this-unit", keyword: "", weapon_type: "all" },
    parameterSchema: {
      type: "object",
      required: ["subject", "keyword", "weapon_type"],
      properties: {
        subject: { enum: ["this-unit", "this-model", "bearer"] },
        keyword: { anyOf: [{ enum: weaponGrantKeywords }, { type: "string", pattern: parameterizedWeaponKeyword.source }] },
        weapon_type: { enum: WEAPON_TYPES },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "weapon-ability-grant",
    version: 3,
    role: "EFFECT",
    label: "Give weapons an ability",
    description: "Weapons equipped by the specified models gain a named weapon ability, optionally only melee or only ranged weapons. This is not a unit keyword. \"The bearer\" is this model.",
    starter: { subject: "this-unit", keyword: "", weapon_type: "all" },
    parameterSchema: {
      type: "object",
      required: ["subject", "keyword", "weapon_type"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        keyword: { anyOf: [{ enum: weaponGrantKeywords }, { type: "string", pattern: parameterizedWeaponKeyword.source }] },
        weapon_type: { enum: WEAPON_TYPES },
      },
      additionalProperties: false,
    },
  },
  {
    id: "feel-no-pain",
    version: 1,
    role: "EFFECT",
    label: "Feel No Pain",
    description: "Models ignore wounds on a roll of the threshold or more, optionally only against mortal wounds or psychic attacks.",
    starter: { subject: "this-unit", threshold: null, against: "all" },
    parameterSchema: {
      type: "object",
      required: ["subject", "threshold", "against"],
      properties: {
        subject: { enum: SUBJECTS_WITH_BEARER },
        threshold: { type: "integer", minimum: 2, maximum: 6 },
        against: { enum: FNP_AGAINST },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "feel-no-pain",
    version: 2,
    role: "EFFECT",
    label: "Feel No Pain",
    description: "Models ignore wounds on a roll of the threshold or more, optionally only against mortal wounds or psychic attacks. \"The bearer\" is this model.",
    starter: { subject: "this-unit", threshold: null, against: "all" },
    parameterSchema: {
      type: "object",
      required: ["subject", "threshold", "against"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        threshold: { type: "integer", minimum: 2, maximum: 6 },
        against: { enum: FNP_AGAINST },
      },
      additionalProperties: false,
    },
  },
  {
    id: "invulnerable-save",
    version: 1,
    role: "EFFECT",
    label: "Invulnerable save",
    description: "Models have an invulnerable save of the threshold or better.",
    starter: { subject: "this-unit", threshold: null },
    parameterSchema: {
      type: "object",
      required: ["subject", "threshold"],
      properties: { subject: { enum: SUBJECTS_WITH_BEARER }, threshold: { type: "integer", minimum: 2, maximum: 6 } },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "invulnerable-save",
    version: 2,
    role: "EFFECT",
    label: "Invulnerable save",
    description: "Models have an invulnerable save of the threshold or better. \"The bearer\" is this model.",
    starter: { subject: "this-unit", threshold: null },
    parameterSchema: {
      type: "object",
      required: ["subject", "threshold"],
      properties: { subject: { enum: BUFF_SUBJECTS }, threshold: { type: "integer", minimum: 2, maximum: 6 } },
      additionalProperties: false,
    },
  },
  {
    id: "fights-first",
    version: 1,
    role: "EFFECT",
    label: "Fights First",
    description: "Models have the Fights First ability.",
    starter: { subject: "this-unit" },
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: { subject: { enum: SUBJECTS_WITH_BEARER } },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "fights-first",
    version: 2,
    role: "EFFECT",
    label: "Fights First",
    description: "Models have the Fights First ability. \"The bearer\" is this model.",
    starter: { subject: "this-unit" },
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: { subject: { enum: BUFF_SUBJECTS } },
      additionalProperties: false,
    },
  },
  {
    id: "characteristic-modifier",
    version: 1,
    role: "EFFECT",
    label: "Add to or subtract from a characteristic",
    description: "Adds to or subtracts from a model characteristic such as OC, Attacks, Strength, or Move. Setting a value is a different leaf.",
    starter: { subject: "this-unit", characteristic: "", operation: "add", value: 1 },
    deprecated: true,
    parameterSchema: {
      type: "object",
      required: ["subject", "characteristic", "operation", "value"],
      properties: {
        subject: { enum: SUBJECTS_WITH_BEARER },
        characteristic: { enum: CHARACTERISTICS },
        operation: { enum: ["add", "subtract"] },
        value: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise parameters for a buff family, or null when the family is not one. */
export function normalizeBuffParameters(
  family: string,
  input: Record<string, unknown>,
  version: number,
): Record<string, unknown> | null {
  switch (family) {
    case "characteristic-set":
      exactKeys(input, ["subject", "characteristic", "value"], family);
      return {
        subject: enumValue(input.subject, version === 1 ? ["bearer", "this-model", "this-unit"] : ["this-model", "this-unit"], "characteristic-set.subject"),
        characteristic: enumValue(input.characteristic, ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"], "characteristic-set.characteristic"),
        value: integerOrSource(input.value, "characteristic-set.value"),
      };
    case "weapon-ability-grant": {
      if (version === 1) {
        exactKeys(input, ["subject", "keyword"], family);
        return {
          subject: enumValue(input.subject, ["this-unit", "this-model", "bearer"], "weapon-ability-grant.subject"),
          keyword: enumValue(input.keyword, weaponGrantKeywords, "weapon-ability-grant.keyword"),
        };
      }
      exactKeys(input, ["subject", "keyword", "weapon_type"], family);
      const keyword = input.keyword;
      if (typeof keyword !== "string" || !((weaponGrantKeywords as readonly string[]).includes(keyword) || parameterizedWeaponKeyword.test(keyword))) {
        throw new TypeError(`weapon-ability-grant.keyword must be a named weapon ability such as Lethal Hits or Sustained Hits 1.`);
      }
      return {
        subject: enumValue(input.subject, version === 2 ? SUBJECTS_WITH_BEARER : BUFF_SUBJECTS, "weapon-ability-grant.subject"),
        keyword,
        weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, "weapon-ability-grant.weapon_type"),
      };
    }
    case "feel-no-pain":
      exactKeys(input, ["subject", "threshold", "against"], family);
      return {
        subject: enumValue(input.subject, version === 1 ? SUBJECTS_WITH_BEARER : BUFF_SUBJECTS, "feel-no-pain.subject"),
        threshold: boundedInteger(input.threshold, 2, 6, "feel-no-pain.threshold"),
        against: enumValue(input.against, FNP_AGAINST, "feel-no-pain.against"),
      };
    case "invulnerable-save":
      exactKeys(input, ["subject", "threshold"], family);
      return {
        subject: enumValue(input.subject, version === 1 ? SUBJECTS_WITH_BEARER : BUFF_SUBJECTS, "invulnerable-save.subject"),
        threshold: boundedInteger(input.threshold, 2, 6, "invulnerable-save.threshold"),
      };
    case "fights-first":
      exactKeys(input, ["subject"], family);
      return { subject: enumValue(input.subject, version === 1 ? SUBJECTS_WITH_BEARER : BUFF_SUBJECTS, "fights-first.subject") };
    case "characteristic-modifier":
      if (version >= 2) return normalizeEffectParameters(family, input, version)!;
      exactKeys(input, ["subject", "characteristic", "operation", "value"], family);
      return {
        subject: enumValue(input.subject, SUBJECTS_WITH_BEARER, "characteristic-modifier.subject"),
        characteristic: enumValue(input.characteristic, CHARACTERISTICS, "characteristic-modifier.characteristic"),
        operation: enumValue(input.operation, ["add", "subtract"], "characteristic-modifier.operation"),
        value: boundedInteger(input.value, 1, 20, "characteristic-modifier.value"),
      };
    default:
      return null;
  }
}