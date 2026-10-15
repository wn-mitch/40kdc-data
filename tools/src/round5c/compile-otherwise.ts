import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { allOf, condition, negate } from "./compile-conditions.js";
import type { Placement } from "./compile-placement.js";
import { WRAP_CONDITION_FAMILIES } from "./compile-wrappers.js";

/**
 * An "Otherwise" sentence is the else branch of the sentence before it. The compiler has no
 * else-branch for a sentence's condition, so a leading condition there would gate the Otherwise
 * sentence too. A result band's "otherwise" is handled by the dice shapes (compile-dice.ts).
 *
 * Shape: an `otherwise` leaf opens the sentence O, and the sentence P before it carries the leading
 * conditions G_P. The else gate of O is the negation of G_P (compile.ts ANDs it with O's own
 * leaves, so a restated condition in O is still required). G_P gates P only, not the sentences after O.
 * Without an `otherwise` leaf, an Otherwise sentence is refused (refuseOtherwiseGates).
 */

export const OTHERWISE_REFUSAL = "An Otherwise sentence needs an otherwise-else-branch; the earlier condition would gate it.";
export const OTHERWISE_TEXT = "An otherwise leaf must open its own sentence and span the word Otherwise.";
export const OTHERWISE_NO_EFFECT = "An Otherwise sentence needs an effect of its own for its else branch to decide.";
export const OTHERWISE_NO_PRECEDING = "An Otherwise sentence needs the sentence before it to have an effect and a leading condition for the else branch to negate.";
export const OTHERWISE_ROLL = "An Otherwise after a result band takes its else from the dice shapes (compile-dice.ts), not from a condition.";
export const OTHERWISE_UNNEGATABLE = "The condition before an Otherwise sentence is a selection, a wrapper, a per-unit gate or an attacker gate, which an else branch cannot negate.";
export const OTHERWISE_AMBIGUOUS = "An Otherwise sentence after two or more conditions with nothing restated in it has two readings for its else branch.";

const OPENS_OTHERWISE = /^[\s.;:,■•]*otherwise\b/iu;
const OTHERWISE_FAMILY = "otherwise";
/** Families whose gate compile.ts routes on its own (a selection flag or a result band), so it cannot move into a sentence gate. */
const ROUTED_ELSEWHERE = new Set(["target-is-selected", "battle-size", "roll-result"]);

type Node = Record<string, unknown>;

/** An else gate for the Otherwise sentence at `sentence` (its merged sentence number). */
export type ElseGate = { sentence: number; gate: Node };

export type OtherwiseElse = {
  /** One else gate per valid Otherwise sentence; each ANDs into that sentence's gates. */
  gates: ElseGate[];
  /** Leading conditions of the first effect sentence that move from the ability's gates to that sentence's gates. */
  moved: Set<number>;
  errors: string[];
};

/**
 * Builds the else gate of each `otherwise` leaf, or refuses it. `raw` is the pre-merge sentence of each
 * leaf (rawSentences, compile-placement.ts); `unnegatable` holds leaves the else cannot take (end
 * conditions, selection eligibility, leaves a container or a timing moment already consumed).
 */
export function otherwiseElse(list: readonly CompileLeaf[], places: readonly Placement[], raw: readonly number[], sourceText: string | undefined, unnegatable: ReadonlySet<number>): OtherwiseElse {
  const result: OtherwiseElse = { gates: [], moved: new Set(), errors: [] };
  const bytes = sourceText === undefined ? null : Buffer.from(sourceText, "utf8");
  const effectful = new Set(list.flatMap((leaf, at) => leaf.role === "EFFECT" ? [raw[at]!] : []));
  const firstEffectOf = (sentence: number) => list.findIndex((leaf, at) => leaf.role === "EFFECT" && raw[at] === sentence);
  const firstEffectSentence = effectful.size === 0 ? -1 : Math.min(...effectful);
  const leading = (sentence: number) => {
    const first = firstEffectOf(sentence);
    return list.flatMap((leaf, at) => raw[at] === sentence && leaf.role === "CONDITION" && leaf.fragment !== "TARGET"
      && !(leaf.fragment === "RESTRICTIONS" && leaf.parameters.subject === "each-target") && (first === -1 || at < first) ? [at] : []);
  };
  list.forEach((leaf, at) => {
    if (leaf.family_id !== OTHERWISE_FAMILY) return;
    const refuse = (message: string) => result.errors.push(message);
    const sentence = raw[at]!;
    const opening = bytes === null || leaf.end_byte === undefined ? "" : bytes.subarray(leaf.start_byte, leaf.end_byte).toString("utf8");
    if (!OPENS_OTHERWISE.test(opening) || (at > 0 && raw[at - 1] === sentence)) return refuse(OTHERWISE_TEXT);
    if (!effectful.has(sentence)) return refuse(OTHERWISE_NO_EFFECT);
    const preceding = sentence - 1;
    const precedingFirst = list.findIndex((_, other) => raw[other] === preceding);
    if (preceding < 0 || !effectful.has(preceding) || (precedingFirst !== -1 && list[precedingFirst]!.family_id === OTHERWISE_FAMILY)) return refuse(OTHERWISE_NO_PRECEDING);
    const gateAt = leading(preceding);
    if (gateAt.length === 0) return refuse(OTHERWISE_NO_PRECEDING);
    if (gateAt.some((index) => list[index]!.family_id === "roll-result")) return refuse(OTHERWISE_ROLL);
    const fixed = gateAt.some((index) => unnegatable.has(index) || WRAP_CONDITION_FAMILIES.has(list[index]!.family_id) || ROUTED_ELSEWHERE.has(list[index]!.family_id)
      || (list[index]!.family_id === "optional-cost-paid" && list[index]!.parameters.window === "trigger"));
    if (fixed) return refuse(OTHERWISE_UNNEGATABLE);
    const restated = leading(sentence);
    if (gateAt.length >= 2 && restated.length === 0) return refuse(OTHERWISE_AMBIGUOUS);
    try {
      // Fresh nodes: the else gate never shares an object with the gate that moved into P's sentence.
      const nodes = gateAt.map((index) => condition(list[index]!));
      const text = JSON.stringify(nodes);
      // An attack-type or attacker gate narrows a designation's attacks (compile.ts), so it cannot move into a sentence gate.
      if (text.includes('"attack-is"') || text.includes('"subject":"attacker"')) return refuse(OTHERWISE_UNNEGATABLE);
      const gate = negate(allOf(nodes)!);
      result.gates.push({ sentence: places[at]!.sentence, gate });
      if (preceding === firstEffectSentence) for (const index of gateAt) result.moved.add(index);
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      refuse(error.message);
    }
  });
  return result;
}

/**
 * Refuses an "Otherwise" sentence when a condition that would gate it is in scope: a leading
 * condition of the sentence before it, or of the ability's first effect sentence, which gates every
 * effect (compile.ts). Stratagem TARGET conditions are eligibility, not gates, and roll bands are exempt.
 * An Otherwise sentence that opens with an `otherwise` leaf is handled by otherwiseElse instead.
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
    if (after.family_id === OTHERWISE_FAMILY) continue;
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
