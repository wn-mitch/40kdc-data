import { boundedInteger, enumSet, enumValue, exactKeys, integerOrSource } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Params, ANTECEDENT, WEAPON_TYPES, WEAPON_KEYWORDS, DICE, DICE_SCHEMA, MODEL_KEYWORDS_SCHEMA,
  WEAPON_NAMES_SCHEMA, isObject, strings, modelKeywordList, weaponNameList,
} from "./buffs-and-weapons-shared.js";

/** Characteristic changes: set, amount, floor and modifier. */

/** Characteristics a setter names, in setter order. */
const SET_CHARACTERISTICS = ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"] as const;
const MODEL_CHARACTERISTICS = ["M", "T", "Sv", "W", "Ld", "OC"] as const;
/** The only characteristics a change can limit to melee or ranged weapons. */
const WEAPON_CHARACTERISTICS: readonly string[] = ["A", "WS", "BS", "S", "AP", "D"];
const FLOOR_CHARACTERISTICS = [...MODEL_CHARACTERISTICS, ...WEAPON_CHARACTERISTICS];
/** A modifier's characteristics in canonical order; Range is listed apart, as a weapon characteristic. */
const MODIFIER_CHARACTERISTICS = [...FLOOR_CHARACTERISTICS, "detection-range"];
const PSYKER_LEVEL = "psyker-level";
const SOURCE_SCHEMA = { type: "object", required: ["source"], properties: { source: { type: "string", minLength: 1 } }, additionalProperties: false };

function refuseWith(input: Params, keys: readonly string[], label: string): void {
  for (const key of keys) if (key in input) throw new TypeError(`${label} cannot combine with ${key}.`);
}
/** A printed weapon name as a characteristic change carries it: trimmed and lower case. */
function loweredWeaponName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label}.weapon_name is the weapon's name as its datasheet prints it.`);
  return value.trim().toLowerCase();
}

/** One setter: a characteristic and its value, with an optional subject, weapon type and weapon name. */
function oneSetter(input: Params, diceValue: boolean): Params {
  const { weapon_name: name, ...rest } = input;
  exactKeys(rest, ["characteristic", "value", ...(rest.subject !== undefined ? ["subject"] : []), ...(rest.weapon_type !== undefined ? ["weapon_type"] : [])], "characteristic-set");
  const characteristic = enumValue(rest.characteristic, [...SET_CHARACTERISTICS, PSYKER_LEVEL], "characteristic-set.characteristic");
  const weaponType = rest.weapon_type !== undefined ? enumValue(rest.weapon_type, WEAPON_TYPES, "characteristic-set.weapon_type") : undefined;
  if (weaponType !== undefined && weaponType !== "all" && !WEAPON_CHARACTERISTICS.includes(characteristic)) {
    throw new TypeError("characteristic-set: only weapon characteristics (A, WS, BS, S, AP, D) can be limited to melee or ranged weapons.");
  }
  const result: Params = {
    ...(rest.subject === undefined ? {} : { subject: enumValue(rest.subject, ["this-model", "this-unit", "selected-unit"], "characteristic-set.subject") }),
    characteristic,
    value: diceValue ? rest.value : integerOrSource(rest.value, "characteristic-set.value"),
    ...(weaponType !== undefined ? { weapon_type: weaponType } : {}),
  };
  if ("weapon_name" in input) {
    if (weaponType === undefined || weaponType === "all") throw new TypeError("characteristic-set.weapon_name names a melee or ranged weapon; give that weapon_type.");
    result.weapon_name = loweredWeaponName(name, "characteristic-set");
  }
  return result;
}

const isPsykerItem = (item: unknown): boolean => isObject(item) && item.characteristic === PSYKER_LEVEL;

