import { useState } from "react";

import { LeafForm, type Family } from "./LeafForm";

/** Words that only join leaves; a piece made of them alone is not a leaf. */
const GLUE = new Set(["and", "as well", "in addition", "then", "when doing so", "if you do", "if it does"]);
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
    .filter((piece) => piece && !GLUE.has(piece.toLowerCase()));
}

/**
 * Cut composed wording into singular leaves. Click between two words to add or remove a cut;
 * each piece is then named on its own and decided for the whole corpus.
 */
export function SplitEditor({ text, families, busy, onDecide, onCancel }: {
  text: string;
  families: readonly Family[];
  busy: boolean;
  onDecide: (exactText: string, familyId: string, parameters: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const words = text.split(/\s+/u).filter(Boolean);
  const [cuts, setCuts] = useState(() => suggestedCuts(words));
  const [naming, setNaming] = useState<string | null>(null);
  const toggle = (index: number) => setCuts((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });
  const pieces = splitPieces(words, cuts);
  return <div className="wb-split">
    <p className="wb-help">Click between words to cut. Each piece becomes its own leaf; joining words (and, as well) need none.</p>
    <p className="wb-split-words">{words.map((word, index) => <span key={index}>
      {index > 0 && <button type="button" className={cuts.has(index) ? "wb-cut wb-cut-on" : "wb-cut"} aria-pressed={cuts.has(index)}
        aria-label={`Cut before “${word}”`} onClick={() => toggle(index)}>{cuts.has(index) ? "|" : "·"}</button>}
      <span>{word}</span>
    </span>)}</p>
    <ol className="wb-split-pieces">{pieces.map((piece) => <li key={piece}>
      <span className="wb-surface-text">“{piece}”</span>
      {naming === piece
        ? <LeafForm families={families} exactText={piece} role={null} busy={busy} submitLabel="Decide everywhere"
          onSubmit={(familyId, parameters) => onDecide(piece, familyId, parameters)} onCancel={() => setNaming(null)} />
        : <button className="primary" type="button" onClick={() => setNaming(piece)}>Name this piece</button>}
    </li>)}</ol>
    <div className="wb-actions"><button className="secondary" type="button" onClick={onCancel}>Done splitting</button></div>
  </div>;
}
