import { ANTECEDENT } from "./antecedent-families.js";
import { activitiesExtension, DICE, type FamilyExtension, keywordList, optional, properties, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/**
 * The third round of family extensions, each on top of the version the earlier rounds (or the
 * antecedent versions) made current. As there, a version checks only its own additions and hands
 * the rest of a leaf to the previous version, so leaves move across by identity.
 */

/** Where a set-up places a unit, as the DSL's set-up placement names it. */
const PLACEMENTS = ["closest-to-destruction", "closest-to-original", "deployment-zone", "wholly-within", "anywhere"] as const;
/** Who destroyed the unit ("each time this unit destroys an enemy unit"). */
const DESTROYERS = ["this-unit", "this-model", "selected-unit", ANTECEDENT] as const;

/**
 * "**CHARACTER** models in this unit have …": the effect reaches only the subject's models with
 * every listed keyword. Lowered as a model-level DSL unit-filter of the subject's own models.
 */
const MODEL_KEYWORDS = { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true };

function modelKeywords(input: Record<string, unknown>, label: string): { rest: Record<string, unknown>; added: Record<string, unknown> } {
  const { model_keywords: keywords, ...rest } = input;
  if (!("model_keywords" in input)) return { rest, added: {} };
  // Only a unit has models to pick from; this model and the attack being made have none.
  if (rest.subject === "this-model" || rest.subject === "attack") throw new TypeError(`${label}.model_keywords picks models of a unit; its subject cannot be ${String(rest.subject)}.`);
  return { rest, added: { model_keywords: keywordList(keywords, `${label}.model_keywords`, 1) } };
}

function weaponName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label}.weapon_name is the weapon's name as its datasheet prints it.`);
  return value.trim().toLowerCase();
}

/** Model keywords on an effect family whose previous version needs nothing else changed. */
function modelKeywordsExtension(family: string, what: string): FamilyExtension {
  return {
    family,
    description: `As the previous version, plus model_keywords: ${what} only the subject's models with every listed keyword ("**CHARACTER** models in this unit").`,
    schema: (previous) => withProperties(previous, { model_keywords: optional(MODEL_KEYWORDS) }),
    normalize: (input, previous) => {
      const { rest, added } = modelKeywords(input, family);
      return { ...previous(rest), ...added };
    },
  };
}

/** The keyword pattern earlier versions embed: ASCII capitals only. */
const ASCII_KEYWORD = "^[A-Z][A-Z0-9' -]*[A-Z0-9]$";
/** Keywords as the rules print them, accented capitals included ("KÂHL"). */
export const PRINTED_KEYWORD = "^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$";
/** Families whose schemas embed the ASCII keyword pattern, from `REVIEWED_FAMILY_REGISTRY`. */
const KEYWORD_FAMILIES = [
  "stratagem-target", "triggering-target", "split-unit", "ability-modifier", "model-count", "loadout",
  "destroy-models", "unit-keyword", "keyword-grant", "return-models", "bearer-eligibility", "unit-position",
] as const;

function withPrintedKeywords(schema: unknown): unknown {
  if (schema === ASCII_KEYWORD) return PRINTED_KEYWORD;
  if (Array.isArray(schema)) return schema.map(withPrintedKeywords);
  if (schema !== null && typeof schema === "object") return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, withPrintedKeywords(value)]));
  return schema;
}

/** "KÂHL" → "KAHL": the spelling an earlier version's ASCII check accepts. */
const unaccented = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");

/**
 * A keyword with accented capitals: the previous version checks the leaf with each such keyword
 * spelled without accents, then the printed spelling goes back. A leaf that also spells the
 * unaccented keyword itself is refused, since the two could not be told apart.
 */
