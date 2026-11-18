import {
  enumOrSource, type SourceQualifiedValue,
} from "../family-validation.js";

/** Keyword spellings, unit-refs and patterns the movement-and-units family files share. */

export type Params = Record<string, unknown>;

export const ANTECEDENT = "antecedent";
export const EVENT_SUBJECT = "event-subject";

/** A kebab-case entity id. */
export const ENTITY_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
/** A unit keyword as the DSL writes it: ASCII capitals. */
const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;
/** A dice amount, optionally plus a number: D3, 2D6, D3+3. */
export const DICE = /^\d*D(3|6)(\+\d+)?$/u;

export const MOVE_SUBJECTS = ["this-unit", "this-model", "selected-unit"] as const;
export const MOVE_ACTOR_SUBJECTS = ["this-unit", "this-model"] as const;

// ---------------------------------------------------------------------------------------------
// Printed keyword spellings

/** A keyword printed after one apostrophe ('ARDMOB). */
const LEADING_APOSTROPHE = /^'(?=\p{Lu})[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;
/** A keyword with accented capitals as the rules print it (KÂHL). */
const PRINTED_KEYWORD = /^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$/u;
const unaccented = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Check a leaf with every keyword in its plain spelling, then give each keyword back its printed
 * spelling. `plain` maps a printed string to its plain form, or returns it unchanged. A leaf that
 * also spells the plain form itself is refused, since the two could not be told apart. With
 * `keep`, a printed keyword the check drops is an error.
 */
function printedSpelling(
  family: string,
  input: Params,
  check: (input: Params) => Params,
  plain: (value: string) => string,
  clash: (plain: string) => string,
  keep: boolean,
): Params {
  const printed = new Map<string, string>();
  const strings: string[] = [];
  const swap = (value: unknown): unknown => {
    if (typeof value === "string") {
      strings.push(value);
      const spelled = plain(value);
      if (spelled !== value) printed.set(spelled, value);
      return spelled;
    }
    if (Array.isArray(value)) return value.map(swap);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]));
    return value;
  };
  const staged = swap(input) as Params;
  if (printed.size === 0) return check(input);
  for (const spelled of printed.keys()) if (strings.includes(spelled)) throw new TypeError(clash(spelled));
  const restored = new Set<string>();
  const restore = (value: unknown): unknown => {
    if (typeof value === "string") {
      const original = printed.get(value);
      if (original === undefined) return value;
      restored.add(original);
      return original;
    }
    if (Array.isArray(value)) return value.map(restore);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item)]));
    return value;
  };
  const result = restore(check(staged)) as Params;
  if (keep) {
    const lost = [...printed.values()].filter((original) => !restored.has(original));
    if (lost.length) throw new TypeError(`${family} could not keep the leading apostrophe of ${lost.join(", ")}.`);
  }
  return result;
}

/** Keywords may start with an apostrophe as the rules print them ('ARDMOB). */
export function withApostrophes(family: string, input: Params, check: (input: Params) => Params): Params {
  return printedSpelling(
    family, input, check,
    (value) => LEADING_APOSTROPHE.test(value) ? value.slice(1) : value,
    (spelled) => `${family} names ${spelled} both with and without a leading apostrophe.`,
    true,
  );
}

/** Keywords may carry accented capitals as the rules print them (KÂHL). */
export function withAccents(family: string, input: Params, check: (input: Params) => Params): Params {
  return printedSpelling(
    family, input, check,
    (value) => !PRINTED_KEYWORD.test(value) || /^[\x20-\x7e]*$/u.test(value) ? value : unaccented(value),
    (spelled) => `${family} names ${spelled} both with and without accents.`,
    false,
  );
}

/** A list of ASCII unit keywords, sorted, with markdown emphasis and extra spaces removed. */
export function keywordList(value: unknown, label: string, minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum) throw new TypeError(`${label} must list at least ${minimum} keyword${minimum === 1 ? "" : "s"}.`);
  const list = value.map((item) => {
    const keyword = String(item).replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort();
}

/** One ASCII unit keyword, with markdown emphasis and extra spaces removed. */
export function modelKeyword(value: unknown, label: string): string {
  const keyword = String(value).replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
  if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} must be a unit keyword.`);
  return keyword;
}

/** A unit-ref that is one of `values` or one of the bare refs in `extra`, which take no source snippet. */
export function subjectOrSource(value: unknown, values: readonly string[], extra: readonly string[], label: string): string | SourceQualifiedValue {
  if (typeof value === "string" && extra.includes(value)) return value;
  return enumOrSource(value, values, label);
}
