import { duration } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

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