function normalizeCharacteristicSet(input: Params): Params {
  const { excluded_model_keywords: excludedInput, weapon_keyword: keyword, ...rest } = input;
  let excluded: string[] | undefined;
  if ("excluded_model_keywords" in input) {
    if (input.subject === "this-model" || input.subject === "attack") throw new TypeError(`characteristic-set.excluded_model_keywords picks models of a unit; its subject cannot be ${String(input.subject)}.`);
    excluded = modelKeywordList(excludedInput, "characteristic-set.excluded_model_keywords");
  }
  const dice = typeof input.value === "string";
  if (dice) {
    if (!DICE.test(input.value as string)) throw new TypeError("characteristic-set.value must be an integer, {source}, or a dice string such as D3+3.");
    if (!["A", "S", "D"].includes(String(input.characteristic))) throw new TypeError("characteristic-set: only A, S and D take a dice value.");
  }
  if ("weapon_keyword" in input) {
    refuseWith(input, ["weapon_name", "values"], "characteristic-set.weapon_keyword");
    if (input.weapon_type === undefined) throw new TypeError("characteristic-set.weapon_keyword needs weapon_type (all is allowed).");
    if (!WEAPON_CHARACTERISTICS.includes(String(input.characteristic))) throw new TypeError("characteristic-set.weapon_keyword selects weapons, so it sets a weapon characteristic.");
  }
  // The attack's weapon is checked as this unit's: nothing below distinguishes them.
  const attack = rest.subject === "attack";
  if (attack) rest.subject = "this-unit";
  const values = rest.values;
  if ((Array.isArray(values) && values.some(isPsykerItem)) || rest.characteristic === PSYKER_LEVEL) {
    if (rest.subject !== "this-model") throw new TypeError("characteristic-set psyker-level needs subject this-model: the psyker level belongs to the model.");
    if (rest.weapon_type !== undefined && rest.weapon_type !== "all") throw new TypeError("characteristic-set psyker-level is not a weapon characteristic; it takes no weapon_type.");
    if (rest.weapon_name !== undefined) throw new TypeError("characteristic-set psyker-level is not a weapon characteristic; it takes no weapon_name.");
  }
  let result: Params;
  if (values === undefined) {
    result = oneSetter(rest, dice);
  } else {
    const { values: _values, ...shared } = rest;
    if (!Array.isArray(values) || values.length < 2) throw new TypeError("characteristic-set.values lists two or more characteristics.");
    if (shared.characteristic !== undefined || shared.value !== undefined) throw new TypeError("characteristic-set.values replaces characteristic and value.");
    // Each pair names only characteristic and value, and is checked with the shared keys.
    const checked = values.map((item) => {
      if (!isObject(item)) throw new TypeError("characteristic-set.values items are {characteristic, value} objects.");
      exactKeys(item, ["characteristic", "value"], "characteristic-set.values item");
      return oneSetter({ ...shared, ...item }, false);
    });
    const items = checked.map(({ characteristic, value }) => ({ characteristic, value }));
    const { characteristic: _c, value: _v, ...common } = checked[0]!;
    result = { ...common, values: items };
  }
  if (attack) result.subject = "attack";
  if (keyword !== undefined || "weapon_keyword" in input) result.weapon_keyword = enumValue(keyword, WEAPON_KEYWORDS, "characteristic-set.weapon_keyword");
  if (excluded) result.excluded_model_keywords = excluded;
  return result;
}

function normalizeCharacteristicAmount(input: Params): Params {
  exactKeys(input, ["value"], "characteristic-amount");
  const { value } = input;
  if (typeof value === "string") {
    const dice = value.trim().toUpperCase();
    if (!DICE.test(dice)) throw new TypeError("characteristic-amount.value is a whole number from 1, or a dice amount (D3, D6, D6+1).");
    return { value: dice };
  }
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError("characteristic-amount.value is a whole number from 1, or a dice amount (D3, D6, D6+1).");
  return { value };
}

function normalizeCharacteristicFloor(input: Params): Params {
  exactKeys(input, ["characteristics", "minimum"], "characteristic-floor");
  return {
    characteristics: enumSet(input.characteristics, FLOOR_CHARACTERISTICS, "characteristic-floor.characteristics"),
    minimum: boundedInteger(input.minimum, 0, 20, "characteristic-floor.minimum"),
  };
}

const MODIFIER_SUBJECTS = ["this-unit", "this-model", "attack", "selected-unit", ANTECEDENT, "event-subject", "bearer-transport", "target", "army-models"];
const AMOUNT_OPERATIONS = ["add", "subtract", "improve", "worsen"];
const MODIFIER_KEYS = [
  "subject", "characteristics", "operation", "value", "weapon_type", "weapon_keyword", "weapon_name", "model_keywords",
  "minimum", "weapon", "weapon_names", "excluded_model_keywords",
];

