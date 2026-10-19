import { exactSpan } from "./contracts.js";
import { addsAttackGate } from "./compile-attack-backref.js";
import { attackTypeCondition } from "./compile-conditions.js";
import type { CompileLeaf } from "./compile-fragments.js";
import type { Placement } from "./compile-placement.js";

type Node = Record<string, unknown>;

/** The fields of a planned effect that the attack-frame inheritance reads and gates (compile.ts PlannedEffect). */
export type AttackFrameItem = { index: number; gate: Node[] };

/**
 * "Each time a model makes a melee attack …, improve its AP by 1. If …, improve the AP of that attack by 2 instead":
 * the instead sentence names no attack, so the attack type the replaced clause's attack leaf gated it by is the
 * replacement's too; without it the replacement would change every attack. Only the type gate of an attack leaf in the
 * replaced effect's own sentence passes across sentences. A replacement whose sentence names an attack of its own, or
 * that already carries an attack-type gate, keeps its own scope.
 */
export function inheritAttackFrame(
  list: readonly CompileLeaf[],
  places: readonly Placement[],
  replaced: AttackFrameItem,
  replacement: AttackFrameItem,
): void {
  const sentence = places[replacement.index]!.sentence;
  const replacedSentence = places[replaced.index]!.sentence;
  if (sentence === replacedSentence) return;
  if (list.some((leaf, at) => leaf.family_id === "attack" && places[at]!.sentence === sentence)) return;
  if (replacement.gate.some((node) => node.type === "attack-is")) return;
  const frames = list.flatMap((leaf, at) => {
    if (leaf.family_id !== "attack" || at >= replaced.index || places[at]!.sentence !== replacedSentence || !addsAttackGate(leaf)) return [];
    const frame = attackTypeCondition(leaf);
    return frame === null ? [] : [JSON.stringify(frame)];
  });
  const inherited = replaced.gate.filter((node) => frames.includes(JSON.stringify(node)));
  if (inherited.length > 0) replacement.gate = [...inherited, ...replacement.gate];
}

/**
 * Whether a sentence after `sentence` holds an "instead" and a condition of its own before it ("If B, … instead"),
 * so the replacement says on its own when it applies. A choice ("Or:") and a roll band are not such conditions.
 */
export function conditionedInsteadAfter(list: readonly CompileLeaf[], places: readonly Placement[], sentence: number): boolean {
  return list.some((leaf, at) => leaf.family_id === "instead" && leaf.parameters.choice !== true && places[at]!.sentence > sentence
    && list.some((other, from) => from < at && other.role === "CONDITION" && other.family_id !== "roll-result" && other.family_id !== "target-is-selected"
      && places[from]!.sentence === places[at]!.sentence));
}

/** "this unit" / "this model" / "your unit" / "your model": wording that names the bearer. */
const BEARER_WORDING = /\b(?:this|your) (?:unit|model)\b/iu;

/** Whether a leaf's own source wording names the bearer, so its this-unit subject is the bearer and not a taker said another way. */
export function namesBearer(leaf: CompileLeaf, sourceText: string | undefined): boolean {
  return sourceText !== undefined && leaf.end_byte !== undefined && BEARER_WORDING.test(exactSpan(sourceText, leaf.start_byte, leaf.end_byte));
}

const IF_BEFORE = /\bif\s*$/iu;
const AND_BETWEEN = /^[\s,]*(?:\band\b)?[\s,]*$/iu;

/**
 * The conditions of `sentence` that an "if" opens ("..., if A and B, add 1"), before the sentence's first effect: the
 * condition right after "if" and each condition joined to it by "and". Roll bands and a target condition that names no
 * selection are not among them. Without source text there is no wording to read, so none are.
 */
export function ifGatedConditions(list: readonly CompileLeaf[], places: readonly Placement[], sentence: number, sourceText: string | undefined): Set<number> {
  const found = new Set<number>();
  if (sourceText === undefined) return found;
  const firstEffect = list.findIndex((leaf, at) => leaf.role === "EFFECT" && places[at]!.sentence === sentence);
  list.forEach((leaf, at) => {
    if (leaf.role !== "CONDITION" || places[at]!.sentence !== sentence || (firstEffect !== -1 && at > firstEffect)) return;
    if (leaf.family_id === "roll-result" || leaf.family_id === "target-is-selected") return;
    const before = list[at - 1];
    const from = before?.end_byte ?? 0;
    const lead = from <= leaf.start_byte ? Buffer.from(sourceText, "utf8").subarray(from, leaf.start_byte).toString("utf8") : "";
    if (IF_BEFORE.test(lead) || (found.has(at - 1) && AND_BETWEEN.test(lead))) found.add(at);
  });
  return found;
}

