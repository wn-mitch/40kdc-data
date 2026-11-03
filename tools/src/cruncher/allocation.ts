/**
 * The discrete allocation stage: what one shooting or fighting unit's attacks do to the models of
 * the target unit, as an exact distribution rather than an expected value.
 *
 * Each attack that gets through deals its Damage to one model; damage beyond that model's
 * remaining wounds is lost, and an already damaged model takes the next attack. Feel No Pain rolls
 * once for each wound that would be lost. Devastating Wounds mortal wounds are inflicted after all
 * normal damage and also damage at most one model each, the rest being lost. Mortal wounds an
 * ability inflicts on the attack's rolls come last, one wound at a time, each carrying over to the
 * next model.
 *
 * The state is (models alive, wounds left on the damaged model, zeroing uses left). Event counts
 * come from the exact joint distribution of normal damage events, mortal-wound events and ability
 * mortal wounds per attack, so Sustained Hits, Lethal Hits, Devastating Wounds and mortal wounds on
 * a roll keep their correlation within an attack.
 *
 * A damage-zeroing defence changes an unsaved attack's Damage to 0 before it is rolled. Every
 * normal damage event has the same Damage distribution, so the defender spends a use on the first
 * event it can: for this activation no later choice does better. Mortal-wound events are not
 * attacks with a Damage characteristic and are never zeroed.
 */
import type { Dataset } from "../data/dataset.js";
import { damageRoll, quantityDistribution } from "./damage-roll.js";
import { crunchModel, type AttackModel, type EngineInput } from "./engine.js";

export type AllocationOutput = {
  /** Expected wounds removed from the target unit. */
  damageDealt: number;
  modelsDestroyed: number;
  /** Probability of each number of models destroyed, from 0 to the unit's size. */
  modelsDestroyedDistribution: number[];
};

/**
 * A defence that changes the Damage of an attack allocated to the target to 0, `uses` times: shared
 * by the unit, or available to each model separately.
 */
export type DamageZeroing = { uses: number; per: "unit" | "model" };

/** Defender options that act on individual attacks, which only the allocation stage sees. */
export type AllocationDefences = { zeroing?: DamageZeroing };

/**
 * The largest event table the exact computation builds, measured as attacks × table rows × table
 * columns. Past it the allocation is refused rather than approximated.
 */
export const MAX_EVENT_WORK = 1_000_000;

/** Probabilities indexed [normal events][mortal events][ability mortal wounds]. */
type Joint = number[][][];

function joint(rows: number, columns: number, depth = 1): Joint {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => new Array<number>(depth).fill(0)));
}

function convolve(left: Joint, right: Joint): Joint {
  const out = joint(left.length + right.length - 1, left[0]!.length + right[0]!.length - 1, left[0]![0]!.length + right[0]![0]!.length - 1);
  left.forEach((row, k) => row.forEach((cell, j) => cell.forEach((p, a) => {
    if (p === 0) return;
    right.forEach((other, k2) => other.forEach((cell2, j2) => cell2.forEach((q, a2) => {
      if (q !== 0) out[k + k2]![j + j2]![a + a2]! += p * q;
    })));
  })));
  return out;
}

/** `table` plus `weight` times `from`, grown to hold both. */
function add(into: Joint, from: Joint, weight: number): Joint {
  const grown = joint(Math.max(into.length, from.length), Math.max(into[0]!.length, from[0]!.length), Math.max(into[0]![0]!.length, from[0]![0]!.length));
  into.forEach((row, k) => row.forEach((cell, j) => cell.forEach((p, a) => { grown[k]![j]![a]! += p; })));
  from.forEach((row, k) => row.forEach((cell, j) => cell.forEach((p, a) => { grown[k]![j]![a]! += weight * p; })));
  return grown;
}

/** `table` with every ability mortal-wound count raised by `by`. */
function shift(table: Joint, by: number): Joint {
  return by === 0 ? table : table.map((row) => row.map((cell) => [...new Array<number>(by).fill(0), ...cell]));
}

