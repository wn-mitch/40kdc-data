import { boundedInteger, enumSet, enumValue, exactKeys } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Params, ANTECEDENT, UNIT_SUBJECTS, WEAPON_TYPES, WEAPON_KEYWORDS, ENTITY_ID, ENTITY_ID_SCHEMA,
  WEAPON_NAMES_SCHEMA, isObject, nonEmptyString, constTrue, weaponNameList,
} from "./buffs-and-weapons-shared.js";

/** Weapon grants, weapon abilities and their scopes and conditions, named weapons, wargear and equipped weapon counts. */

/** Value-less weapon abilities a weapon can gain or lose. */
const GRANT_KEYWORDS = [
  "Devastating Wounds", "Lethal Hits", "Twin-linked", "Assault", "Heavy", "Pistol", "Torrent", "Blast",
  "Ignores Cover", "Precision", "Hazardous", "Indirect Fire", "Extra Attacks", "Psychic", "One Shot", "Lance", "Close-quarters",
];
/** The keywords a scope selects weapons by: those both a removal and a characteristic change name. */
const SCOPE_WEAPON_KEYWORDS = WEAPON_KEYWORDS.filter((keyword) => GRANT_KEYWORDS.includes(keyword));
const RATED_KEYWORD = /^(?:(?:Sustained Hits|Rapid Fire|Melta) (?:[1-9]|D3|D6)|Anti-[A-Z][A-Za-z -]*[A-Za-z] [2-6]\+)$/u;
const CLEAVE_OR_ANTI_LIST = /^(?:Cleave [1-9]|Anti-[A-Z][A-Za-z -]*[A-Za-z](?:\/[A-Z][A-Za-z -]*[A-Za-z])* [2-6]\+)$/u;
const GRANT_KEYWORD_SCHEMA = { anyOf: [{ enum: GRANT_KEYWORDS }, { type: "string", pattern: RATED_KEYWORD.source }, { type: "string", pattern: CLEAVE_OR_ANTI_LIST.source }] };
const MODELS_SCHEMA = {
  type: "object",
  required: ["at_least", "state"],
  properties: { at_least: { type: "integer", minimum: 1, maximum: 30 }, state: { enum: ["carry", "lack"] } },
  additionalProperties: false,
};

/** One printed weapon name, kept as printed: non-empty, with no padding. */
function printedWeaponName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) throw new TypeError(`${label} takes one printed weapon name, with no padding.`);
  return value;
}
/** A weapon ability a weapon can gain: value-less, rated (Sustained Hits 1), Cleave N, or Anti with one or more targets. */
function grantKeyword(value: unknown, label: string): string {
  if (typeof value === "string" && (GRANT_KEYWORDS.includes(value) || RATED_KEYWORD.test(value) || CLEAVE_OR_ANTI_LIST.test(value))) return value;
  throw new TypeError(`${label} must be a named weapon ability such as Lethal Hits or Sustained Hits 1.`);
}

const negatedField = (input: Params): Params => ("negated" in input ? { negated: input.negated === true } : {});

function modelsQuantifier(value: unknown, label: string): { at_least: number; state: string } {
  if (!isObject(value)) throw new TypeError(`${label} is an object with at_least and state.`);
  exactKeys(value, ["at_least", "state"], label);
  return { at_least: boundedInteger(value.at_least, 1, 30, `${label}.at_least`), state: enumValue(value.state, ["carry", "lack"], `${label}.state`) };
}

const WEAPON_GRANT_KEYS = ["subject", "keyword", "weapon_type", "weapon_name", "weapon_keyword", "if_present", "incoming", "weapon", "frame", "exclude_weapon_keyword"];

