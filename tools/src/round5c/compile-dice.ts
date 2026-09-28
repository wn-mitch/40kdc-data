import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { DICE_FACES } from "./dice-families.js";

/**
 * Result bands of a roll. A roll-result leaf compiles to a marker condition that clause binding
 * places like any other; this module then turns marked effects into the DSL's roll shapes:
 *
 * - fight-on-death takes its band as its own per-model gate, and its other conditions as its
 *   eligibility, because each destroyed model rolls separately;
 * - one band that reaches the die's top face ("on a 4+") becomes dice-gated;
 * - several bands ("on a 2-5 …; on a 6 …") become a dice-table, faces no band names doing nothing.
 */

type Node = Record<string, unknown>;
export type Planned = { index: number; leaf: CompileLeaf; node: Node; gate: Node[] };

const ROLL = "__roll-result";

export function rollMarker(leaf: CompileLeaf): Node {
  return { type: ROLL, from: leaf.parameters.from, to: leaf.parameters.to };
}

export const isRollMarker = (node: Node): boolean => node.type === ROLL;

const allOf = (nodes: Node[]): Node | null => nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : { operator: "and", operands: nodes };
const gated = (gate: Node[], body: Node): Node => {
  const condition = allOf(gate);
  return condition ? { type: "conditional", condition, effect: body } : body;
};
const body = (items: Planned[]): Node => {
  const steps = items.map((item) => gated(item.gate, item.node));
  return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
};

/**
 * Replace roll-gated effects with the roll shape. `global` may hold a band that gates every
 * effect; it is moved onto each effect first. Returns the ordered steps of the ability body.
 */
export function resolveRolls(planned: Planned[], global: Node[], rolls: readonly CompileLeaf[]): Node[] {
  const globalBands = global.filter(isRollMarker);
  if (globalBands.length) {
    for (const item of planned) item.gate = [...globalBands, ...item.gate];
    global.splice(0, global.length, ...global.filter((node) => !isRollMarker(node)));
  }
  const banded = planned.filter((item) => item.gate.some(isRollMarker));
  if (banded.length === 0) {
    if (rolls.length) throw new CompileError("A roll has no result band (\"on a 4+\") saying what it decides.");
    return planned.map((item) => gated(item.gate, item.node));
  }
  if (rolls.length !== 1) throw new CompileError(`Result bands need exactly one roll; found ${rolls.length}.`);
  const dice = String(rolls[0]!.parameters.dice);
  const faces = DICE_FACES[dice]!;
  const bandOf = (item: Planned) => {
    const markers = item.gate.filter(isRollMarker);
    if (markers.length > 1) throw new CompileError("One effect is gated by two result bands.");
    item.gate = item.gate.filter((node) => !isRollMarker(node));
    const band = markers[0]!;
    if (Number(band.to) > faces) throw new CompileError(`A result band reaches ${String(band.to)}, beyond a ${dice}.`);
    return { from: Number(band.from), to: Number(band.to) };
  };

  const table: Array<{ band: { from: number; to: number }; items: Planned[] }> = [];
  for (const item of banded) {
    const band = bandOf(item);
    if (item.leaf.family_id === "fight-on-death" && (item.node.modifier as Node).act === "fight") {
      if (band.to !== faces) throw new CompileError("Fighting on death needs a band that reaches the top face (\"on a 2+\").");
      const modifier = item.node.modifier as Node;
      modifier.gate = { dice, threshold: band.from, comparison: "gte" };
      // As the ability's only effect, the conditions ahead of it ("if that model has not fought")
      // say which destroyed models roll, so they are its eligibility rather than a wrapper.
      if (planned.length === 1) {
        item.gate = [...global, ...item.gate];
        global.splice(0, global.length);
      }
      const eligibility = allOf(item.gate);
      if (eligibility) modifier.eligibility = eligibility;
      item.gate = [];
      continue;
    }
    const row = table.find((entry) => entry.band.from === band.from && entry.band.to === band.to);
    if (row) row.items.push(item); else table.push({ band, items: [item] });
  }

  const rollNode = (): Node | null => {
    if (table.length === 0) return null;
    table.sort((left, right) => left.band.from - right.band.from);
    if (table.length === 1 && table[0]!.band.to === faces) {
      return { type: "dice-gated", dice, threshold: table[0]!.band.from, comparison: "gte", on_success: body(table[0]!.items), on_fail: null };
    }
    if (dice === "2D6") throw new CompileError("Several result bands on 2D6 have no DSL table; only D3 and D6 tables exist.");
    const outcomes: Array<{ results: number[]; effect: Node }> = [];
    let next = 1;
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
    for (const row of table) {
      if (row.band.from < next) throw new CompileError("Two result bands overlap.");
      if (row.band.from > next) outcomes.push({ results: range(next, row.band.from - 1), effect: { type: "no-effect" } });
      outcomes.push({ results: range(row.band.from, row.band.to), effect: body(row.items) });
      next = row.band.to + 1;
    }
    if (next <= faces) outcomes.push({ results: range(next, faces), effect: { type: "no-effect" } });
    return { type: "dice-table", dice, outcomes };
  };

  // The roll takes the place of its first banded effect; everything else keeps its order.
  const roll = rollNode();
  const tabled = new Set(table.flatMap((row) => row.items));
  const steps: Node[] = [];
  let placed = false;
  for (const item of planned) {
    if (tabled.has(item)) {
      if (!placed && roll) steps.push(roll);
      placed = true;
      continue;
    }
    steps.push(gated(item.gate, item.node));
  }
  return steps;
}
