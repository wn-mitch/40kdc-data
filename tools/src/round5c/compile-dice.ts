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
 * Several dice rolled at once, each success doing the same thing ("roll six D6: for each 5+,
 * that unit suffers 1 mortal wound", or one D6 for each model in this unit). The DSL expresses this only for mortal wounds, as a count
 * per success of a roll of `count` D6; anything else rolled per die has no DSL shape yet.
 */
function perSuccess(planned: Planned[], banded: Planned[], dice: string, count: number, bound: boolean, perModel?: string): Node[] {
  if (dice !== "D6") throw new CompileError(`Rolling ${count} ${dice} has no DSL shape; only several D6 fold into a count per success.`);
  if (bound) throw new CompileError("A roll of several dice cannot also bind a roll_var.");
  for (const item of banded) {
    const markers = item.gate.filter(isRollMarker);
    if (markers.length !== 1) throw new CompileError("One effect is gated by two result bands.");
    const band = markers[0]!;
    if (Number(band.to) !== 6) throw new CompileError("A per-die success band must reach 6 (\"for each 5+\").");
    if (item.leaf.family_id !== "mortal-wounds") throw new CompileError(`Rolling several dice folds only into mortal wounds per success; ${item.leaf.family_id} has no per-die DSL shape.`);
    const modifier = item.node.modifier as Node;
    modifier.per = "success";
    modifier.roll = { dice: count, threshold: Number(band.from), ...(perModel ? { per_model: perModel === "target" ? "target" : "this" } : {}) };
    item.gate = item.gate.filter((node) => !isRollMarker(node));
  }
  return planned.map((item) => gated(item.gate, item.node));
}

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
  const count = rolls[0]!.parameters.count as number | undefined;
  const perModel = rolls[0]!.parameters.per_model as string | undefined;
  if (count !== undefined || perModel !== undefined) return perSuccess(planned, banded, dice, count ?? 1, rolls[0]!.parameters.roll_var !== undefined, perModel);
  const faces = DICE_FACES[dice]!;
  // A roll_var (dice-roll@2) binds the roll as the DSL's `roll` container; a single band then
  // compiles its dice-gated `from` that binding instead of a fresh `dice` field.
  const rollVar = rolls[0]!.parameters.roll_var as string | undefined;
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
      const gate: Node = rollVar
        ? { type: "dice-gated", from: { roll_var: rollVar }, threshold: table[0]!.band.from, comparison: "gte", on_success: body(table[0]!.items), on_fail: null }
        : { type: "dice-gated", dice, threshold: table[0]!.band.from, comparison: "gte", on_success: body(table[0]!.items), on_fail: null };
      return rollVar ? { type: "roll", dice, roll_var: rollVar, effect: gate } : gate;
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
    const table_: Node = { type: "dice-table", dice, outcomes };
    // dice-table always rolls its own dice (the DSL gives it no `from`); roll_var still binds the
    // wrapping roll so the total (or successes_on count) is available to a sibling `from` elsewhere.
    return rollVar ? { type: "roll", dice, roll_var: rollVar, effect: table_ } : table_;
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