/** `joint` without trailing all-zero rows, columns and depth; convolution skips zeros, so the nonzero values are unchanged. */
function trim(table: Joint): Joint {
  const zero = (cell: number[], from = 0) => cell.slice(from).every((p) => p === 0);
  let rows = table.length;
  while (rows > 1 && table[rows - 1]!.every((cell) => zero(cell))) rows -= 1;
  let columns = table[0]!.length;
  while (columns > 1 && table.slice(0, rows).every((row) => zero(row[columns - 1]!))) columns -= 1;
  let depth = table[0]![0]!.length;
  while (depth > 1 && table.slice(0, rows).every((row) => row.slice(0, columns).every((cell) => cell[depth - 1] === 0))) depth -= 1;
  return table.slice(0, rows).map((row) => row.slice(0, columns).map((cell) => cell.slice(0, depth)));
}

function power(base: Joint, times: number): Joint {
  let out: Joint = [[[1]]];
  for (let index = 0; index < times; index += 1) out = convolve(out, base);
  return out;
}

function integral(value: number, what: string): number {
  if (!Number.isInteger(value)) throw new Error(`allocate: ${what} must be a whole number, got ${value}`);
  return value;
}

/** The mortal wounds an attack's rolls inflict, checked whole. */
function rollMortalsOf(model: AttackModel): AttackModel["rollMortals"] {
  const mortals = model.rollMortals;
  for (const [key, count] of Object.entries(mortals)) {
    if (integral(count, `mortal wounds on a roll (${key})`) < 0) throw new Error(`allocate: mortal wounds on a roll (${key}) must not be negative, got ${count}`);
  }
  return mortals;
}

/**
 * Distribution of one attack's normal damage events, its second kind of event (mortal wounds with
 * Devastating Wounds, otherwise unsaved critical wounds when they have their own save and Damage
 * (`criticalWound`), else none) and the mortal wounds its rolls inflict.
 */
function perAttack(model: AttackModel): Joint {
  const mortals = rollMortalsOf(model);
  const normalWound = model.wound.pass - model.wound.crit;
  const split = model.criticalWound !== undefined && !model.devastating;
  const toMain = (normalWound + (model.devastating || split ? 0 : model.wound.crit)) * model.unsaved;
  const toSecond = model.devastating ? model.wound.crit : split ? model.wound.crit * model.criticalWound!.unsaved : 0;
  // `extra`: the mortal wounds a critical wound inflicts beyond every critical wound's.
  const woundRoll = (extra: number): Joint => {
    const onWound = mortals.wound;
    const onCritical = onWound + mortals.criticalWound + extra;
    if (onWound === 0 && onCritical === 0) return [[[1 - toMain - toSecond], [toSecond]], [[toMain], [0]]];
    const out = joint(2, 2, Math.max(onWound, onCritical) + 1);
    const crit = model.wound.crit;
    const critUnsaved = model.devastating ? 1 : split ? model.criticalWound!.unsaved : model.unsaved;
    const critEvent = model.devastating || split ? out[0]![1]! : out[1]![0]!;
    out[0]![0]![0]! += 1 - model.wound.pass;
    out[1]![0]![onWound]! += normalWound * model.unsaved;
    out[0]![0]![onWound]! += normalWound * (1 - model.unsaved);
    critEvent[onCritical]! += crit * critUnsaved;
    out[0]![0]![onCritical]! += crit * (1 - critUnsaved);
    return out;
  };
  const autoWound: Joint = shift([[[1 - model.unsaved]], [[model.unsaved]]], mortals.wound);
  const normalHit = model.torrent ? 1 : model.hit.pass - model.hit.crit;
  const critHit = model.torrent ? 0 : model.hit.crit;
  const out = joint(1, 1);
  out[0]![0]![0] = 1 - normalHit - critHit;
  let result = add(out, shift(woundRoll(0), mortals.hit), normalHit);
  if (critHit > 0) {
    const first = model.lethal ? autoWound : woundRoll(mortals.criticalWoundOfCriticalHit);
    const extras = model.sustainedStat == null ? [[0, 1] as [number, number]] : quantityDistribution(model.sustainedStat);
    for (const [count, probability] of extras) {
      const hits = convolve(first, power(woundRoll(0), integral(count, "Sustained Hits")));
      result = add(result, shift(hits, mortals.hit + mortals.criticalHit), critHit * probability);
    }
  }
  return result;
}

