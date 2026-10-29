import { CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

const MODELS = "destroyed-models-by-triggering-attacks";

/** The select-unit key a destroyed-model-selection folds into: who made the triggering attacks. */
export const AMONG_DESTROYED = "among_destroyed_by";

/**
 * "Select one of those destroyed models; that destroyed model's unit must take a Battle-shock
 * test": a destroyed-model-selection limits the select-unit right before it (no effect between) to
 * the units that lost a model to the triggering attacks. It folds into that leaf and leaves the
 * list; selectUnit (compile-wrappers.ts) lowers it as the selection's eligibility.
 */
export function foldDestroyedSelections(input: readonly CompileLeaf[]): CompileLeaf[] {
  if (!input.some((leaf) => leaf.family_id === "destroyed-model-selection")) return [...input];
  const list = withoutRestatedGate(input);
  const out: CompileLeaf[] = [];
  let head = -1;
  for (const leaf of list) {
    if (leaf.family_id === "select-unit") head = out.length;
    else if (leaf.role === "EFFECT") head = -1;
    if (leaf.family_id !== "destroyed-model-selection") { out.push(leaf); continue; }
    if (head < 0) throw new CompileError("A destroyed-model-selection limits the select-unit right before it.");
    const selection = out[head]!;
    if (selection.parameters[AMONG_DESTROYED] !== undefined) throw new CompileError("A selection takes one destroyed-model-selection.");
    out[head] = { ...selection, parameters: { ...selection.parameters, [AMONG_DESTROYED]: leaf.parameters.destroyer } };
  }
  return out;
}

/**
 * "If one or more enemy models are destroyed as the result of those attacks, select one of those
 * destroyed models": the destruction gate restates what the selection already requires (a
 * selection among units that lost a model has no candidate unless a model was destroyed), so a
 * destroyed-models-by-triggering-attacks gate by the same destroyer before the selection, with
 * the model-level unit-filter that names its victims, is dropped rather than rendered twice.
 */
function withoutRestatedGate(list: readonly CompileLeaf[]): CompileLeaf[] {
  const at = list.findIndex((leaf) => leaf.family_id === "destroyed-model-selection");
  const destroyer = list[at]!.parameters.destroyer;
  const gate = list.findIndex((leaf, index) => index < at && leaf.family_id === "unit-activity"
    && (leaf.parameters.activities as unknown[] | undefined)?.length === 1 && (leaf.parameters.activities as unknown[])[0] === MODELS
    && leaf.parameters.destroyer === destroyer && leaf.parameters.negated === false);
  if (gate < 0) return [...list];
  const victims = gate > 0 && list[gate - 1]!.family_id === "unit-filter" && list[gate - 1]!.parameters.level === "model" ? gate - 1 : gate;
  return list.filter((_, index) => index < victims || index > gate);
}

/** The eligibility a folded destroyed-model-selection gives its selection: a model of the candidate destroyed by the triggering attacks. */
export function destroyedSelectionEligibility(selection: CompileLeaf): Node | null {
  const destroyer = selection.parameters[AMONG_DESTROYED];
  if (destroyer === undefined) return null;
  return { type: "happened", parameters: { event: "model-destroyed", object: { level: "model", member_of: "selected-unit" }, filter: { by: destroyer }, window: "event" } };
}
