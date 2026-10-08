import { type FamilyExtension, type Schema, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-9 weapon-ability vocabulary: the keywords the printed rules name that the keyword enum and
 * pattern did not yet take. Each widening adds keywords and changes nothing a previous version
 * accepted. Both weapon-ability-keyword and weapon-ability-grant take the same additions.
 *
 * - Close-quarters: a value-less keyword, distinct from the shooting mode `close-quarters`.
 * - Cleave N: a value-carrying keyword, N from 1 to 9.
 * - Anti with a target list: "Anti-Monster/Vehicle 4+" (one of the slash-separated targets).
 */

/** Value-less keywords added in wave 9. */
export const WAVE9_KEYWORDS = ["Close-quarters"] as const;

/** Value-carrying keywords added in wave 9: Cleave N, and Anti whose target is one of several slash-separated keywords. */
export const WAVE9_KEYWORD_PATTERN = /^(?:Cleave [1-9]|Anti-[A-Z][A-Za-z -]*[A-Za-z](?:\/[A-Z][A-Za-z -]*[A-Za-z])* [2-6]\+)$/u;

/** Whether a keyword is one wave 9 adds. Anti with one target is already in the earlier pattern, so it is not checked here. */
export function isWave9Keyword(keyword: string): boolean {
  return (WAVE9_KEYWORDS as readonly string[]).includes(keyword) || WAVE9_KEYWORD_PATTERN.test(keyword);
}

/** The keyword property with the wave-9 values: more enum members and one more pattern branch. */
function widenKeyword(previous: Schema): Schema {
  const widened = widenedEnum(previous, "keyword", WAVE9_KEYWORDS);
  return withProperties(previous, {
    keyword: { ...widened, anyOf: [...(widened.anyOf as Schema[]), { type: "string", pattern: WAVE9_KEYWORD_PATTERN.source }] },
  });
}

/**
 * Wave-9 keywords are checked here, and the previous version gets a keyword it already accepts in
 * their place. Its other keys still must be the ones it allows.
 */
function normalizeWave9Keyword(input: Record<string, unknown>, previous: (rest: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  const keyword = input.keyword;
  if (typeof keyword !== "string" || !isWave9Keyword(keyword)) return previous(input);
  return standIn(input, "keyword", "Lethal Hits", previous);
}

export const FAMILY_EXTENSIONS_13_WEAPON_VOCABULARY: readonly FamilyExtension[] = [
  {
    family: "weapon-ability-keyword",
    description: "As the previous version, plus Close-quarters, Cleave N (N from 1 to 9) and Anti with several slash-separated target keywords (\"Anti-Monster/Vehicle 4+\", one of them).",
    schema: widenKeyword,
    normalize: normalizeWave9Keyword,
  },
  {
    family: "weapon-ability-grant",
    description: "As the previous version, and the keyword can be Close-quarters, Cleave N or Anti with several slash-separated target keywords.",
    schema: widenKeyword,
    normalize: normalizeWave9Keyword,
  },
];
