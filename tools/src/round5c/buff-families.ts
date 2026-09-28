import type { SemanticFamilyDefinition } from "./contracts.js";
import { boundedInteger, enumValue, exactKeys, integerOrSource, integerOrSourceSchema } from "./family-validation.js";
import { normalizeEffectParameters } from "./effect-families.js";

/**
 * The first effect buffs: set a characteristic, give weapons an ability, Feel No Pain, an
 * invulnerable save, Fights First, and the first characteristic modifier. Each names whose
 * models it changes.
 */

/** Shared with weapon-buff-families.ts, which builds weapon-ability-grant on the same vocabulary. */
export const weaponGrantKeywords = [
  "Devastating Wounds", "Lethal Hits", "Twin-linked", "Assault", "Heavy", "Pistol", "Torrent", "Blast",
  "Ignores Cover", "Precision", "Hazardous", "Indirect Fire", "Extra Attacks", "Psychic", "One Shot", "Lance",
] as const;

/** Weapon abilities that carry a value, written the way the DSL's keyword-grant spells them. */
export const parameterizedWeaponKeyword = /^(?:(?:Sustained Hits|Rapid Fire|Melta) (?:[1-9]|D3|D6)|Anti-[A-Z][A-Za-z -]*[A-Za-z] [2-6]\+)$/u;

export const WEAPON_TYPES = ["all", "melee", "ranged"] as const;
/** Version 1 subjects. "The bearer" is the model, so later versions spell it this-model. */
export const SUBJECTS_WITH_BEARER = ["this-unit", "this-model", "bearer"] as const;
export const BUFF_SUBJECTS = ["this-unit", "this-model"] as const;
const FNP_AGAINST = ["all", "mortal", "psychic", "psychic-and-mortal"] as const;
const CHARACTERISTICS = ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"] as const;

/** A kebab-case entity id, as core and enrichment ability/weapon records are keyed. Shared with ability-modifier-families.ts. */
export const ENTITY_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
/** A unit keyword as the DSL writes it: uppercase words, without markdown emphasis. */
export const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;

/** Core rulebook abilities `ability-grant` can name (`data/core/unit-keywords.json`) plus Benefit of Cover. Shared with ability-modifier-families.ts. */
export const CORE_ABILITY_GRANT_IDS = [
  "benefit-of-cover", "deadly-demise", "deep-strike", "feel-no-pain", "fights-first", "firing-deck", "hover",
  "infiltrators", "leader", "lone-operative", "scouts", "stealth", "support", "super-heavy-walker",
] as const;
/** Core abilities whose datasheet rating carries a number (Scouts 6", Firing Deck N, Deadly Demise D3/D6). */
const VALUED_ABILITY_GRANTS = ["scouts", "deep-strike", "firing-deck", "deadly-demise"] as const;
/** `{rating: true}`: the value is the unit's own datasheet rating for this ability, not a fixed number. Shared with ability-modifier-families.ts. */
export const abilityRatingSchema = { type: "object", required: ["rating"], properties: { rating: { const: true } }, additionalProperties: false } as const;

export function entityId(value: unknown, label: string): string {
  if (typeof value === "string" && ENTITY_ID.test(value)) return value;
  throw new TypeError(`${label} must be a kebab-case entity id.`);
}

export function unitKeywordArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must list at least one unit keyword.`);
  for (const item of value) {
    if (typeof item !== "string" || !UNIT_KEYWORD.test(item)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} lists a keyword twice.`);
  return value as string[];
}

/** Shared with weapon-buff-families.ts and ability-modifier-families.ts. */
export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new TypeError(`${label} must be a nonempty string.`);
}

export function constTrue(value: unknown, label: string): true {
  if (value === true) return true;
  throw new TypeError(`${label} must be true.`);
}

