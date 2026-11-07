import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * A Stratagem's "You cannot use this Stratagem during the fourth or fifth battle rounds" says when
 * the Stratagem can be used, not what it does. When its WHEN is a moment (an event leaf), the
 * moment is where it can be used, so the battle-round test joins the moment's condition, as the
 * core Rapid Ingress record has it. Without a moment (a use-window alone) there is no such place,
 * and the test stays a condition on the effect.
 */
export function usabilityGates(list: readonly CompileLeaf[]): Set<number> {
  const gates = new Set<number>();
  if (!list.some((leaf) => leaf.family_id === "event" && leaf.fragment === "WHEN")) return gates;
  list.forEach((leaf, index) => {
    if (leaf.family_id === "battle-round" && leaf.fragment === "RESTRICTIONS") gates.add(index);
  });
  return gates;
}

/** The moment with the gates anded onto its condition, after the phase and turn it already tests. */
export function gatedMoment(moment: Node, gates: readonly Node[]): Node {
  if (gates.length === 0) return moment;
  const own = moment.condition as Node | undefined;
  const operands = [...(own === undefined ? [] : own.operator === "and" ? own.operands as Node[] : [own]), ...gates];
  return { ...moment, condition: operands.length === 1 ? operands[0] : { operator: "and", operands } };
}
