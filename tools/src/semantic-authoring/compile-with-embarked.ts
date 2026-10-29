import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * "That unit (and any units embarked within that unit): A. B.": the with-embarked-units leaf widens every effect
 * after it in its fragment to the units embarked within that effect's unit too. The leaf folds away; each effect
 * after it carries `with_embarked`, which {@link withEmbarked} lowers.
 */
export function foldWithEmbarked(given: readonly CompileLeaf[]): CompileLeaf[] {
  const markers = given.filter((leaf) => leaf.family_id === "with-embarked-units");
  if (markers.length === 0) return [...given];
  return given.flatMap((leaf) => {
    if (leaf.family_id === "with-embarked-units") return [];
    const widened = leaf.role === "EFFECT" && markers.some((marker) => marker.fragment === leaf.fragment && marker.start_byte < leaf.start_byte);
    return [widened ? { ...leaf, parameters: { ...leaf.parameters, with_embarked: true } } : leaf];
  });
}

/** An effect node and the same effect on the units embarked within its target. */
export function withEmbarked(node: Node): Node {
  const target = node.target;
  if (target === undefined) return node;
  return { type: "sequence", steps: [node, { ...structuredClone(node), target: { owner: "friendly", embarked_in: structuredClone(target) } }] };
}
