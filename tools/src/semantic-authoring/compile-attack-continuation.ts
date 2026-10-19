import { isBackref } from "./compile-attack-backref.js";
import type { CompileLeaf } from "./compile-fragments.js";
import type { Placement } from "./compile-placement.js";

type Node = Record<string, unknown>;

/** The planned-effect fields this pass reads and gates (compile.ts PlannedEffect). */
type Planned = { index: number; leaf: CompileLeaf; gate: Node[] };

/** Effects that change the rolls of attacks, so the attacks they apply to are the ones an earlier sentence framed. */
const ATTACK_SCOPED = new Set(["roll-modifier", "re-roll"]);

/** "…, subtract 1 from the Wound roll as well": the wording right after the effect that says it adds to the earlier sentence's attacks. */
const AS_WELL = /^\s*as well\b/iu;

/** Conditions printed on an attack that say which attacks it covers: "that targets your unit". */
const ATTACK_QUALIFIERS = new Set(["same-unit"]);

/**
 * "…, each time a model in that unit makes an attack that targets your unit, subtract 1 from the Hit roll. If that
 * test was failed, subtract 1 from the Wound roll as well.": a roll change in a later sentence with no attack of its
 * own, ending "as well", applies to the attacks the earlier sentence's roll change applies to. It takes the qualifiers
 * printed on that earlier effect's attack ("that targets your unit"), so the second change is not made to attacks the
 * first one is not. An attack's type gate already wraps both sentences, and other conditions of the earlier sentence
 * ("below Starting Strength") are not the attack's: the later sentence states its own.
 *
 * Applies only to a roll change or re-roll in a sentence with no attack leaf and no gate of its own naming the
 * attack, whose wording ends "as well", with an earlier-sentence roll change of the same kind that follows an attack.
 */
export function inheritAttackFrames(
  list: readonly CompileLeaf[],
  places: readonly Placement[],
  planned: readonly Planned[],
  sourceText: string | undefined,
  conditionOf: (leaf: CompileLeaf) => Node,
): void {
  if (sourceText === undefined) return;
  const bytes = Buffer.from(sourceText, "utf8");
  for (const item of planned) {
    const { leaf } = item;
    if (!ATTACK_SCOPED.has(leaf.family_id) || leaf.end_byte === undefined) continue;
    if (!AS_WELL.test(bytes.subarray(leaf.end_byte, leaf.end_byte + 16).toString("utf8"))) continue;
    const sentence = places[item.index]!.sentence;
    if (list.some((other, at) => other.family_id === "attack" && at < item.index && places[at]!.sentence === sentence)) continue;
    const earlier = planned.filter((other) => other.index < item.index && ATTACK_SCOPED.has(other.leaf.family_id) && places[other.index]!.sentence < sentence).at(-1);
    if (earlier === undefined) continue;
    const attackAt = list.map((other, at) => other.family_id === "attack" && !isBackref(other) && at < earlier.index && places[at]!.sentence === places[earlier.index]!.sentence ? at : -1)
      .filter((at) => at !== -1).at(-1);
    if (attackAt === undefined) continue;
    const attack = list[attackAt]!;
    const framed = list.flatMap((other, at) => at > attackAt && at < earlier.index && other.role === "CONDITION" && ATTACK_QUALIFIERS.has(other.family_id)
      && places[at]!.sentence === places[attackAt]!.sentence ? [conditionOf(other)] : []);
    for (const node of framed) {
      if (!item.gate.some((have) => JSON.stringify(have) === JSON.stringify(node))) item.gate.push(node);
    }
  }
}
