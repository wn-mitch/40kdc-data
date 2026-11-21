/** Helpers shared by the unit-filter, aura and selection, and targeting family files. */

export type Params = Record<string, unknown>;

/** Kebab-case ids: rule slugs, ability, Stratagem, datasheet and option ids. */
export const KEBAB_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
export const KEBAB_ID_PATTERN = "^[a-z0-9][a-z0-9-]*[a-z0-9]$";

/** A unit keyword as the DSL writes it: uppercase ASCII words, without markdown emphasis. */
export const ASCII_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;

/** A keyword the rules print after one apostrophe ('ARDMOB). */
export const LEADING_APOSTROPHE = /^'(?=\p{Lu})[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;

/** A selection name: the bind_as of an earlier selection, or the name one selection binds. */
export const SELECTION_NAME = /^[a-z][a-z0-9_-]*$/u;
export const SELECTION_NAME_SCHEMA = { type: "string", pattern: "^[a-z][a-z0-9_-]*$", minLength: 1, maxLength: 40 };

export const STRING_LIST_SCHEMA = { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } };
export const APOSTROPHE_KEYWORD_ITEMS = { type: "string", pattern: "^'?[A-Z][A-Z0-9' -]*[A-Z0-9]$" };

export function selectionName(value: unknown, field: string): string {
  if (typeof value !== "string" || !SELECTION_NAME.test(value) || value.length > 40) throw new TypeError(`${field} is a lowercase selection name.`);
  return value;
}

/** Keywords in the DSL's ASCII spelling, upper-cased, each once, sorted. */
export function keywordList(value: unknown, label: string, minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum) throw new TypeError(`${label} must list at least ${minimum} keyword${minimum === 1 ? "" : "s"}.`);
  const list = value.map((item) => {
    const keyword = String(item).replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!ASCII_KEYWORD.test(keyword)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort();
}

export function mapStrings(value: unknown, change: (text: string) => string): unknown {
  if (typeof value === "string") return change(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, change));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, change)]));
  return value;
}

/**
 * A keyword printed after one apostrophe ('ARDMOB) is checked, canonicalised and ordered as the
 * keyword without it, then printed with it again. A leaf that also names the keyword without the
 * apostrophe is refused, since the two spellings could not be told apart; so is one whose keyword
 * the check rewrites (a doubled space), since its apostrophe would have no keyword to go back on.
 */
export function withLeadingApostrophes(family: string, input: Params, check: (input: Params) => Params): Params {
  const printed = new Map<string, string>();
  const strings: string[] = [];
  const staged = mapStrings(input, (text) => {
    strings.push(text);
    if (!LEADING_APOSTROPHE.test(text)) return text;
    printed.set(text.slice(1), text);
    return text.slice(1);
  }) as Params;
  if (printed.size === 0) return check(input);
  for (const plain of printed.keys()) if (strings.includes(plain)) throw new TypeError(`${family} names ${plain} both with and without a leading apostrophe.`);
  const restored = new Set<string>();
  const result = mapStrings(check(staged), (text) => {
    const original = printed.get(text);
    if (original === undefined) return text;
    restored.add(original);
    return original;
  }) as Params;
  const lost = [...printed.values()].filter((original) => !restored.has(original));
  if (lost.length) throw new TypeError(`${family} could not keep the leading apostrophe of ${lost.join(", ")}.`);
  return result;
}

export const MATCHED_UNITS = "matched-units";
