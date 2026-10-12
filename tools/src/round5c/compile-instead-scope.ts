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