function printedKeywordsExtension(family: string): FamilyExtension {
  return {
    family,
    description: "As the previous version, and a keyword can carry accented capitals as the rules print it (KÂHL).",
    schema: (previous) => withPrintedKeywords(previous) as Record<string, unknown>,
    normalize: (input, previous) => {
      const printed = new Map<string, string>();
      const strings: string[] = [];
      const swap = (value: unknown): unknown => {
        if (typeof value === "string") {
          strings.push(value);
          if (!new RegExp(PRINTED_KEYWORD, "u").test(value) || /^[\x20-\x7e]*$/u.test(value)) return value;
          printed.set(unaccented(value), value);
          return unaccented(value);
        }
        if (Array.isArray(value)) return value.map(swap);
        if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]));
        return value;
      };
      const staged = swap(input) as Record<string, unknown>;
      if (printed.size === 0) return previous(input);
      for (const plain of printed.keys()) if (strings.includes(plain)) throw new TypeError(`${family} names ${plain} both with and without accents.`);
      const restore = (value: unknown): unknown => {
        if (typeof value === "string") return printed.get(value) ?? value;
        if (Array.isArray(value)) return value.map(restore);
        if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item)]));
        return value;
      };
      return restore(previous(staged)) as Record<string, unknown>;
    },
  };
}

