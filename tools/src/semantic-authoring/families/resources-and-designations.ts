import { DESIGNATION_IDS, LIST_BUILDING_DESIGNATIONS, designationId, refuseListBuildingTag } from "../../translate/designations.js";
import { ANTECEDENT } from "../antecedent-families.js";
import {
  booleanValue, boundedInteger, enumOrSource, enumSet, enumValue, integerOrSource, keySet, sourceQualified,
  type SourceQualifiedValue,
} from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import {
  type Params, SUBJECT_REF, FOLLOWING_FILTER, ENTITY_ID, BATTLE_SIZES, isObject,
} from "./restrictions-and-predicates-shared.js";

/** Resource pools and costs, army construction, designations and optional costs. */

const SOURCE_QUALIFIED_SCHEMA = {
  type: "object",
  required: ["source"],
  properties: { source: { type: "string", minLength: 1 } },
  additionalProperties: false,
};

/** A resource pool id: plain kebab-case (command-point included). */
const POOL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Pool ids the leaf form and audit sample; normalize accepts any kebab-case pool id. */
const KNOWN_POOL_IDS = ["command-point", "miracle-dice-pool", "pain-token-pool", "blood-tithe-pool", "yp-pool", "battle-focus-pool", "fate-dice-pool"] as const;

/** A dice amount: D3, D6, 2D6, D3+1. */
const DICE = /^\d*D(3|6)(\+\d+)?$/u;

/** The tags apply-mark accepts: every registered designation except the ones only list building sets. */
const MARK_TAG_VALUES = [...DESIGNATION_IDS].filter((id) => !LIST_BUILDING_DESIGNATIONS.has(designationId(id))).sort();

/** A resource pool id: a plain kebab-case id, or an exact source snippet. */
function poolId(value: unknown, label: string): string | SourceQualifiedValue {
  if (typeof value === "string" && POOL_ID.test(value)) return value;
  const source = sourceQualified(value, label);
  if (source) return source;
  throw new TypeError(`${label} must be a kebab-case resource pool id or an exact source snippet.`);
}

function poolLabel(input: Params, family: string): { label?: string } {
  if (input.label === undefined) return {};
  if (typeof input.label !== "string" || !input.label) throw new TypeError(`${family}.label must be a nonblank string.`);
  return { label: input.label };
}

const RESOURCE_DIE_ROLLS = [
  "hit", "wound", "save", "damage", "charge", "advance", "battle-shock", "leadership", "hazard", "psychic",
  "normal-move", "surge", "dark-pact", "blessings-of-khorne", "manoeuvre", "channelling", "any", "all",
] as const;

function normalizeResourceDie(input: Params): Params {
  keySet(input, ["pool", "operation"], ["value", "rolls"], "resource-die");
  const result: Params = {
    pool: poolId(input.pool, "resource-die.pool"),
    operation: enumValue(input.operation, ["add", "substitute"], "resource-die.operation"),
  };
  if (input.value !== undefined) {
    result.value = typeof input.value === "number"
      ? boundedInteger(input.value, 1, 6, "resource-die.value")
      : enumValue(input.value, ["rolled", "highest"], "resource-die.value");
  }
  if (input.rolls !== undefined) result.rolls = enumSet(input.rolls, RESOURCE_DIE_ROLLS, "resource-die.rolls");
  return result;
}

const COST_OPERATIONS = ["increase", "decrease", "set", "multiply", "waive"] as const;

function normalizeStratagemCost(input: Params): Params {
  keySet(input, ["of", "operation"], ["amount", "applies_to", "id"], "stratagem-cost");
  const operation = enumValue(input.operation, COST_OPERATIONS, "stratagem-cost.operation");
  const result: Params = { of: enumValue(input.of, ["stratagem", "manoeuvre", "ability"], "stratagem-cost.of"), operation };
  if (operation !== "waive") {
    if (input.amount === undefined) throw new TypeError("stratagem-cost.amount is required unless operation is waive.");
    result.amount = boundedInteger(input.amount, operation === "multiply" ? 2 : 0, 20, "stratagem-cost.amount");
  } else if (input.amount !== undefined) {
    throw new TypeError("stratagem-cost.amount must be omitted when operation is waive.");
  }
  if (input.applies_to !== undefined) {
    result.applies_to = enumValue(input.applies_to, ["targeting-this-unit", "used-by-this-unit", "the-triggering-use", "any"], "stratagem-cost.applies_to");
  }
  if (input.id !== undefined) {
    if (typeof input.id !== "string" || !ENTITY_ID.test(input.id)) throw new TypeError("stratagem-cost.id must be a kebab-case entity id.");
    result.id = input.id;
  }
  return result;
}

