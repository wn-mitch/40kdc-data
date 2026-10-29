import type { CompileLeaf } from "./compile-fragments.js";

/** Leaves of one fragment in source order. */
const inOrder = (list: readonly CompileLeaf[]) => [...list].sort((a, b) => (a.fragment ?? "").localeCompare(b.fragment ?? "") || a.start_byte - b.start_byte);

/**
 * "If a FOO model in this unit has lost any wounds but is not destroyed, that model regains all of
 * its lost wounds": a heal reaches only models that are on the battlefield and have lost wounds, so
 * the lost-wounds test between a model-level unit-filter and the heal of that model says nothing the
 * heal does not. It folds away, and the filter names the healed models as it does with no test.
 * Only an unnegated lost-wounds test on a model of this unit, right between the two, folds.
 */
export function foldImpliedHealCondition(given: readonly CompileLeaf[]): CompileLeaf[] {
  const list = inOrder(given);
  const implied = new Set<CompileLeaf>();
  list.forEach((leaf, at) => {
    if (leaf.family_id !== "wounds-state" || leaf.parameters.kind !== "lost" || leaf.parameters.negated === true) return;
    if (leaf.parameters.subject !== "model-in-this-unit") return;
    const before = list[at - 1];
    const after = list[at + 1];
    if (before?.family_id !== "unit-filter" || before.parameters.level !== "model" || before.fragment !== leaf.fragment) return;
    if (after?.family_id !== "regain-wounds" || after.parameters.subject !== "antecedent" || after.fragment !== leaf.fragment) return;
    implied.add(leaf);
  });
  return implied.size === 0 ? [...given] : given.filter((leaf) => !implied.has(leaf));
}
