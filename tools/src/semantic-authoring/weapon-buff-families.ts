import type { SemanticFamilyDefinition } from "./contracts.js";
import { enumValue, exactKeys } from "./family-validation.js";
import {
  BUFF_SUBJECTS, constTrue, nonEmptyString, parameterizedWeaponKeyword, SUBJECTS_WITH_BEARER, WEAPON_TYPES, weaponGrantKeywords,
} from "./buff-families.js";
import { WAVE9_KEYWORDS } from "./families/weapon-keywords.js";

/**
 * Weapon abilities a weapon can lose ("Do not have [Heavy]"): every grantable value-less keyword, plus the
 * wave-9 Close-quarters. Rated forms (Sustained Hits 1, Melta 2) are not here, so a removal of one is refused.
 */
export const WEAPON_REMOVAL_KEYWORDS: readonly string[] = [...weaponGrantKeywords, ...WAVE9_KEYWORDS];

/**
 * `weapon-ability-grant` (and its keyword leaf) on its own file: at five versions plus its normalizer, it would push
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
    deprecated: true,
  },
  {
    id: "weapon-ability-grant",
    version: 5,
    role: "EFFECT",
    label: "Give weapons an ability",
    description: "As version 4, but the keyword can be left out: then the leaf is the frame (\"ranged weapons equipped by models in this unit have the\") and the weapon-ability-keyword leaves of its sentence (or, for \"the selected ability\", the nearest earlier ones) say which abilities. Keywords joined by \"and\" are all granted; joined by \"or\" or listed as bullets, one is chosen.",
    starter: { subject: "this-unit", weapon_type: "all" },
    parameterSchema: {
      type: "object",
      required: ["subject", "weapon_type"],
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
  {
    id: "weapon-ability-removal",
    version: 1,
    role: "EFFECT",
    label: "Weapons lose an ability",
    description: "The weapons in the scope of the weapon-property-scope before it lose one named weapon ability (\"Do not have [Heavy]\"). Not a unit keyword, and not a rated ability.",
    starter: { keyword: "" },
    parameterSchema: {
      type: "object",
      required: ["keyword"],
      properties: { keyword: { enum: WEAPON_REMOVAL_KEYWORDS } },
      additionalProperties: false,
    },
  },
  {
    id: "weapon-property-scope",
    version: 1,
    role: "CONDITION",
    label: "Whose attacks and which weapons",
    description: "A property prefix identifies the recipient and weapon scope without granting anything itself. The following weapon-ability name or characteristic adjustment supplies the property.",
    starter: { subject: "", weapon_type: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "weapon_type"],
      properties: {
        subject: { enum: ["this-unit", "this-model", "selected-unit"] },
        weapon_type: { enum: WEAPON_TYPES },
      },
      additionalProperties: false,
    },
  },
  {
    id: "weapon-ability-keyword",
    version: 1,
    role: "EFFECT",
    label: "A weapon ability",
    description: "One named weapon ability (\"Sustained Hits 1\") whose recipient and weapons come from a property-scope or weapon-grant frame. A colon-qualified target restriction is a separate condition.",
    starter: { keyword: "" },
    parameterSchema: {
      type: "object",
      required: ["keyword"],
      properties: { keyword: { anyOf: [{ enum: weaponGrantKeywords }, { type: "string", pattern: parameterizedWeaponKeyword.source }] } },
      additionalProperties: false,
    },
  },
];

/** A named weapon ability, or a parameterized one such as Sustained Hits 2. */
function validKeyword(keyword: unknown): string {
  if (typeof keyword !== "string" || !((weaponGrantKeywords as readonly string[]).includes(keyword) || parameterizedWeaponKeyword.test(keyword))) {
    throw new TypeError(`weapon-ability-grant.keyword must be a named weapon ability such as Lethal Hits or Sustained Hits 1.`);
  }
  return keyword;
}

/** Validate and canonicalise weapon scopes and ability grants, or null for another family. */
export function normalizeWeaponBuffParameters(
  family: string,
  input: Record<string, unknown>,
  version: number,
): Record<string, unknown> | null {
  if (family === "weapon-property-scope") {
    exactKeys(input, ["subject", "weapon_type"], family);
    return {
      subject: enumValue(input.subject, ["this-unit", "this-model", "selected-unit"], "weapon-property-scope.subject"),
      weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, "weapon-property-scope.weapon_type"),
    };
  }
  if (family === "weapon-ability-removal") {
    exactKeys(input, ["keyword"], family);
    return { keyword: enumValue(input.keyword, WEAPON_REMOVAL_KEYWORDS, "weapon-ability-removal.keyword") };
  }
  if (family === "weapon-ability-keyword") {
    exactKeys(input, ["keyword"], family);
    return { keyword: validKeyword(input.keyword) };
  }
  if (family !== "weapon-ability-grant") return null;
  if (version === 1) {
    exactKeys(input, ["subject", "keyword"], family);
    return {
      subject: enumValue(input.subject, ["this-unit", "this-model", "bearer"], "weapon-ability-grant.subject"),
      keyword: enumValue(input.keyword, weaponGrantKeywords, "weapon-ability-grant.keyword"),
    };
  }
  if (version <= 3) {
    exactKeys(input, ["subject", "keyword", "weapon_type"], family);
    return {
      subject: enumValue(input.subject, version === 2 ? SUBJECTS_WITH_BEARER : BUFF_SUBJECTS, "weapon-ability-grant.subject"),
      keyword: validKeyword(input.keyword),
      weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, "weapon-ability-grant.weapon_type"),
    };
  }
  // Version 4 adds independent optional filters and flags; only these keys may join the base three.
  // Version 5 makes the keyword optional: without it the leaf is a frame for keyword leaves.
  const base = version >= 5 ? ["subject", "weapon_type"] : ["subject", "keyword", "weapon_type"];
  const optional = ["weapon_name", "weapon_keyword", "if_present", "incoming", ...(version >= 5 ? ["keyword"] : [])];
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
    ...(Object.hasOwn(input, "keyword") ? { keyword: validKeyword(input.keyword) } : {}),
    weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, "weapon-ability-grant.weapon_type"),
    ...(Object.hasOwn(input, "weapon_name") ? { weapon_name: nonEmptyString(input.weapon_name, "weapon-ability-grant.weapon_name") } : {}),
    ...(Object.hasOwn(input, "weapon_keyword") ? { weapon_keyword: nonEmptyString(input.weapon_keyword, "weapon-ability-grant.weapon_keyword") } : {}),
    ...(Object.hasOwn(input, "if_present") ? { if_present: enumValue(input.if_present, ["increment"], "weapon-ability-grant.if_present") } : {}),
    ...(Object.hasOwn(input, "incoming") ? { incoming: constTrue(input.incoming, "weapon-ability-grant.incoming") } : {}),
  };
}
