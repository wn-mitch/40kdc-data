/**
 * Splitting composed wording into singular leaves. Shared by the Split editor, which suggests
 * cuts to the reviewer, and the leaf proposer, which tries the same cuts on its own.
 */

/** Words that only join leaves; a piece made of them alone is not a leaf. */
export const SPLIT_GLUE = new Set(["and", "as well", "in addition", "then", "when doing so", "if you do", "if it does"]);
const EDGE = /^[\s\p{P}]+|[\s\p{P}]+$/gu;

/**
 * Where wording that joins several meanings usually divides: before a condition ("if", "that
 * targets"), before "instead", after a comma, and at a joining "as well" or "(".
 */
export function suggestedCuts(words: readonly string[]): Set<number> {
  const cuts = new Set<number>();
  words.forEach((word, index) => {
    if (index === 0) return;
    const lower = word.toLowerCase().replace(/^[(\p{P}]+/u, "");
    const next = words[index + 1]?.toLowerCase() ?? "";
    const previous = words[index - 1] ?? "";
    if (["if", "unless", "while", "instead"].includes(lower)) cuts.add(index);
    else if (lower === "that" && next.startsWith("target")) cuts.add(index);
    else if (word.startsWith("(")) cuts.add(index);
    else if (/[,;]$/u.test(previous)) cuts.add(index);
    else if (lower === "as" && next.startsWith("well")) cuts.add(index);
  });
  return cuts;
}

/** The pieces between cuts, without edge punctuation; joining words alone are dropped. */
export function splitPieces(words: readonly string[], cuts: ReadonlySet<number>): string[] {
  const pieces: string[][] = [[]];
  words.forEach((word, index) => {
    if (cuts.has(index)) pieces.push([]);
    pieces.at(-1)!.push(word);
  });
  return pieces.map((piece) => piece.join(" ").replace(EDGE, ""))
    .map((piece) => piece.replace(/^(?:and|as well)\s+/iu, "").replace(/\s+(?:and|as well)$/iu, "").replace(EDGE, ""))
    .filter((piece) => piece && !SPLIT_GLUE.has(piece.toLowerCase()));
}
