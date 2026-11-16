type Node = Record<string, unknown>;

/** Whether a step reads the loop's unit (the pass's recipient) or the unit selected in the pass. */
const readsPass = (node: unknown): boolean => /"(?:recipient|selected-unit)"/u.test(JSON.stringify(node ?? null));

/**
 * The steps printed in sentences after the loop's own, which run once after the loop rather than in each pass: every
 * step from the first one past the loop's sentence on is past it, and none reads the pass's unit or the unit selected
 * in it. At least one step must stay in the loop. Returns the tail (possibly empty).
 */
export function loopTail(steps: readonly Node[], sentences: readonly number[], loopSentence: number): Node[] {
  if (steps.length < 2 || sentences.length !== steps.length) return [];
  const from = sentences.findIndex((sentence) => sentence > loopSentence);
  if (from <= 0 || sentences.slice(from).some((sentence) => sentence <= loopSentence)) return [];
  const tail = steps.slice(from);
  return tail.some(readsPass) ? [] : tail;
}
