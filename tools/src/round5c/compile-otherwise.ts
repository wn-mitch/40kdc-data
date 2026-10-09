import type { CompileLeaf } from "./compile-fragments.js";
import type { Placement } from "./compile-placement.js";

/**
 * An "Otherwise" sentence is the else-branch of the sentence before it. The compiler has no
 * else-branch for a sentence's condition, so a leading condition there would gate the Otherwise
 * sentence too. A result band's "otherwise" is handled by the dice shapes (compile-dice.ts).
 */

export const OTHERWISE_REFUSAL = "An Otherwise sentence needs an otherwise-else-branch; the earlier condition would gate it.";

const OPENS_OTHERWISE = /^[\s.;:,]*otherwise\b/iu;

/**
 * Refuses an "Otherwise" sentence when a condition that would gate it is in scope: a leading
 * condition of the sentence before it, or of the ability's first effect sentence, which gates every
 * effect (compile.ts). Stratagem TARGET conditions are eligibility, not gates, and roll bands are exempt.
 */
export function refuseOtherwiseGates(list: readonly CompileLeaf[], places: readonly Placement[], sourceText: string | undefined): string[] {
  if (sourceText === undefined) return [];
  const bytes = Buffer.from(sourceText, "utf8");
  const effectSentences = list.flatMap((leaf, at) => leaf.role === "EFFECT" ? [places[at]!.sentence] : []);
  if (effectSentences.length === 0) return [];
  const firstSentence = Math.min(...effectSentences);
  for (let index = 1; index < list.length; index += 1) {
    const previous = places[index - 1]!.sentence;
    if (places[index]!.sentence === previous) continue;
    const before = list[index - 1]!;
    const after = list[index]!;
    if (before.end_byte === undefined || after.start_byte < before.end_byte) continue;
    if (!OPENS_OTHERWISE.test(bytes.subarray(before.end_byte, after.start_byte).toString("utf8"))) continue;
    const leadingIn = (sentence: number) => {
      const first = list.findIndex((leaf, at) => leaf.role === "EFFECT" && places[at]!.sentence === sentence);
      return list.some((leaf, at) => places[at]!.sentence === sentence && leaf.role === "CONDITION"
        && leaf.family_id !== "roll-result" && leaf.fragment !== "TARGET" && (first === -1 || at < first));
    };
    if (leadingIn(previous) || leadingIn(firstSentence)) return [OTHERWISE_REFUSAL];
  }
  return [];
}