const DICE_REQUIREMENT_TYPES = ["pair", "triple", "single", "run"] as const;
const TABLE_OF = [ANTECEDENT, "event-subject", "event-object"] as const;

function normalizeResourceSpend(input: Params): Params {
  const family = "resource-spend";
  keySet(input, ["pool", "amount"], ["label", "spend_gate", "face", "requirement_type", "requirement_min", "table_of", "starting_strength"], family);
  const { amount, table_of: tableOf, starting_strength: strength } = input;
  const result: Params = {
    pool: poolId(input.pool, "resource-spend.pool"),
    amount: amount === "all" || amount === "one-or-more" || amount === "by-table" ? amount : integerOrSource(amount, "resource-spend.amount"),
    ...poolLabel(input, family),
  };
  if (amount === "by-table") {
    // The cost is the row of the table after the leaf that matches the unit table_of names.
    if (strength !== undefined) throw new TypeError("resource-spend.starting_strength names one row; a by-table spend has none.");
    if (!(TABLE_OF as readonly unknown[]).includes(tableOf)) throw new TypeError(`resource-spend amount by-table needs table_of: ${TABLE_OF.join(" or ")}.`);
    result.table_of = tableOf;
  } else if (tableOf !== undefined) {
    throw new TypeError("resource-spend.table_of goes with amount by-table.");
  } else if (strength !== undefined) {
    if (!Number.isInteger(strength) || (strength as number) < 1) throw new TypeError("resource-spend.starting_strength is a whole number of models, at least 1.");
    if (!Number.isInteger(amount)) throw new TypeError("resource-spend.starting_strength is a table row, which costs a fixed amount.");
    result.starting_strength = strength;
  }
  const hasFace = input.face !== undefined;
  const hasType = input.requirement_type !== undefined;
  const hasMin = input.requirement_min !== undefined;
  if (hasFace && (hasType || hasMin)) throw new TypeError("resource-spend: face and requirement_type/requirement_min are mutually exclusive.");
  if (hasType !== hasMin) throw new TypeError("resource-spend: requirement_type and requirement_min must be given together.");
  // spend_gate is a self-consistency hint (which field pair, if either, is set); the compiled DSL reads the fields directly.
  if (input.spend_gate !== undefined) {
    const gate = enumValue(input.spend_gate, ["none", "face", "requirement"], "resource-spend.spend_gate");
    if (gate === "none" && (hasFace || hasType)) throw new TypeError("resource-spend.spend_gate none conflicts with face or requirement.");
    if (gate === "face" && !hasFace) throw new TypeError("resource-spend.spend_gate face needs a face.");
    if (gate === "requirement" && !hasType) throw new TypeError("resource-spend.spend_gate requirement needs requirement_type and requirement_min.");
  }
  if (hasFace) result.face = boundedInteger(input.face, 1, 6, "resource-spend.face");
  if (hasType) {
    result.requirement_type = enumValue(input.requirement_type, DICE_REQUIREMENT_TYPES, "resource-spend.requirement_type");
    result.requirement_min = boundedInteger(input.requirement_min, 1, 6, "resource-spend.requirement_min");
  }
  return result;
}

const UNIT_CHARACTERISTICS = ["M", "T", "Sv", "W", "Ld", "OC", "psyker-level"] as const;
const POOL_OWNERS = ["this-unit", ANTECEDENT] as const;

/** One value per battle size ("6 / 10 / 14 Resurgence points"), each within 0..maximum. */
function battleSizeValue(value: unknown, maximum: number, label: string): Record<string, number> {
  if (!isObject(value)) throw new TypeError(`${label} is a number, or an object with incursion, strike-force and onslaught.`);
  const keys = Object.keys(value);
  if (keys.length !== BATTLE_SIZES.length || !BATTLE_SIZES.every((size) => keys.includes(size))) {
    throw new TypeError(`${label} names exactly incursion, strike-force and onslaught.`);
  }
  return Object.fromEntries(BATTLE_SIZES.map((size) => [size, boundedInteger(value[size], 0, maximum, `${label}.${size}`)]));
}

