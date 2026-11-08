import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "When this unit makes a save roll: on an unmodified 6, …": a band read before any modifier, printed
 * after a moment that is a roll, narrows that moment to those faces. The band (roll-result unmodified)
 * folds into the after-roll moment as `unmodified` {from, to}, which compile-triggers.ts puts in the
 * trigger's filter; the band is then no condition of its own.
 *
 * Folds only when the nearest moment before the band, in its fragment, is an after-roll: an ability's
 * own dice (dice-roll) between them keep the band for compile-dice.ts. Refuses a band after a
 * before-roll moment (the faces are not known yet) and a second band on one moment.
 */
export function foldRollFaces(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "roll-result" && leaf.parameters.unmodified === true)) return [...list];
  const out = [...list];
  const folded = new Set<number>();
  out.forEach((leaf, index) => {
    if (leaf.family_id !== "roll-result" || leaf.parameters.unmodified !== true) return;
    const at = out.slice(0, index).map((other) => other.role === "EVENT" && other.fragment === leaf.fragment).lastIndexOf(true);
    const moment = out[at];
    if (moment === undefined) return;
    if (moment.parameters.kind === "before-roll") throw new CompileError("An unmodified result reads a roll already made; the moment before it is before the roll.");
    if (moment.parameters.kind !== "after-roll") return;
    if (moment.parameters.unmodified !== undefined) throw new CompileError("A moment's roll has more than one unmodified band; each band is an outcome of its own.");
    const from = Number(leaf.parameters.from);
    const to = leaf.parameters.to === undefined ? 6 : Number(leaf.parameters.to);
    if (to > 6) throw new CompileError("An unmodified band reads one die, whose faces are 1 to 6.");
    out[at] = { ...moment, parameters: { ...moment.parameters, unmodified: { from, to } } };
    folded.add(index);
  });
  return out.filter((_leaf, index) => !folded.has(index));
}

/**
 * "When making the charge roll, if the result is greater than 6 (after modifiers), change it to 6":
 * a band from N+1 with no upper bound, directly before a fixed result of N for a named roll, caps that
 * roll at N. The band folds into the fixed result as `at_most` (roll-result at_most); it is no band of
 * its own, since the record rolls no dice. Only a result of 6 is fixed today (roll-auto-result
 * counts-as-6), so only a cap of 6 folds; other bands keep their meaning for compile-dice.ts.
 */
export function foldRollCaps(list: readonly CompileLeaf[]): CompileLeaf[] {
  const capped = new Set<number>();
  list.forEach((leaf, index) => {
    const next = list[index + 1];
    if (leaf.family_id === "roll-result" && leaf.parameters.to === undefined && leaf.parameters.unmodified === undefined && leaf.parameters.from === 7
      && next?.family_id === "roll-auto-result" && next.parameters.outcome === "counts-as-6" && typeof next.parameters.roll === "string"
      && next.parameters.count === undefined && next.parameters.rolls === undefined && (next.fragment ?? null) === (leaf.fragment ?? null)) capped.add(index + 1);
  });
  return list.flatMap((leaf, index) => capped.has(index + 1) ? [] : capped.has(index) ? [{ ...leaf, parameters: { ...leaf.parameters, at_most: 6 } }] : [leaf]);
}
