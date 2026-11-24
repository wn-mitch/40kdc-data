/** The weapon and keyword vocabulary, schema pieces and checks the buff and weapon families share. */

export type Params = Record<string, unknown>;

export const ANTECEDENT = "antecedent";
export const UNIT_SUBJECTS = ["this-unit", "this-model"] as const;
export const WEAPON_TYPES = ["all", "melee", "ranged"] as const;

/** Weapon abilities a change, scope or grant can select or exclude weapons by. */
export const WEAPON_KEYWORDS = [
  "Assault", "Blast", "Devastating Wounds", "Hazardous", "Heavy", "Ignores Cover", "Indirect Fire", "Lance", "Lethal Hits",
  "Melta", "One Shot", "Pistol", "Precision", "Psychic", "Rapid Fire", "Sustained Hits", "Torrent", "Twin-linked",
];
export const DICE = /^\d*D(3|6)(\+\d+)?$/u;
export const ENTITY_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
export const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;
export const LEADING_APOSTROPHE = /^'(?=\p{Lu})[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;

export const ENTITY_ID_SCHEMA = { type: "string", pattern: ENTITY_ID.source };
export const DICE_SCHEMA = { type: "string", pattern: DICE.source };
export const MODEL_KEYWORDS_SCHEMA = { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true, "x-optional": true };
export const WEAPON_NAMES_SCHEMA = { type: "array", items: { type: "string", minLength: 1 }, minItems: 2, maxItems: 8, uniqueItems: true, "x-optional": true };

export const isObject = (value: unknown): value is Params => value !== null && typeof value === "object" && !Array.isArray(value);

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new TypeError(`${label} must be a nonempty string.`);
}

export function constTrue(value: unknown, label: string): true {
  if (value === true) return true;
  throw new TypeError(`${label} must be true.`);
}

/** Every string in a JSON value, at any depth. */
export function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isObject(value)) return Object.values(value).flatMap(strings);
  return [];
}

/** A unit keyword as a model filter writes it: no emphasis, single spaces, upper case. */
export const foldKeyword = (item: unknown): string => String(item).replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();

/**
 * Model keywords, folded and sorted. With `apostrophe`, an item printed after one apostrophe
 * ('ARDMOB) keeps it: its body must already be a folded keyword, and sorts by the body. No string
 * of `context` may spell that body without the apostrophe.
 */
export function modelKeywordList(value: unknown, label: string, apostrophe?: { family: string; context: readonly string[] }): string[] {
  if (!Array.isArray(value) || value.length < 1) throw new TypeError(`${label} must list at least 1 keyword.`);
  const entries = value.map((item) => {
    if (apostrophe && typeof item === "string" && LEADING_APOSTROPHE.test(item)) {
      const body = item.slice(1);
      if (apostrophe.context.includes(body)) throw new TypeError(`${apostrophe.family} names ${body} both with and without a leading apostrophe.`);
      if (foldKeyword(body) !== body) throw new TypeError(`${apostrophe.family} could not keep the leading apostrophe of ${item}.`);
      if (!UNIT_KEYWORD.test(body)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
      return { key: body, out: item };
    }
    const key = foldKeyword(item);
    if (!UNIT_KEYWORD.test(key)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return { key, out: key };
  });
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length) throw new TypeError(`${label} lists a keyword twice.`);
  return entries.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)).map((entry) => entry.out);
}


/** Two to eight printed weapon names: no padding, no repeats. */
export function weaponNameList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) throw new TypeError(`${label} names 2 to 8 weapons.`);
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "" || item !== item.trim()) throw new TypeError(`${label} takes printed weapon names, with no padding.`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} lists a weapon name twice.`);
  return value as string[];
}

/**
 * What a modifier does not stack with ("this is not cumulative with any other negative modifiers to
 * that Charge roll", "not cumulative with the REAVERS' Matchless Swiftness ability"): every other
 * negative modifier to the same roll or characteristic, or the one named ability's own change.
 */
export const NOT_CUMULATIVE_SCHEMA = {
  anyOf: [{ const: "negative-modifiers" }, { type: "object", required: ["ability"], properties: { ability: ENTITY_ID_SCHEMA }, additionalProperties: false }],
  "x-optional": true,
};

export function notCumulative(value: unknown, label: string): string | Params {
  if (value === "negative-modifiers") return value;
  if (isObject(value) && Object.keys(value).length === 1 && typeof value.ability === "string" && ENTITY_ID.test(value.ability)) return { ability: value.ability };
  throw new TypeError(`${label} is negative-modifiers or {ability: id}.`);
}
