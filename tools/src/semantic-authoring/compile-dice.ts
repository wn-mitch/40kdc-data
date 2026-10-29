import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { DICE_FACES } from "./dice-families.js";
import { perDieConditionalRolls, resolveAlternativePools } from "./compile-dice-variants.js";

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

export const ROLL = "__roll-result";

export function rollMarker(leaf: CompileLeaf): Node {
  return { type: ROLL, from: leaf.parameters.from, ...(leaf.parameters.to === undefined ? {} : { to: leaf.parameters.to }) };
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
export function perSuccess(planned: Planned[], banded: Planned[], dice: string, count: number, bound: boolean, perModel?: string, forEach?: Node): Node[] {
  if (dice !== "D6") throw new CompileError(`Rolling ${count} ${dice} has no DSL shape; only several D6 fold into a count per success.`);
  if (bound) throw new CompileError("A roll of several dice cannot also bind a roll_var.");
  if (perModel === undefined && forEach === undefined && banded.some((item) => item.leaf.family_id !== "mortal-wounds")
    && banded.every((item) => COUNTED_TYPES.has(String(item.node.type)))) return countedSuccesses(planned, banded, count);
  for (const item of banded) {
    const markers = item.gate.filter(isRollMarker);
    if (markers.length !== 1) throw new CompileError("One effect is gated by two result bands.");
    const band = markers[0]!;
    if (Number(band.from) > 6) throw new CompileError("A per-die success band starts beyond a D6.");
    const to = Number(band.to ?? 6);
    if (to > 6) throw new CompileError("A per-die success band reaches beyond a D6.");
    // "for each 1": a band from the bottom face up to below the top is a success at or under its top.
    const low = Number(band.from) === 1 && to < 6;
    if (!low && to !== 6) throw new CompileError("A per-die success band must reach 6 (\"for each 5+\") or start at 1 (\"for each 1\").");
    if (item.leaf.family_id !== "mortal-wounds") throw new CompileError(`Rolling several dice folds only into mortal wounds per success; ${item.leaf.family_id} has no per-die DSL shape.`);
    const modifier = item.node.modifier as Node;
    modifier.per = "success";
    modifier.roll = {
      dice: count, threshold: low ? to : Number(band.from), ...(low ? { comparison: "lte" } : {}),
      ...(perModel ? { per_model: perModel === "target" ? item.node.target : "this-unit" } : {}),
      // One die for each model the selector matches (compile-count-scale.ts).
      ...(forEach ? { for_each: structuredClone(forEach) } : {}),
    };
    item.gate = item.gate.filter((node) => !isRollMarker(node));
  }
  return planned.map((item) => gated(item.gate, item.node));
}

/** Effects whose amount takes a quantity, so it can be the count of a roll's successes. */
const COUNTED_TYPES = new Set(["mortal-wounds", "heal", "return-models", "destroy-models", "resource-gain", "resource-spend"]);

/** The amount fields of an effect that can read a bound roll. */
const AMOUNT_FIELDS = ["value", "count", "amount"];

/**
 * "Roll six D6. For each 4+, that enemy unit suffers 1 mortal wound and one model in your unit regains
 * up to 1 lost wound": several effects done once per success, at least one of them not a mortal wound.
 * The dice are rolled once as a `roll` step, and each effect's amount of 1 becomes the number of its
 * dice that rolled the band's value or higher. Every banded effect must share that one band and an
 * amount of 1; a band counted from the bottom face ("for each 1") has no success count.
 */
function countedSuccesses(planned: Planned[], banded: Planned[], count: number): Node[] {
  const rollVar = "result";
  const bands = banded.map((item) => item.gate.filter(isRollMarker));
  if (bands.some((markers) => markers.length !== 1 || JSON.stringify(markers) !== JSON.stringify(bands[0]))) {
    throw new CompileError("Effects done per success of one roll must share one result band.");
  }
  const band = bands[0]![0]!;
  const from = Number(band.from);
  if (from < 2 || from > 6 || Number(band.to ?? 6) !== 6) throw new CompileError("A success count reads a band from 2+ to 6 (\"for each 4+\").");
  const counted = (item: Planned): Node => {
    const modifier = item.node.modifier as Node | undefined;
    const fields = modifier === undefined ? [] : AMOUNT_FIELDS.filter((field) => field in modifier);
    if (fields.length !== 1 || Number(modifier![fields[0]!]) !== 1) throw new CompileError(`${item.leaf.family_id} done per success needs an amount of 1 to count successes with.`);
    return gated(item.gate.filter((node) => !isRollMarker(node)), { ...item.node, modifier: { ...modifier, [fields[0]!]: { roll_var: rollVar, successes_on: from } } });
  };
  const inside = banded.map(counted);
  const rolled: Node = { type: "roll", dice: `${count}D6`, roll_var: rollVar, effect: inside.length === 1 ? inside[0]! : { type: "sequence", steps: inside } };
  const first = planned.indexOf(banded[0]!);
  return planned.flatMap((item, at) => at === first ? [rolled] : banded.includes(item) ? [] : [gated(item.gate, item.node)]);
}

/** Rebuild an effect with each amount equal to the roll's dice read from the roll instead; null when none is. */
function readRoll(node: Node, dice: string, rollVar: string): Node | null {
  const modifier = node.modifier as Node | undefined;
  if (modifier !== undefined && AMOUNT_FIELDS.some((field) => modifier[field] === dice)) {
    return { ...node, modifier: Object.fromEntries(Object.entries(modifier).map(([key, value]) => [key, AMOUNT_FIELDS.includes(key) && value === dice ? { roll_var: rollVar } : value])) };
  }
  if (node.type === "sequence") {
    const steps = (node.steps as Node[]).map((step) => readRoll(step, dice, rollVar));
    return steps.some((step) => step !== null) ? { ...node, steps: steps.map((step, at) => step ?? (node.steps as Node[])[at]!) } : null;
  }
  return null;
}

/**
 * "Roll one D3: your unit suffers a number of mortal wounds equal to the result": a roll with no
 * result band whose result an effect after it takes as its amount (written as the roll's own dice).
 * The effects from the first reader to the last share that one roll, bound as the DSL's `roll`
 * step. Null when the roll is not a single plain die or no effect reads it.
 */
function resultReaders(planned: Planned[], roll: CompileLeaf): Node[] | null {
  const parameters = roll.parameters;
  if (["count", "per_model", "for_each", "bonus", "roll_var", "conditional_bonus", "pool_condition", "kind"].some((key) => parameters[key] !== undefined)) return null;
  const dice = String(parameters.dice);
  const rollVar = "result";
  const read = planned.map((item) => readRoll(item.node, dice, rollVar));
  const first = read.findIndex((node) => node !== null);
  if (first < 0) return null;
  // Only an effect after the roll can read its result.
  if (planned.some((item, at) => read[at] !== null && (item.leaf.start_byte ?? 0) < (roll.start_byte ?? 0))) return null;
  const last = read.length - 1 - [...read].reverse().findIndex((node) => node !== null);
  const steps = planned.map((item, at) => gated(item.gate, read[at] ?? item.node));
  const shared = steps.slice(first, last + 1);
  const rolled: Node = { type: "roll", dice, roll_var: rollVar, effect: shared.length === 1 ? shared[0]! : { type: "sequence", steps: shared } };
  return [...steps.slice(0, first), rolled, ...steps.slice(last + 1)];
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
    const read = rolls.length === 1 ? resultReaders(planned, rolls[0]!) : null;
    if (read) return read;
    if (rolls.length) throw new CompileError("A roll has no result band (\"on a 4+\") saying what it decides.");
    return planned.map((item) => gated(item.gate, item.node));
  }
  if (rolls.length > 1 && rolls[0]!.parameters.pool_condition === undefined && rolls.slice(1).every((roll) => roll.parameters.pool_condition !== undefined)) return resolveAlternativePools(planned, global, banded, rolls);
  if (rolls.length !== 1) throw new CompileError(`Result bands need exactly one roll; found ${rolls.length}.`);
  // A change to the roll that holds only under a condition (compile-preceding-roll.ts): two rolls, one per side.
  const conditional = rolls[0]!.parameters.conditional_bonus as ConditionalBonus | undefined;
  if (conditional !== undefined) return resolveConditionalRolls(planned, global, banded, rolls[0]!, conditional);
  const die = String(rolls[0]!.parameters.dice);
  const count = rolls[0]!.parameters.count as number | undefined;
  const perModel = rolls[0]!.parameters.per_model as string | undefined;
  const forEach = rolls[0]!.parameters.for_each as Node | undefined;
  if ((count !== undefined || perModel !== undefined || forEach !== undefined) && rolls[0]!.parameters.bonus !== undefined) {
    throw new CompileError("Several dice rolled at once each read their own face; a bonus added to the result has no per-die DSL shape.");
  }
  if (count !== undefined || perModel !== undefined || forEach !== undefined) return perSuccess(planned, banded, die, count ?? 1, rolls[0]!.parameters.roll_var !== undefined, perModel, forEach);
  // "adding 1 to the result" (compile-preceding-roll.ts): the bands read the roll plus the bonus.
  const bonus = Number(rolls[0]!.parameters.bonus ?? 0);
  const dice = bonus > 0 ? `${die}+${bonus}` : die;
  const faces = DICE_FACES[die]! + bonus;
  // A roll_var (dice-roll@2) binds the roll as the DSL's `roll` container; a single band then
  // compiles its dice-gated `from` that binding instead of a fresh `dice` field.
  // A named test ("take a Psychic test") is the DSL's roll with a kind; the roll binds a var so
  // its bands read that roll.
  const kind = rolls[0]!.parameters.kind as string | undefined;
  const rollVar = (rolls[0]!.parameters.roll_var as string | undefined) ?? (kind !== undefined ? `${kind}-test` : undefined);
  const wrap = (effect: Node): Node => rollVar ? { type: "roll", dice, ...(kind !== undefined ? { kind } : {}), roll_var: rollVar, effect } : effect;
  const bandOf = (item: Planned) => {
    const markers = item.gate.filter(isRollMarker);
    if (markers.length > 1) throw new CompileError("One effect is gated by two result bands.");
    item.gate = item.gate.filter((node) => !isRollMarker(node));
    const band = markers[0]!;
    const from = Number(band.from);
    const to = Number(band.to ?? faces);
    if (from > faces) throw new CompileError(`A result band starts at ${from}, beyond a ${dice}.`);
    if (to > faces) throw new CompileError(`A result band reaches ${to}, beyond a ${dice}.`);
    return { from, to };
  };

  const table: Array<{ band: { from: number; to: number }; items: Planned[] }> = [];
  for (const item of banded) {
    const band = bandOf(item);
    if (item.leaf.family_id === "fight-on-death" && (item.node.modifier as Node).act === "fight") {
      if (band.to !== faces) throw new CompileError("Fighting on death needs a band that reaches the top face (\"on a 2+\").");
      const modifier = item.node.modifier as Node;
      modifier.gate = { dice, threshold: band.from, comparison: "gte", modifiers: [] };
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
      return wrap(gate);
    }
    // A pass and a fail band that split the faces ("on a 7+ … otherwise …", a Psychic test passed
    // or failed) are one dice-gated with both branches, which a 2D6 roll can carry.
    if (table.length === 2 && table[0]!.band.from === 1 && table[0]!.band.to + 1 === table[1]!.band.from && table[1]!.band.to === faces) {
      const threshold = table[1]!.band.from;
      const gate: Node = rollVar
        ? { type: "dice-gated", from: { roll_var: rollVar }, threshold, comparison: "gte", on_success: body(table[1]!.items), on_fail: body(table[0]!.items) }
        : { type: "dice-gated", dice, threshold, comparison: "gte", on_success: body(table[1]!.items), on_fail: body(table[0]!.items) };
      if (die === "2D6" || kind !== undefined) return wrap(gate);
    }
    if (die === "2D6") throw new CompileError("Several result bands on 2D6 have no DSL table; only D3 and D6 tables exist.");
    if (bonus > 0) throw new CompileError(`Several result bands on ${dice} have no DSL table; a table rolls one plain D3 or D6.`);
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
    return wrap(table_);
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

/**
 * A change to the ability's own roll that holds only under a condition ("adding 1 to the result if
 * X"). `node` is the condition compiled (compile.ts); `value` is signed.
 */
export type ConditionalBonus = { value: number; node: Node };

type Band = { from: number; to: number };
type Row = { band: Band; items: Planned[] };

/** The roll's name when a band reads it: its roll_var, or the test kind's roll. */
type RollNames = { rollVar?: string; kind?: string };

/** The one result band an effect is gated by, as the roll marker holds it. */
export function markerOf(item: Planned): Node {
  const markers = item.gate.filter(isRollMarker);
  if (markers.length !== 1) throw new CompileError("One effect is gated by two result bands.");
  return markers[0]!;
}

/** An effect cloned for one side of the roll, with its band marker taken out of its gate. */
export const stripMarkers = (item: Planned): Planned => ({ ...item, node: structuredClone(item.node), gate: item.gate.filter((node) => !isRollMarker(node)) });

/** A band as the marker writes it, with `to` defaulting to `top`. */
export const bandOfMarker = (marker: Node, top: number): Band => ({ from: Number(marker.from), to: Number(marker.to ?? top) });

/** Rows of effects that share one band, in first-seen order. */
function groupRows(entries: Array<{ band: Band; item: Planned }>): Row[] {
  const rows: Row[] = [];
  for (const { band, item } of entries) {
    const row = rows.find((entry) => entry.band.from === band.from && entry.band.to === band.to);
    if (row) row.items.push(item); else rows.push({ band, items: [item] });
  }
  return rows;
}

/**
 * One roll over result bands, rolling `dice` with `faces` as its top face: a dice-gated when one
 * band reaches that top, otherwise a dice-table (faces no band names do nothing). `dice` is a
 * plain D3 or D6 for a table.
 */
function bandedRoll(rows: Row[], dice: string, faces: number, names: RollNames): Node {
  const sorted = [...rows].sort((left, right) => left.band.from - right.band.from);
  const wrap = (effect: Node): Node => names.rollVar ? { type: "roll", dice, ...(names.kind !== undefined ? { kind: names.kind } : {}), roll_var: names.rollVar, effect } : effect;
  if (sorted.length === 1 && sorted[0]!.band.to === faces) {
    const threshold = sorted[0]!.band.from;
    const onSuccess = body(sorted[0]!.items);
    return wrap(names.rollVar
      ? { type: "dice-gated", from: { roll_var: names.rollVar }, threshold, comparison: "gte", on_success: onSuccess, on_fail: null }
      : { type: "dice-gated", dice, threshold, comparison: "gte", on_success: onSuccess, on_fail: null });
  }
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
  const outcomes: Array<{ results: number[]; effect: Node }> = [];
  let next = 1;
  for (const row of sorted) {
    if (row.band.from < next) throw new CompileError("Two result bands overlap.");
    if (row.band.from > next) outcomes.push({ results: range(next, row.band.from - 1), effect: { type: "no-effect" } });
    outcomes.push({ results: range(row.band.from, row.band.to), effect: body(row.items) });
    next = row.band.to + 1;
  }
  if (next <= faces) outcomes.push({ results: range(next, faces), effect: { type: "no-effect" } });
  return wrap({ type: "dice-table", dice, outcomes });
}

/**
 * A conditional change to this ability's own roll ("adding 1 to the result if X"). The roll is made
 * in two forms, one for each side of X, and exactly one of them runs. Each form is wrapped in its
 * side's condition, and only the roll is wrapped: the other effects in the part keep their order.
 *
 * Result bands are read on the modified result (the roll plus the change), so a band "on a 5+"
 * with +1 means a modified 5 or more. A fight-on-death roll instead gives each destroyed model two
 * act-on-death effects whose eligibility is the condition, since each model rolls on its own.
 */
function resolveConditionalRolls(planned: Planned[], global: Node[], banded: Planned[], roll: CompileLeaf, bonus: ConditionalBonus): Node[] {
  if (roll.parameters.count !== undefined || roll.parameters.per_model !== undefined || roll.parameters.for_each !== undefined) {
    // Only a plain count of dice folds. A per-model or per-unit roll that adds a bonus stays refused (BRIEF: per-model dice).
    if (roll.parameters.count !== undefined && roll.parameters.per_model === undefined && roll.parameters.for_each === undefined) return perDieConditionalRolls(planned, banded, roll, bonus);
    throw new CompileError("A conditional change to a roll of several dice has no DSL shape.");
  }
  if (Number(roll.parameters.bonus ?? 0) !== 0) throw new CompileError("An unconditional and a conditional change to one roll have no DSL shape yet.");
  const die = String(roll.parameters.dice);
  if (die !== "D3" && die !== "D6") throw new CompileError(`A conditional change folds only into a D3 or D6 roll, not ${die}.`);
  const faces = DICE_FACES[die]!;
  const value = bonus.value;
  const notCondition: Node = { operator: "not", operands: [bonus.node] };
  const kind = roll.parameters.kind as string | undefined;
  const rollVar = (roll.parameters.roll_var as string | undefined) ?? (kind !== undefined ? `${kind}-test` : undefined);
  const names: RollNames = { rollVar, kind };

  const fight = banded.find((item) => item.leaf.family_id === "fight-on-death" && (item.node.modifier as Node).act === "fight");
  if (fight) return fightOnDeathConditional(planned, global, fight, die, faces, value, bonus.node, notCondition);

  const top = faces + value;
  const entries = banded.map((item) => ({ item: stripMarkers(item), marker: markerOf(item) }));
  // The written bands read the modified result, so the yes side reads the raw roll shifted by the change.
  const modified = entries.map(({ item, marker }) => {
    const band = bandOfMarker(marker, top);
    if (band.from > top) throw new CompileError(`A result band starts at ${band.from}, beyond the changed ${die}.`);
    if (band.to > top) throw new CompileError(`A result band reaches ${band.to}, beyond the changed ${die}.`);
    return { band, item };
  });
  const modifiedRows = groupRows(modified);
  let yes: Node;
  if (modifiedRows.length === 1 && modifiedRows[0]!.band.to === top) {
    const { from } = modifiedRows[0]!.band;
    if (value > 0) {
      // "D6+1" reads the changed result directly, so the threshold stays as written.
      yes = bandedRoll([{ band: { from, to: top }, items: modifiedRows[0]!.items }], `${die}+${value}`, top, names);
    } else {
      if (from - value > faces) throw new CompileError(`A result band starts at ${from - value}, beyond the unchanged ${die}.`);
      yes = bandedRoll([{ band: { from: from - value, to: faces }, items: modifiedRows[0]!.items }], die, faces, names);
    }
  } else {
    const shifted: Row[] = [];
    for (const row of modifiedRows) {
      if (row.band.from - value > faces) throw new CompileError(`A result band starts at ${row.band.from - value}, beyond the unchanged ${die}.`);
      const from = Math.max(1, row.band.from - value);
      const to = Math.min(faces, row.band.to - value);
      // A band the change moves wholly off the die has no raw result: its faces read as no effect.
      if (to >= from) shifted.push({ band: { from, to }, items: row.items });
    }
    yes = bandedRoll(shifted, die, faces, names);
  }

  // The no side rolls the die unchanged, so a band reads the raw roll as written, its top clipped to the die.
  const unchanged = groupRows(entries.map(({ item, marker }) => {
    const band = bandOfMarker(marker, faces);
    if (band.from > faces) throw new CompileError(`A result band starts at ${band.from}, beyond a ${die}.`);
    return { band: { from: band.from, to: Math.min(faces, band.to) }, item };
  }));
  const no = structuredClone(bandedRoll(unchanged, die, faces, names));

  const steps: Node[] = [];
  let placed = false;
  for (const item of planned) {
    if (banded.includes(item)) {
      if (!placed) {
        steps.push({ type: "conditional", condition: bonus.node, effect: yes }, { type: "conditional", condition: notCondition, effect: no });
        placed = true;
      }
      continue;
    }
    steps.push(gated(item.gate, item.node));
  }
  return steps;
}

/**
 * Fight-on-death with a conditional change: one act-on-death effect for each side of the condition,
 * each with its own per-model gate. Yes-side gate: the written threshold on the changed roll (a
 * positive change, "D6+1") or, for a subtraction, the threshold raised by the amount ("D6" at 5+
 * when 4+ is written and 1 is subtracted). Both sides keep the ability's conditions as eligibility.
 */
function fightOnDeathConditional(planned: Planned[], global: Node[], item: Planned, die: string, faces: number, value: number, condition: Node, notCondition: Node): Node[] {
  if (planned.length !== 1) throw new CompileError("A conditional change to a fight-on-death roll needs its roll's effect to be the ability's only effect in its part.");
  const top = faces + value;
  const marker = markerOf(item);
  const band = bandOfMarker(marker, top);
  if (band.to !== top) throw new CompileError("Fighting on death needs a band that reaches the top face (\"on a 2+\").");
  if (band.from > top) throw new CompileError(`A result band starts at ${band.from}, beyond the changed ${die}.`);
  const yesGate: Node = value > 0
    ? { dice: `${die}+${value}`, threshold: band.from, comparison: "gte", modifiers: [] }
    : { dice: die, threshold: band.from - value, comparison: "gte", modifiers: [] };
  if (band.from - value > faces) throw new CompileError(`A fight-on-death threshold of ${band.from - value} is beyond a ${die}; the change cannot succeed.`);
  if (band.from > faces) throw new CompileError(`A fight-on-death threshold of ${band.from} is beyond a ${die}; the unchanged roll cannot succeed.`);
  const base = [...global, ...item.gate.filter((node) => !isRollMarker(node))];
  global.splice(0, global.length);
  const side = (gate: Node, eligibility: Node) => {
    const node = structuredClone(item.node);
    (node.modifier as Node).gate = gate;
    (node.modifier as Node).eligibility = allOf([...base, eligibility])!;
    return node;
  };
  return [
    side(yesGate, condition),
    side({ dice: die, threshold: band.from, comparison: "gte", modifiers: [] }, notCondition),
  ];
}
