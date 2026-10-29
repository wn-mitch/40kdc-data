import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "Select one or more X models in this unit. For each X model you select, roll one D6": the roll is
 * made once per selected model. A model selection already applies its effect to each model it
 * selects, so a dice-roll with per_model "selected" lowers to a plain roll inside that selection.
 * The roll needs a model selection before it, with no effect between them (an effect there would
 * sit outside the per-model pass); otherwise it is refused.
 */
export function foldSelectedModelRolls(list: readonly CompileLeaf[]): CompileLeaf[] {
  return list.map((leaf, index) => {
    if (leaf.family_id !== "dice-roll" || leaf.parameters.per_model !== "selected") return leaf;
    let at = index - 1;
    while (at >= 0 && list[at]!.family_id !== "select-unit") at -= 1;
    const selection = list[at];
    if (selection === undefined || selection.parameters.target_kind !== "model") {
      throw new CompileError("A roll for each selected model needs a selection of models before it.");
    }
    if (list.slice(at + 1, index).some((between) => between.role === "EFFECT")) {
      throw new CompileError("A roll for each selected model follows its model selection with no effect between them.");
    }
    const { per_model: _perModel, ...parameters } = leaf.parameters;
    return { ...leaf, parameters };
  });
}
