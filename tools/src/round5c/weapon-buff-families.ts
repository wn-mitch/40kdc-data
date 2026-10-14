import type { SemanticFamilyDefinition } from "./contracts.js";
import { enumValue, exactKeys } from "./family-validation.js";
import {
  BUFF_SUBJECTS, constTrue, nonEmptyString, parameterizedWeaponKeyword, SUBJECTS_WITH_BEARER, WEAPON_TYPES, weaponGrantKeywords,
} from "./buff-families.js";

/**
 * `weapon-ability-grant` on its own file: at four versions plus its normalizer, it would push
 * `buff-families.ts` past the line-count guideline. Split out so the family's whole history
 * (which weapons, which filters, incoming attacks) stays in one place.
 */

export const WEAPON_BUFF_FAMILIES: readonly SemanticFamilyDefinition[] = [
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
    deprecated: true,
  },
  {
    id: "weapon-ability-grant",
    version: 4,
    role: "EFFECT",
    label: "Give weapons an ability",
    description: "Weapons equipped by the specified models gain a named weapon ability, optionally only melee or only ranged, only a named weapon, or only weapons with a named weapon keyword. if_present: a weapon that already has the ability adds the ratings together. incoming: the attacking weapon gains the ability, each time an attack targets the subject.",
    starter: { subject: "this-unit", keyword: "", weapon_type: "all" },
    parameterSchema: {
      type: "object",
      required: ["subject", "keyword", "weapon_type"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        keyword: { anyOf: [{ enum: weaponGrantKeywords }, { type: "string", pattern: parameterizedWeaponKeyword.source }] },
        weapon_type: { enum: WEAPON_TYPES },
        weapon_name: { type: "string", minLength: 1 },
        weapon_keyword: { type: "string", minLength: 1 },
        if_present: { enum: ["increment"] },
        incoming: { const: true },
      },
      additionalProperties: false,
    },
  },
];

/** Validate and canonicalise parameters for weapon-ability-grant, or null when the family is not it. */
export function normalizeWeaponBuffParameters(
  family: string,
  input: Record<string, unknown>,
  version: number,
): Record<string, unknown> | null {
  if (family !== "weapon-ability-grant") return null;
  if (version === 1) {
    exactKeys(input, ["subject", "keyword"], family);
    return {
      subject: enumValue(input.subject, ["this-unit", "this-model", "bearer"], "weapon-ability-grant.subject"),
      keyword: enumValue(input.keyword, weaponGrantKeywords, "weapon-ability-grant.keyword"),
    };
  }
  const validKeyword = (keyword: unknown): string => {
    if (typeof keyword !== "string" || !((weaponGrantKeywords as readonly string[]).includes(keyword) || parameterizedWeaponKeyword.test(keyword))) {
      throw new TypeError(`weapon-ability-grant.keyword must be a named weapon ability such as Lethal Hits or Sustained Hits 1.`);
    }
    return keyword;
  };
  if (version <= 3) {
    exactKeys(input, ["subject", "keyword", "weapon_type"], family);
    return {
      subject: enumValue(input.subject, version === 2 ? SUBJECTS_WITH_BEARER : BUFF_SUBJECTS, "weapon-ability-grant.subject"),
      keyword: validKeyword(input.keyword),
      weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, "weapon-ability-grant.weapon_type"),
    };
  }
  // Version 4 adds independent optional filters and flags; only these keys may join the base three.
  const base = ["subject", "keyword", "weapon_type"];
  const optional = ["weapon_name", "weapon_keyword", "if_present", "incoming"];
  const keys = Object.keys(input);
  if (!base.every((key) => keys.includes(key)) || !keys.every((key) => base.includes(key) || optional.includes(key))) {
    throw new TypeError(`weapon-ability-grant parameters must contain ${base.join(", ")}, and optional ${optional.join(", ")} only.`);
  }
  if (Object.hasOwn(input, "weapon_name") && Object.hasOwn(input, "weapon_keyword")) {
    throw new TypeError("weapon-ability-grant cannot filter by both weapon_name and weapon_keyword.");
  }
  if (Object.hasOwn(input, "incoming") && (Object.hasOwn(input, "weapon_name") || Object.hasOwn(input, "weapon_keyword"))) {
    throw new TypeError("weapon-ability-grant.incoming names the attacking weapon; weapon_name and weapon_keyword have no text there.");
  }
  return {
    subject: enumValue(input.subject, BUFF_SUBJECTS, "weapon-ability-grant.subject"),
    keyword: validKeyword(input.keyword),
    weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, "weapon-ability-grant.weapon_type"),
    ...(Object.hasOwn(input, "weapon_name") ? { weapon_name: nonEmptyString(input.weapon_name, "weapon-ability-grant.weapon_name") } : {}),
    ...(Object.hasOwn(input, "weapon_keyword") ? { weapon_keyword: nonEmptyString(input.weapon_keyword, "weapon-ability-grant.weapon_keyword") } : {}),
    ...(Object.hasOwn(input, "if_present") ? { if_present: enumValue(input.if_present, ["increment"], "weapon-ability-grant.if_present") } : {}),
    ...(Object.hasOwn(input, "incoming") ? { incoming: constTrue(input.incoming, "weapon-ability-grant.incoming") } : {}),
  };
}