function normalizeWeaponAbilityGrant(input: Params): Params {
  const family = "weapon-ability-grant";
  for (const key of Object.keys(input)) if (!WEAPON_GRANT_KEYS.includes(key)) throw new TypeError(`${family} parameters must be one of: ${WEAPON_GRANT_KEYS.join(", ")}.`);
  const ifPresent = "if_present" in input ? { if_present: enumValue(input.if_present, ["increment"], `${family}.if_present`) } : {};
  if ("frame" in input) {
    // A frame whose recipient and weapon type the binder copies from the nearest earlier frame or scope.
    if (input.frame !== ANTECEDENT) throw new TypeError(`${family}.frame is ${ANTECEDENT} or absent.`);
    for (const key of ["subject", "weapon_type", "keyword", "weapon", "weapon_name", "weapon_keyword", "incoming", "exclude_weapon_keyword"]) {
      if (key in input) throw new TypeError(`${family} antecedent frame cannot also name ${key}; the binder takes it from an earlier frame.`);
    }
    return { ...ifPresent, frame: ANTECEDENT };
  }
  if ("weapon" in input) {
    // The one weapon an earlier select-weapon bound.
    if (input.weapon !== ANTECEDENT) throw new TypeError(`${family}.weapon is ${ANTECEDENT} or absent.`);
    if (input.subject !== "this-model") throw new TypeError(`${family} with weapon antecedent takes subject this-model: the bound weapon is this model's.`);
    if (typeof input.keyword !== "string") throw new TypeError(`${family} with weapon antecedent names one keyword; a frame has none.`);
    if (input.weapon_type === "all") throw new TypeError(`${family} with weapon antecedent takes the bound weapon's melee or ranged type, not all.`);
    for (const key of ["weapon_name", "weapon_keyword", "incoming", "exclude_weapon_keyword"]) {
      if (key in input) throw new TypeError(`${family} with weapon antecedent cannot also name ${key}; the bound weapon is already one weapon.`);
    }
    return {
      subject: "this-model",
      keyword: grantKeyword(input.keyword, `${family}.keyword`),
      ...("weapon_type" in input ? { weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, `${family}.weapon_type`) } : {}),
      ...ifPresent,
      weapon: ANTECEDENT,
    };
  }
  if (!("subject" in input) || !("weapon_type" in input)) throw new TypeError(`${family} needs subject and weapon_type unless weapon or frame is antecedent.`);
  if ("weapon_name" in input && "weapon_keyword" in input) throw new TypeError(`${family} cannot filter by both weapon_name and weapon_keyword.`);
  if ("incoming" in input && ("weapon_name" in input || "weapon_keyword" in input)) {
    throw new TypeError(`${family}.incoming names the attacking weapon; weapon_name and weapon_keyword have no text there.`);
  }
  const result: Params = {
    subject: enumValue(input.subject, ["this-unit", "this-model", ANTECEDENT, "attack"], `${family}.subject`),
    ...("keyword" in input ? { keyword: grantKeyword(input.keyword, `${family}.keyword`) } : {}),
    weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, `${family}.weapon_type`),
    ...("weapon_name" in input ? { weapon_name: nonEmptyString(input.weapon_name, `${family}.weapon_name`) } : {}),
    ...("weapon_keyword" in input ? { weapon_keyword: nonEmptyString(input.weapon_keyword, `${family}.weapon_keyword`) } : {}),
    ...ifPresent,
    ...("incoming" in input ? { incoming: constTrue(input.incoming, `${family}.incoming`) } : {}),
  };
  if ("exclude_weapon_keyword" in input) {
    if (result.weapon_keyword === input.exclude_weapon_keyword) throw new TypeError(`${family} cannot both select and exclude one weapon keyword.`);
    result.exclude_weapon_keyword = enumValue(input.exclude_weapon_keyword, WEAPON_KEYWORDS, `${family}.exclude_weapon_keyword`);
  }
  return result;
}


function normalizeEquippedWeaponCount(input: Params): Params {
  const family = "equipped-weapon-count";
  if ("weapon_keywords" in input || "min" in input) {
    // The keyword form: at least min weapons with any listed ability between the subject's models.
    exactKeys(input, ["subject", "weapon_keywords", "min", ...("negated" in input ? ["negated"] : [])], family);
    return {
      subject: enumValue(input.subject, ["this-unit", "this-model"], `${family}.subject`),
      weapon_keywords: enumSet(input.weapon_keywords, WEAPON_KEYWORDS, `${family}.weapon_keywords`),
      min: boundedInteger(input.min, 1, 12, `${family}.min`),
      ...negatedField(input),
    };
  }
  if (input.subject === "this-unit") throw new TypeError(`${family} with subject this-unit is the keyword form; it needs weapon_keywords and min.`);
  exactKeys(input, ["subject", "weapon_type", "count", "other_than", ...("negated" in input ? ["negated"] : [])], family);
  const subject = enumValue(input.subject, ["this-model"], `${family}.subject`);
  const name = typeof input.other_than === "string" ? input.other_than.trim() : "";
  if (name.length === 0) throw new TypeError(`${family}.other_than is the printed name of the weapon it excludes.`);
  return {
    subject,
    weapon_type: enumValue(input.weapon_type, ["melee", "ranged"], `${family}.weapon_type`),
    count: boundedInteger(input.count, 1, 12, `${family}.count`),
    other_than: name,
    ...negatedField(input),
  };
}

