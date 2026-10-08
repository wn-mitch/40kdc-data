import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Two selections in one ability, where the second is measured from or visible to the first:
 * "select one friendly X model" (bind_as) then "select one enemy unit within 8\" of that model"
 * (within_of). The first selection wraps the second, and the effects name the second, the
 * selection the ability's wording makes its unit. Any other pair of selections has no reading.
 */

const refersTo = (leaf: CompileLeaf) => leaf.parameters.within_of !== undefined || leaf.parameters.visible_to !== undefined;

/**
 * The outer and inner selection of a bound pair, or null when the selections are not such a pair
 * (the caller then refuses two selections). Refuses a reference to a selection the ability does
 * not bind, and a reference in a lone selection.
 */
export function boundSelectionPair(selections: readonly CompileLeaf[]): { outer: CompileLeaf; inner: CompileLeaf } | null {
  if (selections.length === 1) {
    if (refersTo(selections[0]!)) throw new CompileError("A selection measured from or visible to another selection needs that selection in the ability; this ability selects one unit.");
    return null;
  }
  if (selections.length !== 2) return null;
  const [outer, inner] = selections as [CompileLeaf, CompileLeaf];
  if (!refersTo(inner)) return null;
  const name = outer.parameters.bind_as;
  if (typeof name !== "string") throw new CompileError("A selection measured from or visible to another needs the earlier selection bound by a name (bind_as).");
  for (const reference of [inner.parameters.within_of, inner.parameters.visible_to]) {
    if (reference !== undefined && reference !== name) throw new CompileError(`The selection refers to "${String(reference)}", which this ability does not bind.`);
  }
  if (inner.parameters.bind_as === name) throw new CompileError("Two selections bind the same name.");
  return { outer, inner };
}
