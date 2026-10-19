/**
 * A roll a named ability makes (its own dice, as a re-roll or a modifier). The dice belong to that ability only when its use is in the same clause before
 * the roll: an event that the ability was used, or an ability-used of it in progress. An ability
 * that is only activated (an option choice, an ability-activate effect) rolls nothing here, so it
 * does not bind the roll.
 */

import { abilityRollOf, CompileError, type CompileLeaf } from "./compile-fragments.js";

/** Whether an earlier leaf in the same clause shows a use of the ability: a used event or an ability-used. */
function useBefore(list: readonly CompileLeaf[], index: number, id: string): boolean {
  const fragment = list[index]!.fragment;
  return list.slice(0, index).some((leaf) => {
    if (leaf.fragment !== fragment) return false;
    if (leaf.family_id === "event") return leaf.parameters.kind === "used" && leaf.parameters.activity === "ability" && leaf.parameters.id === id;
    if (leaf.family_id === "ability-used") return leaf.parameters.id === id && leaf.parameters.window === "now" && leaf.parameters.negated !== true;
    return false;
  });
}

/** Each roll of a named ability has a use of that ability before it in its clause (throws otherwise). */
export function checkAbilityRollUses(list: readonly CompileLeaf[]): void {
  list.forEach((leaf, index) => {
    if (leaf.family_id !== "reroll" && leaf.family_id !== "roll-modifier") return;
    const id = abilityRollOf(leaf)?.of_ability;
    if (id === undefined) return;
    if (!useBefore(list, index, id)) throw new CompileError(`roll of ability ${id} at byte ${leaf.start_byte} has no use of ${id} before it in its clause.`);
  });
}
