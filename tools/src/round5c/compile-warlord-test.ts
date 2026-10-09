import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "If a friendly Militarum Tempestus Officer model is your Warlord, …": the Warlord is the model
 * chosen at mustering, so the test names the unit it tests through the unit-filter just before it.
 * The designated-filter with `subject: antecedent` and `tag: warlord` is folded onto that filter as
 * `designated: "warlord"`, and removed. Compilation then reads the filter's units as the Warlord's
 * units (dslUnitFilter with `warlordTest`). Runs before bindAntecedents, which would otherwise bind
 * the anaphor to the next filter (compile-antecedent.ts has no designation rule).
 */
export function foldWarlordTests(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  const dropped = new Set<CompileLeaf>();
  const replaced = new Map<CompileLeaf, CompileLeaf>();
  for (const [index, leaf] of leaves.entries()) {
    if (!isWarlordAnaphor(leaf)) continue;
    const filter = precedingUnitFilter(leaves, index);
    if (filter === undefined) throw new CompileError("A Warlord test needs the unit it tests named just before it.");
    const current = replaced.get(filter) ?? filter;
    if (current.parameters.designated !== undefined && current.parameters.designated !== "warlord") {
      throw new CompileError(`The unit it tests is already ${String(current.parameters.designated)}; a Warlord test cannot also name that designation.`);
    }
    replaced.set(filter, { ...current, parameters: { ...current.parameters, designated: "warlord" } });
    dropped.add(leaf);
  }
  if (dropped.size === 0) return [...leaves];
  return leaves.filter((leaf) => !dropped.has(leaf)).map((leaf) => replaced.get(leaf) ?? leaf);
}

/** A Warlord test that names no unit of its own ("is your Warlord"). */
function isWarlordAnaphor(leaf: CompileLeaf): boolean {
  return leaf.family_id === "designated-filter" && leaf.parameters.tag === "warlord" && leaf.parameters.subject === "antecedent";
}

/**
 * The nearest unit-filter before `index` in the same fragment. Leaves between them are connectives
 * ("and", "or") or the filter's own wording; a different fragment ends the search.
 */
function precedingUnitFilter(leaves: readonly CompileLeaf[], index: number): CompileLeaf | undefined {
  const fragment = leaves[index]!.fragment;
  for (let at = index - 1; at >= 0; at -= 1) {
    const other = leaves[at]!;
    if (other.fragment !== fragment) return undefined;
    if (other.family_id === "unit-filter") return other;
  }
  return undefined;
}