/** A sentence-opening "If" in the text before a leaf: the "if" is the first word of its sentence or line. */
const IF_OPENS = /(?:^|[.;:\r\n])[\s*]*if[\s*]*$/iu;
/** The text before a leaf ends where a sentence or line starts. */
const SENTENCE_START = /(?:^|[.;:\r\n])[\s*]*$/u;
/** A leaf whose own wording is led by "If" ("If this unit has X"). */
const IF_LED = /^[\s*]*if\b/iu;

/**
 * The conditions before a sentence's first effect that an "If" opens the sentence with and that its own comma
 * ends ("If A, add 1."): the condition after a sentence-opening "if" (inside its span or just before it) and each
 * condition joined to it by "and". A sentence whose effect is split from the condition by a colon or full stop
 * (`raw`, the sentence before effect-less ones join the next) is not one.
 */
function openedByIf(list: readonly CompileLeaf[], places: readonly Placement[], raw: readonly number[], sentence: number, sourceText: string): Set<number> {
  const found = new Set<number>();
  const firstEffect = list.findIndex((leaf, at) => leaf.role === "EFFECT" && places[at]!.sentence === sentence);
  if (firstEffect === -1) return found;
  const bytes = Buffer.from(sourceText, "utf8");
  list.forEach((leaf, at) => {
    if (leaf.role !== "CONDITION" || at >= firstEffect || places[at]!.sentence !== sentence || raw[at] !== raw[firstEffect]) return;
    if (leaf.family_id === "roll-result" || leaf.family_id === "target-is-selected" || leaf.end_byte === undefined) return;
    const before = bytes.subarray(Math.max(0, leaf.start_byte - 16), leaf.start_byte).toString("utf8");
    const own = bytes.subarray(leaf.start_byte, leaf.end_byte).toString("utf8");
    const previous = list[at - 1];
    const lead = previous?.end_byte !== undefined && previous.end_byte <= leaf.start_byte ? bytes.subarray(previous.end_byte, leaf.start_byte).toString("utf8") : "";
    if ((IF_LED.test(own) && !/[.;:]/u.test(own) && SENTENCE_START.test(before)) || IF_OPENS.test(before) || (found.has(at - 1) && AND_BETWEEN.test(lead))) found.add(at);
  });
  return found;
}

/**
 * The leading conditions of the ability's first effect sentence that an "If" opens a sentence with ("While A: If B,
 * add 1. If C, add 3."; "If it is a K unit, it has X. When …, it can Y."): each applies to its own sentence, so it
 * gates that sentence's effects and nothing after its full stop. This holds when a later sentence is independent of
 * the first, because it opens a moment or an "If" of its own; a later sentence tied back with no condition of its own
 * ("When doing so, …", "If it does, …") is part of the first one's outcome, which the condition keeps gating. A
 * A sentence that ends in a colon introduces a list its condition keeps gating. A "While" condition and a condition inside a sentence ("…, if A,") stay the ability's.
 */
export function sentenceIfGates(
  list: readonly CompileLeaf[],
  places: readonly Placement[],
  raw: readonly number[],
  sentence: number,
  sourceText: string | undefined,
): Set<number> {
  if (sourceText === undefined) return new Set();
  // A sentence ending in a colon introduces the items after it, which its condition keeps gating.
  const last = list.reduce((found, leaf, at) => (places[at]!.sentence === sentence ? at : found), -1);
  const next = list[last + 1];
  const tail = last >= 0 && next !== undefined && list[last]!.end_byte !== undefined && next.start_byte > list[last]!.end_byte!
    ? exactSpan(sourceText, list[last]!.end_byte!, next.start_byte) : "";
  if ([...tail].find((mark) => ".;:".includes(mark)) === ":") return new Set();
  const independent = [...new Set(list.flatMap((leaf, at) => leaf.role === "EFFECT" && places[at]!.sentence > sentence ? [places[at]!.sentence] : []))].some((later) => {
    const first = list.findIndex((item, at) => item.role === "EFFECT" && places[at]!.sentence === later);
    return list.slice(0, first).some((item, at) => places[at]!.sentence === later && item.role === "EVENT") || openedByIf(list, places, raw, later, sourceText).size > 0;
  });
  return independent ? openedByIf(list, places, raw, sentence, sourceText) : new Set();
}
