/**
 * The discrete allocation stage: what one shooting or fighting unit's attacks do to the models of
 * the target unit, as an exact distribution rather than an expected value.
 *
 * Each attack that gets through deals its Damage to one model; damage beyond that model's
 * remaining wounds is lost, and an already damaged model takes the next attack. Feel No Pain rolls
 * once for each wound that would be lost. Devastating Wounds mortal wounds are inflicted after all
 * normal damage and also damage at most one model each, the rest being lost.
 *
 * The state is (models alive, wounds left on the damaged model). Event counts come from the exact
 * joint distribution of normal and mortal damage events per attack, so Sustained Hits, Lethal
 * Hits and Devastating Wounds keep their correlation within an attack.
 */
import type { Dataset } from "../data/dataset.js";
import { quantityDistribution } from "./damage-roll.js";
import { crunchModel, type AttackModel, type EngineInput } from "./engine.js";

export type AllocationOutput = {
  /** Expected wounds removed from the target unit. */
  damageDealt: number;
  modelsDestroyed: number;
  /** Probability of each number of models destroyed, from 0 to the unit's size. */
  modelsDestroyedDistribution: number[];
};

/** Probabilities indexed [normal events][mortal events]. */
type Joint = number[][];

function joint(rows: number, columns: number): Joint {
  return Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
}

function convolve(left: Joint, right: Joint): Joint {
  const out = joint(left.length + right.length - 1, left[0]!.length + right[0]!.length - 1);
  left.forEach((row, k) => row.forEach((p, j) => {
    if (p === 0) return;
    right.forEach((other, k2) => other.forEach((q, j2) => {
      if (q !== 0) out[k + k2]![j + j2]! += p * q;
    }));
  }));
  return out;
}

function power(base: Joint, times: number): Joint {
  let out: Joint = [[1]];
  for (let index = 0; index < times; index += 1) out = convolve(out, base);
  return out;
}

function integral(value: number, what: string): number {
  if (!Number.isInteger(value)) throw new Error(`allocate: ${what} must be a whole number, got ${value}`);
  return value;
}

/** Distribution of one attack's normal and mortal damage events. */
function perAttack(model: AttackModel): Joint {
  const normalWound = model.wound.pass - model.wound.crit;
  const toMain = (normalWound + (model.devastating ? 0 : model.wound.crit)) * model.unsaved;
  const toMortal = model.devastating ? model.wound.crit : 0;
  const woundRoll: Joint = [[1 - toMain - toMortal, toMortal], [toMain, 0]];
  const autoWound: Joint = [[1 - model.unsaved], [model.unsaved]];
  const normalHit = model.torrent ? 1 : model.hit.pass - model.hit.crit;
  const critHit = model.torrent ? 0 : model.hit.crit;
  const out = joint(1, 1);
  out[0]![0] = 1 - normalHit - critHit;
  const add = (into: Joint, from: Joint, weight: number): Joint => {
    const grown = joint(Math.max(into.length, from.length), Math.max(into[0]!.length, from[0]!.length));
    into.forEach((row, k) => row.forEach((p, j) => { grown[k]![j]! += p; }));
    from.forEach((row, k) => row.forEach((p, j) => { grown[k]![j]! += weight * p; }));
    return grown;
  };
  let result = add(out, woundRoll, normalHit);
  if (critHit > 0) {
    const first = model.lethal ? autoWound : woundRoll;
    const extras = model.sustainedStat == null ? [[0, 1] as [number, number]] : quantityDistribution(model.sustainedStat);
    for (const [count, probability] of extras) {
      result = add(result, convolve(first, power(woundRoll, integral(count, "Sustained Hits"))), critHit * probability);
    }
  }
  return result;
}

