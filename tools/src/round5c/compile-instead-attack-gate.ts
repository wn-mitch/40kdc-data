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