/** characteristic-modifier: the change's characteristics, operation and amount, with its recipient and weapon scope. */
function normalizeCharacteristicModifier(input: Params): Params {
  const family = "characteristic-modifier";
  for (const key of Object.keys(input)) if (!MODIFIER_KEYS.includes(key)) throw new TypeError(`${family} parameters must be one of: ${MODIFIER_KEYS.join(", ")}.`);
  if (!("characteristics" in input) || !("operation" in input)) throw new TypeError(`${family} parameters must include characteristics and operation.`);
  const has = (key: string) => key in input;
  const subject = has("subject") ? enumValue(input.subject, MODIFIER_SUBJECTS, `${family}.subject`) : undefined;
  const weaponType = has("weapon_type") ? enumValue(input.weapon_type, WEAPON_TYPES, `${family}.weapon_type`) : undefined;
  const result: Params = { ...(subject !== undefined ? { subject } : {}) };

  // Characteristics: Range is a weapon characteristic listed apart, and never beside Strength.
  if (!Array.isArray(input.characteristics)) throw new TypeError(`${family}.characteristics must list at least one of ${MODIFIER_CHARACTERISTICS.join(", ")}.`);
  const listed = input.characteristics as unknown[];
  const range = listed.includes("Range");
  if (range && listed.includes("S")) throw new TypeError(`${family} lists Range with Strength; split them.`);
  const characteristics = enumSet(listed.map((item) => (item === "Range" ? "S" : item)), MODIFIER_CHARACTERISTICS, `${family}.characteristics`);
  result.characteristics = range ? characteristics.map((item) => (item === "S" ? "Range" : item)).sort() : characteristics;
  const weaponOnly = characteristics.every((item) => WEAPON_CHARACTERISTICS.includes(item));

  // Operation and amount.
  const operation = enumValue(input.operation, [...AMOUNT_OPERATIONS, "halve", "multiply"], `${family}.operation`);
  result.operation = operation;
  if (operation === "halve") {
    if (input.value !== undefined) throw new TypeError(`${family} halve takes no value.`);
  } else if (operation === "multiply") {
    if (!Number.isInteger(input.value) || (input.value as number) < 2 || (input.value as number) > 4) throw new TypeError(`${family} multiply needs a whole factor from 2 to 4.`);
    result.value = input.value;
  } else if (typeof input.value === "string") {
    const dice = input.value.trim().toUpperCase();
    if (!DICE.test(dice)) throw new TypeError(`${family}.value is a whole number or a dice amount (D3, D6, D3+1, 2D6).`);
    result.value = dice;
  } else if (input.value !== undefined) {
    result.value = boundedInteger(input.value, 1, Number.MAX_SAFE_INTEGER, `${family}.value`);
  }
  if (input.minimum !== undefined) {
    if (!Number.isInteger(input.minimum) || (input.minimum as number) < 0 || (input.minimum as number) > 20) throw new TypeError(`${family}.minimum must be an integer from 0 to 20.`);
    if (operation !== "subtract" && operation !== "worsen") throw new TypeError(`${family}.minimum floors only a subtract or worsen.`);
    result.minimum = input.minimum;
  }

  // Weapon scope: a type, then at most one way of naming weapons.
  if (input.weapon !== undefined && input.weapon !== ANTECEDENT && input.weapon !== "earlier-named") throw new TypeError(`${family}.weapon is antecedent, earlier-named or absent.`);
  if (input.weapon === "earlier-named") refuseWith(input, ["weapon_name", "weapon_names", "weapon_keyword"], `${family}.weapon earlier-named`);
  if (has("weapon_names")) refuseWith(input, ["weapon_name", "weapon_keyword", "weapon"], `${family}.weapon_names`);
  const boundWeapon = input.weapon === ANTECEDENT && weaponType === undefined;
  if (input.weapon === ANTECEDENT || has("weapon_names") || input.weapon === "earlier-named") {
    // The bound weapon is one weapon; the counted weapons are melee or ranged; names and earlier-named need a type.
    if (input.weapon === ANTECEDENT) refuseWith(input, ["weapon_name", "weapon_keyword"], `${family}.weapon antecedent`);
    if (input.weapon === ANTECEDENT && weaponType === "all") throw new TypeError(`${family}.weapon antecedent needs a melee or ranged weapon_type.`);
    if (input.weapon !== ANTECEDENT && weaponType === undefined) throw new TypeError(`${family}.${has("weapon_names") ? "weapon_names" : "weapon earlier-named"} needs weapon_type (all is allowed).`);
  }
  if (boundWeapon) {
    if (subject !== undefined && subject !== "this-model") throw new TypeError(`${family}.weapon antecedent belongs to this-model, the model that made the selection.`);
    if (!weaponOnly || range) throw new TypeError(`${family}.weapon antecedent changes weapon characteristics only (A, WS, BS, S, AP, D).`);
  }
  if (weaponType !== undefined) {
    if (weaponType !== "all" && !weaponOnly) throw new TypeError(`${family}: only weapon characteristics (A, WS, BS, S, AP, D) can be limited to melee or ranged weapons.`);
    // An attack is already melee or ranged by its attack leaf.
    if (subject === "attack" && weaponType !== "all") throw new TypeError(`${family}: the attack's own leaf says melee or ranged; use weapon type all.`);
    result.weapon_type = weaponType;
  }
  if (has("weapon_keyword")) {
    if (weaponType === undefined) throw new TypeError(`${family}.weapon_keyword limits a weapon characteristic; give weapon_type too.`);
    result.weapon_keyword = enumValue(input.weapon_keyword, WEAPON_KEYWORDS, `${family}.weapon_keyword`);
  }
  if (has("weapon_name")) {
    if (weaponType === undefined || weaponType === "all") throw new TypeError(`${family}.weapon_name names a melee or ranged weapon; give that weapon_type.`);
    result.weapon_name = loweredWeaponName(input.weapon_name, family);
  }
  if (input.weapon !== undefined) result.weapon = input.weapon;
  if (has("weapon_names")) result.weapon_names = weaponNameList(input.weapon_names, `${family}.weapon_names`);

  // Which of the subject's models: only a unit has models to pick from.
  for (const key of ["model_keywords", "excluded_model_keywords"]) {
    if (!has(key)) continue;
    if (subject === "this-model" || subject === "attack") throw new TypeError(`${family}.${key} picks models of a unit; its subject cannot be ${subject}.`);
    const { excluded_model_keywords: _excluded, ...context } = input;
    result[key] = modelKeywordList(input[key], `${family}.${key}`, key === "model_keywords" ? { family, context: strings(context) } : undefined);
  }
  return result;
}

