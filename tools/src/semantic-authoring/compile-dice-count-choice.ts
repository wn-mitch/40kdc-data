import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "Roll either one D6 or two D6 (keep re-rolling duplicate results). … If you rolled two D6, when this unit
 * has attacked, this unit makes one hazard roll": the player picks how many dice to roll on the record's one
 * table. The record compiles with one die; the table then becomes a choice between rolling it once and
 * rolling it `count` times, each result applying (at most once when `distinct`), and what the
 * dice-count-rolled condition gates belongs to the second option only.
 */

type Node = Record<string, unknown>;

export const DICE_COUNT_OPTION = "dice-count-option";
export const DICE_COUNT_ROLLED = "dice-count-rolled";
/** The condition a dice-count-rolled leaf compiles to until the choice is folded. */
export const DICE_COUNT_MARKER = "__dice-count-rolled";

export type DiceCountOption = { count: number; distinct: boolean };

/** The record's leaves without its dice-count option, and that option; null option when the record has none. */
export function takeDiceCountOption(leaves: readonly CompileLeaf[]): { leaves: CompileLeaf[]; option: DiceCountOption | null } {
  const options = leaves.filter((leaf) => leaf.family_id === DICE_COUNT_OPTION);
  const rolled = leaves.filter((leaf) => leaf.family_id === DICE_COUNT_ROLLED);
  if (options.length === 0) {
    if (rolled.length > 0) throw new CompileError("A condition on how many dice were rolled needs a dice-count option for the player to pick.");
    return { leaves: [...leaves], option: null };
  }
  if (options.length > 1) throw new CompileError("A record offers one dice-count option; two have no DSL form.");
  const option = options[0]!;
  const rolls = leaves.filter((leaf) => leaf.family_id === "dice-roll");
  if (rolls.length !== 1 || rolls[0]!.start_byte > option.start_byte || rolls[0]!.fragment !== option.fragment) {
    throw new CompileError("A dice-count option offers another count of the one roll printed right before it.");
  }
  if (rolls[0]!.parameters.count !== undefined || rolls[0]!.parameters.per_model !== undefined || rolls[0]!.parameters.dice !== "D6") {
    throw new CompileError("A dice-count option needs one plain D6 roll before it to offer another count of.");
  }
  const count = Number(option.parameters.count);
  for (const leaf of rolled) {
    if (Number(leaf.parameters.count) !== count) throw new CompileError("A condition on how many dice were rolled names a count the option does not offer.");
  }
  return { leaves: leaves.filter((leaf) => leaf !== option), option: { count, distinct: option.parameters.distinct === true } };
}

const isMarker = (node: unknown): boolean => (node as Node | null)?.type === DICE_COUNT_MARKER;

/** The conditional's effect when the marker is its whole condition; a marker anywhere else is refused. */
function riderOf(node: Node): Node | null {
  if (node.type !== "conditional") return null;
  if (isMarker(node.condition)) return node.effect as Node;
  if (JSON.stringify(node.condition).includes(DICE_COUNT_MARKER)) {
    throw new CompileError("A condition on how many dice were rolled is joined to another condition; the choice cannot carry it.");
  }
  return null;
}

/** Takes every effect the marker gates out of `node`, into `riders`; returns the node without them, or null when nothing is left. */
function withoutRiders(node: Node, riders: Node[]): Node | null {
  const rider = riderOf(node);
  if (rider) { riders.push(rider); return null; }
  // A part whose whole effect the marker gates goes to the option with its own trigger.
  if (node.type === "ability-part" && node.effect && riderOf(node.effect as Node)) {
    riders.push({ ...node, effect: riderOf(node.effect as Node) });
    return null;
  }
  if (node.type === "sequence") {
    const steps = (node.steps as Node[]).flatMap((step) => { const kept = withoutRiders(step, riders); return kept ? [kept] : []; });
    if (steps.length === 0) return null;
    return steps.length === 1 ? steps[0]! : { ...node, steps };
  }
  const out: Node = {};
  for (const [key, value] of Object.entries(node)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && key !== "condition" && key !== "trigger") {
      const kept = withoutRiders(value as Node, riders);
      if (kept === null) throw new CompileError("A condition on how many dice were rolled gates an effect the choice cannot take out of its place.");
      out[key] = kept;
    } else out[key] = value;
  }
  return out;
}

/** The mechanics with the record's one dice-table offered as a choice of one die or `option.count` dice. */
export function foldDiceCountChoice(mechanics: Node, option: DiceCountOption): Node {
  const riders: Node[] = [];
  const effect = withoutRiders(mechanics.effect as Node, riders);
  if (effect === null) throw new CompileError("A condition on how many dice were rolled gates the whole record; the roll has nothing left to choose.");
  if (JSON.stringify(effect).includes(DICE_COUNT_MARKER)) throw new CompileError("A condition on how many dice were rolled sits where the choice cannot take it.");
  let tables = 0;
  const replace = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(replace);
    if (node === null || typeof node !== "object") return node;
    const object = node as Node;
    if (object.type === "dice-table") {
      tables += 1;
      if (object.count !== undefined || object.distinct !== undefined) throw new CompileError("A dice-count option offers another count of a table that already rolls several dice.");
      const many: Node = { ...structuredClone(object), count: option.count, ...(option.distinct ? { distinct: true } : {}) };
      return { type: "choice", options: [object, riders.length === 0 ? many : { type: "sequence", steps: [many, ...riders] }] };
    }
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, replace(value)]));
  };
  const folded = replace(effect) as Node;
  if (tables !== 1) throw new CompileError(`A dice-count option offers another count of one result table; this record rolls on ${tables}.`);
  return { ...mechanics, effect: folded };
}
