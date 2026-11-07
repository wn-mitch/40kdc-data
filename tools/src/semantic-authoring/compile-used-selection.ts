import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/** Leaves by which a record selects or targets units of its own; "the selected unit" is then that one. */
const OWN_SELECTIONS = new Set([
  "select-unit", "for-each-unit-select", "stratagem-target", "triggering-target", "target-binding", "persistent-designation-open",
]);

const SELECTED = "selected-unit";
const USE_OBJECT = "event-object";

/** A moment at which a unit uses a named ability (event kind used with the ability's id). */
function namedUse(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" && leaf.parameters.kind === "used" && leaf.parameters.id !== undefined;
}

const naming = (leaf: CompileLeaf) => Object.entries(leaf.parameters).filter(([, value]) => value === SELECTED).map(([key]) => key);

/**
 * "Each time the bearer uses its Foo ability, … add 3\" to the Move characteristic of the selected VEHICLE
 * model": in a record that selects no unit of its own, the selected unit is the one the used ability
 * selected, which the DSL holds as the use's object (event-object). Refuses what it cannot bind: two named
 * uses, a use aimed at this unit or model (event object), or a selected unit named before the use.
 */
export function bindUsedSelections(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  if (leaves.some((leaf) => OWN_SELECTIONS.has(leaf.family_id))) return [...leaves];
  const uses = leaves.flatMap((leaf, at) => namedUse(leaf) ? [at] : []);
  if (uses.length === 0 || !leaves.some((leaf) => naming(leaf).length > 0)) return [...leaves];
  if (uses.length > 1) throw new CompileError("A selected unit with no selection in the record follows two uses of named abilities; which use selected it is ambiguous.");
  const at = uses[0]!;
  const use = leaves[at]!;
  if (use.parameters.object !== undefined) {
    throw new CompileError(`event at byte ${use.start_byte} is aimed at ${String(use.parameters.object)}, so the selected unit after it is no unit the use selected.`);
  }
  return leaves.map((leaf, index) => {
    const keys = naming(leaf);
    if (keys.length === 0) return leaf;
    if (index < at || leaf.fragment !== use.fragment) {
      throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} names the selected unit outside the use of the ability that selects it.`);
    }
    return { ...leaf, parameters: { ...leaf.parameters, ...Object.fromEntries(keys.map((key) => [key, USE_OBJECT])) } };
  });
}
