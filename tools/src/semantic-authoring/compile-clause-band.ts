import type { Placement } from "./compile-placement.js";

type Node = Record<string, unknown>;

const isBand = (node: Node): boolean => node.type === "__roll-result";

/**
 * A result band ("on a 5+") decides every clause after it in its own sentence, up to the next band
 * or the sentence's end. Clause binding gives the band only its own clause, so an "and" clause that
 * follows it ("on a 5+, X and must Y") would apply on every roll. Each later clause without a band
 * of its own takes the nearest band before it in the sentence (compile.ts runs this after the
 * leaves are bound to their clauses, and before the clause gates are read).
 *
 * Sentences in `exempt` (a fight-on-death band is its own per-model gate, compile-dice.ts) neither
 * pass a band on nor take one.
 */
export function inheritClauseBands(clauseGates: Map<number, Node[]>, places: readonly Placement[], exempt: ReadonlySet<number>): void {
  const sentenceOfClause = new Map<number, number>();
  for (const { sentence, clause } of places) if (!sentenceOfClause.has(clause)) sentenceOfClause.set(clause, sentence);
  let current: { sentence: number; bands: Node[] } | null = null;
  for (const clause of [...sentenceOfClause.keys()].sort((left, right) => left - right)) {
    const sentence = sentenceOfClause.get(clause)!;
    const own = (clauseGates.get(clause) ?? []).filter(isBand);
    if (exempt.has(sentence)) {
      current = null;
    } else if (own.length > 0) {
      current = { sentence, bands: own };
    } else if (current !== null && current.sentence === sentence) {
      clauseGates.set(clause, [...(clauseGates.get(clause) ?? []), ...current.bands.map((band) => structuredClone(band))]);
    } else {
      current = null;
    }
  }
}