/** Distribution of the unit's total attacks: each model rolls its own Attacks. */
function attackCounts(model: AttackModel): Map<number, number> {
  const one = new Map<number, number>();
  const rapid = model.rapidFireStat == null ? [[0, 1] as [number, number]] : quantityDistribution(model.rapidFireStat);
  for (const [attacks, p] of quantityDistribution(model.attacksStat)) {
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
function woundsLost(model: AttackModel, lost: number): number[] {
  const out: number[] = [];
  for (const { value, probability } of model.damage) {
    const damage = integral(value, "Damage");
    for (let removed = 0; removed <= damage; removed += 1) {
      out[removed] = (out[removed] ?? 0) + probability * binomial(damage, removed, lost);
    }
  }
  return Array.from(out, (p) => p ?? 0);
}

/** Exact allocation of an attacking unit's damage into the target's models. */
export function allocate(input: EngineInput, dataset?: Dataset): AllocationOutput {
  return allocateModel(crunchModel(input, dataset).model);
}

export function allocateModel(model: AttackModel): AllocationOutput {
  const models = integral(model.modelCount, "target models");
  const wounds = integral(model.wounds, "target Wounds");
  if (models === 0 || wounds === 0) return { damageDealt: 0, modelsDestroyed: 0, modelsDestroyedDistribution: [1] };
  const dead = models * wounds;
  // Alive state (m, w) is (m - 1) * wounds + (w - 1); `dead` absorbs.
  const step = (state: number[], removed: readonly number[]): number[] => {
    const out = new Array<number>(dead + 1).fill(0);
    out[dead] = state[dead]!;
    for (let id = 0; id < dead; id += 1) {
      const p = state[id]!;
      if (p === 0) continue;
      const alive = Math.floor(id / wounds) + 1;
      const left = (id % wounds) + 1;
      removed.forEach((q, amount) => {
        if (q === 0) return;
        const next = amount === 0 ? id : amount < left ? id - amount : alive === 1 ? dead : (alive - 2) * wounds + (wounds - 1);
        out[next]! += p * q;
      });
    }
    return out;
  };

  const events = (() => {
    const per = perAttack(model);
    let total: Joint = [[0]];
    let acc: Joint = [[1]];
    const counts = attackCounts(model);
    const most = Math.max(...counts.keys());
    for (let attacks = 0; attacks <= most; attacks += 1) {
      const weight = counts.get(attacks) ?? 0;
      if (weight > 0) {
        const grown = joint(Math.max(total.length, acc.length), Math.max(total[0]!.length, acc[0]!.length));
        total.forEach((row, k) => row.forEach((p, j) => { grown[k]![j]! += p; }));
        acc.forEach((row, k) => row.forEach((p, j) => { grown[k]![j]! += weight * p; }));
        total = grown;
      }
      if (attacks < most) acc = convolve(acc, per);
    }
    return total;
  })();

  const normal = woundsLost(model, model.woundLost);
  const mortal = woundsLost(model, model.mortalWoundLost);
  let state = new Array<number>(dead + 1).fill(0);
  state[(models - 1) * wounds + (wounds - 1)] = 1;
  const final = new Array<number>(dead + 1).fill(0);
  events.forEach((row, normalEvents) => {
    if (normalEvents > 0) state = step(state, normal);
    if (!row.some((p) => p > 0)) return;
    let after = state;
    row.forEach((p, mortalEvents) => {
      if (mortalEvents > 0) after = step(after, mortal);
      if (p > 0) after.forEach((q, id) => { final[id]! += p * q; });
    });
  });

  const destroyed = new Array<number>(models + 1).fill(0);
  let damageDealt = 0;
  final.forEach((p, id) => {
    const alive = id === dead ? 0 : Math.floor(id / wounds) + 1;
    const remaining = id === dead ? 0 : (alive - 1) * wounds + (id % wounds) + 1;
    destroyed[models - alive]! += p;
    damageDealt += p * (dead - remaining);
  });
  const modelsDestroyed = destroyed.reduce((sum, p, count) => sum + p * count, 0);
  return { damageDealt, modelsDestroyed, modelsDestroyedDistribution: destroyed };
}
