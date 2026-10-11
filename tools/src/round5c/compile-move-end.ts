import { EVENT_SUBJECT } from "./family-extension-helpers.js";
import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * A move-must-end restriction in one ability: the leaf's index and its conditions, by index.
 * replaces is set when the restriction replaces the usual end threshold (move-must-end version 4).
 */
export type MoveEndRule = { index: number; match: string; cannot: boolean; moveTypes: string[] | null; conditions: number[]; replaces: boolean };

/** An effect already compiled, by its leaf index. */
export type PlacedNode = { index: number; node: Node };

/** Builds the DSL node for one condition leaf (the caller's compile step); null when it does not compile. */
export type ConditionBuilder = (leaf: CompileLeaf) => Node | null;

/**
 * "…, and cannot end that move within Engagement Range of them" and "…, can end that move more than
 * 6\" horizontally from all enemy units (instead of more than 8\")": the restriction's move is the
 * trigger's (a move-ended event, or a selection that names its moves) and no make-move in the ability
 * makes it. The one condition is either "engaged" with this unit or model (no_end_in_engagement, on
 * the unit the nearest move-through or move permission in its sentence binds), or "within a distance
 * of the unit-filter after it" with this unit (ends_when: not that place, carried as ends_when_replaces
 * when the restriction replaces the usual threshold). applies_to_moves is the restriction's own
 * move_types, else the trigger's; a distance needs the trigger's move_types and takes no leaf move_types
 * of its own. Returns an error when a piece is missing.
 */
export function triggerMoveEnd(
  list: readonly CompileLeaf[],
  rule: MoveEndRule,
  placed: readonly PlacedNode[],
  stopBetween: (from: number, to: number) => boolean,
  condition: ConditionBuilder,
): { node: Node } | { error: string } {
  const refuse = (error: string) => ({ error });
  if (!rule.cannot) return positiveChargeEnd(list, rule, condition);
  if (rule.conditions.length !== 1) return refuse("\"Cannot end that move\" with no move before it needs exactly one condition: engaged, or within a distance of a unit-filter.");
  const leaf = list[rule.conditions[0]!]!;
  if (isEngaged(leaf)) {
    if (rule.replaces) return refuse("\"Instead of\" on a cannot-end restriction with no move before it needs a distance condition, not engaged.");
    return noEndInEngagement(list, rule, placed, stopBetween, leaf);
  }
  if (isWithinFilter(leaf)) return endsWhen(list, rule, leaf, condition);
  return refuse("\"Cannot end that move\" with no move before it covers only \"engaged\" with this unit or model, or a distance to the unit-filter after it.");
}

/**
 * The nearest earlier move-ended, selected or targets-selected event, when it is a declared charge
 * (a targets-selected event with action_kind charge). Any other nearest event gives no charge anchor,
 * so a restriction never borrows a charge declared before a later move-ended or shoot trigger.
 */
export function chargeDeclarationBefore(list: readonly CompileLeaf[], index: number): CompileLeaf | undefined {
  for (let at = index - 1; at >= 0; at -= 1) {
    const leaf = list[at]!;
    if (leaf.family_id !== "event") continue;
    const kind = leaf.parameters.kind;
    if (kind !== "move-ended" && kind !== "selected" && kind !== "targets-selected") continue;
    return kind === "targets-selected" && leaf.parameters.action_kind === "charge" ? leaf : undefined;
  }
  return undefined;
}

/**
 * "This unit must end that charge move engaged with that enemy unit": a positive restriction on the
 * move that a declared charge starts. The move-modifier sits on the declaring unit (event-subject),
 * applies to charge moves, and ends where the conditions say. Each condition is a unit-state on the
 * moving unit; "this unit" in a condition is rewritten to event-subject, since in a Stratagem a bare
 * this-unit does not name the moving unit. Several conditions join with "or" (match any) or "and".
 */
function positiveChargeEnd(
  list: readonly CompileLeaf[],
  rule: MoveEndRule,
  condition: ConditionBuilder,
): { node: Node } | { error: string } {
  const refuse = (error: string) => ({ error });
  if (chargeDeclarationBefore(list, rule.index) === undefined) return refuse("\"Must end that move\" has no move before it.");
  if (rule.replaces) return refuse("\"Must end that move\" that replaces the usual threshold has no charge form.");
  if (rule.moveTypes && !rule.moveTypes.every((type) => type === "charge")) return refuse("\"Cannot end that move\" names a move type the trigger does not name.");
  if (rule.conditions.length === 0) return refuse("\"Must end that move\" names no condition for where the move ends.");
  const nodes: Node[] = [];
  for (const at of rule.conditions) {
    const leaf = list[at]!;
    if (leaf.family_id !== "unit-state") return refuse("\"Must end that move\" after a charge declaration names only a unit-state condition on the moving unit.");
    const subject = leaf.parameters.subject;
    if (subject === "this-model") return refuse("\"Must end that move\" names a model, which the charge path does not take.");
    if (subject !== "this-unit" && subject !== EVENT_SUBJECT) return refuse("\"Must end that move\" names a subject the charge path does not take.");
    const fixed = subject === "this-unit" ? { ...leaf, parameters: { ...leaf.parameters, subject: EVENT_SUBJECT } } : leaf;
    const node = condition(fixed);
    if (node === null) return refuse("\"Must end that move\" names a condition that does not compile.");
    nodes.push(node);
  }
  const where: Node = nodes.length === 1 ? nodes[0]! : { operator: rule.match === "any" ? "or" : "and", operands: nodes };
  return { node: { type: "move-modifier", target: EVENT_SUBJECT, modifier: { applies_to_moves: ["charge"], ends_when: where } } };
}

