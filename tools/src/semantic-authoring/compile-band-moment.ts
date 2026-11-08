import { ATTACK_EVENTS } from "./compile-conditions.js";
import type { CompileLeaf } from "./compile-fragments.js";
import type { Placement } from "./compile-placement.js";

/**
 * A moment printed inside a result band: "Roll one D6: On a 1, this model has K, and when this unit has shot, this
 * model is destroyed. On a 2+, …". The moment starts a part that exists only for that band; the effects after it in
 * the sentence happen when the moment does, and a later band of the same roll is not under it.
 *
 * Returns each such moment's position in `list` with the positions of the effects it holds: the effects after it in
 * its sentence, up to the next result band. A moment qualifies when a result band of the same sentence precedes it
 * and a dice roll precedes that band; a moment with no effect after it in its sentence is left alone.
 */
export function bandMoments(list: readonly CompileLeaf[], places: readonly Placement[]): Map<number, number[]> {
  const found = new Map<number, number[]>();
  list.forEach((leaf, index) => {
    if (leaf.role !== "EVENT" || leaf.family_id !== "event" || ATTACK_EVENTS.has(String(leaf.parameters.kind))) return;
    const sentence = places[index]!.sentence;
    let band = -1;
    for (let at = 0; at < index; at += 1) if (list[at]!.family_id === "roll-result" && places[at]!.sentence === sentence) band = at;
    if (band === -1 || !list.some((other, at) => at < band && other.family_id === "dice-roll")) return;
    const effects: number[] = [];
    for (let at = index + 1; at < list.length && places[at]!.sentence === sentence && list[at]!.family_id !== "roll-result"; at += 1) {
      if (list[at]!.role === "EFFECT") effects.push(at);
    }
    if (effects.length > 0) found.set(index, effects);
  });
  return found;
}
