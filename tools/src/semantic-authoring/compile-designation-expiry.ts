import { duration } from "./compile-duration-scope.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "On a 5+, that unit is struck by arcing energies. After resolving this model's attacks, each unit
 * struck by arcing energies suffers D3 mortal wounds": a mark with no applier and no printed
 * duration that a later attacks-resolved moment of the same record reads back (a unit-filter
 * designated with its tag) lasts until that moment has passed. Both moments fall in one phase, so
 * the mark clears at the end of the phase. A mark whose own moment prints a duration, and any other
 * unapplied mark, is left as it is. It runs on the whole record, before a later part is split off, so
 * the reading moment is still in the list.
 */
export function withResolvedReadExpiry(list: readonly CompileLeaf[]): CompileLeaf[] {
  return list.map((leaf) => {
    if (leaf.family_id !== "apply-mark" || leaf.parameters.by !== undefined || leaf.parameters.subject === "selected-objective" || leaf.parameters.clears_on !== undefined) return leaf;
    // A duration printed for the mark's own moment is its lifetime; one bounding a later part is not.
    if (list.some((other) => other.role === "DURATION" && sameMoment(list, leaf, other))) return leaf;
    const resolved = list.filter((other) => other.start_byte > leaf.start_byte && other.family_id === "event" && other.parameters.kind === "attacks-resolved")
      .map((other) => other.start_byte);
    if (resolved.length === 0) return leaf;
    const read = list.some((other) => other.start_byte > Math.min(...resolved) && readsTag(other, leaf.parameters.tag));
    return read ? { ...leaf, parameters: { ...leaf.parameters, clears_on: "phase" } } : leaf;
  });
}

/** A unit-filter designated with the tag. */
function readsTag(leaf: CompileLeaf, tag: unknown): boolean {
  return leaf.family_id === "unit-filter" && leaf.parameters.designated === tag;
}

/**
 * A designation one unit applies to another ("is affected by that Bondsman ability") ends when the
 * printed duration of its own moment ends. Each apply-mark with a `by` takes that duration as its
 * clears_on (the designate effect's own expiry). A mark with no printed duration in its moment is
 * refused: the designation would never end. A mark with two different printed durations in its moment
 * is refused: the leaves do not say which one ends the designation. The record's scope.duration is
 * left as it is.
 */
export function withDesignationExpiry(list: readonly CompileLeaf[]): CompileLeaf[] {
  // A designation on an objective marker (apply-mark selected-objective) lasts as long as the record's
  // duration says: it has no applier, so it takes the duration with no `by`.
  const applied = (leaf: CompileLeaf) => leaf.family_id === "apply-mark" && (leaf.parameters.by !== undefined || leaf.parameters.subject === "selected-objective");
  if (!list.some(applied)) return [...list];
  return list.map((leaf) => {
    if (!applied(leaf)) return leaf;
    const ends = [...new Set(list.filter((other) => other.role === "DURATION" && sameMoment(list, leaf, other)).map((other) => duration(other)))];
    if (ends.length === 0) {
      throw new CompileError(leaf.parameters.subject === "selected-objective" ? "A designation on the selected objective marker needs its duration printed, or it never ends." : "A designation a unit applies to another needs its duration printed, or it never ends.");
    }
    if (ends.length > 1) throw new CompileError("A designation a unit applies to another has two printed durations, and the record does not say which one ends it.");
    return { ...leaf, parameters: { ...leaf.parameters, clears_on: ends[0]! } };
  });
}

/**
 * Whether a printed duration bounds the mark's own moment. "…, select one friendly ARMIGER unit. That unit is
 * affected by this ability. Each time this unit is selected to shoot, until the end of the phase, …": a moment
 * printed between the mark and a later duration starts another part, whose duration it is. A duration printed
 * before the mark leads the moments after it ("Until the end of the turn, when …, select …"), unless an effect
 * of its own comes between it and a moment before the mark.
 */
function sameMoment(list: readonly CompileLeaf[], mark: CompileLeaf, end: CompileLeaf): boolean {
  if (end.start_byte > mark.start_byte) return !list.some((leaf) => leaf.role === "EVENT" && leaf.start_byte > mark.start_byte && leaf.start_byte < end.start_byte);
  const between = list.filter((leaf) => leaf.start_byte > end.start_byte && leaf.start_byte < mark.start_byte);
  const firstEffect = between.findIndex((leaf) => leaf.role === "EFFECT");
  return firstEffect === -1 || !between.slice(firstEffect).some((leaf) => leaf.role === "EVENT");
}
