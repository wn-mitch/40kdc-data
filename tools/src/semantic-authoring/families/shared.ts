import { DESIGNATION_IDS } from "../../translate/designations.js";
import { ANTECEDENT } from "../antecedent-families.js";
import { type FamilyExtension, type Schema, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";

/**
 * Vocabulary and builders more than one subject file's versions use.
 */

/** Weapon abilities a characteristic change can be limited to ("Torrent weapons equipped by …"). */
export const WEAPON_KEYWORDS = [
  "Assault", "Blast", "Devastating Wounds", "Hazardous", "Heavy", "Ignores Cover", "Indirect Fire", "Lance", "Lethal Hits",
  "Melta", "One Shot", "Pistol", "Precision", "Psychic", "Rapid Fire", "Sustained Hits", "Torrent", "Twin-linked",
] as const;

/** The keyword pattern earlier versions embed: ASCII capitals only. */
const ASCII_KEYWORD = "^[A-Z][A-Z0-9' -]*[A-Z0-9]$";

/** Keywords as the rules print them, accented capitals included ("KÂHL"). */
export const PRINTED_KEYWORD = "^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$";

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
 * unaccented keyword itself is refused, since the two could not be told apart. The families whose
 * schemas embed the ASCII keyword pattern each take one such version: stratagem-target,
 * triggering-target, split-unit, ability-modifier, model-count, loadout, destroy-models,
 * unit-keyword, keyword-grant, return-models, bearer-eligibility and unit-position.
 */
export function printedKeywordsExtension(family: string, version: number): FamilyExtension {
  return {
    family,
    version,
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

/** Where a unit can be held off the battlefield. Cult Ambush is the Genestealer Cults' own. */
export const HELD_IN = ["strategic-reserves", "cult-ambush"] as const;

export const isObject = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value);

/** A distance or engagement whose other unit is the unit-filter right after the leaf. */
export const FOLLOWING_FILTER = "following-filter";

/** Keys whose value following-filter names the unit-filter right after the leaf. */
const FOLLOWING_FILTER_KEYS = ["of", "with", "object", "target", "by", "to", "into"] as const;

/** Whether a leaf names the unit-filter right after it (a distance's, engagement's or targeting's other unit). */
export function awaitsFollowingFilter(parameters: Record<string, unknown>): boolean {
  return FOLLOWING_FILTER_KEYS.some((key) => parameters[key] === FOLLOWING_FILTER);
}

/** A version whose subject also accepts antecedent: an earlier leaf's unit, bound when the record compiles. */
export function antecedentSubject(family: string, version: number, example: string): FamilyExtension {
  return {
    family,
    version,
    description: `As the previous version, plus subject antecedent: ${example}.`,
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [ANTECEDENT]) }),
    normalize: (input, previous) => input.subject === ANTECEDENT ? { ...previous({ ...input, subject: "this-unit" }), subject: ANTECEDENT } : previous(input),
  };
}

/** A condition in TARGET about every target named before it ("that have not been selected …"). */
export const EACH_TARGET = "each-target";

/** A kebab-case entity id: an enrichment ability record, a core Stratagem or a menu action. */
export const NAMED_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

/** A named entity id, or a TypeError naming the key. */
export function namedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !NAMED_ID.test(value)) throw new TypeError(`${label} is a kebab-case ability, Stratagem, manoeuvre or action id.`);
  return value;
}

export const ENHANCEMENT_KIND = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

export const WEAPON = "weapon";

/**
 * Remove keys from a family's required list, for a version where another check requires them
 * instead (or where an antecedent supplies them). A schema with no required list is returned as is.
 */
export function withoutRequired(schema: Schema, keys: string | readonly string[]): Schema {
  if (!Array.isArray(schema.required)) return schema;
  const removed: readonly string[] = typeof keys === "string" ? [keys] : keys;
  return { ...schema, required: (schema.required as string[]).filter((item) => !removed.includes(item)) };
}

/**
 * Embarked-transport shapes. A unit is embarked within a Transport (a unit state), and
 * the Transport the bearer is embarked within (`bearer-transport`) becomes a subject that the
 * effect and condition families accept. The Transport is only ever the bearer's own: a Stratagem
 * has no bearer, so compile-antecedent.ts refuses it there.
 */
export const BEARER_TRANSPORT = "bearer-transport";

/** A family whose subject gains bearer-transport; the previous version checks the rest with this-unit standing in. */
export function bearerTransportSubject(family: string, version: number, description: string): FamilyExtension {
  return {
    family,
    version,
    description,
    schema: (previous) => withProperties(previous, { subject: widenedEnum(previous, "subject", [BEARER_TRANSPORT]) }),
    normalize: (input, previous) => input.subject === BEARER_TRANSPORT ? standIn(input, "subject", "this-unit", previous) : previous(input),
  };
}

export function standInEachTarget(input: Record<string, unknown>, previous: (input: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  if (input.subject !== EACH_TARGET) return previous(input);
  const normalized = previous({ ...input, subject: "this-unit" });
  return { ...normalized, subject: EACH_TARGET };
}

/** A registered designation id: the registry is checked in normalize, the pattern in the schema. */
export function designationId(value: unknown, label: string): string {
  if (typeof value !== "string" || !DESIGNATION_IDS.has(value)) throw new TypeError(`${label} ${JSON.stringify(value)} is not a registered designation.`);
  return value;
}

/** Two to eight printed weapon names: one name is one weapon_name, so a single name needs no list. */
export const WEAPON_NAMES_MIN = 2;

export const WEAPON_NAMES_MAX = 8;

export const WEAPON_NAMES_SCHEMA = { type: "array", items: { type: "string", minLength: 1 }, minItems: WEAPON_NAMES_MIN, maxItems: WEAPON_NAMES_MAX, uniqueItems: true };

/** The weapon-name list a leaf carries: printed names, no padding, no repeats. */
export function weaponNameList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < WEAPON_NAMES_MIN || value.length > WEAPON_NAMES_MAX) {
    throw new TypeError(`${label} names ${WEAPON_NAMES_MIN} to ${WEAPON_NAMES_MAX} weapons.`);
  }
  const names = value.map((item) => {
    if (typeof item !== "string" || item.trim() === "" || item !== item.trim()) throw new TypeError(`${label} takes printed weapon names, with no padding.`);
    return item;
  });
  if (new Set(names).size !== names.length) throw new TypeError(`${label} lists a weapon name twice.`);
  return names;
}

/** Keys that name weapons some other way; a list of names takes none of them. */
export function refuseWith(input: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of keys) if (key in input) throw new TypeError(`${label} cannot combine with ${key}.`);
}

/** A unit-filter or targeting-restriction that names the matched set ("those VEHICLE units"). */
export const MATCHED_UNITS = "matched-units";

/**
 * move-passthrough-used is a CONDITION: "but if it does, after it has moved, …" names the move that
 * used a move-through permission. It folds into the move-ended moment after it
 * (compile-passthrough-used.ts), which takes the `through` filter (event@25).
 */

/** The terrain kinds a move-through permission can pass through that a "but if it does" can name. */
export const PASSTHROUGH_USED_VALUES = ["tall-terrain"] as const;

/** One printed weapon name: non-empty, with no padding. */
export function weaponName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) throw new TypeError(`${label} takes one printed weapon name, with no padding.`);
  return value;
}

/** The subject value a unit-filter folds onto a leaf (compile-antecedent.ts FILTERED_UNITS). */
export const FILTERED_UNITS = "filtered-units";

/** The Transports a unit-filter's embarked units can be embarked within: the leaf's own unit or model. */
export const EMBARKED_IN = ["this-unit", "this-model"] as const;
