import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** A move-must-end restriction in one ability: the leaf's index and its conditions, by index. */
export type MoveEndRule = { index: number; match: string; cannot: boolean; moveTypes: string[] | null; conditions: number[] };

/** An effect already compiled, by its leaf index. */
export type PlacedNode = { index: number; node: Node };

/**
 * "…, and cannot end that move within Engagement Range of them", where the move is the trigger's
 * (a move-ended event) and no make-move in the ability makes it. The restriction is the enemy
 * engagement end rule: the move-modifier carries no_end_in_engagement, on the unit the nearest
 * move-through or move permission in its sentence binds. applies_to_moves is the restriction's own
 * move_types, else the trigger's, else omitted (every move). Returns an error when a piece is missing.
 */
export function triggerMoveEnd(
  list: readonly CompileLeaf[],
  rule: MoveEndRule,
  placed: readonly PlacedNode[],
  stopBetween: (from: number, to: number) => boolean,
): { node: Node } | { error: string } {
  const refuse = (error: string) => ({ error });
  if (!rule.cannot) return refuse("\"Must end that move\" has no move before it.");
  if (rule.conditions.length !== 1) return refuse("\"Cannot end that move\" with no move before it needs exactly one condition: engaged.");
  const condition = list[rule.conditions[0]!]!;
  const params = condition.parameters;
  const engaged = condition.family_id === "unit-state" && Array.isArray(params.states) && params.states.length === 1 && params.states[0] === "engaged";
  if (!engaged || params.subject !== "this-unit") return refuse("\"Cannot end that move\" with no move before it covers only \"engaged\" with this unit.");
  if (params.negated !== false) return refuse("\"Cannot end that move\" with no move before it does not take a negated engaged condition.");
  if (params.with !== undefined || params.at !== undefined) return refuse("\"Cannot end that move\" with no move before it does not take a with or at qualifier.");

  let trigger: CompileLeaf | undefined;
  for (let at = rule.index - 1; at >= 0 && !trigger; at -= 1) {
    const leaf = list[at]!;
    if (leaf.family_id === "event" && leaf.parameters.kind === "move-ended") trigger = leaf;
  }
  if (!trigger) return refuse("\"Cannot end that move\" has no move before it: no move-ended trigger precedes it.");

  const triggerMoves = Array.isArray(trigger.parameters.move_types) ? trigger.parameters.move_types as string[] : null;
  if (rule.moveTypes && triggerMoves && !rule.moveTypes.every((type) => triggerMoves.includes(type))) {
    return refuse("\"Cannot end that move\" names a move type the trigger does not name.");
  }
  const applies = rule.moveTypes ?? triggerMoves;

  // The bound effect is in the restriction's sentence: no stop (. ; :) in the source between them.
  const bound = placed.filter((item) => item.index < rule.index && !stopBetween(item.index, rule.index)
    && (isPassthrough(item.node) || isMovePermission(item.node))).at(-1);
  if (!bound) return refuse("\"Cannot end that move\" has no move-through or move permission in its sentence to bind its unit.");

  const modifier: Node = { no_end_in_engagement: true };
  if (applies) modifier.applies_to_moves = applies;
  return { node: { type: "move-modifier", target: bound.node.target, modifier } };
}

function isPassthrough(node: Node): boolean {
  return node.type === "move-modifier" && (node.modifier as Node | undefined)?.passthrough !== undefined;
}

function isMovePermission(node: Node): boolean {
  return node.type === "permission" && (node.modifier as Node | undefined)?.activity === "move";
}
