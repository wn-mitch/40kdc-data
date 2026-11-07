import type { CompileLeaf } from "./compile-fragments.js";
import { exactSpan } from "./contracts.js";

/** The sticky-objective subjects that name a unit (or model) whose own controlled objectives become secured. */
const UNIT_SUBJECTS = new Set(["this-unit", "this-model", "selected-unit", "recipient"]);
/** The words between "… is controlling an objective" and "that objective is secured": a comma and "that". */
const BACK_TO_OBJECTIVE = /^[\s*]*,?[\s*]*that[\s*]*$/iu;

/**
 * Whether a controls-objective leaf only says that a unit controls an objective: one or more
 * objectives, by no named player, of no named kind, not negated, with no upper bound.
 */
function plainUnitControl(leaf: CompileLeaf): boolean {
  const p = leaf.parameters;
  return p.mode === "count" && p.count_min === 1 && p.count_max === undefined && p.by === undefined
    && p.objective_role === undefined && p.home_of === undefined && p.objective_territory === undefined && p.negated !== true;
}

/**
 * Folds "if <unit> is controlling an objective, that objective is secured" into the secured
 * objective alone. A sticky objective with a unit subject is already "the objectives that unit
 * controls", so the control test before it is that effect's own scope, not a separate gate; lowered
 * as a condition it would read as the army controlling any objective. The control leaf is dropped
 * only when it names no player ("if you control …" keeps its gate), carries no objective filter or
 * bound, and is the leaf right before the sticky objective in its fragment with only ", that"
 * between them.
 */
export function foldStickyControl(leaves: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (sourceText === undefined || !leaves.some((leaf) => leaf.family_id === "sticky-objective")) return [...leaves];
  return leaves.filter((leaf, index) => {
    if (leaf.family_id !== "controls-objective" || !plainUnitControl(leaf)) return true;
    const next = leaves[index + 1];
    if (next?.family_id !== "sticky-objective" || next.fragment !== leaf.fragment) return true;
    if (!UNIT_SUBJECTS.has(String(next.parameters.subject ?? "this-unit"))) return true;
    if (leaf.end_byte === undefined || next.start_byte === undefined || next.start_byte < leaf.end_byte) return true;
    return !BACK_TO_OBJECTIVE.test(exactSpan(sourceText, leaf.end_byte, next.start_byte));
  });
}
