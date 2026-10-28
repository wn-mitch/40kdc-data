import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "Select one objective that: your unit was controlling when it was destroyed. Has no enemy units
 * within range of it.": each objective-criterion qualifies the markers the select-objective-open
 * before it can take. The criteria fold into that leaf (controlled_by_unit, clear_of), which
 * lowers them into its selector's filter (compile-containers.ts), and leave the list. A criterion
 * needs a select-objective-open before it with no effect between them; one criterion of each
 * kind per selection.
 */
export function foldObjectiveCriteria(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "objective-criterion")) return [...list];
  const out: CompileLeaf[] = [];
  let head = -1;
  for (const leaf of list) {
    if (leaf.family_id === "select-objective-open") head = out.length;
    else if (leaf.role === "EFFECT") head = -1;
    if (leaf.family_id !== "objective-criterion") { out.push(leaf); continue; }
    if (head < 0) throw new CompileError("An objective criterion qualifies the objective markers a select-objective-open right before it selects.");
    const selection = out[head]!;
    const key = leaf.parameters.criterion === "controlled-by-unit" ? "controlled_by_unit" : "clear_of";
    if (selection.parameters[key] !== undefined) throw new CompileError(`A selection of objective markers takes one ${leaf.parameters.criterion} criterion.`);
    const value = key === "controlled_by_unit" ? leaf.parameters.unit : {
      owner: leaf.parameters.side,
      ...(Array.isArray(leaf.parameters.keywords) ? { all_of: leaf.parameters.keywords } : {}),
      ...(Array.isArray(leaf.parameters.excluded_keywords) ? { none_of: leaf.parameters.excluded_keywords } : {}),
    };
    out[head] = { ...selection, parameters: { ...selection.parameters, [key]: value } };
  }
  return out;
}
