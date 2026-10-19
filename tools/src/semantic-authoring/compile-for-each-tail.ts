import type { CompileLeaf } from "./compile-fragments.js";
import type { Placement } from "./compile-placement.js";
import { AURA_RECIPIENT } from "./compile-antecedent.js";

type Node = Record<string, unknown>;
type Planned = { index: number; leaf: CompileLeaf; node: Node; gate: Node[] };

/** "…Then, your unit suffers 3D3 mortal wounds": the sentence opens with "Then" right before its first leaf. */
const THEN_BEFORE = /\bthen[\s,]*$/iu;

/**
 * Effects that follow a for-each's own sentence and happen once, not once per unit the loop reaches: "Roll one D6 for
 * each enemy unit engaged with your unit: on a 2+ that enemy unit suffers D6 mortal wounds. Then, your unit suffers
 * 3D3 mortal wounds." The later sentence opens with "Then", names no unit of the loop (no recipient anywhere in its
 * effect or gates), and sits in a later sentence than the quantifier, so it runs after the loop.
 */
export function forEachTail(
  list: readonly CompileLeaf[],
  places: readonly Placement[],
  planned: readonly Planned[],
  forEach: CompileLeaf | null,
  sourceText: string | undefined,
): Planned[] {
  if (forEach === null || sourceText === undefined) return [];
  const loopSentence = places[list.indexOf(forEach)]!.sentence;
  const bytes = Buffer.from(sourceText, "utf8");
  return planned.filter((item) => {
    const sentence = places[item.index]!.sentence;
    if (sentence <= loopSentence) return false;
    if (JSON.stringify([item.node, item.gate]).includes(`"${AURA_RECIPIENT}"`)) return false;
    const opening = list.findIndex((leaf, at) => places[at]!.sentence === sentence);
    return opening !== -1 && THEN_BEFORE.test(bytes.subarray(Math.max(0, list[opening]!.start_byte - 12), list[opening]!.start_byte).toString("utf8"));
  });
}