/** Distribution of the unit's total attacks: each model rolls its own Attacks. */
function attackCounts(model: AttackModel): Map<number, number> {
  const one = new Map<number, number>();
  const rapid = model.rapidFireStat == null ? [[0, 1] as [number, number]] : quantityDistribution(model.rapidFireStat);
  const rolled: Array<[number, number]> = model.attacksReroll
    ? damageRoll({ stat: model.attacksStat, bonus: 0, modifier: 0, reduction: 0, reroll: model.attacksReroll }).distribution.map(({ value, probability }) => [value, probability])
    : quantityDistribution(model.attacksStat);
  for (const [attacks, p] of rolled) {
    for (const [extra, q] of rapid) {
      const total = Math.max(0, integral(attacks + extra + model.attacksBonus, "Attacks"));
      one.set(total, (one.get(total) ?? 0) + p * q);
    }
  }
  let all = new Map<number, number>([[0, 1]]);
  for (let index = 0; index < integral(model.modelsFiring, "models firing"); index += 1) {
    const next = new Map<number, number>();
    for (const [sum, p] of all) for (const [count, q] of one) next.set(sum + count, (next.get(sum + count) ?? 0) + p * q);
    all = next;
  }
  return all;
}

function binomial(trials: number, successes: number, p: number): number {
  let coefficient = 1;
  for (let index = 0; index < successes; index += 1) coefficient = coefficient * (trials - index) / (index + 1);
  return coefficient * Math.pow(p, successes) * Math.pow(1 - p, trials - successes);
}

/** Distribution of wounds one event removes before the damaged model's remaining wounds cap it: each wound is lost with probability `lost`. */
function woundsLost(damageRoll: AttackModel["damage"], lost: number): number[] {
  const out: number[] = [];
  for (const { value, probability } of damageRoll) {
    const damage = integral(value, "Damage");
    for (let removed = 0; removed <= damage; removed += 1) {
      out[removed] = (out[removed] ?? 0) + probability * binomial(damage, removed, lost);
    }
  }
  return Array.from(out, (p) => p ?? 0);
}

/**
 * Exact allocation of an attacking unit's damage into the target's models. Without an explicit
 * `defences.zeroing`, the input's `damage-zeroing` buffs supply it.
 */
export function allocate(input: EngineInput, dataset?: Dataset, defences: AllocationDefences = {}): AllocationOutput {
  const { output, model } = crunchModel(input, dataset);
  if (defences.zeroing !== undefined) return allocateModel(model, defences);
  const { unit, model: perModel } = output.resolved.damageZeroing;
  if (unit > 0 && perModel > 0) throw new Error("allocate: unit-wide and per-model damage zeroing together are not modelled");
  if (unit > 0) return allocateModel(model, { zeroing: { uses: unit, per: "unit" } });
  if (perModel > 0) return allocateModel(model, { zeroing: { uses: perModel, per: "model" } });
  return allocateModel(model);
}

function zeroingOf(defences: AllocationDefences): DamageZeroing {
  const zeroing = defences.zeroing ?? { uses: 0, per: "unit" };
  if (zeroing.per !== "unit" && zeroing.per !== "model") throw new Error(`allocate: zeroing per must be "unit" or "model", got ${String(zeroing.per)}`);
  if (integral(zeroing.uses, "zeroing uses") < 0) throw new Error(`allocate: zeroing uses must not be negative, got ${zeroing.uses}`);
  return zeroing;
}

