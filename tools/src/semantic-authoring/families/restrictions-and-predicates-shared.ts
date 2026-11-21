import { ANTECEDENT } from "../antecedent-families.js";
import { booleanValue, enumValue } from "../family-validation.js";

/** Constants and checks the restriction, resource and predicate family files share. */

export type Params = Record<string, unknown>;

/** Every unit-ref role the describer renders a phrase for (`condition-refs.ts` ROLE_PHRASES). */
export const SUBJECT_REF = [
  "this-unit", "this-model", "model-in-this-unit", "attacker", "defender",
  "event-subject", "event-object", "selected-unit", "recipient",
] as const;
export const SUBJECTS_OR_ANTECEDENT = [...SUBJECT_REF, ANTECEDENT] as const;

export const FOLLOWING_FILTER = "following-filter";

/** A kebab-case entity id: an ability record, profile, region, faction or datasheet. */
export const ENTITY_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

export const WINDOW_PHASES = ["command", "movement", "shooting", "charge", "fight"] as const;
export const PHASE_SET_SCHEMA = { type: "array", items: { enum: WINDOW_PHASES }, minItems: 0, uniqueItems: true };

export const BATTLE_SIZES = ["incursion", "strike-force", "onslaught"] as const;

/** A unit keyword as the DSL writes it: ASCII capitals, without markdown emphasis. */
export const UNIT_KEYWORD = /^[A-Z][A-Z0-9' -]*[A-Z0-9]$/u;
/** A keyword as the rules print it: accented capitals (KÂHL). */
export const ACCENTED_KEYWORD = /^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$/u;
/** A keyword printed after one apostrophe ('ARDMOB). */
export const LEADING_APOSTROPHE = /^'(?=\p{Lu})[\p{Lu}\p{N}' -]*[\p{Lu}\p{N}]$/u;
/** The schema pattern of a printed keyword: an optional leading apostrophe, then accented capitals. */
export const PRINTED_KEYWORD_PATTERN = "^'?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9' -]*[A-ZÀ-ÖØ-Þ0-9]$";

export const isObject = (value: unknown): value is Params => typeof value === "object" && value !== null && !Array.isArray(value);

export function trueFlag(value: unknown, label: string): true {
  if (value === true) return true;
  throw new TypeError(`${label} must be true.`);
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new TypeError(`${label} must be a nonempty string.`);
}

export function negation(input: Params, family: string): { negated?: boolean } {
  return "negated" in input ? { negated: booleanValue(input.negated, `${family}.negated`) } : {};
}

/** The optional subject of a predicate, from `values`. */
export function subjectOf(input: Params, values: readonly string[] = SUBJECT_REF): { subject?: string } {
  return "subject" in input ? { subject: enumValue(input.subject, values, "subject") } : {};
}

/** The keys a predicate leaf holds: the listed ones, each only when the leaf has it. */
export const present = (input: Params, keys: readonly string[]) => keys.filter((key) => key in input);

export function allStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) allStrings(item, into);
  else if (isObject(value)) for (const item of Object.values(value)) allStrings(item, into);
  return into;
}

export const withoutApostrophe = (text: string) => LEADING_APOSTROPHE.test(text) ? text.slice(1) : text;
export const unaccented = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");
export const isAccented = (text: string) => ACCENTED_KEYWORD.test(text) && !/^[\x20-\x7e]*$/u.test(text);

/**
 * The printed spellings of one leaf's keywords: a leading apostrophe ('ARDMOB) and, for the keys
 * that take them, accented capitals (KÂHL). A keyword is checked in its bare ASCII form and comes
 * back as printed. A leaf that also spells a printed keyword's bare form anywhere is refused, since
 * the two could not be told apart.
 */
export class PrintedKeywords {
  private readonly apostrophes = new Map<string, string>();
  private readonly accents = new Map<string, string>();
  private readonly kept = new Set<string>();

  /** `plainKeys` hold keywords (or other strings) that take no accented capitals. */
  constructor(private readonly family: string, input: Params, plainKeys: readonly string[] = []) {
    const strings = allStrings(input);
    for (const text of strings) if (LEADING_APOSTROPHE.test(text)) this.apostrophes.set(text.slice(1), text);
    for (const bare of this.apostrophes.keys()) {
      if (strings.includes(bare)) throw new TypeError(`${family} names ${bare} both with and without a leading apostrophe.`);
    }
    const accentable = allStrings(Object.fromEntries(Object.entries(input).filter(([key]) => !plainKeys.includes(key)))).map(withoutApostrophe);
    for (const text of accentable) if (isAccented(text)) this.accents.set(unaccented(text), text);
    for (const plain of this.accents.keys()) {
      if (accentable.includes(plain)) throw new TypeError(`${family} names ${plain} both with and without accents.`);
    }
  }

  /** The value as the ASCII keyword check sees it: no leading apostrophe and, if `accented`, no accents. */
  bare(value: unknown, accented = true): unknown {
    if (typeof value === "string") {
      const text = withoutApostrophe(value);
      return accented && isAccented(text) ? unaccented(text) : text;
    }
    if (Array.isArray(value)) return value.map((item) => this.bare(item, accented));
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.bare(item, accented)]));
    return value;
  }

  /** A checked keyword in its printed spelling. */
  printed(keyword: string, accented = true): string {
    const spelled = accented ? this.accents.get(keyword) ?? keyword : keyword;
    const original = this.apostrophes.get(spelled);
    if (original === undefined) return spelled;
    this.kept.add(original);
    return original;
  }

  /** Fail if a keyword's canonical form lost its leading apostrophe (a keyword the check rewrote). */
  finish<T>(result: T): T {
    const lost = [...this.apostrophes.values()].filter((original) => !this.kept.has(original));
    if (lost.length) throw new TypeError(`${this.family} could not keep the leading apostrophe of ${lost.join(", ")}.`);
    return result;
  }
}

/** A keyword list in canonical form: no emphasis, single spaces, upper case, sorted, each once. */
export function keywordList(value: unknown, label: string, minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new TypeError(minimum === 0 ? `${label} must be a list of keywords.` : `${label} must list at least ${minimum === 1 ? "one keyword" : `${minimum} keywords`}.`);
  }
  const list = value.map((item) => {
    const keyword = String(item).replaceAll("*", "").replace(/\s+/gu, " ").trim().toUpperCase();
    if (!UNIT_KEYWORD.test(keyword)) throw new TypeError(`${label} keyword ${JSON.stringify(item)} is not a unit keyword.`);
    return keyword;
  });
  if (new Set(list).size !== list.length) throw new TypeError(`${label} lists a keyword twice.`);
  return list.sort();
}

export const OWNERS = ["friendly", "enemy"] as const;