function gainAmount(amount: unknown, pool: unknown): unknown {
  if (amount === "variable" || amount === "any") return amount;
  if (typeof amount === "string" && DICE.test(amount.trim().toUpperCase())) return amount.trim().toUpperCase();
  if (isObject(amount) && "characteristic" in amount) {
    if (Object.keys(amount).length !== 1) throw new TypeError("resource-gain.amount {characteristic} takes only the characteristic.");
    return { characteristic: enumValue(amount.characteristic, UNIT_CHARACTERISTICS, "resource-gain.amount.characteristic") };
  }
  if (isObject(amount) && "pool" in amount) {
    if (Object.keys(amount).length !== 1 || typeof amount.pool !== "string" || !POOL_ID.test(amount.pool)) {
      throw new TypeError("resource-gain.amount {pool} takes only a kebab-case pool id.");
    }
    if (amount.pool === pool) throw new TypeError("resource-gain.amount {pool} names another pool than the one gained.");
    return { pool: amount.pool };
  }
  if (isObject(amount) && !("source" in amount)) return battleSizeValue(amount, 100, "resource-gain.amount");
  return integerOrSource(amount, "resource-gain.amount");
}

function normalizeResourceGain(input: Params): Params {
  const family = "resource-gain";
  keySet(input, ["pool", "amount"], ["label", "set", "subject"], family);
  const { amount, set, subject } = input;
  const result: Params = { pool: poolId(input.pool, "resource-gain.pool"), amount: gainAmount(amount, input.pool), ...poolLabel(input, family) };
  const characteristic = isObject(result.amount) && "characteristic" in result.amount;
  if (subject !== undefined) {
    if (!characteristic) throw new TypeError("resource-gain.subject names the unit whose characteristic the amount reads; it needs amount {characteristic}.");
    result.subject = enumValue(subject, POOL_OWNERS, "resource-gain.subject");
  }
  if (set !== undefined) {
    if (isObject(result.amount) && "pool" in result.amount) throw new TypeError("resource-gain.set does not take an amount read from another pool.");
    if (set !== true) throw new TypeError("resource-gain.set is true or omitted.");
    if (amount === "variable") throw new TypeError("resource-gain.set needs a number: any, a value or dice.");
    result.set = true;
  }
  return result;
}

const ARMY_RULES = [
  "warlord-required", "warlord-forbidden", "unique", "enhancement-forbidden", "enhancement-slot", "attachment", "composition",
  "faction-forbidden", "single-chapter", "detachment-forbidden", "detachment-tag-exclusive", "enhancement-source", "limit-exemption",
  "warlord-allowed",
] as const;
/** Rules about the units a group names: the group is the rule's subject (its DSL target). */
const ARMY_SUBJECT_RULES = ["warlord-required", "warlord-forbidden", "warlord-allowed", "enhancement-forbidden", "enhancement-source", "limit-exemption"];
/** Rules about the list as a whole, which no group of units qualifies. */
const ARMY_LIST_RULES = ["single-chapter", "detachment-forbidden", "detachment-tag-exclusive", "faction-forbidden"];
const ARMY_MEASURES = ["units", "models", "points"] as const;
const ARMY_SUBJECTS = ["this-unit", "this-model", ANTECEDENT] as const;
const ARMY_OBJECTS = ["this-unit", FOLLOWING_FILTER] as const;
/** Limits a unit or Enhancement can be left out of: the Retinue cap, the Enhancement cap, the Strategic Reserves points cap. */
const ARMY_EXEMPTIONS = ["retinue-limit", "enhancement-limit", "strategic-reserves-points"] as const;

