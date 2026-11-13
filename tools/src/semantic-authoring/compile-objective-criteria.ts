import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "Select one objective that: your unit was controlling when it was destroyed. Has no enemy units
 * within range of it.": each objective-criterion qualifies the markers the select-objective-open
 * before it can take. The criteria fold into that leaf (controlled_by_unit, clear_of), which
 * lowers them into its selector's filter (compile-containers.ts), and leave the list. A criterion
 * needs a select-objective-open before it with no effect between them; one criterion of each
 * kind per selection. A territory in-region right after the selection folds the same way.
 */
export function foldObjectiveCriteria(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "objective-criterion" || leaf.family_id === "in-region")) return [...list];
  const out: CompileLeaf[] = [];
  let head = -1;
  for (const leaf of list) {
    if (leaf.family_id === "select-objective-open") head = out.length;
    else if (leaf.role === "EFFECT") head = -1;
    // "select one objective marker that is not in your opponent's deployment zone": a territory right
    // after the selection, before any effect, says which markers it can take (the selector's territory).
    if (leaf.family_id === "in-region" && head >= 0 && head === out.length - 1 && leaf.parameters.region_kind === "territory"
      && Object.keys(leaf.parameters).every((key) => ["region_kind", "territory", "negated"].includes(key))) {
      const selection = out[head]!;
      const key = leaf.parameters.negated === true ? "outside_territory" : "territory";
      out[head] = { ...selection, end_byte: leaf.end_byte, parameters: { ...selection.parameters, [key]: leaf.parameters.territory } };
      continue;
    }
    if (leaf.family_id !== "objective-criterion") { out.push(leaf); continue; }
    if (head < 0) throw new CompileError("An objective criterion qualifies the objective markers a select-objective-open right before it selects.");
    const selection = out[head]!;
    const key = leaf.parameters.criterion === "controlled-by-unit" ? "controlled_by_unit" : "clear_of";
    if (selection.parameters[key] !== undefined) throw new CompileError(`A selection of objective markers takes one ${leaf.parameters.criterion} criterion.`);
    // "that your unit was controlling at the end of the previous phase": control read then, not when the rule triggered.
    const at = key === "controlled_by_unit" && leaf.parameters.at !== undefined ? { controlled_at: leaf.parameters.at } : {};
    const value = key === "controlled_by_unit" ? leaf.parameters.unit : {
      owner: leaf.parameters.side,
      ...(Array.isArray(leaf.parameters.keywords) ? { all_of: leaf.parameters.keywords } : {}),
      ...(Array.isArray(leaf.parameters.excluded_keywords) ? { none_of: leaf.parameters.excluded_keywords } : {}),
    };
    out[head] = { ...selection, parameters: { ...selection.parameters, [key]: value, ...at } };
  }
  return out;
}