/** The rated value a core ability grant carries: an integer, or the unit's own datasheet rating. Shared with ability-modifier-families.ts. */
export function abilityGrantValue(value: unknown, label: string): number | { rating: true } {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 36) return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).rating === true && Object.keys(value as object).length === 1) {
    return { rating: true };
  }
  throw new TypeError(`${label} must be an integer from 1 to 36 or {rating: true}.`);
}

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
    id: "core-ability-grant",
    version: 1,
    role: "EFFECT",
    label: "Grant a core ability",
    description: "Gives the target a core rulebook ability such as Scouts, Deep Strike, Firing Deck, or Benefit of Cover, with its datasheet rating when the ability carries one.",
    starter: { subject: "this-unit", ability: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "ability"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        ability: { enum: CORE_ABILITY_GRANT_IDS },
        value: { anyOf: [{ type: "integer", minimum: 1, maximum: 36 }, abilityRatingSchema], "x-only-when": { ability: VALUED_ABILITY_GRANTS } },
      },
      additionalProperties: false,
    },
  },
  {
    id: "keyword-grant",
    version: 1,
    role: "EFFECT",
    label: "Grant unit keywords",
    description: "Gives the target unit keywords, optionally naming which keywords they replace.",
    starter: { subject: "this-unit", keywords: [] },
    parameterSchema: {
      type: "object",
      required: ["subject", "keywords"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        keywords: { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 1, uniqueItems: true },
        replaces: { type: "array", items: { type: "string", pattern: UNIT_KEYWORD.source }, minItems: 1, uniqueItems: true },
      },
      additionalProperties: false,
    },
  },
  {
    id: "weapon-grant",
    version: 1,
    role: "EFFECT",
    label: "Equip a weapon",
    description: "Equips the target with a named weapon, optionally more than one copy of it.",
    starter: { subject: "this-unit", weapon_id: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "weapon_id"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        weapon_id: { type: "string", pattern: ENTITY_ID.source },
        count: { type: "integer", minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "ability-activate",
    version: 1,
    role: "EFFECT",
    label: "Activate an ability now",
    description: "Makes a named ability resolve now, or activates one of its options, in addition to any already active. exclusive: only that option is active.",
    starter: { subject: "this-unit", ability: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "ability"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        ability: { type: "string", pattern: ENTITY_ID.source },
        option: { type: "string", minLength: 1 },
        exclusive: { const: true },
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
    case "core-ability-grant": {
      const ability = enumValue(input.ability, CORE_ABILITY_GRANT_IDS, "core-ability-grant.ability");
      const valued = (VALUED_ABILITY_GRANTS as readonly string[]).includes(ability);
      exactKeys(input, valued ? ["subject", "ability", "value"] : ["subject", "ability"], family);
      return {
        subject: enumValue(input.subject, BUFF_SUBJECTS, "core-ability-grant.subject"),
        ability,
        ...(valued ? { value: abilityGrantValue(input.value, "core-ability-grant.value") } : {}),
      };
    }
    case "keyword-grant": {
      const keys = Object.keys(input);
      if (!Object.hasOwn(input, "subject") || !Object.hasOwn(input, "keywords") || !keys.every((key) => key === "subject" || key === "keywords" || key === "replaces")) {
        throw new TypeError("keyword-grant parameters must contain subject and keywords, and optional replaces only.");
      }
      return {
        subject: enumValue(input.subject, BUFF_SUBJECTS, "keyword-grant.subject"),
        keywords: unitKeywordArray(input.keywords, "keyword-grant.keywords"),
        ...(Object.hasOwn(input, "replaces") ? { replaces: unitKeywordArray(input.replaces, "keyword-grant.replaces") } : {}),
      };
    }
    case "weapon-grant": {
      const keys = Object.keys(input);
      if (!Object.hasOwn(input, "subject") || !Object.hasOwn(input, "weapon_id") || !keys.every((key) => key === "subject" || key === "weapon_id" || key === "count")) {
        throw new TypeError("weapon-grant parameters must contain subject and weapon_id, and optional count only.");
      }
      return {
        subject: enumValue(input.subject, BUFF_SUBJECTS, "weapon-grant.subject"),
        weapon_id: entityId(input.weapon_id, "weapon-grant.weapon_id"),
        ...(Object.hasOwn(input, "count") ? { count: boundedInteger(input.count, 1, 10, "weapon-grant.count") } : {}),
      };
    }
    case "ability-activate": {
      const keys = Object.keys(input);
      if (!Object.hasOwn(input, "subject") || !Object.hasOwn(input, "ability") || !keys.every((key) => key === "subject" || key === "ability" || key === "option" || key === "exclusive")) {
        throw new TypeError("ability-activate parameters must contain subject and ability, and optional option/exclusive only.");
      }
      if (Object.hasOwn(input, "exclusive") && !Object.hasOwn(input, "option")) {
        throw new TypeError("ability-activate.exclusive requires option: only one option can be exclusively active.");
      }
      return {
        subject: enumValue(input.subject, BUFF_SUBJECTS, "ability-activate.subject"),
        ability: entityId(input.ability, "ability-activate.ability"),
        ...(Object.hasOwn(input, "option") ? { option: nonEmptyString(input.option, "ability-activate.option") } : {}),
        ...(Object.hasOwn(input, "exclusive") ? { exclusive: constTrue(input.exclusive, "ability-activate.exclusive") } : {}),
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