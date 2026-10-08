import { awaitsFollowingFilter } from "./family-extensions-11.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

const isFilter = (leaf: CompileLeaf | undefined) => leaf?.family_id === "unit-filter";

/**
 * "select one enemy unit within 8\" of the bearer's unit (excluding **MONSTER** units)": an
 * exclusion-only unit-filter after a selection's distance folds into the selection's filter. This
 * pass moves that exclusion to sit right after its select (or merges it into the filter there), so
 * the select fold reads one filter. The exclusion must name the selection's side, and at most one
 * distance may sit between the select and the exclusion; otherwise it stays where it is and refuses.
 */
export function foldSelectExclusions(
  input: readonly CompileLeaf[],
  mergeFilters: (first: CompileLeaf, second: CompileLeaf) => CompileLeaf | null,
): CompileLeaf[] {
  const list = [...input];
  for (let index = 0; index < list.length; index += 1) {
    const select = list[index]!;
    if (select.family_id !== "select-unit") continue;
    const base = isFilter(list[index + 1]) && list[index + 1]!.fragment === select.fragment ? index + 1 : null;
    let cursor = base === null ? index + 1 : index + 2;
    if (selectionDistance(list[cursor], select)) cursor += 1;
    const exclusion = list[cursor];
    if (!exclusionOnly(exclusion) || exclusion!.fragment !== select.fragment) continue;
    const selectedSide = select.parameters.scope ?? (base === null ? undefined : list[base]!.parameters.side);
    // With no side on the select or its filter, the exclusion alone names the side: the select fold reads it.
    if (selectedSide === undefined) continue;
    if (exclusion!.parameters.side !== selectedSide) throw new CompileError("An exclusion's side differs from the select-unit's side.");
    if (base === null) {
      list.splice(cursor, 1);
      list.splice(index + 1, 0, exclusion!);
      continue;
    }
    const merged = mergeFilters(list[base]!, exclusion!);
    if (merged === null) throw new CompileError("An exclusion cannot narrow the select-unit's filter (its sides or keyword lists conflict).");
    list[base] = merged;
    list.splice(cursor, 1);
  }
  return list;
}

/** A distance a selection's exclusion may sit past: a side-less aura-range, or a unit-position measured to the selection's own units. */
function selectionDistance(leaf: CompileLeaf | undefined, select: CompileLeaf): boolean {
  if (leaf === undefined || leaf.fragment !== select.fragment || awaitsFollowingFilter(leaf.parameters)) return false;
  if (leaf.family_id === "aura-range") return leaf.parameters.side === undefined;
  return leaf.family_id === "unit-position" && ["selected-unit", "antecedent", "target"].includes(String(leaf.parameters.subject));
}

/** Parameters an exclusion-only unit-filter may carry: the side it names and the keywords it excludes. */
const EXCLUSION_KEYS = new Set(["side", "excluded_keywords", "excluded_all_keywords"]);

/** A unit-filter that only excludes units ("(excluding **MONSTER** units)"), so it can narrow a selection but not name one. */
function exclusionOnly(leaf: CompileLeaf | undefined): boolean {
  if (!isFilter(leaf) || !Object.keys(leaf!.parameters).every((key) => EXCLUSION_KEYS.has(key))) return false;
  const excluded = (leaf!.parameters.excluded_keywords as unknown[] | undefined)?.length ?? 0;
  const allExcluded = (leaf!.parameters.excluded_all_keywords as unknown[] | undefined)?.length ?? 0;
  return excluded + allExcluded > 0;
}
