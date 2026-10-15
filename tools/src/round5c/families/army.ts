import { ANTECEDENT } from "../antecedent-families.js";
import { POOL_ID_PATTERN } from "../economy-families.js";
import { DICE, type FamilyExtension, optional, properties, type Schema, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { booleanValue, boundedInteger, enumValue } from "../family-validation.js";
import { SUBJECT_REF } from "../predicate-families.js";
import { ENHANCEMENT_KIND, FOLLOWING_FILTER, isObject } from "./shared.js";

/**
 * Versions of the army-construction and resource families: army-construction, army-faction,
 * resource-gain, resource-spend and optional-cost-paid. Each version checks only its own additions
 * and hands the rest of a leaf to the previous version, so every earlier leaf still fits it
 * unchanged.
 */

export const BATTLE_SIZES = ["incursion", "strike-force", "onslaught"] as const;

export const ARMY_MEASURES = ["units", "models", "points"] as const;

const FACTION_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

const battleSizeSchema = (maximum: number) => ({
  type: "object",
  required: [...BATTLE_SIZES],
  properties: Object.fromEntries(BATTLE_SIZES.map((size) => [size, { type: "integer", minimum: 0, maximum }])),
  additionalProperties: false,
});

/** One value per battle size ("6 / 10 / 14 Resurgence points"), each within 0..maximum. */
export function battleSizeValue(value: unknown, maximum: number, label: string): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} is a number, or an object with incursion, strike-force and onslaught.`);
  const keys = Object.keys(value);
  if (keys.length !== BATTLE_SIZES.length || !BATTLE_SIZES.every((size) => keys.includes(size))) {
    throw new TypeError(`${label} names exactly incursion, strike-force and onslaught.`);
  }
  return Object.fromEntries(BATTLE_SIZES.map((size) => [size, boundedInteger((value as Record<string, unknown>)[size], 0, maximum, `${label}.${size}`)]));
}

/** Rules about the units a group names: the group is the rule's subject (its DSL target). */
export const ARMY_SUBJECT_RULES = ["warlord-required", "warlord-forbidden", "enhancement-forbidden", "enhancement-source", "limit-exemption"] as const;

/** Rules that count the units a group names: the group is what is counted (the DSL's `with`). */
export const ARMY_COUNTING_RULES = ["unique", "composition"] as const;

/** Rules about the list as a whole, which no group of units qualifies. */
export const ARMY_LIST_RULES = ["single-chapter", "detachment-forbidden", "detachment-tag-exclusive", "faction-forbidden"] as const;

const NEW_RULES = ["enhancement-source", "limit-exemption"] as const;

const SUBJECTS = ["this-unit", "this-model", ANTECEDENT] as const;

const OBJECTS = ["this-unit", FOLLOWING_FILTER] as const;

/** Limits a unit or Enhancement can be left out of: the Retinue cap, the Enhancement cap, the Strategic Reserves points cap. */
export const ARMY_EXEMPTIONS = ["retinue-limit", "enhancement-limit", "strategic-reserves-points"] as const;

export const OPTIONAL_COST_POOLS_V2 = ["yp-pool", "pain-token-pool"] as const;

export const OPTIONAL_COST_WINDOWS_V2 = ["use", "trigger", "turn"] as const;

export const OPTIONAL_COST_HOLDERS = ["this-unit", "selected-unit"] as const;

const TAG = { type: "string", pattern: "^[a-z][a-z0-9-]*$", minLength: 1, maxLength: 60 };

export const OPTIONAL_COST_PAID_V2: FamilyExtension = {
  family: "optional-cost-paid",
  version: 2,
  description: "As version 1, plus window trigger (a spend the ability's own moment offers, read later), pool pain-token-pool (not with window use), tag (the designation the spend sets and the read tests), and holder (the unit the designation is set on; trigger only).",
  schema: (previous: Schema) => {
    return withProperties(previous, {
      pool: widenedEnum(previous, "pool", OPTIONAL_COST_POOLS_V2),
      window: widenedEnum(previous, "window", OPTIONAL_COST_WINDOWS_V2),
      tag: optional(TAG),
      holder: optional({ enum: [...OPTIONAL_COST_HOLDERS] }),
    });
  },
  normalize: (input) => normalizeOptionalCostV2(input),
};

/**
 * Checks one version-2 leaf. Each window takes only its own keys: use and trigger name the
 * subject that spent and the designation tag; turn names neither, and takes negation instead.
 */
export function normalizeOptionalCostV2(input: Record<string, unknown>): Record<string, unknown> {
  const family = "optional-cost-paid";
  const window = enumValue(input.window, OPTIONAL_COST_WINDOWS_V2, `${family}.window`);
  const pool = enumValue(input.pool, OPTIONAL_COST_POOLS_V2, `${family}.pool`);
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
  if ("negated" in input) throw new TypeError(`${family} negated is only for window turn ("spent no YP in that turn").`);
  if (input.subject === undefined) throw new TypeError(`${family} window ${window} needs the subject that spent the pool.`);
  // A version-1 use leaf names no tag: it reads the legacy designation the same use's spend sets.
  if (input.tag === undefined && window !== "use") throw new TypeError(`${family} window ${window} needs the designation tag its spend sets.`);
  const tag = input.tag === undefined ? "yp-spent-this-use" : input.tag;
  if (typeof tag !== "string" || !/^[a-z][a-z0-9-]*$/u.test(tag) || tag.length > 60) throw new TypeError(`${family}.tag is a kebab-case designation id.`);
  const subject = enumValue(input.subject, SUBJECT_REF, `${family}.subject`);
  if (window === "use") return { pool, window, subject, tag };
  const holder = input.holder === undefined ? "this-unit" : enumValue(input.holder, OPTIONAL_COST_HOLDERS, `${family}.holder`);
  return { pool, window, subject, tag, holder };
}

/** A spend of as many as the player chooses, at least one ("spend one or more BTP"). */
export const ONE_OR_MORE = "one-or-more";

export const ARMY_EXTENSIONS: readonly FamilyExtension[] = [
  /**
   * Army limits per battle size or in points (allied inclusion).
   */
  {
    // "You can include Deathwatch units in your army … The combined points value of such units
    // cannot exceed 500 points": a composition limit counted in points, per battle size, or per unit.
    family: "army-construction",
    version: 2,
    description: "As the previous version, and max may be one value per battle size ({incursion, strike-force, onslaught}); measure says what max counts (units, models or points; default units); per_keywords applies max once per unit with those keywords (\"one per INQUISITOR\"); faction names the allied faction a composition rule admits (kebab-case faction id).",
    schema: (previous) => {
      const max = properties(previous).max!;
      return withProperties(previous, {
        max: { anyOf: [{ ...max, maximum: 5000 }, battleSizeSchema(5000)] },
        measure: optional({ enum: ARMY_MEASURES }),
        per_keywords: optional({ type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true }),
        faction: optional({ type: "string", pattern: FACTION_ID.source }),
      });
    },
    normalize: (input, previous) => {
      const { max, measure, per_keywords: per, faction, ...rest } = input;
      const added = measure !== undefined || per !== undefined || faction !== undefined || (max !== undefined && (isObject(max) || Number(max) > 20));
      if (!added) return previous(input);
      const result: Record<string, unknown> = { ...previous(rest) };
      if (max !== undefined) {
        result.max = isObject(max) ? battleSizeValue(max, 5000, "army-construction.max") : boundedInteger(max, 0, 5000, "army-construction.max");
      }
      if (measure !== undefined) result.measure = enumValue(measure, ARMY_MEASURES, "army-construction.measure");
      if (measure !== "points" && result.max !== undefined && !isObject(result.max) && Number(result.max) > 20) {
        throw new TypeError("army-construction.max above 20 counts points; set measure: points.");
      }
      if (per !== undefined) {
        // The previous version checks a keyword list as with_keywords does.
        result.per_keywords = (previous({ rule: rest.rule, with_keywords: per }) as { with_keywords: string[] }).with_keywords;
      }
      if (faction !== undefined) {
        if (typeof faction !== "string" || !FACTION_ID.test(faction)) throw new TypeError("army-construction.faction is a kebab-case faction id.");
        result.faction = faction;
      }
      if ((result.measure !== undefined || result.per_keywords !== undefined) && result.rule !== "composition") {
        throw new TypeError("army-construction.measure and per_keywords go with rule: composition.");
      }
      return result;
    },
  },
  {
    // "You cannot include more than one" + "PATRIARCH model"; "None of these models can be your
    // WARLORD"; "Enhancements from this Detachment do not count towards …"; "it can be attached to
    // this unit".
    family: "army-construction",
    version: 3,
    description: "As the previous version, plus: rule enhancement-source (the subject can only be given Enhancements from this Detachment) and limit-exemption (the subject does not count toward a limit, named by exempt_from); with following-filter (the group is the unit-filter right after the leaf); subject this-unit, this-model or antecedent (the units an earlier leaf named: the group of the nearest earlier composition rule, else the unit-filter right before the leaf); object this-unit or following-filter (attachment only: the unit the subject can be attached to); exempt_from (retinue-limit with composition; enhancement-limit or strategic-reserves-points with limit-exemption); enhancement_kind (a kind of Enhancement, with enhancement-slot or unique). One group source at most: with_keywords, with or an antecedent subject.",
    schema: (previous) => withProperties(previous, {
      rule: widenedEnum(previous, "rule", NEW_RULES),
      with: optional({ enum: [FOLLOWING_FILTER] }),
      subject: optional({ enum: SUBJECTS }),
      object: optional({ enum: OBJECTS, "x-only-when": { rule: ["attachment"] } }),
      exempt_from: optional({ type: "array", items: { enum: ARMY_EXEMPTIONS }, minItems: 1, uniqueItems: true }),
      enhancement_kind: optional({ type: "string", pattern: ENHANCEMENT_KIND.source, "x-only-when": { rule: ["enhancement-slot", "unique"] } }),
    }),
    normalize: (input, previous) => {
      const { with: withValue, subject, object, exempt_from: exempt, enhancement_kind: kind, ...rest } = input;
      const isNew = NEW_RULES.includes(rest.rule as typeof NEW_RULES[number]);
      if (!isNew && [withValue, subject, object, exempt, kind].every((value) => value === undefined)) return previous(input);
      // A new rule is checked as the previous version checks a subject rule.
      const normalized = isNew ? { ...standIn(rest, "rule", "warlord-forbidden", previous) } : previous(rest);
      const rule = String(normalized.rule);
      const result: Record<string, unknown> = { ...normalized };
      if (withValue !== undefined) result.with = enumValue(withValue, [FOLLOWING_FILTER], "army-construction.with");
      if (subject !== undefined) result.subject = enumValue(subject, SUBJECTS, "army-construction.subject");
      const sources = [result.with_keywords !== undefined, result.with !== undefined, result.subject === ANTECEDENT].filter(Boolean).length;
      if (sources > 1) throw new TypeError("army-construction names its group once: with_keywords, with following-filter, or subject antecedent.");
      if (sources > 0 && (ARMY_LIST_RULES as readonly string[]).includes(rule) && (result.with !== undefined || result.subject === ANTECEDENT)) {
        throw new TypeError(`army-construction rule ${rule} is about the list as a whole; no group of units qualifies it.`);
      }
      if (result.subject !== undefined && result.subject !== ANTECEDENT && (result.with_keywords !== undefined || result.with !== undefined)) {
        throw new TypeError("army-construction.subject this-unit/this-model names the subject itself; it takes no group (with_keywords or with).");
      }
      if (result.subject !== undefined && result.subject !== ANTECEDENT && ![...ARMY_SUBJECT_RULES, "attachment"].includes(rule)) {
        throw new TypeError(`army-construction.subject this-unit/this-model has no meaning for rule ${rule}.`);
      }
      if (object !== undefined) {
        if (rule !== "attachment") throw new TypeError("army-construction.object goes with rule: attachment.");
        // Attachment eligibility names its Leaders by its pattern (or is the bearer itself), never by inline keywords, a cap or a led-by.
        for (const key of ["with_keywords", "max", "led_by"]) if (result[key] !== undefined) throw new TypeError(`army-construction.object (attachment eligibility) takes no ${key}.`);
        result.object = enumValue(object, OBJECTS, "army-construction.object");
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
        if (typeof kind !== "string" || !ENHANCEMENT_KIND.test(kind)) throw new TypeError("army-construction.enhancement_kind is a kebab-case kind of Enhancement.");
        result.enhancement_kind = kind;
      }
      return result;
    },
  },
  {
    // "If your Army Faction is not X".
    family: "army-faction",
    version: 3,
    description: "As the previous version, plus negated: your Army Faction is not this faction.",
    schema: (previous) => withProperties(previous, { negated: optional({ type: "boolean" }) }),
    normalize: (input, previous) => {
      if (!("negated" in input)) return previous(input);
      const { negated, ...rest } = input;
      return { ...previous(rest), ...(booleanValue(negated, "army-faction.negated") ? { negated: true } : {}) };
    },
  },
  /**
   * A pool's amount per battle size.
   */
  {
    // "you start the battle with 6 / 10 / 14 Resurgence points, depending on the battle size".
    family: "resource-gain",
    version: 3,
    description: "As the previous version, and amount may be one value per battle size ({incursion, strike-force, onslaught}).",
    schema: (previous) => {
      const amount = properties(previous).amount!;
      return withProperties(previous, { amount: { anyOf: [...(amount.anyOf as unknown[]), battleSizeSchema(100)] } });
    },
    normalize: (input, previous) => {
      if (!isObject(input.amount) || "source" in (input.amount as Record<string, unknown>)) return previous(input);
      return { ...standIn(input, "amount", 1, previous), amount: battleSizeValue(input.amount, 100, "resource-gain.amount") };
    },
  },
  /**
   * Resource gains with a dice amount and a plain pool id. "You gain an additional D3 Miracle dice"
   * and "gain D3 Blood Tithe points" give the amount as dice; "start the battle with 2 additional
   * Resurgence points" names the pool plainly. The previous version keeps every value it accepted:
   * the v3 pool branches (including the known-id enum the samplers read) stay, and the dice amount
   * is an added branch. Earlier versions refuse a dice amount, so existing leaves keep their
   * meaning, and `{source: ...}` still fails at compile time because it is quoted text.
   */
  {
    family: "resource-gain",
    version: 4,
    description: "As the previous version, and amount may be a dice amount (D3, D6, 2D6, D3+1) for a gain rolled on the bearer's ability, and pool may be any kebab-case pool id. Dice amounts are normalized to uppercase.",
    schema: (previous) => {
      const { amount, pool } = properties(previous);
      return withProperties(previous, {
        amount: { anyOf: [...(amount.anyOf as unknown[]), { type: "string", pattern: DICE.source, examples: ["D3"] }] },
        pool: { anyOf: [...(pool.anyOf as unknown[]), { type: "string", pattern: POOL_ID_PATTERN.source }] },
      });
    },
    normalize: (input, previous) => {
      if (typeof input.amount !== "string") return previous(input);
      const dice = input.amount.trim().toUpperCase();
      if (!DICE.test(dice)) return previous(input);
      return { ...standIn(input, "amount", 1, previous), amount: dice };
    },
  },
  /**
   * An open amount: "spend one or more BTP you have". The DSL's resource-spend names it (`amount:
   * one-or-more`). A cap ("up to 2") is not this value: nothing in the DSL says the largest amount,
   * so such a leaf keeps its number or stays unauthored.
   */
  {
    family: "resource-spend",
    version: 3,
    description: "As the previous version, plus amount one-or-more: the player chooses how many to spend, at least one (\"spend one or more BTP you have\").",
    schema: (previous) => {
      const amount = properties(previous).amount as Schema;
      return withProperties(previous, { amount: { ...amount, anyOf: [...(amount.anyOf as Schema[]), { const: ONE_OR_MORE }] } });
    },
    normalize: (input, previous) => input.amount === ONE_OR_MORE ? standIn(input, "amount", "all", previous) : previous(input),
  },
  /**
   * Version 1 reads a use-time spend only from the same use (window use, subject that spent).
   * Version 2 adds:
   *
   * - window trigger: "if you spent YP/Pain tokens" read at a later moment of the ability, which is
   *   the spend the ability's own event offers (compile-optional-cost.ts).
   * - pool pain-token-pool (window trigger and turn only; a use spends YP).
   * - tag: the designation this ability's spend sets and its read tests. Each ability names its
   *   own, so two abilities never read each other's designation.
   * - holder: the unit the designation is set on (trigger only; this-unit by default).
   *
   * Version 1 leaves keep their meaning: a use leaf with no tag reads the legacy yp-spent-this-use
   * tag.
   */
  OPTIONAL_COST_PAID_V2,
];