export const FAMILY_EXTENSIONS_3: readonly FamilyExtension[] = [
  {
    // "this model has the Lone Operative 9\" ability".
    family: "core-ability-grant",
    description: "As the previous version, and Lone Operative can carry its range in inches as value.",
    schema: (previous) => {
      const value = properties(previous).value!;
      const only = value["x-only-when"] as { ability: string[] };
      return withProperties(previous, { value: { ...value, "x-only-when": { ability: [...only.ability, "lone-operative"] } } });
    },
    normalize: (input, previous) => {
      if (input.ability !== "lone-operative" || !("value" in input)) return previous(input);
      if (!Number.isInteger(input.value)) throw new TypeError("core-ability-grant.value for Lone Operative is a range in inches.");
      return standIn(input, "ability", "scouts", previous);
    },
  },
  {
    // "each time this unit destroys an enemy unit", "when this unit is selected to attack".
    family: "event",
    description: "As the previous version, plus by: the unit that destroyed the unit (unit-destroyed), with object_owner saying whose unit was destroyed; and selected can be to attack (to shoot or to fight).",
    schema: (previous) => withProperties(previous, {
      to: widenedEnum(previous, "to", ["attack"]),
      by: optional({ enum: DESTROYERS, "x-only-when": { kind: ["unit-destroyed"] } }),
      object_owner: optional({ enum: ["friendly", "enemy"], "x-only-when": { kind: ["unit-destroyed"] } }),
    }),
    normalize: (input, previous) => {
      const { by, object_owner: objectOwner, ...rest } = input;
      const added: Record<string, unknown> = {};
      if ("by" in input || "object_owner" in input) {
        if (rest.kind !== "unit-destroyed") throw new TypeError("event.by and event.object_owner describe a unit-destroyed only.");
        if ("by" in input) added.by = enumValue(by, DESTROYERS, "event.by");
        if ("object_owner" in input) added.object_owner = enumValue(objectOwner, ["friendly", "enemy"], "event.object_owner");
      }
      const normalized = rest.kind === "selected" && rest.to === "attack" ? standIn(rest, "to", "shoot", previous) : previous(rest);
      return { ...normalized, ...added };
    },
  },
  {
    // "that enemy unit suffers D3+1 mortal wounds", "2D3 mortal wounds".
    family: "mortal-wounds",
    description: "As the previous version, and a count can be any dice amount plus a number (2D3, D3+1).",
    schema: (previous) => withProperties(previous, { count: { anyOf: [properties(previous).count!, { type: "string", pattern: DICE.source }] } }),
    normalize: (input, previous) => {
      // The previous version's own counts first; only a count it does not list is a new dice amount.
      if (typeof input.count !== "string" || !DICE.test(input.count.trim().toUpperCase())) return previous(input);
      try {
        return previous(input);
      } catch {
        // Not one of the previous version's counts: a dice amount, with the rest checked below.
      }
      return { ...standIn(input, "count", "D3", previous), count: input.count.trim().toUpperCase() };
    },
  },
  {
    // "set it up as close as possible to where it was destroyed", "regardless of how many units
    // are already in Strategic Reserves".
    family: "set-up",
    description: "As the previous version, plus placement (as close as possible to where it was destroyed or to where it was, wholly within its deployment zone, anywhere) and ignore_limits: the set-up ignores the limits on units in or arriving from Strategic Reserves.",
    schema: (previous) => withProperties(previous, {
      placement: optional({ enum: PLACEMENTS }),
      ignore_limits: optional({ const: true }),
    }),
    normalize: (input, previous) => {
      const { placement, ignore_limits: ignore, ...rest } = input;
      const added: Record<string, unknown> = {};
      if ("placement" in input) added.placement = enumValue(placement, PLACEMENTS, "set-up.placement");
      if ("ignore_limits" in input) {
        if (ignore !== true) throw new TypeError("set-up.ignore_limits is true or absent.");
        added.ignore_limits = true;
      }
      return { ...previous(rest), ...added };
    },
  },
  {
    // "add 1 to the Attacks characteristic of its Nemesis force weapon", "**CHARACTER** models in this unit have +1 T".
    family: "characteristic-modifier",
    description: "As the previous version, plus weapon_name (the change applies to that one weapon) and model_keywords (only the subject's models with every listed keyword).",
    schema: (previous) => withProperties(previous, { weapon_name: optional({ type: "string", minLength: 1 }), model_keywords: optional(MODEL_KEYWORDS) }),
    normalize: (input, previous) => {
      const { rest, added } = modelKeywords(input, "characteristic-modifier");
      const { weapon_name: name, ...remaining } = rest;
      const normalized = previous(remaining);
      if ("weapon_name" in rest) {
        if (normalized.weapon_type === undefined || normalized.weapon_type === "all") throw new TypeError("characteristic-modifier.weapon_name names a melee or ranged weapon; give that weapon_type.");
        added.weapon_name = weaponName(name, "characteristic-modifier");
      }
      return { ...normalized, ...added };
    },
  },
  {
    // "the Damage characteristic of its arco-flails is 2".
    family: "characteristic-set",
    description: "As the previous version, plus weapon_name: the change applies to that one weapon.",
    schema: (previous) => withProperties(previous, { weapon_name: optional({ type: "string", minLength: 1 }) }),
    normalize: (input, previous) => {
      if (!("weapon_name" in input)) return previous(input);
      const { weapon_name: name, ...rest } = input;
      const normalized = previous(rest);
      if (normalized.weapon_type === undefined || normalized.weapon_type === "all") throw new TypeError("characteristic-set.weapon_name names a melee or ranged weapon; give that weapon_type.");
      return { ...normalized, weapon_name: weaponName(name, "characteristic-set") };
    },
  },
  {
    // "adding 1 to the result", "with +1 to that roll", "subtracting 1 from that test".
    family: "roll-modifier",
    description: "As the previous version, and roll can be preceding: the roll or test the record made just before, bound when the record compiles.",
    schema: (previous) => withProperties(previous, { roll: optional(widenedEnum(previous, "roll", ["preceding"])) }),
    normalize: (input, previous) => input.roll === "preceding" ? standIn(input, "roll", "hit", previous) : previous(input),
  },
  modelKeywordsExtension("feel-no-pain", "the Feel No Pain applies to"),
  modelKeywordsExtension("invulnerable-save", "the invulnerable save applies to"),
  ...KEYWORD_FAMILIES.map(printedKeywordsExtension),
  // "if this unit disembarked from a TRANSPORT this turn", "made an Ingress move this turn", "was set up this turn".
  activitiesExtension(["disembarked-this-turn", "made-ingress-move-this-turn", "set-up-this-turn"], "three activities: disembarked this turn, made an Ingress move this turn, and was set up on the battlefield this turn"),
];