export function allocateModel(model: AttackModel, defences: AllocationDefences = {}): AllocationOutput {
  if (model.unmodelled.length > 0) throw new Error(`allocate: ${model.unmodelled.join(", ")} not modelled by exact allocation`);
  const models = integral(model.modelCount, "target models");
  const wounds = integral(model.wounds, "target Wounds");
  const zeroing = zeroingOf(defences);
  if (models === 0 || wounds === 0) return { damageDealt: 0, modelsDestroyed: 0, modelsDestroyedDistribution: [1] };
  const uses = zeroing.uses + 1;
  const cells = models * wounds;
  const dead = cells * uses;
  // Alive state (m, w, u) is ((m - 1) * wounds + (w - 1)) * uses + u; `dead` absorbs.
  const step = (state: number[], removed: readonly number[], zeroable: boolean): number[] => {
    const out = new Array<number>(dead + 1).fill(0);
    out[dead] = state[dead]!;
    for (let id = 0; id < dead; id += 1) {
      const p = state[id]!;
      if (p === 0) continue;
      const cell = Math.floor(id / uses);
      const left = (cell % wounds) + 1;
      const unused = id % uses;
      if (zeroable && unused > 0) {
        out[id - 1]! += p;
        continue;
      }
      const alive = Math.floor(cell / wounds) + 1;
      const refilled = zeroing.per === "model" ? uses - 1 : unused;
      removed.forEach((q, amount) => {
        if (q === 0) return;
        const next = amount === 0 ? id : amount < left ? id - amount * uses : alive === 1 ? dead : ((alive - 2) * wounds + (wounds - 1)) * uses + refilled;
        out[next]! += p * q;
      });
    }
    return out;
  };

  const per = trim(perAttack(model));
  const counts = attackCounts(model);
  const most = Math.max(...counts.keys());
  const work = most * (most * (per.length - 1) + 1) * (most * (per[0]!.length - 1) + 1) * (most * (per[0]![0]!.length - 1) + 1);
  if (work > MAX_EVENT_WORK) throw new Error(`allocate: ${most} attacks exceed the exact allocation bound (work ${work} > ${MAX_EVENT_WORK})`);
  const normal = woundsLost(model.damage, model.woundLost);
  const mortals = model.rollMortals;
  const zeros = (): number[] => new Array<number>(dead + 1).fill(0);
  // States by the ability mortal wounds still to inflict: layer k waits on k of them.
  type Layers = number[][];
  let state: Layers = [zeros()];
  state[0]![dead - 1] = 1;
  const pending: Layers = [];
  const gather = (into: Layers, layers: Layers, weight: number): void => layers.forEach((layer, k) => {
    const target = into[k] ??= zeros();
    layer.forEach((q, id) => { target[id]! += weight * q; });
  });
  const stepAll = (from: Layers, removed: readonly number[], zeroable: boolean): Layers => from.map((layer) => step(layer, removed, zeroable));
  const shiftAll = (from: Layers, by: number): Layers => by === 0 ? from : [...Array.from({ length: by }, zeros), ...from];
  if (model.criticalWound !== undefined && !model.devastating) {
    // Critical wounds with their own save and Damage land in the order their hits wound, and a
    // normal and a critical wound of different Damage do not commute: the allocation steps one
    // hit at a time, an attack's critical hit before the extra hits Sustained Hits gives it.
    const critical = woundsLost(model.criticalWound.damage, model.woundLost);
    const toNormal = (model.wound.pass - model.wound.crit) * model.unsaved;
    const toCritical = model.wound.crit * model.criticalWound.unsaved;
    const normalHit = model.torrent ? 1 : model.hit.pass - model.hit.crit;
    const critHit = model.torrent ? 0 : model.hit.crit;
    const extras = model.sustainedStat == null ? [[0, 1] as [number, number]] : quantityDistribution(model.sustainedStat);
    const blend = (parts: ReadonlyArray<readonly [number, Layers]>): Layers => {
      const out: Layers = [zeros()];
      for (const [weight, from] of parts) if (weight > 0) gather(out, from, weight);
      return out;
    };
    // `extra`: the mortal wounds a critical wound inflicts beyond every critical wound's.
    const woundRoll = (from: Layers, extra: number): Layers => {
      const onWound = mortals.wound;
      const onCritical = onWound + mortals.criticalWound + extra;
      if (onWound === 0 && onCritical === 0) {
        return blend([[1 - toNormal - toCritical, from], [toNormal, stepAll(from, normal, true)], [toCritical, stepAll(from, critical, true)]]);
      }
      const normalWound = model.wound.pass - model.wound.crit;
      return blend([
        [1 - model.wound.pass, from],
        [normalWound * (1 - model.unsaved), shiftAll(from, onWound)],
        [toNormal, shiftAll(stepAll(from, normal, true), onWound)],
        [model.wound.crit - toCritical, shiftAll(from, onCritical)],
        [toCritical, shiftAll(stepAll(from, critical, true), onCritical)],
      ]);
    };
    // Lethal Hits: the critical hit wounds automatically, a normal wound that takes the save.
    const firstWound = (from: Layers): Layers => model.lethal
      ? shiftAll(blend([[1 - model.unsaved, from], [model.unsaved, stepAll(from, normal, true)]]), mortals.wound)
      : woundRoll(from, mortals.criticalWoundOfCriticalHit);
    const attack = (from: Layers): Layers => {
      const parts: Array<readonly [number, Layers]> = [[1 - normalHit - critHit, from], [normalHit, shiftAll(woundRoll(from, 0), mortals.hit)]];
      if (critHit > 0) {
        let after = firstWound(shiftAll(from, mortals.hit + mortals.criticalHit));
        let done = 0;
        for (const [count, probability] of [...extras].sort((left, right) => left[0] - right[0])) {
          for (; done < integral(count, "Sustained Hits"); done += 1) after = woundRoll(after, 0);
          parts.push([critHit * probability, after]);
        }
      }
      return blend(parts);
    };
    for (let attacks = 0; attacks <= most; attacks += 1) {
      const weight = counts.get(attacks) ?? 0;
      if (weight > 0) gather(pending, state, weight);
      if (attacks === most) break;
      state = attack(state);
    }
  } else {
    allocateEvents();
  }

  function allocateEvents(): void {
    const events = eventTable();
    // Devastating Wounds' mortal wounds deal a critical wound's own Damage when it has one.
    const mortal = woundsLost(model.criticalWound?.damage ?? model.damage, model.mortalWoundLost);
    let current = state[0]!;
    events.forEach((row, normalEvents) => {
      if (normalEvents > 0) current = step(current, normal, true);
      if (!row.some((cell) => cell.some((p) => p > 0))) return;
      let after = current;
      row.forEach((cell, mortalEvents) => {
        if (mortalEvents > 0) after = step(after, mortal, false);
        cell.forEach((p, wounds) => {
          if (!(p > 0)) return;
          const target = pending[wounds] ??= zeros();
          after.forEach((q, id) => { target[id]! += p * q; });
        });
      });
    });
  }

  function eventTable(): Joint {
    let total: Joint = [[[0]]];
    let acc: Joint = [[[1]]];
    for (let attacks = 0; attacks <= most; attacks += 1) {
      const weight = counts.get(attacks) ?? 0;
      if (weight > 0) total = add(total, acc, weight);
      if (attacks < most) acc = convolve(acc, per);
    }
    return total;
  }

  // The ability's mortal wounds, one wound each after everything else: layer k takes k of them.
  const one = woundsLost([{ value: 1, probability: 1 }], model.mortalWoundLost);
  let final = pending[pending.length - 1] ?? zeros();
  for (let k = pending.length - 2; k >= 0; k -= 1) {
    final = step(final, one, false);
    (pending[k] ?? []).forEach((q, id) => { final[id]! += q; });
  }

  const destroyed = new Array<number>(models + 1).fill(0);
  let damageDealt = 0;
  final.forEach((p, id) => {
    const cell = Math.floor(id / uses);
    const alive = id === dead ? 0 : Math.floor(cell / wounds) + 1;
    const remaining = id === dead ? 0 : (alive - 1) * wounds + (cell % wounds) + 1;
    destroyed[models - alive]! += p;
    damageDealt += p * (cells - remaining);
  });
  const modelsDestroyed = destroyed.reduce((sum, p, count) => sum + p * count, 0);
  return { damageDealt, modelsDestroyed, modelsDestroyedDistribution: destroyed };
}
