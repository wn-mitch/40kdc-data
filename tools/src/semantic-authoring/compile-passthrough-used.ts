import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { currentFamilyVersion } from "./contracts.js";

/**
 * A move-passthrough-used leaf ("but if it does, after it has moved, …") folds into the move-ended
 * moment that follows it in its fragment: that moment gets `through`, the terrain the move passed
 * through under the nearest move-through before the qualifier. The qualifier leaf is then dropped,
 * so only the moment carries the gate. Every other shape refuses with a CompileError.
 */

const MOVERS = ["this-unit", "this-model"];

/**
 * The unit or model the permission's move is made by. A permission whose subject is "event-subject"
 * (the antecedent of a moment's unit) takes the subject of the nearest event before it in its fragment.
 */
function moverOf(list: readonly CompileLeaf[], permissionAt: number, fragment: string | null): string | null {
  const subject = list[permissionAt]!.parameters.subject;
  if (typeof subject === "string" && MOVERS.includes(subject)) return subject;
  if (subject !== "event-subject") return null;
  for (let position = permissionAt - 1; position >= 0; position--) {
    const other = list[position]!;
    if ((other.fragment ?? null) !== fragment || other.family_id !== "event") continue;
    // A moment named by owner does not name the mover's unit, so it cannot give the permission's mover.
    if (other.parameters.owner !== undefined) return null;
    const named = other.parameters.subject ?? "this-unit";
    return typeof named === "string" && MOVERS.includes(named) ? named : null;
  }
  return null;
}

/** Folds each move-passthrough-used leaf into the move-ended moment after it; throws on any refused shape. */
export function foldPassthroughUsed(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === "move-passthrough-used")) return [...leaves];
  const list = [...leaves];
  const drop = new Set<number>();
  list.forEach((leaf, index) => {
    if (leaf.family_id !== "move-passthrough-used") return;
    const fragment = leaf.fragment ?? null;
    const inFragment = (other: CompileLeaf) => (other.fragment ?? null) === fragment;
    const terrain = String(leaf.parameters.passthrough);
    // 1. The first event after it in its fragment is the moment the qualifier applies to.
    let target = -1;
    for (let position = index + 1; position < list.length; position++) {
      const other = list[position]!;
      if (inFragment(other) && other.family_id === "event") { target = position; break; }
    }
    if (target < 0 || list[target]!.parameters.kind !== "move-ended") {
      throw new CompileError(`"if it does" names a move-ended moment, but no move-ended moment follows it in its fragment.`);
    }
    // 2. The nearest move-through before it in its fragment is the permission whose move it qualifies.
    let permission = -1;
    for (let position = index - 1; position >= 0; position--) {
      const other = list[position]!;
      if (inFragment(other) && other.family_id === "move-through") { permission = position; break; }
    }
    if (permission < 0) {
      throw new CompileError(`"if it does" names a move-through permission, but none before it in its fragment moves through tall terrain.`);
    }
    const passthrough = list[permission]!.parameters.passthrough;
    if (passthrough !== terrain) {
      const shown = typeof passthrough === "string" ? `"${passthrough}"` : "a typed or sourced item";
      throw new CompileError(`"if it does" names tall terrain, but the move before it passes through ${shown}.`);
    }
    // 3. The moment takes its gate once; a second gate on it is a conflict.
    const moment = list[target]!;
    if (moment.parameters.through !== undefined) {
      throw new CompileError(`Conflicting through: the moment already names ${String(moment.parameters.through)}; "if it does" says ${terrain}.`);
    }
    // 4. The moment must be the move the permission governs: the same unit or model. An "event-subject"
    // moment is that move's mover, so it takes the permission's mover. Any other differing subject
    // refuses, as does a moment named by owner (an owner and a subject do not go together).
    const mover = moverOf(list, permission, fragment);
    if (mover === null) throw new CompileError(`"if it does" needs the move before it to be made by this-unit or this-model.`);
    if (moment.parameters.owner !== undefined) throw new CompileError(`"if it does" names the moment's mover by owner; name it by subject.`);
    const named = moment.parameters.subject ?? "this-unit";
    if (named !== "event-subject" && named !== mover) throw new CompileError(`"if it does" names the move of ${mover}, but the moment after it is ${String(named)}'s.`);
    // 5. The moment is replaced by a copy carrying the gate; the input list is not mutated.
    list[target] = { ...moment, family_version: currentFamilyVersion("event"), parameters: { ...moment.parameters, subject: mover, through: terrain } };
    drop.add(index);
  });
  return list.filter((_, index) => !drop.has(index));
}

const BUT_IF_IT_DOES = /\bbut if it does\b/iu;

/**
 * A "but if it does" qualifier after a tall-terrain move-through, left uncovered by any leaf, is a
 * condition the compiler cannot bind: the moment after it would compile ungated. The check reads the
 * gaps between one part's own leaves and refuses only that shape. A plain "if it does" with no move-through
 * before it is not this shape and takes the existing path.
 */
export function refuseUnboundIfItDoes(leaves: readonly CompileLeaf[], sourceText: string | undefined): void {
  if (sourceText === undefined || leaves.some((leaf) => leaf.family_id === "move-passthrough-used")) return;
  const sorted = leaves.filter((leaf) => leaf.end_byte !== undefined).sort((a, b) => a.start_byte - b.start_byte);
  if (sorted.length === 0) return;
  const bytes = Buffer.from(sourceText, "utf8");
  let covered = sorted[0]!.start_byte;
  let tallBefore = false;
  for (const leaf of sorted) {
    const gap = bytes.subarray(covered, leaf.start_byte).toString("utf8");
    if (tallBefore && BUT_IF_IT_DOES.test(gap)) {
      throw new CompileError(`"${gap.trim()}" is a condition on the move before it, but no leaf covers it; author a move-passthrough-used leaf over it.`);
    }
    if (leaf.family_id === "move-through" && leaf.parameters.passthrough === "tall-terrain") tallBefore = true;
    covered = Math.max(covered, leaf.end_byte!);
  }
}
