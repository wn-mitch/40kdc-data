import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** A planned node: the leaf index it came from, the leaf, and the DSL node it compiled to. */
export type PlannedNode = { index: number; leaf: CompileLeaf; node: Node };

/** A move-distance bonus node: a move-modifier that names how far the bonus adds. */
export function isBonusNode(node: Node): boolean {
  return node.type === "move-modifier" && (node.modifier as Node | undefined)?.distance_bonus !== undefined;
}

/**
 * Attaches each move-end-nearest (its filter already folded into `of`) and its waiver, if any, to
 * the nearest earlier move in the same sentence: a make-move gets ends_nearest on its modifier; a
 * move-distance bonus gets a new move-modifier of its own, so the bonus itself is never gated by
 * the end rule. Returns the refusals; nothing is attached when one is returned for that leaf.
 */
export function attachMoveEndNearest<T extends PlannedNode>(
  list: readonly CompileLeaf[], planned: T[], sentenceAt: (index: number) => number, gateAt: (index: number) => Node[],
): string[] {
  const errors: string[] = [];
  const nearests = list.flatMap((leaf, at) => leaf.family_id === "move-end-nearest" ? [at] : []);
  const waivers = list.flatMap((leaf, at) => leaf.family_id === "move-end-waiver" ? [at] : []);
  for (const waiver of waivers) {
    if (!nearests.some((at) => sentenceAt(at) === sentenceAt(waiver))) errors.push("A move-end waiver needs a move-end nearest the closest unit in its sentence.");
  }
  for (const at of nearests) {
    const sentence = sentenceAt(at);
    const own = waivers.filter((waiver) => sentenceAt(waiver) === sentence);
    if (own.length > 1) { errors.push("A move-end nearest has more than one waiver in its sentence."); continue; }
    const of = list[at]!.parameters.of;
    if (of === undefined) { errors.push("A move-end nearest has no unit-filter for the unit it ends nearest."); continue; }
    const endsNearest: Node = { of };
    if (own.length === 1) endsNearest.waives = list[own[0]!]!.parameters.rule;
    const target = planned.filter((item) => item.index < at && sentenceAt(item.index) === sentence && (item.node.type === "move" || isBonusNode(item.node))).at(-1);
    if (!target) { errors.push("A move-end has no move to attach to."); continue; }
    if (target.node.type === "move") {
      const modifier = target.node.modifier as Node;
      if (modifier.ends_nearest !== undefined) { errors.push("A move already has a move-end nearest; a second one has no DSL form."); continue; }
      modifier.ends_nearest = endsNearest;
      continue;
    }
    const bonus = target.node.modifier as Node;
    const node: Node = { type: "move-modifier", target: target.node.target, modifier: { applies_to_moves: bonus.applies_to_moves, ends_nearest: endsNearest } };
    // The new node is the end rule's own effect: it takes the gates of the end leaf's clause, not the bonus's.
    planned.splice(planned.indexOf(target) + 1, 0, { ...target, index: at, leaf: list[at]!, node: node as T["node"], gate: gateAt(at) });
  }
  return errors;
}

/**
 * A permission flagged engaged_with_move_end names the unit the ability's move ends nearest. It is
 * not a permission of its own: it binds allow_engagement on the nearest earlier make-move that ends
 * nearest, so the permission node is dropped from the plan. A bound permission with no such move is
 * refused.
 */
export function bindEngagedPermissions(planned: PlannedNode[]): string[] {
  const errors: string[] = [];
  for (const item of [...planned]) {
    if (item.leaf.family_id !== "eligibility-permission" || item.leaf.parameters.engaged_with_move_end !== true) continue;
    const move = planned.filter((other) => other.index < item.index && other.node.type === "move" && (other.node.modifier as Node).ends_nearest !== undefined).at(-1);
    if (!move) { errors.push("A permission bound to the move-end's unit has no move-end nearest in its ability."); continue; }
    const modifier = move.node.modifier as Node;
    modifier.allow_engagement = true;
    modifier.engaged_with = "nearest-move-end";
    planned.splice(planned.indexOf(item), 1);
  }
  return errors;
}
