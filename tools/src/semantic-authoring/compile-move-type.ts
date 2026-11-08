import { condition } from "./compile-conditions.js";
import { closed, CompileError, effect, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

export const MOVE_TYPE_OPEN = "move-type-open";
export const MOVE_TYPE_SECTION = "move-type-section";

/** The DSL field each section fills; the effect section restates the core move and fills none. */
const SECTION_FIELDS: Readonly<Record<string, string | null>> = { eligible: "eligible_if", effect: null, before: "before", while: "while", after: "after" };

/**
 * A move type an army rule defines (Special Move Types), from its opener and the leaves after it up to
 * the next opener: each run of leaves follows a move-type-section marker naming the part it states.
 * Eligibility is the conjunction of its condition leaves; before, while and after are effects, and a
 * run with its own duration or moment compiles as an ability part through `nested`.
 */
export function buildMoveType(head: CompileLeaf, body: readonly CompileLeaf[], nested: ((leaves: readonly CompileLeaf[]) => Node) | null): Node {
  const node: Node = { type: "move-type", name: closed(head, "name"), move_type: closed(head, "move_type") };
  if (head.parameters.mode !== undefined) node.mode = closed(head, "mode");
  if (node.move_type === "disembark" && node.mode === undefined) throw new CompileError("A disembark move type needs the mode it defines.");
  if (head.parameters.setup_inches !== undefined) node.setup_distance = { inches: closed(head, "setup_inches") };
  if (head.parameters.distance_inches !== undefined && head.parameters.distance_dice !== undefined) throw new CompileError("A move type prints one maximum distance: inches or dice, not both.");
  if (head.parameters.distance_inches !== undefined) node.distance = closed(head, "distance_inches");
  if (head.parameters.distance_dice !== undefined) node.distance = closed(head, "distance_dice");
  if (body.length > 0 && body[0]!.family_id !== MOVE_TYPE_SECTION) throw new CompileError("Each part of a move type needs a leading move-type-section leaf naming it.");
  const runs: Array<{ section: string; leaves: CompileLeaf[] }> = [];
  for (const leaf of body) {
    if (leaf.family_id === MOVE_TYPE_SECTION) runs.push({ section: closed(leaf, "section") as string, leaves: [] });
    else runs.at(-1)!.leaves.push(leaf);
  }
  // "After moving: your unit must be unengaged": where the move ends, the move's own end rule.
  let endsUnengaged = false;
  for (const run of runs) {
    if (run.section !== "after") continue;
    const ending = run.leaves.filter(isUnengaged);
    if (ending.length === 0) continue;
    endsUnengaged = true;
    run.leaves = run.leaves.filter((leaf) => !isUnengaged(leaf));
  }
  for (const { section, leaves } of runs) {
    const field = SECTION_FIELDS[section];
    if (field === undefined) throw new CompileError(`Unknown move-type section ${section}.`);
    if (field === null) {
      if (leaves.length > 0) throw new CompileError("A move type's effect section restates the core move; it holds no leaves.");
      continue;
    }
    if (leaves.length === 0) continue;
    if (node[field] !== undefined) throw new CompileError(`A move type states its ${section} section once.`);
    node[field] = field === "eligible_if" ? eligibility(leaves) : effects(leaves, nested);
  }
  if (endsUnengaged) {
    const end = { type: "move-modifier", target: "this-unit", modifier: { no_end_in_engagement: true } };
    const prior = node.while as Node | undefined;
    node.while = prior === undefined ? end : { type: "sequence", steps: [...(prior.type === "sequence" ? prior.steps as Node[] : [prior]), end] };
  }
  return node;
}

/** "Your unit must be unengaged" after the move: this unit, not engaged. */
function isUnengaged(leaf: CompileLeaf): boolean {
  const p = leaf.parameters;
  return leaf.role === "CONDITION" && leaf.family_id === "unit-state" && p.negated === true && p.subject === "this-unit"
    && Array.isArray(p.states) && p.states.length === 1 && p.states[0] === "engaged" && p.with === undefined && p.at === undefined;
}

function eligibility(leaves: readonly CompileLeaf[]): Node {
  const bad = leaves.find((leaf) => leaf.role !== "CONDITION");
  if (bad) throw new CompileError(`A move type's eligible section holds condition leaves only; ${bad.family_id} has no place there.`);
  const operands = leaves.map((leaf) => condition(leaf));
  return operands.length === 1 ? operands[0]! : { operator: "and", operands };
}

function effects(leaves: readonly CompileLeaf[], nested: ((leaves: readonly CompileLeaf[]) => Node) | null): Node {
  if (leaves.every((leaf) => leaf.role === "EFFECT")) {
    const nodes = leaves.map((leaf) => effect(leaf, { attached: false, attacker: null, incoming: false }));
    return nodes.length === 1 ? nodes[0]! : { type: "sequence", steps: nodes };
  }
  if (!nested) throw new CompileError("A move type's part with its own duration or moment needs the nested compiler.");
  return nested(leaves);
}