/** Engaged with this unit or this model. A model subject binds to a move that names that model (noEndInEngagement). */
function isEngaged(leaf: CompileLeaf): boolean {
  const params = leaf.parameters;
  return leaf.family_id === "unit-state" && Array.isArray(params.states) && params.states.length === 1 && params.states[0] === "engaged"
    && (params.subject === "this-unit" || params.subject === "this-model");
}

/** A unit-position within a distance, this unit, measured to the unit-filter right after it. */
function isWithinFilter(leaf: CompileLeaf): boolean {
  return leaf.family_id === "unit-position" && leaf.parameters.kind === "within" && leaf.parameters.subject === "this-unit"
    && leaf.parameters.of === "following-filter";
}

/**
 * The moment whose move a restriction ends: the nearest earlier move-ended or selected event. The caller
 * checks that a selected event names its moves (move_types); a move-ended event may not.
 */
export function moveTriggerBefore(list: readonly CompileLeaf[], index: number): CompileLeaf | undefined {
  for (let at = index - 1; at >= 0; at -= 1) {
    const leaf = list[at]!;
    if (leaf.family_id === "event" && (leaf.parameters.kind === "move-ended" || leaf.parameters.kind === "selected")) return leaf;
  }
  return undefined;
}

/** The move kinds a restriction covers: its own move_types when it names some the trigger names, else the trigger's. */
function coveredMoves(rule: MoveEndRule, trigger: CompileLeaf): { moves: string[] | null } | { error: string } {
  const triggerMoves = Array.isArray(trigger.parameters.move_types) ? trigger.parameters.move_types as string[] : null;
  if (rule.moveTypes && triggerMoves && !rule.moveTypes.every((type) => triggerMoves.includes(type))) {
    return { error: "\"Cannot end that move\" names a move type the trigger does not name." };
  }
  return { moves: rule.moveTypes ?? triggerMoves };
}

function noEndInEngagement(
  list: readonly CompileLeaf[],
  rule: MoveEndRule,
  placed: readonly PlacedNode[],
  stopBetween: (from: number, to: number) => boolean,
  condition: CompileLeaf,
): { node: Node } | { error: string } {
  const refuse = (error: string) => ({ error });
  const params = condition.parameters;
  if (params.negated !== false) return refuse("\"Cannot end that move\" with no move before it does not take a negated engaged condition.");
  if (params.with !== undefined || params.at !== undefined) return refuse("\"Cannot end that move\" with no move before it does not take a with or at qualifier.");

  const trigger = moveTriggerBefore(list, rule.index);
  if (!trigger) return refuse("\"Cannot end that move\" has no move before it: no move-ended trigger precedes it.");
  if (trigger.parameters.kind === "selected" && !Array.isArray(trigger.parameters.move_types)) return refuse("\"Cannot end that move\" after a selection needs a trigger that names its moves.");
  const covered = coveredMoves(rule, trigger);
  if ("error" in covered) return covered;

  // The bound effect is in the restriction's sentence: no stop (. ; :) in the source between them.
  // A model subject needs a bound effect that names that model, not the unit.
  const subject = params.subject;
  const bound = placed.filter((item) => item.index < rule.index && !stopBetween(item.index, rule.index)
    && (isPassthrough(item.node) || isMovePermission(item.node)) && (subject === "this-unit" || item.node.target === subject)).at(-1);
  if (!bound) return refuse(subject === "this-model"
    ? "\"Cannot end that move\" covers this model only with a move-through or move permission for this model in its sentence."
    : "\"Cannot end that move\" has no move-through or move permission in its sentence to bind its unit.");

  const modifier: Node = { no_end_in_engagement: true };
  if (covered.moves) modifier.applies_to_moves = covered.moves;
  return { node: { type: "move-modifier", target: bound.node.target, modifier } };
}

/**
 * "…, can end that move more than 6\" horizontally from all enemy units": the move ends where the
 * condition after it is not. The distance is measured from this unit. The move kinds come from the
 * trigger (a restriction that replaces the threshold may not name its own).
 */
function endsWhen(
  list: readonly CompileLeaf[],
  rule: MoveEndRule,
  leaf: CompileLeaf,
  condition: ConditionBuilder,
): { node: Node } | { error: string } {
  const refuse = (error: string) => ({ error });
  if (leaf.parameters.negated !== false) return refuse("\"Cannot end that move\" within a distance does not take a negated distance.");
  const trigger = moveTriggerBefore(list, rule.index);
  if (!trigger) return refuse("\"Cannot end that move\" has no move before it: no move-ended trigger precedes it.");
  if (!Array.isArray(trigger.parameters.move_types)) return refuse("\"Cannot end that move\" within a distance needs a trigger that names its moves.");
  if (rule.replaces && rule.moveTypes) return refuse("\"Instead of\" a usual threshold takes its move kinds from the trigger, not from the restriction.");
  const covered = coveredMoves(rule, trigger);
  if ("error" in covered) return covered;
  const where = condition(leaf);
  if (where === null) return refuse("\"Cannot end that move\" names a distance to a unit-filter that does not compile.");
  const modifier: Node = { ends_when: { operator: "not", operands: [where] } };
  if (covered.moves) modifier.applies_to_moves = covered.moves;
  if (rule.replaces) modifier.ends_when_replaces = true;
  return { node: { type: "move-modifier", target: "this-unit", modifier } };
}

function isPassthrough(node: Node): boolean {
  return node.type === "move-modifier" && (node.modifier as Node | undefined)?.passthrough !== undefined;
}

function isMovePermission(node: Node): boolean {
  return node.type === "permission" && (node.modifier as Node | undefined)?.activity === "move";
}