const SCOPE_SUBJECTS = ["this-unit", "this-model", "selected-unit", ANTECEDENT, "event-subject"];

function normalizeWeaponPropertyScope(input: Params): Params {
  const family = "weapon-property-scope";
  if ("frame" in input) {
    // A scope whose recipient and weapon type the binder copies from the nearest earlier frame or scope.
    if (input.frame !== ANTECEDENT) throw new TypeError(`${family}.frame is ${ANTECEDENT} or absent.`);
    for (const key of ["subject", "weapon_type", "weapon", "weapon_keyword", "weapon_name", "incoming", "weapon_names", "exclude_weapon_name"]) {
      if (key in input) throw new TypeError(`${family} antecedent frame cannot also name ${key}; the binder takes it from an earlier frame or scope.`);
    }
    exactKeys(input, ["frame"], family);
    return { frame: ANTECEDENT };
  }
  const namings = ["weapon_keyword", "weapon_names", "weapon_name", "exclude_weapon_name", "weapon"].filter((key) => key in input);
  if (namings.length > 1) throw new TypeError(`${family}.${namings[0]} cannot combine with ${namings[1]}.`);
  if (input.weapon !== undefined) {
    // The weapon an earlier select-weapon bound: this model's, with no weapon type of its own.
    if (input.weapon !== ANTECEDENT) throw new TypeError(`${family}.weapon takes only antecedent.`);
    if ("weapon_type" in input) throw new TypeError(`${family}.weapon antecedent is the bound weapon; it takes no weapon_type.`);
    if (input.subject !== "this-model") throw new TypeError(`${family}.weapon antecedent belongs to this-model, the model that made the selection.`);
    // Keys other than the weapon-naming ones refused above are dropped, not refused.
    return { subject: "this-model", weapon: ANTECEDENT };
  }
  const named = namings[0];
  exactKeys(input, ["subject", "weapon_type", ...(named !== undefined ? [named] : [])], family);
  const result: Params = {
    subject: enumValue(input.subject, SCOPE_SUBJECTS, `${family}.subject`),
    weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, `${family}.weapon_type`),
  };
  if (named === "weapon_keyword") result.weapon_keyword = enumValue(input.weapon_keyword, SCOPE_WEAPON_KEYWORDS, `${family}.weapon_keyword`);
  if (named === "weapon_names") result.weapon_names = weaponNameList(input.weapon_names, `${family}.weapon_names`);
  if (named === "weapon_name") result.weapon_name = printedWeaponName(input.weapon_name, `${family}.weapon_name`);
  if (named === "exclude_weapon_name") result.exclude_weapon_name = printedWeaponName(input.exclude_weapon_name, `${family}.exclude_weapon_name`);
  return result;
}

function normalizeNamedWeapon(input: Params): Params {
  exactKeys(input, ["subject", "name", "count", ...["models", "negated"].filter((key) => key in input)], "named-weapon");
  const subject = enumValue(input.subject, ["this-model", "this-unit"], "named-weapon.subject");
  if (subject === "this-model" && input.models !== undefined) throw new TypeError("named-weapon this-model takes no models quantifier.");
  if (subject === "this-unit" && input.models === undefined) throw new TypeError("named-weapon this-unit needs a models quantifier.");
  // A printed weapon name, trimmed, with typographic hyphens (U+2010 to U+2012) written as ASCII.
  const name = typeof input.name === "string" ? input.name.trim().replace(/[‐-‒]/g, "-") : "";
  if (name.length === 0 || name.length > 80) throw new TypeError("named-weapon.name is the printed weapon name, 1 to 80 characters.");
  return {
    subject,
    name,
    count: boundedInteger(input.count, 1, 12, "named-weapon.count"),
    ...(input.models !== undefined ? { models: modelsQuantifier(input.models, "named-weapon.models") } : {}),
    ...negatedField(input),
  };
}

