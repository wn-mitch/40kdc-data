import { boundSelectionPair } from "./compile-bound-selection.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * The eligibility of a bound selection pair (compile-bound-selection.ts): "select one friendly X
 * unit within 6\" of that unit … select one friendly TRANSPORT that unit is wholly within 6\" of and
 * is able to embark within. That unit can embark within that TRANSPORT." The outer selection's name
 * is written as the unit a candidate or the permission refers to; after the inner selection the
 * positional `selected-unit` names the inner unit, so references to the outer are rewritten to
 * `{ selection_var: <outer name> }` here. The inner selection's candidate conditions become its
 * eligibility, and an embark permission's destination `selection` becomes `{ selection_var: <inner name> }`.
 */

export type SelectionRef = { selection_var: string };
const POSITIONAL = "selected-unit";
const CANDIDATE_FAMILIES = new Set(["eligible", "unit-position"]);

export const isSelectionRef = (value: unknown): value is SelectionRef =>
  typeof value === "object" && value !== null && typeof (value as SelectionRef).selection_var === "string";

/** The refusal for a pair's leaves the pair cannot bind (compile.ts guard, and the permissions below). */
export const PAIR_REFUSAL = "A bound selection's effects are only the inner unit's; attacks, parts, eligibility, battle-size counts and for-each loops are not bound with it yet.";

/** The outer and inner select-unit indexes of a bound pair, or null when the selections are not one. */
export function pairIndexes(list: readonly CompileLeaf[]): { outer: number; inner: number } | null {
  const selects = list.flatMap((leaf, index) => leaf.family_id === "select-unit" ? [index] : []);
  if (selects.length !== 2) return null;
  try {
    if (boundSelectionPair(selects.map((index) => list[index]!)) === null) return null;
  } catch (error) {
    if (error instanceof CompileError) return null;
    throw error;
  }
  return { outer: selects[0]!, inner: selects[1]! };
}

/**
 * The inner selection's candidate conditions: a CONDITION eligibility or unit-position after the
 * inner select, in its sentence, with no effect between, that names the outer unit (`selected-unit`,
 * before rewriting). Returns their indexes.
 */
export function candidateIndexes(list: readonly CompileLeaf[], inner: number, sameSentence: (at: number, selected: number) => boolean): number[] {
  return list.flatMap((leaf, at) => at > inner && leaf.role === "CONDITION" && CANDIDATE_FAMILIES.has(leaf.family_id)
    && (leaf.parameters.subject === POSITIONAL || leaf.parameters.of === POSITIONAL)
    && sameSentence(at, inner) && !list.slice(inner + 1, at).some((between) => between.role === "EFFECT") ? [at] : []);
}

/**
 * Rewrites the pair's references to the outer unit (see the header). Returns the leaves and the
 * refusal message when a leaf cannot be bound: a permission after the inner select that does not
 * name the outer unit, or an `into: selection` with no inner name.
 */
export function bindPairEligibility(list: readonly CompileLeaf[], pair: { outer: number; inner: number }, candidates: readonly number[]): { leaves: CompileLeaf[]; refusal: string | null } {
  const outerName = list[pair.outer]!.parameters.bind_as;
  const innerName = list[pair.inner]!.parameters.bind_as;
  if (typeof outerName !== "string") return { leaves: [...list], refusal: "A selection measured from or visible to another needs the earlier selection bound by a name (bind_as)." };
  const outer: SelectionRef = { selection_var: outerName };
  const leaves = list.map((leaf, at) => {
    if (candidates.includes(at)) return { ...leaf, parameters: rewriteRefs(leaf.parameters, outer) };
    return leaf;
  });
  for (let at = pair.inner + 1; at < list.length; at += 1) {
    const leaf = list[at]!;
    if (leaf.family_id !== "eligibility-permission") continue;
    if (leaf.parameters.subject === POSITIONAL && leaf.parameters.activity === "embark") {
      if (leaf.parameters.into !== "selection") return { leaves: [...list], refusal: PAIR_REFUSAL };
      if (typeof innerName !== "string") return { leaves: [...list], refusal: "eligibility-permission into: selection needs the inner selection bound by a name (bind_as)." };
      leaves[at] = { ...leaf, parameters: { ...leaf.parameters, subject: outer, into: { selection_var: innerName } } };
    } else if (leaf.parameters.activity === "embark") {
      // A permission of this pair that does not name the outer unit has no reading here.
      return { leaves: [...list], refusal: PAIR_REFUSAL };
    }
  }
  return { leaves, refusal: null };
}

function rewriteRefs(parameters: Record<string, unknown>, outer: SelectionRef): Record<string, unknown> {
  const rewritten = { ...parameters };
  if (rewritten.subject === POSITIONAL) rewritten.subject = outer;
  if (rewritten.of === POSITIONAL) rewritten.of = outer;
  return rewritten;
}
