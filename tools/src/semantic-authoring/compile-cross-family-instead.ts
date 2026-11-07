import { allOf, negate } from "./compile-conditions.js";
import { CONFLICTING_DURATIONS } from "./compile-durations.js";
import { isRollMarker } from "./compile-dice.js";
import type { Placement } from "./compile-placement.js";
import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** The fields of a planned effect that a cross-family "instead" reads and gates (compile.ts PlannedEffect). */
export type CrossFamilyItem = { index: number; leaf: CompileLeaf; gate: Node[]; replaces: boolean };

/** The restoration pair: the only families an "instead" may replace across families. */
const RESTORATION = new Set(["return-models", "regain-wounds"]);

/** A roll band that gates the replaced effect covers its replacement too (compile-dice.ts). */
export function inheritBand(replaced: CrossFamilyItem, replacement: CrossFamilyItem): void {
  const band = replaced.gate.filter(isRollMarker);
  if (band.length === 1 && !replacement.gate.some(isRollMarker)) replacement.gate = [...band, ...replacement.gate];
}

/**
 * The earlier restoration effects of the other family that an "instead" can replace: those in its own
 * sentence, else those in the sentence before it. Nothing further back is searched. A replacement outside
 * the restoration pair gets no candidates, so its refusal is the caller's.
 */
export function crossFamilyCandidates<T extends CrossFamilyItem>(
  planned: readonly T[],
  places: readonly Placement[],
  optionalSpends: ReadonlySet<CompileLeaf>,
  replacement: T,
): T[] {
  if (!RESTORATION.has(replacement.leaf.family_id)) return [];
  const sentence = places[replacement.index]!.sentence;
  for (const at of [sentence, sentence - 1]) {
    const found = planned.filter((item) => item !== replacement && item.index < replacement.index && !item.replaces
      && RESTORATION.has(item.leaf.family_id) && item.leaf.family_id !== replacement.leaf.family_id
      && !optionalSpends.has(item.leaf) && places[item.index]!.sentence === at);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * Gates one earlier restoration effect (and the earlier alternatives of its default sentence) "not" the
 * replacing condition, and the replacement on it. The default sentence's alternatives are swept because an
 * "instead" in a later sentence replaces that whole default sentence. Returns the error to report, or null.
 */
export function replaceAcrossFamilies<T extends CrossFamilyItem>(
  planned: readonly T[],
  places: readonly Placement[],
  boundDuration: ReadonlyMap<number, string>,
  replacement: T,
  cand: T,
): string | null {
  const alternative = allOf(replacement.gate);
  if (!alternative) return `"Instead" needs a condition in its clause saying when ${replacement.leaf.family_id} is replaced.`;
  const swept = planned.filter((item) => item !== cand && item.replaces && item.leaf.family_id === cand.leaf.family_id
    && places[item.index]!.sentence === places[cand.index]!.sentence);
  const group = [cand, ...swept];
  if (group.some((item) => boundDuration.has(item.index) !== boundDuration.has(replacement.index))) return CONFLICTING_DURATIONS;
  for (const item of group) item.gate = [...item.gate, negate(alternative)];
  inheritBand(cand, replacement);
  replacement.replaces = true;
  return null;
}

/**
 * "This unit does not have the K ability, but instead, each time … re-roll … and re-roll …": an "instead" whose clause
 * opens with a suppressed rule (a rule-state with direction suppressed) as its only effect before the word, and is
 * followed in its sentence by effects. The suppressed rule is what the unit gives up, not a default the clause replaces;
 * the trade has no condition, so nothing is gated and the effects after "instead" (one or several, across the
 * sentence's clauses) apply beside the loss. An "instead" with a condition on any of these effects, after any other
 * effect, or followed by no effect is not a trade and keeps the replacement rules.
 */
export function tradesSuppressedRule<T extends CrossFamilyItem>(planned: readonly T[], places: readonly Placement[], combinator: number): boolean {
  const { sentence, clause } = places[combinator]!;
  const before = planned.filter((item) => item.index < combinator && places[item.index]!.clause === clause);
  const after = planned.filter((item) => item.index > combinator && places[item.index]!.sentence === sentence);
  return before.length === 1 && after.length > 0 && before[0]!.leaf.family_id === "rule-state" && before[0]!.leaf.parameters.direction === "suppressed"
    && !before[0]!.replaces && [...before, ...after].every((item) => item.gate.length === 0);
}
