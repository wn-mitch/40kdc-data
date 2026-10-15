import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { bandOfMarker, markerOf, perSuccess, type ConditionalBonus, type Planned, resolveRolls, ROLL, stripMarkers } from "./compile-dice.js";

type Node = Record<string, unknown>;

/**
 * A conditional change to each die of a roll of several dice ("roll two D6, adding 1 to each result
 * if X: for each 4+ ..."). Each die reads its own face, so the change moves the per-die threshold:
 * the yes side reads the written band shifted by the change, the no side reads it as written. Only
 * D6 per-success bands fold (perSuccess); a threshold the change moves to every face is refused.
 */
export function perDieConditionalRolls(planned: Planned[], banded: Planned[], roll: CompileLeaf, bonus: ConditionalBonus): Node[] {
  if (Number(roll.parameters.bonus ?? 0) !== 0) throw new CompileError("An unconditional and a conditional change to one roll have no DSL shape yet.");
  const die = String(roll.parameters.dice);
  if (die !== "D6") throw new CompileError(`A conditional change to each die folds only into D6, not ${die}.`);
  if (roll.parameters.roll_var !== undefined) throw new CompileError("A roll of several dice cannot also bind a roll_var.");
  const unbanded = planned.filter((item) => !banded.includes(item));
  if (unbanded.length > 0) throw new CompileError("A conditional change to each die needs every effect of its part to be one the dice decide.");
  const count = roll.parameters.count as number | undefined;
  const perModel = roll.parameters.per_model as string | undefined;
  const forEach = roll.parameters.for_each as Node | undefined;
  const notCondition: Node = { operator: "not", operands: [bonus.node] };
  const side = (shift: number): Node[] => {
    const items: Planned[] = [];
    for (const item of banded) {
      const marker = markerOf(item);
      const band = bandOfMarker(marker, 6 + shift);
      if (shift > 0 && band.from >= 2 && band.from - shift < 2) {
        throw new CompileError(`Adding ${shift} to each die makes a band starting at ${band.from} succeed on every face; that has no per-die DSL shape.`);
      }
      const from = Math.max(1, band.from - shift);
      const to = Math.min(6, band.to - shift);
      if (to < from) continue;
      const clone = stripMarkers(item);
      clone.gate = [...clone.gate, { type: ROLL, from, to }];
      items.push(clone);
    }
    if (items.length === 0) return [];
    return perSuccess(items, items, die, count ?? 1, false, perModel, forEach);
  };
  const yes = side(bonus.value);
  const no = side(0);
  const wrap = (condition: Node, steps: Node[]): Node[] => steps.map((step) => ({ type: "conditional", condition, effect: step }));
  return [...wrap(bonus.node, yes), ...wrap(notCondition, no)];
  }

/**
 * Alternative dice pools ("roll one D6 for each A model, or roll four D6 if X, or roll six D6 if Y: for
 * each 3+ …"). The first roll is the base; each later roll replaces it when its own condition holds.
 * Every pool shares the result bands and the effects they decide, so each pool is one copy of the
 * banded effects under its roll, gated by its condition (the base by none of the alternatives').
 */
export function resolveAlternativePools(planned: Planned[], global: Node[], banded: Planned[], rolls: readonly CompileLeaf[]): Node[] {
  if (planned.some((item) => !banded.includes(item))) throw new CompileError("Alternative dice pools need every effect of their part to be one the dice decide.");
  const alternatives = rolls.slice(1).map((roll) => roll.parameters.pool_condition as Node);
  const none: Node = { operator: "not", operands: [alternatives.length === 1 ? alternatives[0]! : { operator: "or", operands: alternatives }] };
  const conditions: Node[] = [none, ...alternatives];
  const steps: Node[] = [];
  rolls.forEach((roll, at) => {
    const { pool_condition: _pool, ...parameters } = roll.parameters;
    const copy = planned.map((item) => ({ ...item, node: structuredClone(item.node), gate: structuredClone(item.gate) }));
    const own = resolveRolls(copy, at === 0 ? global : [], [{ ...roll, parameters }]);
    for (const step of own) steps.push({ type: "conditional", condition: conditions[at]!, effect: step });
  });
  return steps;
}

/**
 * "…, or roll four D6 if your unit has the X keyword": a dice-roll marked `alternative` takes the
 * condition leaf right after it (same fragment) as the condition under which it replaces the roll before.
 */
export function foldAlternativePools(input: readonly CompileLeaf[]): CompileLeaf[] {
  if (!input.some((leaf) => leaf.family_id === "dice-roll" && leaf.parameters.alternative === true)) return [...input];
  const out: CompileLeaf[] = [];
  for (let at = 0; at < input.length; at += 1) {
    const leaf = input[at]!;
    if (leaf.family_id !== "dice-roll" || leaf.parameters.alternative !== true) { out.push(leaf); continue; }
    const next = input[at + 1];
    if (next === undefined || next.role !== "CONDITION" || next.fragment !== leaf.fragment || next.family_id === "roll-result") {
      throw new CompileError(`dice-roll at byte ${leaf.start_byte} is an alternative pool, but no condition leaf follows it saying when it replaces the roll before.`);
    }
    if (!out.some((before) => before.family_id === "dice-roll" && before.fragment === leaf.fragment)) throw new CompileError(`dice-roll at byte ${leaf.start_byte} is an alternative pool, but no roll comes before it.`);
    const { alternative: _alt, ...parameters } = leaf.parameters;
    out.push({ ...leaf, parameters: { ...parameters, pool_condition: next } });
    at += 1;
  }
  return out;
}
