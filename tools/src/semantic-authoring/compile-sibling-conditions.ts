import type { CompileLeaf } from "./compile-fragments.js";
import { rawSentences, type Placement } from "./compile-placement.js";
import { exactSpan } from "./contracts.js";

/** A condition that can gate a clause: a result band is a roll marker, never a sibling gate. */
function isGate(leaf: CompileLeaf): boolean {
  return leaf.role === "CONDITION" && leaf.family_id !== "roll-result";
}

/**
 * "If it was an X, do A, and if it was a Y, do B": a later clause of the sentence opens with a
 * condition of its own, so the sentence's leading condition decides only its own clause. Read as
 * a sentence gate it would also gate the "and if" clause, nesting B under X.
 *
 * Returns the indexes of the leading conditions that gate only their clause: each is worded "if
 * …" ahead of the sentence's first effect, its clause holds an effect, and a later clause of the
 * same printed sentence opens ", and if …" with a condition of its own and holds an effect. The
 * printed sentence is the one before an effectless sentence joins it, so a condition of the
 * sentence before ("…, if this unit is not destroyed, roll one D6. On a 4+, if …") keeps
 * gating both clauses. Any other
 * wording ("while …, and while …", a parenthetical "(if …, … instead)") keeps the sentence gate.
 */
export function siblingClauseConditions(list: readonly CompileLeaf[], places: readonly Placement[], sourceText: string | undefined): Set<number> {
  const scoped = new Set<number>();
  if (sourceText === undefined) return scoped;
  const wording = (leaf: CompileLeaf) => leaf.end_byte === undefined ? "" : exactSpan(sourceText, leaf.start_byte, leaf.end_byte);
  const startsIf = (leaf: CompileLeaf) => /^if\b/iu.test(wording(leaf));
  const afterAnd = (at: number) => {
    const previous = list[at - 1];
    return previous?.end_byte !== undefined && previous.end_byte <= list[at]!.start_byte
      && /,\s*and\s*$/iu.test(exactSpan(sourceText, previous.end_byte, list[at]!.start_byte));
  };
  const printed = rawSentences(list, sourceText);
  const clauseHasEffect = (clause: number) => list.some((leaf, at) => leaf.role === "EFFECT" && places[at]!.clause === clause);
  const opensClause = (at: number) => at === 0 || places[at - 1]!.clause !== places[at]!.clause;
  list.forEach((leaf, index) => {
    if (!isGate(leaf) || !startsIf(leaf)) return;
    const sentence = printed[index]!;
    const { clause } = places[index]!;
    const effectBefore = list.some((other, at) => at < index && other.role === "EFFECT" && printed[at] === sentence);
    if (effectBefore || !clauseHasEffect(clause)) return;
    const sibling = list.some((other, at) => at > index && printed[at] === sentence && places[at]!.clause !== clause
      && isGate(other) && startsIf(other) && afterAnd(at) && opensClause(at) && clauseHasEffect(places[at]!.clause));
    if (sibling) scoped.add(index);
  });
  return scoped;
}
