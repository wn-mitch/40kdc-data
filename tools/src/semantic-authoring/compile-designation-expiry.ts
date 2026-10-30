import { duration } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "On a 5+, that unit is struck by arcing energies. After resolving this model's attacks, each unit
 * struck by arcing energies suffers D3 mortal wounds": a mark with no applier and no printed
 * duration that a later attacks-resolved moment of the same record reads back (a unit-filter
 * designated with its tag) lasts until that moment has passed. Both moments fall in one phase, so
 * the mark clears at the end of the phase. Any other unapplied mark is left as it is. It runs on the
 * whole record, before a later part is split off, so the reading moment is still in the list.
 */
export function withResolvedReadExpiry(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (list.some((leaf) => leaf.role === "DURATION")) return [...list];
  return list.map((leaf) => {
    if (leaf.family_id !== "apply-mark" || leaf.parameters.by !== undefined || leaf.parameters.subject === "selected-objective" || leaf.parameters.clears_on !== undefined) return leaf;
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
 * record's printed duration ends. Each apply-mark with a `by` takes that duration as its clears_on
 * (the designate effect's own expiry). A record with no printed duration is refused: the designation
 * would never end. A record with two different printed durations is refused: the leaves do not say
 * which one ends the designation. The record's scope.duration is left as it is.
 */
export function withDesignationExpiry(list: readonly CompileLeaf[]): CompileLeaf[] {
  // A designation on an objective marker (apply-mark selected-objective) lasts as long as the record's
  // duration says: it has no applier, so it takes the duration with no `by`.
  const applied = (leaf: CompileLeaf) => leaf.family_id === "apply-mark" && (leaf.parameters.by !== undefined || leaf.parameters.subject === "selected-objective");
  if (!list.some(applied)) return [...list];
  const ends = [...new Set(list.filter((leaf) => leaf.role === "DURATION").map((leaf) => duration(leaf)))];
  if (ends.length === 0) {
    const onObjective = list.some((leaf) => leaf.family_id === "apply-mark" && leaf.parameters.subject === "selected-objective");
    throw new CompileError(onObjective ? "A designation on the selected objective marker needs its duration printed, or it never ends." : "A designation a unit applies to another needs its duration printed, or it never ends.");
  }
  if (ends.length > 1) throw new CompileError("A designation a unit applies to another has two printed durations, and the record does not say which one ends it.");
  const clearsOn = ends[0]!;
  return list.map((leaf) => applied(leaf) ? { ...leaf, parameters: { ...leaf.parameters, clears_on: clearsOn } } : leaf);
}
