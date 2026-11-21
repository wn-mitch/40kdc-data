import { createValidator } from "../../schema-loader.js";
import { ANTECEDENT } from "../antecedent-families.js";
import { boundedInteger, enumValue } from "../family-validation.js";
import { constTrue, isObject, kebabId, nonEmptyString, type Params } from "./containers-and-abilities-shared.js";
import type { FlatFamily } from "./types.js";

/** Ability modifiers (an ability's range, uses, recipients or options) and ability record grants. */

/** A unit keyword as the DSL writes it: uppercase words, without markdown emphasis. */
const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;
/** A keyword printed with accented capitals ("KÂHL"). */
const PRINTED_KEYWORD = /^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$/u;
/** A keyword printed after one apostrophe ('ARDMOB). */
const LEADING_APOSTROPHE = /^'(?=\p{Lu})[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;

// ── Ability modifiers and grants ────────────────────────────────────────────────────────────────

const NUMERIC_ASPECTS = ["range", "uses", "targets", "selections", "concurrent", "duration", "start-round", "end-round", "threshold", "amount", "received"] as const;
const ABILITY_MODIFIER_ASPECTS = [...NUMERIC_ASPECTS, "recipients", "options"] as const;
const ABILITY_MODIFIER_OPERATIONS = ["add", "subtract", "set", "lift-limit"] as const;
const ABILITY_MODIFIER_SUBJECTS = ["this-unit", "this-model", ANTECEDENT, "filtered-units"] as const;
const USES_CAP_PERIODS = ["phase", "turn", "battle-round"] as const;
const NOT_SAME_WINDOWS = ["phase", "turn"] as const;
const FILTER_OWNERS = ["friendly", "enemy", "any"] as const;
const FILTER_LEVELS = ["unit", "model"] as const;
const EVENT_VAR = /^[a-z][a-z0-9_-]*$/u;

/** "'KÂHL" → "KÂHL": a keyword printed after an apostrophe, without it. */
const withoutApostrophe = (text: string) => LEADING_APOSTROPHE.test(text) ? text.slice(1) : text;
/** "KÂHL" → "KAHL": a keyword printed with accented capitals, without the accents. */
const withoutAccents = (text: string) => PRINTED_KEYWORD.test(text) && !/^[\x20-\x7e]*$/u.test(text) ? text.normalize("NFD").replace(/\p{M}/gu, "") : text;
/** The ASCII spelling a printed keyword is checked as: no leading apostrophe, no accents. */
const plainKeyword = (text: string) => withoutAccents(withoutApostrophe(text));

/** Every string value in a leaf, nested ones included. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isObject(value)) return Object.values(value).flatMap(strings);
  return [];
}

/** A copy of a value with every printed keyword in its plain spelling. */
function plainCopy(value: unknown): unknown {
  if (typeof value === "string") return plainKeyword(value);
  if (Array.isArray(value)) return value.map(plainCopy);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainCopy(item)]));
  return value;
}

/**
 * A leaf cannot spell one keyword both as printed and plain ('ARDMOB and ARDMOB, KÂHL and KAHL)
 * anywhere in its parameters: the two could not be told apart.
 */
function refuseDoubleSpellings(input: Params, family: string): void {
  const given = strings(input);
  for (const text of given) {
    const plain = withoutApostrophe(text);
    if (plain !== text && given.includes(plain)) throw new TypeError(`${family} names ${plain} both with and without a leading apostrophe.`);
  }
  const unquoted = given.map(withoutApostrophe);
  for (const text of unquoted) {
    const plain = withoutAccents(text);
    if (plain !== text && unquoted.includes(plain)) throw new TypeError(`${family} names ${plain} both with and without accents.`);
  }
}

/** A keyword as the rules print it: accented capitals and one leading apostrophe allowed. */
function printedKeyword(value: unknown, label: string): string {
  if (typeof value === "string" && UNIT_KEYWORD.test(plainKeyword(value))) return value;
  throw new TypeError(`${label} keyword ${JSON.stringify(value)} is not a unit keyword.`);
}

function printedKeywordArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must list at least one unit keyword.`);
  const list = value.map((item) => printedKeyword(item, label));
  if (new Set(list.map(plainKeyword)).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list;
}

/** The recipients/affecting unit filter: at least one of owner, all_of, any_of, level. */
function abilityFilter(value: unknown, label: string): Params {
  if (!isObject(value)) throw new TypeError(`${label} must be a unit filter object.`);
  const allowed = ["owner", "all_of", "any_of", "level"];
  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.every((key) => allowed.includes(key))) throw new TypeError(`${label} may only set owner, all_of, any_of, level.`);
  const result: Params = {};
  if (Object.hasOwn(value, "owner")) result.owner = enumValue(value.owner, FILTER_OWNERS, `${label}.owner`);
  if (Object.hasOwn(value, "all_of")) result.all_of = printedKeywordArray(value.all_of, `${label}.all_of`);
  if (Object.hasOwn(value, "any_of")) result.any_of = printedKeywordArray(value.any_of, `${label}.any_of`);
  if (Object.hasOwn(value, "level")) result.level = enumValue(value.level, FILTER_LEVELS, `${label}.level`);
  return result;
}

/** A plain ability id, the used ability a trigger names (optionally bound by event_var), every ability with a keyword, or every ability reaching a filtered audience. */
function abilityRef(value: unknown, label: string): unknown {
  if (typeof value === "string") return kebabId(value, label);
  if (isObject(value)) {
    const keys = Object.keys(value).sort().join(",");
    if (keys === "ability_id,option_id") return { ability_id: kebabId(value.ability_id, `${label}.ability_id`), option_id: kebabId(value.option_id, `${label}.option_id`) };
    if (value.event === "used" && keys === "event") return { event: "used" };
    if (value.event === "used" && keys === "event,event_var") {
      if (typeof value.event_var !== "string" || !EVENT_VAR.test(value.event_var)) throw new TypeError(`${label}.event_var must be a nonblank binding name.`);
      return { event: "used", event_var: value.event_var };
    }
    if (keys === "keyword") {
      if (typeof value.keyword !== "string" || !UNIT_KEYWORD.test(plainKeyword(value.keyword))) throw new TypeError(`${label}.keyword must be a unit-keyword-style ability keyword such as PSYCHIC.`);
      return { keyword: value.keyword };
    }
    if (keys === "affecting") return { affecting: abilityFilter(value.affecting, `${label}.affecting`) };
  }
  throw new TypeError(`${label} must be an entity id, {ability_id, option_id}, {event: "used", event_var?}, {keyword}, or {affecting}.`);
}

let effectNodeValidate: ((data: unknown) => boolean) & { errors?: unknown } | null = null;

/** An embedded option effect, checked against the DSL's effect-node schema with its keywords in their plain spelling. */
function effectNode(value: unknown, label: string): Params {
  if (!isObject(value)) throw new TypeError(`${label} must be an effect object.`);
  if (!effectNodeValidate) {
    const found = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/effect-node");
    if (!found) throw new Error("effect-node schema fragment is not registered in the validator.");
    effectNodeValidate = found as unknown as ((data: unknown) => boolean) & { errors?: unknown };
  }
  if (!effectNodeValidate(plainCopy(value))) throw new TypeError(`${label} is not a valid effect node: ${JSON.stringify(effectNodeValidate.errors)}`);
  return value;
}

function abilityOption(value: unknown, label: string): Params {
  if (!isObject(value)) throw new TypeError(`${label} must be {name, effect}.`);
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("name") || !keys.includes("effect")) throw new TypeError(`${label} must contain exactly name and effect.`);
  return { name: nonEmptyString(value.name, `${label}.name`), effect: effectNode(value.effect, `${label}.effect`) };
}

function usesCapPer(value: unknown, label: string): Params {
  if (!isObject(value)) throw new TypeError(`${label} must be {count, period}.`);
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("count") || !keys.includes("period")) throw new TypeError(`${label} must contain exactly count and period.`);
  return { count: boundedInteger(value.count, 1, 10, `${label}.count`), period: enumValue(value.period, USES_CAP_PERIODS, `${label}.period`) };
}

function abilityModifier(input: Params): Params {
  const family = "ability-modifier";
  refuseDoubleSpellings(input, family);
  const ability = abilityRef(input.ability, `${family}.ability`);
  const aspect = enumValue(input.aspect, ABILITY_MODIFIER_ASPECTS, `${family}.aspect`);
  const operation = enumValue(input.operation, ABILITY_MODIFIER_OPERATIONS, `${family}.operation`);
  const numeric = (NUMERIC_ASPECTS as readonly string[]).includes(aspect);
  const base = ["subject", "ability", "aspect", "operation"];
  const optional = [
    ...(numeric ? ["value", "cap"] : []),
    ...(aspect === "recipients" ? ["recipients"] : []),
    ...(aspect === "options" ? ["add_option"] : []),
    ...(aspect === "uses" ? ["cap_per", "not_same", "consumes_shared_use"] : []),
  ];
  const keys = Object.keys(input);
  if (!base.every((key) => keys.includes(key)) || !keys.every((key) => base.includes(key) || optional.includes(key))) {
    throw new TypeError(`${family} parameters for aspect ${aspect} must contain ${base.join(", ")}, and optional ${optional.join(", ") || "none"} only.`);
  }
  if (numeric && !Object.hasOwn(input, "value")) throw new TypeError(`${family}.value is required for this aspect.`);
  if (aspect === "received" && operation !== "set") throw new TypeError(`${family} aspect received sets how many times one unit can be affected; its operation is set.`);
  if (aspect === "recipients" && !Object.hasOwn(input, "recipients")) throw new TypeError(`${family}.recipients is required for the recipients aspect.`);
  if (aspect === "options" && !Object.hasOwn(input, "add_option")) throw new TypeError(`${family}.add_option is required for the options aspect.`);
  return {
    subject: enumValue(input.subject, ABILITY_MODIFIER_SUBJECTS, `${family}.subject`),
    ability,
    aspect,
    operation,
    ...(Object.hasOwn(input, "value") ? { value: boundedInteger(input.value, 1, 36, `${family}.value`) } : {}),
    ...(Object.hasOwn(input, "cap") ? { cap: boundedInteger(input.cap, 1, 36, `${family}.cap`) } : {}),
    ...(Object.hasOwn(input, "recipients") ? { recipients: abilityFilter(input.recipients, `${family}.recipients`) } : {}),
    ...(Object.hasOwn(input, "add_option") ? { add_option: abilityOption(input.add_option, `${family}.add_option`) } : {}),
    ...(Object.hasOwn(input, "cap_per") ? { cap_per: usesCapPer(input.cap_per, `${family}.cap_per`) } : {}),
    ...(Object.hasOwn(input, "not_same") ? { not_same: enumValue(input.not_same, NOT_SAME_WINDOWS, `${family}.not_same`) } : {}),
    ...(Object.hasOwn(input, "consumes_shared_use") ? { consumes_shared_use: constFalse(input.consumes_shared_use, `${family}.consumes_shared_use`) } : {}),
  };
}

function constFalse(value: unknown, label: string): false {
  if (value === false) return false;
  throw new TypeError(`${label} must be false.`);
}

/** Core rulebook abilities, which core-ability-grant names instead. */
const CORE_ABILITY_GRANT_IDS = [
  "benefit-of-cover", "deadly-demise", "deep-strike", "feel-no-pain", "fights-first", "firing-deck", "hover",
  "infiltrators", "leader", "lone-operative", "scouts", "stealth", "support", "super-heavy-walker",
] as const;
const PRINTED_GRANTS = ["one", "several", "unnamed"] as const;

/** An integer rating, or the unit's own datasheet rating. */
function grantValue(value: unknown, label: string): number | { rating: true } {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 36) return value;
  if (isObject(value) && value.rating === true && Object.keys(value).length === 1) return { rating: true };
  throw new TypeError(`${label} must be an integer from 1 to 36 or {rating: true}.`);
}

function abilityRecordGrant(input: Params): Params {
  const family = "ability-record-grant";
  const allowed = ["subject", "ability", "value", "rules_bundle", "printed", "matching_weapon", "held_by_model"];
  if (!Object.hasOwn(input, "subject") || !Object.keys(input).every((key) => allowed.includes(key))) {
    throw new TypeError(`${family} parameters must contain subject, ability or printed, and optional value, rules_bundle, matching_weapon, held_by_model only.`);
  }
  const result: Params = { subject: enumValue(input.subject, ["this-unit", "this-model", ANTECEDENT], `${family}.subject`) };
  if ("printed" in input) {
    if ("ability" in input) throw new TypeError(`${family} names an ability or printed, not both.`);
    if ("value" in input || "rules_bundle" in input) throw new TypeError(`${family}.value and rules_bundle describe a named ability record, not a printed one.`);
    result.printed = enumValue(input.printed, PRINTED_GRANTS, `${family}.printed`);
  } else {
    if (!("ability" in input)) throw new TypeError(`${family} names an ability, or printed for abilities printed after it.`);
    const ability = kebabId(input.ability, `${family}.ability`);
    if ((CORE_ABILITY_GRANT_IDS as readonly string[]).includes(ability)) throw new TypeError(`${family}.ability "${ability}" is a core ability; use core-ability-grant instead.`);
    result.ability = ability;
    if ("value" in input) result.value = grantValue(input.value, `${family}.value`);
    if ("rules_bundle" in input) result.rules_bundle = constTrue(input.rules_bundle, `${family}.rules_bundle`);
  }
  if ("matching_weapon" in input) {
    if (input.matching_weapon !== true) throw new TypeError(`${family}.matching_weapon is true or omitted.`);
    if (result.printed !== "several") throw new TypeError(`${family}.matching_weapon picks among several printed abilities.`);
    result.matching_weapon = true;
  }
  if ("held_by_model" in input) {
    if (input.held_by_model !== true) throw new TypeError(`${family}.held_by_model is true or omitted.`);
    for (const key of ["value", "rules_bundle", "printed", "matching_weapon"]) {
      if (result[key] !== undefined) throw new TypeError(`${family}.held_by_model grants a plain ability; it takes no ${key}.`);
    }
    result.held_by_model = true;
  }
  return result;
}

export const ABILITY_MODIFIERS_AND_GRANTS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "ability-modifier",
    version: 8,
    role: "EFFECT",
    label: "Change a named ability",
    description: "Adds to, subtracts from, sets, or lifts the limit on one measured aspect of a named ability, widens who it recipients (aspect: recipients), or adds a new option to it (aspect: options). amount: the amount the ability resolves with (\"that model regains up to 3 lost wounds instead\"). received: how many times one unit can be affected by it each time its limit counts (\"can be regenerated up to twice per phase, instead of once\"); its subject is that unit and its operation is set. The ability can be a plain id, one option of a record ({ability_id, option_id}: Feed the Swarm's Regenerate choice, a stance or Order), the ability a used trigger names (event_var binds that exact used event; the binding is required when this modifier changes that event's uses), every ability with a keyword, or every ability of the target reaching a filtered audience. A keyword can carry accented capitals (KÂHL) or a leading apostrophe ('ARDMOB) as the rules print it. subject can be antecedent, the unit an earlier leaf of the record introduced (\"that enemy unit\", \"that unit\"), or filtered-units, the units or models a unit-filter right after the modifier names (\"the number of Orders each K model from your army can issue\").",
    starter: {subject: "this-unit", ability: "", aspect: "", operation: "add"},
    parameterSchema: {type: "object", required: ["subject", "ability", "aspect", "operation"], properties: {subject: {enum: ["this-unit", "this-model", "antecedent", "filtered-units"]}, ability: {anyOf: [{type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, {type: "object", required: ["ability_id", "option_id"], properties: {ability_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}, option_id: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"}}, additionalProperties: false}, {type: "object", required: ["event", "event_var"], properties: {event: {const: "used"}, event_var: {type: "string", pattern: "^[a-z][a-z0-9_-]*$", minLength: 1}}, additionalProperties: false}, {type: "object", required: ["keyword"], properties: {keyword: {type: "string", pattern: "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$"}}, additionalProperties: false}, {type: "object", required: ["affecting"], properties: {affecting: {type: "object", minProperties: 1, additionalProperties: false, properties: {owner: {enum: ["friendly", "enemy", "any"]}, all_of: {type: "array", items: {type: "string", pattern: "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$"}, minItems: 1, uniqueItems: true}, any_of: {type: "array", items: {type: "string", pattern: "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$"}, minItems: 1, uniqueItems: true}, level: {enum: ["unit", "model"]}}}}, additionalProperties: false}]}, aspect: {enum: ["range", "uses", "targets", "selections", "concurrent", "duration", "start-round", "end-round", "threshold", "amount", "received", "recipients", "options"]}, operation: {enum: ["add", "subtract", "set", "lift-limit"]}, value: {type: "integer", minimum: 1, maximum: 36, "x-only-when": {aspect: ["range", "uses", "targets", "selections", "concurrent", "duration", "start-round", "end-round", "threshold", "amount", "received"]}}, cap: {type: "integer", minimum: 1, maximum: 36, "x-only-when": {aspect: ["range", "uses", "targets", "selections", "concurrent", "duration", "start-round", "end-round", "threshold", "amount", "received"]}}, recipients: {type: "object", minProperties: 1, additionalProperties: false, properties: {owner: {enum: ["friendly", "enemy", "any"]}, all_of: {type: "array", items: {type: "string", pattern: "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$"}, minItems: 1, uniqueItems: true}, any_of: {type: "array", items: {type: "string", pattern: "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$"}, minItems: 1, uniqueItems: true}, level: {enum: ["unit", "model"]}}, "x-only-when": {aspect: ["recipients"]}}, add_option: {type: "object", required: ["name", "effect"], additionalProperties: false, properties: {name: {type: "string", minLength: 1}, effect: {type: "object"}}, "x-only-when": {aspect: ["options"]}}, cap_per: {type: "object", required: ["count", "period"], additionalProperties: false, properties: {count: {type: "integer", minimum: 1, maximum: 10}, period: {enum: ["phase", "turn", "battle-round"]}}, "x-only-when": {aspect: ["uses"]}}, not_same: {enum: ["phase", "turn"], "x-only-when": {aspect: ["uses"]}}, consumes_shared_use: {const: false, "x-only-when": {aspect: ["uses"]}}}, additionalProperties: false},
    normalize: abilityModifier,
  },
  {
    id: "ability-record-grant",
    version: 5,
    role: "EFFECT",
    label: "Grant a non-core ability record",
    description: "Gives the target a named ability record from the ability collection (not a core rulebook ability — core-ability-grant names those), optionally its datasheet rating, or as a rules bundle (several rules named as one). subject can be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles. printed, in place of ability: the granted abilities are printed right after this wording in the same record. one is \"has the following ability:\", several is \"the following abilities:\", unnamed is \"have the following:\". Each named body starts with a granted-ability-name leaf. subject is the holder: the ability is the holder's own, so it works only while a holder is on the battlefield, and a cadence in it counts per holder. matching_weapon, on a printed grant of several: each printed ability is granted only while this unit's models carry a weapon whose name is that ability's name (\"the ability below that matches that weapon's name\"). held_by_model: the ability is granted only while the model the enclosing while-condition names has it (\"that Warboss model's X ability\"); each such grant splits that condition into one per ability (compile-held-grants.ts). It takes a plain ability, with no value, rules bundle or printed body.",
    starter: {subject: "this-unit", ability: ""},
    parameterSchema: {type: "object", properties: {subject: {enum: ["this-unit", "this-model", "antecedent"]}, ability: {type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-optional": true}, value: {anyOf: [{type: "integer", minimum: 1, maximum: 36}, {type: "object", required: ["rating"], properties: {rating: {const: true}}, additionalProperties: false}]}, rules_bundle: {const: true}, printed: {enum: ["one", "several", "unnamed"], "x-optional": true}, matching_weapon: {const: true, "x-optional": true}, held_by_model: {const: true, "x-optional": true}}, additionalProperties: false, required: ["subject"]},
    normalize: abilityRecordGrant,
  },
];
