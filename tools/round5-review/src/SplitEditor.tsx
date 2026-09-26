import { useState } from "react";

import { LeafForm, type Family } from "./LeafForm";
import type { QueueItem } from "./decision-queue";

export { splitPieces, suggestedCuts } from "../../src/round5c/split";
import { splitPieces, suggestedCuts } from "../../src/round5c/split";

/**
 * Cut composed wording into singular leaves. Click between two words to add or remove a cut;
 * each piece is then named on its own and decided for the whole corpus.
 */
export function SplitEditor({ text, families, busy, pieceState, onDecide, onCancel }: {
  text: string;
  families: readonly Family[];
  busy: boolean;
  /** Where a piece's decision is in the queue, if it has been sent. */
  pieceState?: (piece: string) => QueueItem | null;
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
    <ol className="wb-split-pieces">{pieces.map((piece) => {
      const sent = pieceState?.(piece) ?? null;
      return <li key={piece}>
        <span className="wb-surface-text">“{piece}”</span>
        {sent && <small className={`wb-state ${sent.status === "failed" ? "wb-state-blocked" : "wb-state-queued"}`}>
          {sent.status === "failed" ? `not recorded: ${sent.error}` : sent.status === "running" ? "recording…" : "queued"}</small>}
        {naming === piece
          ? <LeafForm families={families} exactText={piece} role={null} busy={busy} submitLabel="Decide everywhere"
            onSubmit={(familyId, parameters) => { setNaming(null); onDecide(piece, familyId, parameters); }} onCancel={() => setNaming(null)} />
          : (!sent || sent.status === "failed") && <button className="primary" type="button" onClick={() => setNaming(piece)}>Name this piece</button>}
      </li>;
    })}</ol>
    <div className="wb-actions"><button className="secondary" type="button" onClick={onCancel}>Done splitting</button></div>
  </div>;
}
