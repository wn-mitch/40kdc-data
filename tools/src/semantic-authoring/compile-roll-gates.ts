import type { CompileLeaf } from "./compile-fragments.js";
import type { Placement } from "./compile-placement.js";

type Node = Record<string, unknown>;

/**
 * "…, when that unit is selected to move, roll one D6: On a 1-4, X. On a 5-6, Y.": the conditions printed before
 * the roll are the roll's own, so they gate every result band of it, not only the band that shares their sentence.
 * A later band sentence (its first roll-result leaf follows the roll with no other moment or roll between) takes the
 * gates the roll's sentence collected from conditions placed before the roll. Conditions placed after the roll, in
 * the first band, stay that band's.
 *
 * `origin` maps each sentence gate to the index of the leaf it came from (compile.ts scope()).
 */
export function inheritRollGates(
  list: readonly CompileLeaf[],
  places: readonly Placement[],
  sentenceGates: Map<number, Node[]>,
  origin: ReadonlyMap<Node, number>,
): void {
  list.forEach((leaf, roll) => {
    if (leaf.family_id !== "dice-roll") return;
    const sentence = places[roll]!.sentence;
    const before = (sentenceGates.get(sentence) ?? []).filter((gate) => (origin.get(gate) ?? Infinity) < roll);
    if (before.length === 0) return;
    const seen = new Set<number>([sentence]);
    for (let at = roll + 1; at < list.length; at += 1) {
      const next = list[at]!;
      if (next.role === "EVENT") break;
      const later = places[at]!.sentence;
      if (next.family_id !== "roll-result" || next.role !== "CONDITION" || seen.has(later)) continue;
      seen.add(later);
      const held = sentenceGates.get(later) ?? [];
      sentenceGates.set(later, [...before.filter((gate) => !held.some((other) => JSON.stringify(other) === JSON.stringify(gate))), ...held]);
    }
  });
}
