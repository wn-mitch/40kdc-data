import { exactSpan } from "./contracts.js";
import { ATTACK_EVENTS } from "./compile-conditions.js";
import type { CompileLeaf } from "./compile-fragments.js";
import { kindKey } from "./compile-triggers.js";

/**
 * Where leaves sit in their ability: sentences and clauses from the source text between them,
 * and the ability's shape signature built on them (the composition rules are in `compile.ts`).
 */

/** Where each leaf sits: which sentence and which clause, both counted from zero. */
export type Placement = { sentence: number; clause: number };

export const ordered = (leaves: readonly CompileLeaf[]) => [...leaves].sort((left, right) => left.start_byte - right.start_byte);

function gapBetween(previous: CompileLeaf, next: CompileLeaf, sourceText: string | undefined): { sentence: boolean; and: boolean } {
  if (previous.fragment !== undefined && next.fragment !== undefined && previous.fragment !== next.fragment) return { sentence: true, and: false };
  if (sourceText === undefined || previous.end_byte === undefined || next.start_byte <= previous.end_byte) return { sentence: false, and: false };
  const gap = exactSpan(sourceText, previous.end_byte, next.start_byte);
  return { sentence: /[.;:]/u.test(gap), and: /\b(?:and|or)\b|\(/iu.test(gap) };
}

/**
 * Whether a combinator starts a clause of its own: a player's pick ("choice") always does, and an
 * "instead" written as the word "or" does too ("…, or anywhere …instead" with no comma), so the
 * replacement is not counted with the effect it replaces.
 */
function opensClause(leaf: CompileLeaf, sourceText: string | undefined): boolean {
  if (leaf.role !== "COMBINATOR") return false;
  if (leaf.parameters.choice === true) return true;
  if (sourceText === undefined || leaf.end_byte === undefined || leaf.end_byte <= leaf.start_byte) return false;
  return exactSpan(sourceText, leaf.start_byte, leaf.end_byte).trim().toLowerCase() === "or";
}

const BULLET = /[■▪•]/u;

/**
 * Where a bullet sits between leaves: entry `i` is true when the source between `leaves[i-1]` and
 * `leaves[i]` contains a bullet character. Sentence numbering does not use this; it only lets an
 * opener split its options at bullets that carry no full stop (compile-containers.ts).
 */
export function bulletBreaks(leaves: readonly CompileLeaf[], sourceText: string | undefined): boolean[] {
  return leaves.map((leaf, index) => {
    if (index === 0 || sourceText === undefined) return false;
    const previous = leaves[index - 1]!;
    if (previous.end_byte === undefined || leaf.start_byte <= previous.end_byte) return false;
    return BULLET.test(exactSpan(sourceText, previous.end_byte, leaf.start_byte));
  });
}

export function placements(leaves: readonly CompileLeaf[], sourceText: string | undefined): Placement[] {
  const sentenceOf: number[] = [];
  const andBefore: boolean[] = [];
  // A line that opens with bold text ("**Restrictions:** …") is a new paragraph: it starts a clause even when the
  // sentence before it has no effect and joins that sentence (its conditions then sit in a clause of their own).
  const headed = leaves.map((leaf, index) => {
    const previous = leaves[index - 1];
    if (sourceText === undefined || index === 0 || previous?.end_byte === undefined || leaf.start_byte <= previous.end_byte) return false;
    return /\n[ \t]*\*\*/u.test(exactSpan(sourceText, previous.end_byte, leaf.start_byte));
  });
  leaves.forEach((leaf, index) => {
    const gap = index === 0 ? { sentence: false, and: false } : gapBetween(leaves[index - 1]!, leaf, sourceText);
    sentenceOf.push(index === 0 ? 0 : sentenceOf[index - 1]! + (gap.sentence ? 1 : 0));
    // A player's pick between two effects ("re-roll one Hit roll or one Wound roll") is a leaf on
    // its "or", so the "or" is not in a gap: the choice leaf itself starts the clause.
    andBefore.push((gap.and || opensClause(leaf, sourceText)) && !gap.sentence);
  });
  // A sentence without an effect ("While this model is leading a unit.") only sets conditions
  // for what follows, so it joins the next sentence; the last one joins the one before.
  const effectful = new Set(leaves.flatMap((leaf, index) => leaf.role === "EFFECT" ? [sentenceOf[index]!] : []));
  const sentences = [...new Set(sentenceOf)];
  const merged = new Map<number, number>();
  let pending: number[] = [];
  for (const sentence of sentences) {
    pending.push(sentence);
    if (effectful.has(sentence)) {
      for (const item of pending) merged.set(item, sentence);
      pending = [];
    }
  }
  const last = [...effectful].at(-1) ?? sentences.at(-1) ?? 0;
  for (const item of pending) merged.set(item, last);
  sentenceOf.forEach((sentence, index) => { sentenceOf[index] = merged.get(sentence)!; });
  const result: Placement[] = [];
  let clause = 0;
  let clauseStart = 0;
  leaves.forEach((_, index) => {
    if (index > 0 && (sentenceOf[index] !== sentenceOf[index - 1] || headed[index])) {
      clause += 1;
      clauseStart = index;
    } else if (index > 0 && andBefore[index]) {
      const sentence = sentenceOf[index];
      const left = leaves.slice(clauseStart, index);
      const right = leaves.slice(index).filter((_, offset) => sentenceOf[index + offset] === sentence);
      if (left.some((leaf) => leaf.role === "EFFECT") && right.some((leaf) => leaf.role === "EFFECT")) {
        clause += 1;
        clauseStart = index;
      }
    }
    result.push({ sentence: sentenceOf[index]!, clause });
  });
  return result;
}

function signaturePart(leaf: CompileLeaf): string {
  if (leaf.family_id === "attack") return `EVENT(attack:${String(leaf.parameters.refers !== undefined && leaf.parameters.direction === undefined ? "refers" : leaf.parameters.direction)})`;
  if (leaf.role !== "EVENT") return `${leaf.role}(${leaf.family_id})`;
  if (leaf.family_id === "select-unit") return "EVENT(select-unit)";
  if (leaf.family_id === "dice-roll") return "EVENT(dice-roll)";
  return ATTACK_EVENTS.has(String(leaf.parameters.kind)) ? "EVENT(attack)" : `EVENT(${kindKey(leaf)})`;
}

/**
 * The shape of an ability: its leaves' roles and families in source order, parameters left out,
 * with ` | ` between clauses so the binding of conditions is part of what a reviewer approves.
 * Attacks keep their direction and other events their kind, because both change the structure.
 */
export function shapeSignature(leaves: readonly CompileLeaf[], sourceText?: string): string {
  const list = ordered(leaves);
  const places = placements(list, sourceText);
  return list.map((leaf, index) => `${index > 0 && places[index]!.clause !== places[index - 1]!.clause ? "| " : index > 0 ? "· " : ""}${signaturePart(leaf)}`).join(" ");
}
