import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { exclusionOnly } from "./compile-select-exclusions.js";

const isFilter = (leaf: CompileLeaf | undefined) => leaf?.family_id === "unit-filter";

/**
 * "The following friendly X units have K: A units. B units.": the unit-filters after a grant's
 * colon are the head filter's alternatives. The head is the unit-filter right before the effect (past
 * "from your army"); the effect names its units by that filter; only a colon, and then the filters'
 * own sentence ends, sit between the effect and the list. The list becomes one alternatives filter
 * and merges into the head, so the effect reads one filter.
 */
export function foldListNarrowing(
  input: readonly CompileLeaf[],
  mergeFilters: (first: CompileLeaf, second: CompileLeaf) => CompileLeaf | null,
  alternatives: (filters: readonly CompileLeaf[]) => CompileLeaf,
  sourceText: string | undefined,
): CompileLeaf[] {
  if (sourceText === undefined) return [...input];
  const list = [...input];
  const bytes = Buffer.from(sourceText, "utf8");
  const between = (from: number, to: number) => bytes.subarray(from, to).toString("utf8").replace(/[*\s]/gu, "");
  for (let index = 0; index < list.length; index += 1) {
    const head = list[index]!;
    if (!isFilter(head) || exclusionOnly(head)) continue;
    let effectAt = index + 1;
    while (list[effectAt]?.family_id === "unit-owner" && list[effectAt]!.fragment === head.fragment) effectAt += 1;
    const effect = list[effectAt];
    if (effect === undefined || effect.fragment !== head.fragment || effect.role !== "EFFECT" || !Object.values(effect.parameters).includes("antecedent")) continue;
    const first = list[effectAt + 1];
    if (!isFilter(first) || first!.fragment !== head.fragment || between(effect.end_byte!, first!.start_byte!) !== ":") continue;
    let end = effectAt + 1;
    const run: CompileLeaf[] = [];
    while (isFilter(list[end]) && list[end]!.fragment === head.fragment && list[end]!.parameters.side === head.parameters.side
      && (run.length === 0 || /^[.;]?$/u.test(between(run.at(-1)!.end_byte!, list[end]!.start_byte!)))) { run.push(list[end]!); end += 1; }
    const narrowed = run.length === 1 ? run[0]! : alternatives(run);
    const merged = mergeFilters(head, narrowed);
    if (merged === null) throw new CompileError("A list after a colon cannot narrow the filter before the effect (its sides or keyword lists conflict).");
    list[index] = { ...merged, end_byte: head.end_byte };
    list.splice(effectAt + 1, run.length);
  }
  return list;
}

const DESIGNATION_HEADS = new Set(["select-unit", "for-each-unit-select", "stratagem-target"]);

/**
 * "Select one unravelling enemy unit", "for each poisoned enemy unit": a designation the quantifier
 * names before its noun. The designation check moves after the unit-filter, where "enemy unit that is
 * unravelling" puts it, so the head folds its filter and the check gates the units that filter names.
 */
export function foldDesignationBeforeFilter(input: readonly CompileLeaf[]): CompileLeaf[] {
  const list = [...input];
  for (let index = 0; index + 2 < list.length; index += 1) {
    const [head, designation, filter] = [list[index]!, list[index + 1]!, list[index + 2]!];
    if (!DESIGNATION_HEADS.has(head.family_id) || designation.family_id !== "designated-filter" || !isFilter(filter)) continue;
    if (designation.fragment !== head.fragment || filter.fragment !== head.fragment) continue;
    if (designation.parameters.subject !== undefined && designation.parameters.subject !== "antecedent") continue;
    if (designation.parameters.count_min !== undefined || designation.parameters.count_max !== undefined || designation.parameters.by !== undefined) continue;
    list[index + 1] = filter;
    list[index + 2] = designation;
  }
  return list;
}