function normalizeUnitWargear(input: Params): Params {
  exactKeys(input, ["subject", "wargear", ...["models", "negated"].filter((key) => key in input)], "unit-wargear");
  const subject = enumValue(input.subject, ["this-unit"], "unit-wargear.subject");
  if (typeof input.wargear !== "string" || !ENTITY_ID.test(input.wargear)) throw new TypeError("unit-wargear.wargear is a kebab-case wargear id.");
  return {
    subject,
    wargear: input.wargear,
    ...(input.models !== undefined ? { models: modelsQuantifier(input.models, "unit-wargear.models") } : {}),
    ...negatedField(input),
  };
}

export const WEAPONS_AND_WARGEAR_FAMILIES: readonly FlatFamily[] = [
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
      properties: { subject: { enum: UNIT_SUBJECTS }, weapon_id: ENTITY_ID_SCHEMA, count: { type: "integer", minimum: 1, maximum: 10 } },
      additionalProperties: false,
    },
    normalize: (input) => {
      const keys = Object.keys(input);
      if (!Object.hasOwn(input, "subject") || !Object.hasOwn(input, "weapon_id") || !keys.every((key) => key === "subject" || key === "weapon_id" || key === "count")) {
        throw new TypeError("weapon-grant parameters must contain subject and weapon_id, and optional count only.");
      }
      if (typeof input.weapon_id !== "string" || !ENTITY_ID.test(input.weapon_id)) throw new TypeError("weapon-grant.weapon_id must be a kebab-case entity id.");
      return {
        subject: enumValue(input.subject, UNIT_SUBJECTS, "weapon-grant.subject"),
        weapon_id: input.weapon_id,
        ...(Object.hasOwn(input, "count") ? { count: boundedInteger(input.count, 1, 10, "weapon-grant.count") } : {}),
      };
    },
  },
  {
    id: "weapon-ability-grant",
    version: 11,
    role: "EFFECT",
    label: "Give weapons an ability",
    description: "Weapons equipped by the specified models gain a named weapon ability, optionally only melee or only ranged, only a named weapon, or only weapons with a named weapon keyword. This is not a unit keyword. subject can be this unit or model, antecedent (the unit an earlier leaf of the record introduced, bound when the record compiles), or attack (the weapon making the attack the ability is resolving). "
      + "The keyword can be a value-less ability, a rated one (Sustained Hits 1), Close-quarters, Cleave N, or Anti with one or more slash-separated target keywords. if_present: a weapon that already has the ability adds the ratings together. incoming: the attacking weapon gains the ability, each time an attack targets the subject. "
      + "The keyword can be left out: then the leaf is the frame (\"ranged weapons equipped by models in this unit have the\") and the weapon-ability-keyword leaves of its sentence (or, for \"the selected ability\", the nearest earlier ones) say which abilities. Keywords joined by \"and\" are all granted; joined by \"or\" or listed as bullets, one is chosen. "
      + "weapon antecedent gives the keyword to the weapon an earlier select-weapon bound (\"that weapon has the [X] ability\"): the subject is this-model and one keyword is named; weapon_type is the bound weapon's melee or ranged type and may be left out; weapon_name and weapon_keyword cannot narrow a bound weapon. "
      + "frame antecedent makes a keyword-less frame with no subject or weapon_type: the binder copies both from the nearest earlier frame or scope; it names no keyword, weapon name, weapon keyword or incoming attacks. "
      + "exclude_weapon_keyword: weapons with that ability are left out of the grant (\"excluding [ONE SHOT] weapons\"); it needs weapon_type (all is allowed) and takes no weapon or frame.",
    starter: { subject: "this-unit", weapon_type: "all" },
    parameterSchema: {
      type: "object",
      required: [],
      properties: {
        subject: { enum: ["this-unit", "this-model", ANTECEDENT, "attack"] },
        keyword: GRANT_KEYWORD_SCHEMA,
        weapon_type: { enum: WEAPON_TYPES },
        weapon_name: { type: "string", minLength: 1 },
        weapon_keyword: { type: "string", minLength: 1 },
        if_present: { enum: ["increment"] },
        incoming: { const: true },
        weapon: { enum: [ANTECEDENT], "x-optional": true },
        frame: { enum: [ANTECEDENT], "x-optional": true },
        exclude_weapon_keyword: { enum: WEAPON_KEYWORDS, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeWeaponAbilityGrant,
  },
  {
    id: "equipped-weapon-count",
    version: 2,
    role: "CONDITION",
    label: "Model is equipped with a number of weapons besides a named one",
    description: "Requires this model to carry a weapon with the given printed name, and exactly count weapons of a melee or ranged weapon type whose names differ from it (\"equipped with two melee weapons in addition to its close combat weapon\"). Or a keyword form: subject this-unit or this-model, weapon_keywords (one or more weapon abilities, any of which counts) and min, holding when the subject's models carry at least min such weapons between them (\"equipped with one or more Torrent/Melta weapons\"). The keyword form names no weapon_type, count or other_than.",
    starter: { subject: "this-model", weapon_type: "melee", count: 1, other_than: "" },
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: {
        subject: { enum: ["this-model", "this-unit"] },
        weapon_type: { enum: ["melee", "ranged"] },
        count: { type: "integer", minimum: 1, maximum: 12 },
        other_than: { type: "string", minLength: 1 },
        negated: { type: "boolean" },
        weapon_keywords: { type: "array", items: { enum: WEAPON_KEYWORDS }, minItems: 1, uniqueItems: true, "x-optional": true },
        min: { type: "integer", minimum: 1, maximum: 12, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeEquippedWeaponCount,
  },
  {
    id: "weapon-ability-removal",
    version: 1,
    role: "EFFECT",
    label: "Weapons lose an ability",
    description: "The weapons in the scope of the weapon-property-scope before it lose one named weapon ability (\"Do not have [Heavy]\"). Not a unit keyword, and not a rated ability.",
    starter: { keyword: "" },
    parameterSchema: { type: "object", required: ["keyword"], properties: { keyword: { enum: GRANT_KEYWORDS } }, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, ["keyword"], "weapon-ability-removal");
      return { keyword: enumValue(input.keyword, GRANT_KEYWORDS, "weapon-ability-removal.keyword") };
    },
  },
  {
    id: "weapon-ability-keyword",
    version: 2,
    role: "EFFECT",
    label: "A weapon ability",
    description: "One named weapon ability (\"Sustained Hits 1\") whose recipient and weapons come from a property-scope or weapon-grant frame: a value-less or rated ability, Close-quarters, Cleave N (N from 1 to 9), or Anti with one or more slash-separated target keywords (\"Anti-Monster/Vehicle 4+\", one of them). A colon-qualified target restriction is a separate condition.",
    starter: { keyword: "" },
    parameterSchema: { type: "object", required: ["keyword"], properties: { keyword: GRANT_KEYWORD_SCHEMA }, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, ["keyword"], "weapon-ability-keyword");
      return { keyword: grantKeyword(input.keyword, "weapon-ability-keyword.keyword") };
    },
  },
  {
    id: "weapon-property-scope",
    version: 9,
    role: "CONDITION",
    label: "Whose attacks and which weapons",
    description: "A property prefix identifies the recipient and weapon scope without granting anything itself. The following weapon-ability name or characteristic adjustment supplies the property. "
      + "subject can be antecedent (\"Friendly X units' melee attacks have\": the units a unit-filter right before it matches) or event-subject (the weapons are equipped by models in the unit the record's moment names: \"weapons equipped by models in the attacking unit have\"). "
      + "weapon antecedent is the weapon an earlier select-weapon bound (\"That weapon's attacks have\"): it takes subject this-model and no weapon_type, and a stat adjustment after it is the only property it can scope. "
      + "frame antecedent makes a scope with no subject or weapon_type: the binder copies both from the nearest earlier frame or scope. "
      + "Otherwise weapon_type is required, with at most one of: weapon_keyword (only weapons with that weapon ability: Blast, Torrent, Heavy …), weapon_names (two to eight printed names: \"your unit's A, B and C weapons\"), weapon_name (the weapons with one printed name: \"your unit's X weapons\", \"its X weapon\"), or exclude_weapon_name (the weapon_type's weapons except those with one printed name: \"other melee weapons\" after a clause about X weapons).",
    starter: { subject: "", weapon_type: "" },
    parameterSchema: {
      type: "object",
      required: [],
      properties: {
        subject: { enum: SCOPE_SUBJECTS },
        weapon_type: { enum: WEAPON_TYPES },
        weapon: { enum: [ANTECEDENT], "x-optional": true },
        weapon_keyword: { enum: SCOPE_WEAPON_KEYWORDS, "x-optional": true },
        frame: { enum: [ANTECEDENT], "x-optional": true },
        weapon_names: WEAPON_NAMES_SCHEMA,
        weapon_name: { type: "string", minLength: 1, "x-optional": true },
        exclude_weapon_name: { type: "string", minLength: 1, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeWeaponPropertyScope,
  },
  {
    id: "weapon-has-ability",
    version: 1,
    role: "CONDITION",
    label: "Such a weapon already has that ability",
    description: "\"If such a weapon already has that ability\": the weapons the keyword grant before it gave a keyword to, and that keyword, as the weapon prints it before this ability. granted_rating keep: a weapon that already prints the ability keeps its printed rating (the grant adds nothing to it); add: the granted rating adds to the printed one.",
    starter: { weapon: "earlier-grant", ability: "earlier-grant", granted_rating: "keep" },
    parameterSchema: {
      type: "object",
      required: ["weapon", "ability", "granted_rating"],
      properties: { weapon: { enum: ["earlier-grant"] }, ability: { enum: ["earlier-grant"] }, granted_rating: { enum: ["keep", "add"] } },
      additionalProperties: false,
    },
    normalize: (input) => {
      exactKeys(input, ["weapon", "ability", "granted_rating"], "weapon-has-ability");
      return {
        weapon: enumValue(input.weapon, ["earlier-grant"], "weapon-has-ability.weapon"),
        ability: enumValue(input.ability, ["earlier-grant"], "weapon-has-ability.ability"),
        granted_rating: enumValue(input.granted_rating, ["keep", "add"], "weapon-has-ability.granted_rating"),
      };
    },
  },
  {
    id: "weapon-ability-range",
    version: 2,
    role: "EFFECT",
    label: "Weapon ability tested at full range",
    description: "A named weapon ability (Rapid Fire) benefits its attacks when the target is within the attacking weapon's full range, not only half of it, for the units the subject names. subject can be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles.",
    starter: { subject: "this-unit", keyword: "Rapid Fire", within: "weapon" },
    parameterSchema: {
      type: "object",
      required: ["subject", "keyword", "within"],
      properties: { subject: { enum: ["this-unit", "this-model", ANTECEDENT] }, keyword: { enum: ["Rapid Fire"] }, within: { enum: ["weapon"] } },
      additionalProperties: false,
    },
    normalize: (input) => {
      exactKeys(input, ["subject", "keyword", "within"], "weapon-ability-range");
      return {
        subject: enumValue(input.subject, ["this-unit", "this-model", ANTECEDENT], "weapon-ability-range.subject"),
        keyword: enumValue(input.keyword, ["Rapid Fire"], "weapon-ability-range.keyword"),
        within: enumValue(input.within, ["weapon"], "weapon-ability-range.within"),
      };
    },
  },
  {
    id: "named-weapon",
    version: 1,
    role: "CONDITION",
    label: "Model or unit carries a weapon with a printed name in an exact number",
    description: "Holds when this model carries exactly count weapons with the printed name (subject this-model), or when at least at_least models in this unit each carry exactly count such weapons (state carry) or each carry fewer than count (state lack, count 1 meaning none). Names are printed weapon names, not wargear ids.",
    starter: { subject: "this-model", name: "", count: 1 },
    parameterSchema: {
      type: "object",
      required: ["subject", "name", "count"],
      properties: {
        subject: { enum: ["this-model", "this-unit"] },
        name: { type: "string", minLength: 1, maxLength: 80 },
        count: { type: "integer", minimum: 1, maximum: 12 },
        models: MODELS_SCHEMA,
        negated: { type: "boolean" },
      },
      additionalProperties: false,
    },
    normalize: normalizeNamedWeapon,
  },
  {
    id: "unit-wargear",
    version: 1,
    role: "CONDITION",
    label: "Unit has a wargear item, on the unit or on some of its models",
    description: "Holds when this unit has the wargear item (a wargear.json id). With models, at least at_least models in the unit carry the item (state carry) or lack it (state lack).",
    starter: { subject: "this-unit", wargear: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "wargear"],
      properties: { subject: { enum: ["this-unit"] }, wargear: ENTITY_ID_SCHEMA, models: MODELS_SCHEMA, negated: { type: "boolean" } },
      additionalProperties: false,
    },
    normalize: normalizeUnitWargear,
  },
];
