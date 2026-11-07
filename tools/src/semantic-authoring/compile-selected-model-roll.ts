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

/**
 * "Each time a melee attack is allocated to a model in this unit, after the attacking unit has finished making its
 * attacks, roll one D6 (to a maximum of six D6 per attacking unit)": one die for each attack the attacking unit
 * allocated to this unit, rolled once its attacks are done. The attack moment before the roll names which attacks
 * count, so it folds into the roll as per_attack and is no moment of its own. It needs that moment (an attack on this
 * unit) before the roll, in its fragment, with no effect between them; otherwise it is refused.
 */
export function foldAllocatedAttackRolls(list: readonly CompileLeaf[]): CompileLeaf[] {
  const dropped = new Set<number>();
  const folded = list.map((leaf, index) => {
    if (leaf.family_id !== "dice-roll" || leaf.parameters.per_model !== "allocated-attack") return leaf;
    let at = index - 1;
    while (at >= 0 && list[at]!.family_id !== "attack") at -= 1;
    const attack = list[at];
    if (attack === undefined || attack.parameters.direction !== "targeted" || attack.parameters.unit !== "this-unit" || attack.fragment !== leaf.fragment) {
      throw new CompileError("A roll for each allocated attack needs the moment an attack targets this unit before it.");
    }
    if (list.slice(at + 1, index).some((between) => between.role === "EFFECT")) {
      throw new CompileError("A roll for each allocated attack follows its attack moment with no effect between them.");
    }
    dropped.add(at);
    const { per_model: _perModel, ...parameters } = leaf.parameters;
    const type = attack.parameters.attack_type;
    return { ...leaf, parameters: { ...parameters, per_attack: type === undefined || type === "any" ? {} : { attack_type: type } } };
  });
  return folded.filter((_, index) => !dropped.has(index));
}
