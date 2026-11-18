import { DESIGNATION_IDS } from "../../translate/designations.js";

/** Unit-ref vocabulary, parameter checks and printed keyword spellings the unit-subject predicates share. */

export type Params = Record<string, unknown>;

/** Unit-refs every predicate subject here can be: the attack's parties, the model, the trigger's unit, the recipient and a selection. */
export const WIDE = ["this-unit", "this-model", "target", "attacker", "event-subject", "recipient", "selected-unit"] as const;
/** An earlier leaf's unit ("that unit", "it"), bound when the record compiles. */
export const ANTECEDENT = "antecedent";
export const WIDE_OR_ANTECEDENT = [...WIDE, ANTECEDENT] as const;
export const BEARER_TRANSPORT = "bearer-transport";
export const EACH_TARGET = "each-target";
export const FILTERED_UNITS = "filtered-units";
export const FOLLOWING_FILTER = "following-filter";
export const EVENT_OBJECT = "event-object";
export const KEBAB = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;
/** A unit keyword as the base check reads it: ASCII capitals. */
export const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;
export const MAX_INCHES = 48;

// ---- shared checks ----

export function exactKeys(input: Params, keys: readonly string[], family: string): void {
  const received = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (received.length !== expected.length || received.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${family} parameters must be exactly: ${expected.join(", ")}.`);
  }
}

/** Every key in `required`, each other key in `optional`. */
export function keysWithin(input: Params, required: readonly string[], optional: readonly string[], family: string): void {
  const allowed = [...required, ...optional];
  const stray = Object.keys(input).find((key) => !allowed.includes(key));
  if (stray !== undefined) throw new TypeError(`${family} has no parameter ${stray} here; it takes ${required.join(", ")}${optional.length ? ` and optionally ${optional.join(", ")}` : ""}.`);
  const missing = required.find((key) => !(key in input));
  if (missing !== undefined) throw new TypeError(`${family} parameters must include ${missing}.`);
}

export function enumValue(value: unknown, values: readonly string[], label: string): string {
  if (typeof value === "string" && values.includes(value)) return value;
  throw new TypeError(`${label} must be one of ${values.join(", ")}.`);
}

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${label} must be true or false.`);
}

export function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) return value;
  throw new TypeError(`${label} must be an integer from ${min} to ${max}.`);
}

/** A non-empty set of listed values, in the listed order. */
export function enumSet(value: unknown, values: readonly string[], label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must list at least one of ${values.join(", ")}.`);
  for (const item of value) enumValue(item, values, label);
  if (new Set(value).size !== value.length) throw new TypeError(`${label} lists a value twice.`);
  return values.filter((item) => value.includes(item));
}

export const hasDuplicate = (list: readonly unknown[]) => new Set(list).size !== list.length;

/** Keywords as the rules print them: strings only, markdown dropped, upper case, each once, sorted. */
export function keywordList(value: unknown, label: string, minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum) throw new TypeError(`${label} must list at least ${minimum} keyword${minimum === 1 ? "" : "s"}.`);
  const list = value.map((item) => {
    if (typeof item !== "string") throw new TypeError(`${label} must be strings.`);
    const keyword = item.replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort();
}

export function designationId(value: unknown, label: string): string {
  if (typeof value !== "string" || !DESIGNATION_IDS.has(value)) throw new TypeError(`${label} ${JSON.stringify(value)} is not a registered designation.`);
  return value;
}

// ---- printed keyword spellings ----

/** A keyword printed after one apostrophe ('ARDMOB). */
const LEADING_APOSTROPHE = /^'(?=\p{Lu})[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;
/** A keyword with accented capitals as the rules print it (KÂHL). */
const PRINTED_KEYWORD = /^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$/u;

const mapStrings = (value: unknown, map: (text: string) => string): unknown => {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]));
  return value;
};

/**
 * One way the rules print a keyword that the keyword checks do not read: each string in `scope` it
 * matches is checked in its plain spelling and returned as printed. A leaf that also spells the
 * plain keyword itself is refused, since the two could not be told apart.
 */
export class Spellings {
  private readonly printed = new Map<string, string>();
  private readonly restored = new Set<string>();

  constructor(private readonly family: string, scope: unknown, plain: (text: string) => string | null, private readonly what: string) {
    const strings: string[] = [];
    mapStrings(scope, (text) => {
      strings.push(text);
      const spelled = plain(text);
      if (spelled !== null) this.printed.set(spelled, text);
      return text;
    });
    for (const spelled of this.printed.keys()) if (strings.includes(spelled)) throw new TypeError(`${family} names ${spelled} both with and without ${what}.`);
  }

  /** The value with each printed keyword in its plain spelling. */
  plain(value: unknown): unknown {
    const plainOf = new Map([...this.printed].map(([spelled, original]) => [original, spelled]));
    return mapStrings(value, (text) => plainOf.get(text) ?? text);
  }

  /** The value with each plain spelling put back as printed. */
  restore<T>(value: T): T {
    return mapStrings(value, (text) => {
      const original = this.printed.get(text);
      if (original === undefined) return text;
      this.restored.add(original);
      return original;
    }) as T;
  }

  /** Refuse a printed keyword the check rewrote, so its printed spelling could not be kept. */
  requireAllRestored(): void {
    const lost = [...this.printed.values()].filter((original) => !this.restored.has(original));
    if (lost.length) throw new TypeError(`${this.family} could not keep the ${this.what} of ${lost.join(", ")}.`);
  }
}

export const apostrophes = (family: string, scope: unknown) => new Spellings(family, scope, (text) => (LEADING_APOSTROPHE.test(text) ? text.slice(1) : null), "a leading apostrophe");
export const accents = (family: string, scope: unknown) => new Spellings(
  family, scope, (text) => (PRINTED_KEYWORD.test(text) && !/^[\x20-\x7e]*$/u.test(text) ? text.normalize("NFD").replace(/\p{M}/gu, "") : null), "accents",
);

export const without = (input: Params, keys: readonly string[]): Params => Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));

export const KEYWORD_ITEMS = { type: "string", pattern: "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$" } as const;
export const KEBAB_STRING = { type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$" } as const;
