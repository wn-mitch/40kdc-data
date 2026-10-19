import { type Schema, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";

/**
 * Weapon-ability vocabulary: the keywords the printed rules name that the weapon-ability-keyword
 * and weapon-ability-grant keyword enum and pattern did not take at first. It lives apart from
 * weapons.ts because weapon-buff-families.ts (which weapons.ts imports) reads it too.
 */

/** Value-less weapon-ability keywords the later weapon-ability-keyword and weapon-ability-grant versions add. */
export const WAVE9_KEYWORDS = ["Close-quarters"] as const;

/** Value-carrying keywords those versions add: Cleave N, and Anti whose target is one of several slash-separated keywords. */
export const WAVE9_KEYWORD_PATTERN = /^(?:Cleave [1-9]|Anti-[A-Z][A-Za-z -]*[A-Za-z](?:\/[A-Z][A-Za-z -]*[A-Za-z])* [2-6]\+)$/u;

/** Whether a keyword is one those versions add. Anti with one target is already in the earlier pattern, so it is not checked here. */
export function isWave9Keyword(keyword: string): boolean {
  return (WAVE9_KEYWORDS as readonly string[]).includes(keyword) || WAVE9_KEYWORD_PATTERN.test(keyword);
}

/** The keyword property with the added values: more enum members and one more pattern branch. */
export function widenKeyword(previous: Schema): Schema {
  const widened = widenedEnum(previous, "keyword", WAVE9_KEYWORDS);
  return withProperties(previous, {
    keyword: { ...widened, anyOf: [...(widened.anyOf as Schema[]), { type: "string", pattern: WAVE9_KEYWORD_PATTERN.source }] },
  });
}

/**
 * The added keywords are checked here, and the previous version gets a keyword it already accepts in
 * their place. Its other keys still must be the ones it allows.
 */
export function normalizeWave9Keyword(input: Record<string, unknown>, previous: (rest: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  const keyword = input.keyword;
  if (typeof keyword !== "string" || !isWave9Keyword(keyword)) return previous(input);
  return standIn(input, "keyword", "Lethal Hits", previous);
}