/** A list of keywords as printed: nonblank strings, kept as given. */
function printedKeywordArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a nonempty list of keywords.`);
  return value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) throw new TypeError(`${label} must list nonblank keyword strings.`);
    return item;
  });
}

function normalizeArmyConstruction(input: Params): Params {
  const family = "army-construction";
  keySet(input, ["rule"], ["with_keywords", "max", "led_by", "measure", "per_keywords", "faction", "with", "subject", "object", "exempt_from", "enhancement_kind"], family);
  const rule = enumValue(input.rule, ARMY_RULES, "army-construction.rule");
  const { max, measure, per_keywords: per, faction, with: withValue, subject, object, exempt_from: exempt, enhancement_kind: kind } = input;
  const result: Params = { rule };
  if (input.with_keywords !== undefined) result.with_keywords = printedKeywordArray(input.with_keywords, "army-construction.with_keywords");
  if (max !== undefined) {
    // Above 20, max counts points (measure points); a per-battle-size max is an object.
    result.max = isObject(max) ? battleSizeValue(max, 5000, "army-construction.max") : boundedInteger(max, 0, 5000, "army-construction.max");
    if (measure !== "points" && !isObject(max) && (max as number) > 20) throw new TypeError("army-construction.max above 20 counts points; set measure: points.");
  }
  if (input.led_by !== undefined) {
    if (typeof input.led_by !== "string" || input.led_by.trim().length === 0) throw new TypeError("army-construction.led_by must be a nonblank string.");
    result.led_by = input.led_by;
  }
  if (measure !== undefined) result.measure = enumValue(measure, ARMY_MEASURES, "army-construction.measure");
  if (per !== undefined) result.per_keywords = printedKeywordArray(per, "army-construction.per_keywords");
  if (faction !== undefined) {
    if (typeof faction !== "string" || !ENTITY_ID.test(faction)) throw new TypeError("army-construction.faction is a kebab-case faction id.");
    result.faction = faction;
  }
  if ((measure !== undefined || per !== undefined) && rule !== "composition") throw new TypeError("army-construction.measure and per_keywords go with rule: composition.");
  if (withValue !== undefined) result.with = enumValue(withValue, [FOLLOWING_FILTER], "army-construction.with");
  if (subject !== undefined) result.subject = enumValue(subject, ARMY_SUBJECTS, "army-construction.subject");
  const sources = [result.with_keywords !== undefined, result.with !== undefined, result.subject === ANTECEDENT].filter(Boolean).length;
  if (sources > 1) throw new TypeError("army-construction names its group once: with_keywords, with following-filter, or subject antecedent.");
  if (ARMY_LIST_RULES.includes(rule) && (result.with !== undefined || result.subject === ANTECEDENT)) {
    throw new TypeError(`army-construction rule ${rule} is about the list as a whole; no group of units qualifies it.`);
  }
  if (result.subject !== undefined && result.subject !== ANTECEDENT) {
    if (result.with_keywords !== undefined || result.with !== undefined) {
      throw new TypeError("army-construction.subject this-unit/this-model names the subject itself; it takes no group (with_keywords or with).");
    }
    if (![...ARMY_SUBJECT_RULES, "attachment"].includes(rule)) throw new TypeError(`army-construction.subject this-unit/this-model has no meaning for rule ${rule}.`);
  }
  if (object !== undefined) {
    if (rule !== "attachment") throw new TypeError("army-construction.object goes with rule: attachment.");
    // Attachment eligibility names its Leaders by its pattern (or is the bearer itself), never by inline keywords, a cap or a led-by.
    for (const key of ["with_keywords", "max", "led_by"]) if (result[key] !== undefined) throw new TypeError(`army-construction.object (attachment eligibility) takes no ${key}.`);
    result.object = enumValue(object, ARMY_OBJECTS, "army-construction.object");
    if (result.object === FOLLOWING_FILTER && result.with !== undefined) throw new TypeError("army-construction takes one following filter: with or object, not both.");
  }
  if (exempt !== undefined) {
    if (!Array.isArray(exempt) || exempt.length === 0) throw new TypeError("army-construction.exempt_from lists at least one limit.");
    const list = exempt.map((item) => enumValue(item, ARMY_EXEMPTIONS, "army-construction.exempt_from"));
    if (new Set(list).size !== list.length) throw new TypeError("army-construction.exempt_from lists a limit twice.");
    for (const item of list) {
      if (item === "retinue-limit" && rule !== "composition") throw new TypeError("army-construction.exempt_from retinue-limit goes with rule: composition.");
      if (item !== "retinue-limit" && rule !== "limit-exemption") throw new TypeError(`army-construction.exempt_from ${item} goes with rule: limit-exemption.`);
    }
    result.exempt_from = [...list].sort();
  }
  if (rule === "limit-exemption" && result.exempt_from === undefined) throw new TypeError("army-construction rule limit-exemption names the limit in exempt_from.");
  if (kind !== undefined) {
    if (rule !== "enhancement-slot" && rule !== "unique") throw new TypeError("army-construction.enhancement_kind goes with rule: enhancement-slot or unique.");
    if (typeof kind !== "string" || !ENTITY_ID.test(kind)) throw new TypeError("army-construction.enhancement_kind is a kebab-case kind of Enhancement.");
    result.enhancement_kind = kind;
  }
  return result;
}

const MARK_SUBJECTS = ["this-unit", "this-model", "selected-unit", ANTECEDENT, "selected-objective", "visible-terrain"] as const;
/** Who applied a designation: the unit with the ability, its selected unit, the moment's unit, or the for-each pass's unit. */
const MARK_APPLIERS = ["this-unit", "this-model", "selected-unit", "event-subject", "recipient"] as const;

function normalizeApplyMark(input: Params): Params {
  keySet(input, ["subject", "tag"], ["clear", "by"], "apply-mark");
  const subject = enumOrSource(input.subject, MARK_SUBJECTS, "apply-mark.subject");
  let tag: string | SourceQualifiedValue;
  if (typeof input.tag === "string") {
    // Any registered designation, except one that only list building sets.
    if (!DESIGNATION_IDS.has(input.tag)) throw new TypeError(`apply-mark.tag ${JSON.stringify(input.tag)} is not a registered designation.`);
    refuseListBuildingTag(input.tag, "apply-mark.tag");
    tag = input.tag;
  } else {
    const source = sourceQualified(input.tag, "apply-mark.tag");
    if (!source) throw new TypeError("apply-mark.tag must be a registered designation or an exact source snippet.");
    tag = source;
  }
  const result: Params = { subject, tag };
  if (input.clear !== undefined) {
    if (booleanValue(input.clear, "apply-mark.clear") !== true) throw new TypeError("apply-mark.clear must be true, or omitted.");
    result.clear = true;
  }
  if ("by" in input) {
    if (subject === "visible-terrain") throw new TypeError("apply-mark on a terrain feature has no applier; drop by.");
    result.by = enumValue(input.by, MARK_APPLIERS, "apply-mark.by");
  }
  return result;
}

const OPTIONAL_COST_POOLS = ["yp-pool", "pain-token-pool"] as const;
const OPTIONAL_COST_WINDOWS = ["use", "trigger", "turn"] as const;
const OPTIONAL_COST_HOLDERS = ["this-unit", "selected-unit"] as const;

/** Each window takes only its own keys: use and trigger name the subject that spent and the designation tag; turn takes negation. */
function normalizeOptionalCostPaid(input: Params): Params {
  const family = "optional-cost-paid";
  const window = enumValue(input.window, OPTIONAL_COST_WINDOWS, `${family}.window`);
  const pool = enumValue(input.pool, OPTIONAL_COST_POOLS, `${family}.pool`);
  const allowed = window === "turn"
    ? ["pool", "window", "negated"]
    : window === "use"
      ? ["pool", "window", "subject", "tag"]
      : ["pool", "window", "subject", "tag", "holder"];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new TypeError(`${family} window ${window} does not take ${key}.`);
  }
  if (window === "use" && pool === "pain-token-pool") throw new TypeError(`${family} window use reads a YP spend; a Pain token spend is read as window trigger.`);
  if (window === "turn") {
    const negated = "negated" in input ? booleanValue(input.negated, `${family}.negated`) : false;
    return { pool, window, ...(negated ? { negated: true } : {}) };
  }
  if (input.subject === undefined) throw new TypeError(`${family} window ${window} needs the subject that spent the pool.`);
  // A use leaf with no tag reads the designation the same use's spend sets.
  if (input.tag === undefined && window !== "use") throw new TypeError(`${family} window ${window} needs the designation tag its spend sets.`);
  const tag = input.tag === undefined ? "yp-spent-this-use" : input.tag;
  if (typeof tag !== "string" || !/^[a-z][a-z0-9-]*$/u.test(tag) || tag.length > 60) throw new TypeError(`${family}.tag is a kebab-case designation id.`);
  const subject = enumValue(input.subject, SUBJECT_REF, `${family}.subject`);
  if (window === "use") return { pool, window, subject, tag };
  const holder = input.holder === undefined ? "this-unit" : enumValue(input.holder, OPTIONAL_COST_HOLDERS, `${family}.holder`);
  return { pool, window, subject, tag, holder };
}


export const RESOURCES_AND_DESIGNATIONS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "resource-die",
    version: 1,
    role: "EFFECT",
    label: "Add or substitute a pool die",
    description: "Adds a die to a resource pool, or discards one from it to replace a named roll.",
    starter: { pool: "", operation: "" },
    parameterSchema: {
      type: "object", required: ["pool", "operation"], additionalProperties: false,
      properties: {
        pool: { anyOf: [{ enum: [...KNOWN_POOL_IDS] }, SOURCE_QUALIFIED_SCHEMA] },
        operation: { enum: ["add", "substitute"] },
        value: { anyOf: [{ type: "integer", minimum: 1, maximum: 6 }, { enum: ["rolled", "highest"] }] },
        rolls: { type: "array", items: { enum: ["hit", "wound", "save", "damage", "charge", "advance", "battle-shock", "leadership", "hazard", "psychic", "normal-move", "surge", "dark-pact", "blessings-of-khorne", "manoeuvre", "channelling", "any", "all"] }, minItems: 1, uniqueItems: true },
      },
    },
    normalize: normalizeResourceDie,
  },
  {
    id: "stratagem-cost",
    version: 1,
    role: "EFFECT",
    label: "Change what a Stratagem, manoeuvre or ability costs",
    description: "Increases, decreases, sets, multiplies or waives the CP cost; amount is required unless waive.",
    starter: { of: "", operation: "" },
    parameterSchema: {
      type: "object", required: ["of", "operation"], additionalProperties: false,
      properties: {
        of: { enum: ["stratagem", "manoeuvre", "ability"] },
        operation: { enum: ["increase", "decrease", "set", "multiply", "waive"] },
        amount: { type: "integer", minimum: 0 },
        applies_to: { enum: ["targeting-this-unit", "used-by-this-unit", "the-triggering-use", "any"] },
        id: { anyOf: [{ enum: ["cunning-ambush", "rapid-fire"] }, { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" }] },
      },
    },
    normalize: normalizeStratagemCost,
  },
  {
    id: "resource-spend",
    version: 4,
    role: "EFFECT",
    label: "Spend a resource",
    description: "Spends an amount from a named resource pool (any kebab-case pool id, or an exact source snippet): a fixed amount, all of it, one-or-more (the player chooses how many, at least one: \"spend one or more BTP you have\"), or by-table with table_of (antecedent: the unit an earlier leaf named, event-subject or event-object): the cost is the row of the table after it that matches that unit. starting_strength on a row with a fixed amount is the cost for a unit of that Starting Strength. spend_gate optionally requires the spent dice to show a named face, or to form a pair/triple/single/run at or above a minimum value (face and the requirement are mutually exclusive, so spend_gate says which — or neither — applies). label is the player-facing singular noun for one unit of the pool (Aeldari's \"Battle Focus token\"), only when the rules give the pool one.",
    starter: { pool: "", amount: null },
    parameterSchema: {
      type: "object", required: ["pool", "amount"], additionalProperties: false,
      properties: {
        pool: { anyOf: [{ enum: [...KNOWN_POOL_IDS] }, SOURCE_QUALIFIED_SCHEMA, { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }] },
        amount: { anyOf: [{ type: "integer" }, SOURCE_QUALIFIED_SCHEMA, { const: "all" }, { const: "one-or-more" }, { const: "by-table" }] },
        label: { type: "string", minLength: 1 },
        spend_gate: { enum: ["none", "face", "requirement"] },
        face: { type: "integer", minimum: 1, maximum: 6, "x-only-when": { spend_gate: ["face"] } },
        requirement_type: { enum: ["pair", "triple", "single", "run"], "x-only-when": { spend_gate: ["requirement"] } },
        requirement_min: { type: "integer", minimum: 1, maximum: 6, "x-only-when": { spend_gate: ["requirement"] } },
        table_of: { enum: ["antecedent", "event-subject", "event-object"], "x-only-when": { amount: ["by-table"] }, "x-optional": true },
        starting_strength: { type: "integer", minimum: 1, "x-optional": true },
      },
    },
    normalize: normalizeResourceSpend,
  },
  {
    id: "resource-gain",
    version: 6,
    role: "EFFECT",
    label: "Gain a resource",
    description: "Gains an amount of a named resource pool (any kebab-case pool id, or an exact source snippet; command-point becomes CP): a fixed number, a variable or any amount the rules don't fix, one value per battle size ({incursion, strike-force, onslaught}), a dice amount (D3, D6, 2D6, D3+1, normalized to uppercase) for a gain rolled on the bearer's ability, as many as another pool holds ({pool}), or as many as one of the unit's own characteristics ({characteristic}: M, T, Sv, W, Ld, OC or psyker-level). set: true makes the pool become the amount instead of gaining it (amount any is a number the player picks); it takes neither a variable amount nor a {pool} amount. With a characteristic amount the pool belongs to that unit: subject names it (this-unit, or antecedent for the units a unit-filter before it names; this-unit when omitted), and subject needs a characteristic amount. label is the player-facing singular noun for one unit of the pool (Aeldari's \"Battle Focus token\"), only when the rules give the pool one.",
    starter: { pool: "", amount: null },
    parameterSchema: {
      type: "object", required: ["pool", "amount"], additionalProperties: false,
      properties: {
        pool: { anyOf: [{ enum: [...KNOWN_POOL_IDS] }, SOURCE_QUALIFIED_SCHEMA, { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }] },
        amount: { anyOf: [{ type: "integer" }, SOURCE_QUALIFIED_SCHEMA, { const: "variable" }, { const: "any" }, { type: "object", required: ["incursion", "strike-force", "onslaught"], properties: { incursion: { type: "integer", minimum: 0, maximum: 100 }, "strike-force": { type: "integer", minimum: 0, maximum: 100 }, onslaught: { type: "integer", minimum: 0, maximum: 100 } }, additionalProperties: false }, { type: "string", pattern: "^\\d*D(3|6)(\\+\\d+)?$", examples: ["D3"] }, { type: "object", required: ["pool"], properties: { pool: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" } }, additionalProperties: false }, { type: "object", required: ["characteristic"], properties: { characteristic: { enum: ["M", "T", "Sv", "W", "Ld", "OC", "psyker-level"] } }, additionalProperties: false }] },
        label: { type: "string", minLength: 1 },
        set: { const: true, "x-optional": true },
        subject: { enum: ["this-unit", "antecedent"], "x-optional": true },
      },
    },
    normalize: normalizeResourceGain,
  },
  {
    id: "army-construction",
    version: 4,
    role: "EFFECT",
    label: "Army-construction rule",
    description: "A roster-building rule: warlord/enhancement/composition/attachment limits that apply when mustering the army. max is a count (units by default) or one value per battle size ({incursion, strike-force, onslaught}); measure says what max counts (units, models or points; above 20 it counts points); per_keywords applies max once per unit with those keywords (\"one per INQUISITOR\"); faction names the allied faction a composition rule admits (kebab-case faction id); measure and per_keywords go with composition. Rule enhancement-source: the subject can only be given Enhancements from this Detachment; limit-exemption: the subject does not count toward a limit, named by exempt_from; warlord-allowed: the subject can be your Warlord although another rule forbids it. with following-filter: the group is the unit-filter right after the leaf. subject is this-unit, this-model or antecedent (the units an earlier leaf named: the group of the nearest earlier composition rule, else the unit-filter right before the leaf). object this-unit or following-filter (attachment only): the unit the subject can be attached to. exempt_from: retinue-limit with composition; enhancement-limit or strategic-reserves-points with limit-exemption. enhancement_kind: a kind of Enhancement, with enhancement-slot or unique. One group source at most: with_keywords, with or an antecedent subject.",
    starter: { rule: "" },
    parameterSchema: {
      type: "object", required: ["rule"], additionalProperties: false,
      properties: {
        rule: { enum: ["warlord-required", "warlord-forbidden", "unique", "enhancement-forbidden", "enhancement-slot", "attachment", "composition", "faction-forbidden", "single-chapter", "detachment-forbidden", "detachment-tag-exclusive", "enhancement-source", "limit-exemption", "warlord-allowed"] },
        with_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true },
        max: { anyOf: [{ type: "integer", minimum: 0, maximum: 5000 }, { type: "object", required: ["incursion", "strike-force", "onslaught"], properties: { incursion: { type: "integer", minimum: 0, maximum: 5000 }, "strike-force": { type: "integer", minimum: 0, maximum: 5000 }, onslaught: { type: "integer", minimum: 0, maximum: 5000 } }, additionalProperties: false }] },
        led_by: { anyOf: [{ enum: ["Chapter Master"] }, { type: "string", minLength: 1 }] },
        measure: { enum: ["units", "models", "points"], "x-optional": true },
        per_keywords: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true, "x-optional": true },
        faction: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-optional": true },
        with: { enum: ["following-filter"], "x-optional": true },
        subject: { enum: ["this-unit", "this-model", "antecedent"], "x-optional": true },
        object: { enum: ["this-unit", "following-filter"], "x-only-when": { rule: ["attachment"] }, "x-optional": true },
        exempt_from: { type: "array", items: { enum: ["retinue-limit", "enhancement-limit", "strategic-reserves-points"] }, minItems: 1, uniqueItems: true, "x-optional": true },
        enhancement_kind: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", "x-only-when": { rule: ["enhancement-slot", "unique"] }, "x-optional": true },
      },
    },
    normalize: normalizeArmyConstruction,
  },
  {
    id: "apply-mark",
    version: 8,
    role: "EFFECT",
    label: "Tag a unit",
    description: "Applies (or clears) a designation tag on the subject: this unit, this model, the selected unit, antecedent (the unit an earlier leaf of the record introduced, \"that enemy unit\", \"it\", bound when the record compiles), selected-objective (the objective marker a select leaf of this record bound), or visible-terrain (one terrain feature visible to the rule's unit, which the rule picks: \"select one visible terrain feature. That terrain feature is identified\"). tag is any registered designation id (tools/src/translate/designations.ts) or a source-qualified value. by names the unit that applied the designation: this-unit, this-model, selected-unit, event-subject, or recipient (the unit of the current for-each-unit pass: \"for each Observer unit …, select one enemy unit … to be marked as their Spotted unit\"); a terrain subject takes no by. The designation ends at the record's printed duration (compile-designation-expiry.ts), so a by with no printed duration is refused at compile time.",
    starter: { subject: "this-unit", tag: "" },
    parameterSchema: {
      type: "object", required: ["subject", "tag"], additionalProperties: false,
      properties: {
        subject: { anyOf: [{ enum: ["this-unit", "this-model", "selected-unit", "antecedent", "selected-objective", "visible-terrain"] }, SOURCE_QUALIFIED_SCHEMA] },
        tag: { anyOf: [{ enum: [...MARK_TAG_VALUES] }, SOURCE_QUALIFIED_SCHEMA] },
        clear: { const: true },
        by: { enum: ["this-unit", "this-model", "selected-unit", "event-subject", "recipient"], "x-optional": true },
      },
    },
    normalize: normalizeApplyMark,
  },
  {
    id: "optional-cost-paid",
    version: 2,
    role: "CONDITION",
    label: "A resource was spent this use or this turn",
    description: "Requires that the optional spend of a pool was paid during this use of the ability (window use, a YP spend, with the subject that spent it), that a spend the ability's own moment offers was paid and is read later (window trigger), or that the pool was not spent at all in the turn (window turn, negated for \"you spent no YP in that turn\"). pool is yp-pool or pain-token-pool. tag is the designation the spend sets and the read tests (a use leaf without one reads yp-spent-this-use); holder is the unit that designation is set on (trigger only; this-unit when omitted).",
    starter: { pool: "yp-pool", window: "use", subject: "this-unit" },
    parameterSchema: {
      type: "object", required: ["pool", "window"], additionalProperties: false,
      properties: {
        pool: { enum: ["yp-pool", "pain-token-pool"] },
        window: { enum: ["use", "turn", "trigger"] },
        subject: { enum: [...SUBJECT_REF] },
        negated: { type: "boolean" },
        tag: { type: "string", pattern: "^[a-z][a-z0-9-]*$", minLength: 1, maxLength: 60, "x-optional": true },
        holder: { enum: ["this-unit", "selected-unit"], "x-optional": true },
      },
    },
    normalize: normalizeOptionalCostPaid,
  },
];