export const CHARACTERISTIC_CHANGES_FAMILIES: readonly FlatFamily[] = [
  {
    id: "characteristic-set",
    version: 10,
    role: "EFFECT",
    label: "Set a characteristic",
    description: "Sets a model, unit, or weapon characteristic to a source-specified value without guessing its recipient or weapon scope. Reviewed subject and weapon_type bindings can accompany a qualified setter; subject attack is the weapon making the attack, whoever makes it (the attacker of an incoming attack, else this unit's attacks). "
      + "weapon_name: the change applies to that one weapon. values: two or more {characteristic, value} pairs set together (\"has a Move characteristic of 7\\\" and a Save characteristic of 3+\") in place of characteristic and value. "
      + "psyker-level as a characteristic sets the model's psyker level (\"has psyker level 2\"); it needs subject this-model and takes no weapon_type or weapon_name, and in a values list it can sit beside other characteristics that share the subject. "
      + "weapon_keyword: the set applies to the weapons that print this weapon ability (\"the Attacks characteristic of Torrent weapons\"); it needs weapon_type (all is allowed) and a weapon characteristic, and takes no weapon_name or values. "
      + "A dice string value (\"D3+3\") is allowed for the characteristics A, S and D. excluded_model_keywords: the set value skips the subject's models with any listed keyword (\"models (excluding CHARACTERS) in your unit\").",
    starter: { characteristic: "", value: null },
    parameterSchema: {
      type: "object",
      required: [],
      properties: {
        subject: { enum: ["this-model", "this-unit", "selected-unit", "attack"] },
        characteristic: { enum: [...SET_CHARACTERISTICS, PSYKER_LEVEL] },
        value: { anyOf: [{ type: "integer" }, SOURCE_SCHEMA, DICE_SCHEMA] },
        weapon_type: { enum: WEAPON_TYPES },
        weapon_name: { type: "string", minLength: 1, "x-optional": true },
        values: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            required: ["characteristic", "value"],
            properties: { characteristic: { enum: [...SET_CHARACTERISTICS, PSYKER_LEVEL] }, value: { anyOf: [{ type: "integer" }, SOURCE_SCHEMA] } },
            additionalProperties: false,
          },
          "x-optional": true,
        },
        weapon_keyword: { enum: WEAPON_KEYWORDS, "x-optional": true },
        excluded_model_keywords: MODEL_KEYWORDS_SCHEMA,
      },
      additionalProperties: false,
    },
    normalize: normalizeCharacteristicSet,
  },
  {
    id: "characteristic-amount",
    version: 1,
    role: "CONDITION",
    label: "Amount of a characteristic change",
    description: "\"by 2\" or \"by D6+1\" after a characteristic change that has no amount and a recipient filter before this leaf: the amount the change applies. Takes the same amount types as a characteristic change: a whole number from 1, or a dice amount (D3, D6, D6+1). The binder sets it on the change and drops this leaf.",
    starter: { value: 1 },
    parameterSchema: {
      type: "object",
      required: ["value"],
      properties: { value: { anyOf: [{ type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, DICE_SCHEMA] } },
      additionalProperties: false,
    },
    normalize: normalizeCharacteristicAmount,
  },
  {
    id: "characteristic-floor",
    version: 2,
    role: "CONDITION",
    label: "Floor on a lowered characteristic",
    description: "\"(this rule can only worsen a model's Objective Control characteristic to a minimum of 1)\": the characteristic change right before this leaf never lowers these characteristics below minimum. It names one or more of the change's own characteristics; the others it lowers keep no floor. Only for a subtract or worsen, or as a cap on an improved roll-target characteristic (Save, Weapon Skill, Ballistic Skill, Leadership): \"(this cannot improve a model's Save to better than 3+)\" is characteristics [Sv], minimum 3, after a change that improves those characteristics. The binder sets the floor on the change and drops this leaf.",
    starter: { characteristics: [], minimum: 1 },
    parameterSchema: {
      type: "object",
      required: ["characteristics", "minimum"],
      properties: {
        characteristics: { type: "array", minItems: 1, uniqueItems: true, items: { enum: FLOOR_CHARACTERISTICS } },
        minimum: { type: "integer", minimum: 0, maximum: 20 },
      },
      additionalProperties: false,
    },
    normalize: normalizeCharacteristicFloor,
  },
  {
    id: "characteristic-modifier",
    version: 21,
    role: "EFFECT",
    label: "Change characteristics",
    description: "A stat adjustment records the characteristics, operation and amount without guessing its recipient or weapon scope. Signed shorthand bonuses improve the named stat; penalties worsen it. Reviewed subject and weapon_type bindings can accompany a qualified leaf. Setting a value is a different leaf. "
      + "subject can be antecedent (the unit an earlier leaf of the record introduced, bound when the record compiles), event-subject (the triggering unit), bearer-transport (the Transport the model is embarked within), target (the attack's target unit, which the DSL names as the defender), or army-models (every model from your army, narrowed by model_keywords and excluded_model_keywords: \"equipped by WYCH CULT models from your army by 1\", in one leaf that spans the whole change). "
      + "Characteristics include detection range and the Range of weapons. The amount is a whole number or a dice amount (D3, D6, D3+1, 2D6); for add, subtract, improve and worsen it is optional, and a change without one takes its amount from a characteristic-amount leaf after its recipient. halve takes no value; multiply takes the factor (2 to 4) as value. "
      + "minimum: a lowered characteristic never goes below this value (\"(to a minimum of 1)\"), only for subtract or worsen. "
      + "weapon_keyword: the change applies only to weapons with that ability (Torrent, Rapid Fire, Psychic …). weapon_name: the change applies to that one weapon (needs a melee or ranged weapon_type). weapon_names: two to eight printed weapon names (\"of X and Y\"), with weapon_type (all is allowed). "
      + "weapon antecedent with a melee or ranged weapon_type: the weapons an earlier equipped-weapon-count condition counted, excluding its named weapon. weapon antecedent without weapon_type: the one weapon an earlier select-weapon bound; only weapon characteristics (A, WS, BS, S, AP, D) and only this-model take it. "
      + "weapon earlier-named (\"those weapons\"): the weapons the earlier named weapon leaves of this ability name, bound before compilation; it needs weapon_type (all is allowed). A weapon antecedent or earlier-named names no weapon_name, weapon_names or weapon_keyword. "
      + "model_keywords: only the subject's models with every listed keyword; a keyword can start with an apostrophe as the rules print it ('ARDMOB). excluded_model_keywords: the change skips the subject's models with any listed keyword (\"models (excluding CHARACTERS) in your unit\").",
    starter: { characteristics: [], operation: "", value: null },
    parameterSchema: {
      type: "object",
      required: ["characteristics", "operation"],
      properties: {
        subject: { enum: MODIFIER_SUBJECTS },
        characteristics: { type: "array", items: { enum: [...MODIFIER_CHARACTERISTICS, "Range"] }, minItems: 1, uniqueItems: true },
        operation: { enum: [...AMOUNT_OPERATIONS, "halve", "multiply"] },
        value: { anyOf: [{ type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, DICE_SCHEMA], "x-optional": true },
        weapon_type: { enum: WEAPON_TYPES },
        weapon_keyword: { enum: WEAPON_KEYWORDS, "x-optional": true },
        weapon_name: { type: "string", minLength: 1, "x-optional": true },
        model_keywords: MODEL_KEYWORDS_SCHEMA,
        minimum: { type: "integer", minimum: 0, maximum: 20, "x-optional": true },
        weapon: { enum: [ANTECEDENT, "earlier-named"], "x-optional": true },
        weapon_names: WEAPON_NAMES_SCHEMA,
        excluded_model_keywords: MODEL_KEYWORDS_SCHEMA,
      },
      additionalProperties: false,
    },
    normalize: normalizeCharacteristicModifier,
  },
];
