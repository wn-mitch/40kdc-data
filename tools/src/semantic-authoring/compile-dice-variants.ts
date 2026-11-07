import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { bandOfMarker, isRollMarker, markerOf, perSuccess, type ConditionalBonus, type Planned, resolveRolls, ROLL, stripMarkers } from "./compile-dice.js";

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

/**
 * A conditional change to a 2D6 roll read as one total ("roll 2D6 …, subtracting 1 if X: if the
 * result is 6 or less …"). The band reads the changed total, so each side becomes one dice-gated
 * 2D6 roll: a band that reaches the top total compares at or above, one that starts at the lowest
 * total compares at or below. The yes side shifts the threshold by the change; the no side reads
 * the band as written. A band inside the range, or one the change moves past every total, is refused.
 */
export function twoDiceConditionalRolls(planned: Planned[], banded: Planned[], roll: CompileLeaf, bonus: ConditionalBonus): Node[] {
  if (roll.parameters.roll_var !== undefined || roll.parameters.kind !== undefined) throw new CompileError("A conditional change to a named 2D6 roll has no DSL shape yet.");
  const bands = banded.map((item) => bandOfMarker(markerOf(item), 12 + bonus.value));
  const band = bands[0]!;
  if (bands.some((other) => other.from !== band.from || other.to !== band.to)) throw new CompileError("A conditional change to a 2D6 roll folds only one result band.");
  const low = 2 + bonus.value;
  const high = 12 + bonus.value;
  const comparison = band.to >= high ? "gte" : band.from <= low ? "lte" : undefined;
  if (comparison === undefined) throw new CompileError("A 2D6 result band must reach the highest or the lowest total.");
  const written = comparison === "gte" ? band.from : band.to;
  const gate = (threshold: number): Node => {
    if (threshold <= 2 || threshold >= 12) throw new CompileError(`A 2D6 threshold of ${threshold} succeeds on every total or none; it has no DSL shape.`);
    const items = banded.map(stripMarkers);
    const onSuccess = items.length === 1 ? gatedNode(items[0]!) : { type: "sequence", steps: items.map(gatedNode) };
    return { type: "dice-gated", dice: "2D6", threshold, comparison, on_success: onSuccess, on_fail: null };
  };
  const yes = gate(written - bonus.value);
  const no = gate(written);
  const steps: Node[] = [];
  let placed = false;
  for (const item of planned) {
    if (!banded.includes(item)) { steps.push(gatedNode(item)); continue; }
    if (placed) continue;
    steps.push({ type: "conditional", condition: bonus.node, effect: yes }, { type: "conditional", condition: { operator: "not", operands: [bonus.node] }, effect: no });
    placed = true;
  }
  return steps;
}

function gatedNode(item: Planned): Node {
  if (item.gate.length === 0) return item.node;
  return { type: "conditional", condition: item.gate.length === 1 ? item.gate[0]! : { operator: "and", operands: item.gate }, effect: item.node };
}

/** Whose characteristic a dice count reads (dice-roll@10 count_stat.of), as the DSL's unit-ref. */
const COUNT_STAT_REFS: Record<string, string> = { selected: "selected-unit", "this-model": "this-model" };

/**
 * One pool of dice whose faces pay out to different effects ("roll six D6: for each 1, your unit suffers 1 mortal
 * wound; for each 5+, that enemy unit suffers 1 mortal wound"). The dice are rolled once, as a `roll` step, and each
 * mortal-wound effect counts its own faces of that roll: a band reaching 6 counts the dice at its face or higher, a
 * band from 1 the dice at its top or lower. The count is a number of dice, or a model's characteristic (count_stat).
 * Every banded effect must be mortal wounds of 1 per die; the effects keep their written order.
 */
export function sharedPool(planned: Planned[], banded: Planned[], roll: CompileLeaf): Node[] {
  const die = String(roll.parameters.dice);
  if (die !== "D6") throw new CompileError(`A shared pool of ${die} has no DSL shape; only D6 count faces.`);
  if (roll.parameters.roll_var !== undefined || roll.parameters.bonus !== undefined) throw new CompileError("A shared pool reads each die's face; it binds no roll_var and takes no bonus.");
  const rollVar = "pool";
  const counted = (item: Planned): Node => {
    const markers = item.gate.filter(isRollMarker);
    if (markers.length !== 1) throw new CompileError("One effect is gated by two result bands.");
    if (item.leaf.family_id !== "mortal-wounds") throw new CompileError(`A shared pool pays out only mortal wounds; ${item.leaf.family_id} has no per-face shape.`);
    const modifier = item.node.modifier as Node;
    if (Number(modifier.count) !== 1) throw new CompileError("A shared pool pays 1 mortal wound for each die of a band.");
    const band = bandOfMarker(markers[0]!, 6);
    if (band.to > 6) throw new CompileError("A shared pool's band reaches beyond a D6.");
    // "for each 1": a band from the bottom face is counted at or under its top; any other band must reach 6.
    const low = band.from === 1 && band.to < 6;
    if (!low && band.to !== 6) throw new CompileError("A shared pool's band must reach 6 (\"for each 5+\") or start at 1 (\"for each 1\").");
    const count = low ? { roll_var: rollVar, successes_on: band.to, comparison: "lte" } : { roll_var: rollVar, successes_on: band.from };
    const gate = item.gate.filter((node) => !isRollMarker(node));
    const node = { ...item.node, modifier: { ...modifier, count } };
    return gate.length === 0 ? node : { type: "conditional", condition: gate.length === 1 ? gate[0]! : { operator: "and", operands: gate }, effect: node };
  };
  const inside = banded.map(counted);
  const countStat = roll.parameters.count_stat as { stat: string; of: string } | undefined;
  const count = roll.parameters.count as number | undefined;
  const rolled: Node = {
    type: "roll",
    dice: countStat !== undefined ? die : `${count ?? 1}${die}`,
    ...(countStat !== undefined ? { count_stat: { stat: countStat.stat, of: COUNT_STAT_REFS[countStat.of] } } : {}),
    roll_var: rollVar,
    effect: inside.length === 1 ? inside[0]! : { type: "sequence", steps: inside },
  };
  const first = planned.indexOf(banded[0]!);
  return planned.flatMap((item, at) => at === first ? [rolled] : banded.includes(item) ? [] : [item.gate.length === 0 ? item.node : { type: "conditional", condition: item.gate.length === 1 ? item.gate[0]! : { operator: "and", operands: item.gate }, effect: item.node }]);
}
