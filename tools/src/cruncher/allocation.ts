/**
 * The discrete allocation stage: what one shooting or fighting unit's attacks do to the models of
 * the target unit, as an exact distribution rather than an expected value.
 *
 * Each attack that gets through deals its Damage to one model; damage beyond that model's
 * remaining wounds is lost, and an already damaged model takes the next attack. Feel No Pain rolls
 * once for each wound that would be lost. Mortal wounds an ability inflicts on the attack's rolls
 * come after all normal damage, one wound at a time, each carrying over to the next model.
 * Devastating Wounds mortal wounds come last and damage at most one model each, the rest being
 * lost.
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
  const { damageDealt, modelsDestroyed, modelsDestroyedDistribution } = summarize(allocateFrom(model, zeroingOf(defences)));
  return { damageDealt, modelsDestroyed, modelsDestroyedDistribution };
}

/** {@link allocate} over several attack lines in turn, with the wounds dealt as a distribution too. */
export type AllocationSequenceOutput = AllocationOutput & {
  /** Probability of each number of wounds removed from the target unit, from 0 to all of them. */
  woundsDealtDistribution: number[];
};

/**
 * Exact allocation of several attack lines into one target unit, fired in the order given: each
 * line's attacks land on what the earlier lines left (models alive, wounds left on the damaged
 * model and damage-zeroing uses left), so damage carried over and damage lost to overkill both
 * count. Every input must describe the same target. Without an explicit `defences.zeroing`, the
 * first input's `damage-zeroing` buffs supply it.
 */
export function allocateSequence(inputs: readonly EngineInput[], dataset?: Dataset, defences: AllocationDefences = {}): AllocationSequenceOutput {
  const crunched = inputs.map((input) => crunchModel(input, dataset));
  let zeroing = defences.zeroing;
  if (zeroing === undefined && crunched.length > 0) {
    const { unit, model: perModel } = crunched[0]!.output.resolved.damageZeroing;
    if (unit > 0 && perModel > 0) throw new Error("allocate: unit-wide and per-model damage zeroing together are not modelled");
    if (unit > 0) zeroing = { uses: unit, per: "unit" };
    else if (perModel > 0) zeroing = { uses: perModel, per: "model" };
  }
  const resolvedZeroing = zeroingOf(zeroing === undefined ? {} : { zeroing });
  const first = crunched[0]?.model;
  if (first === undefined) return { damageDealt: 0, modelsDestroyed: 0, modelsDestroyedDistribution: [1], woundsDealtDistribution: [1] };
  let result: Allocated | undefined;
  for (const { model } of crunched) {
    if (model.modelCount !== first.modelCount || model.wounds !== first.wounds) {
      throw new Error("allocateSequence: every line must target the same unit");
    }
    result = allocateFrom(model, resolvedZeroing, result?.final);
  }
  return summarize(result!);
}

/** The target's state distribution after an allocation, with the geometry to read it. */
type Allocated = { final: number[]; models: number; wounds: number; uses: number };

/** States by (models alive, wounds left, zeroing uses left); see {@link allocateFrom}. */
function summarize({ final, models, wounds, uses }: Allocated): AllocationSequenceOutput {
  const cells = models * wounds;
  const dead = cells * uses;
  const destroyed = new Array<number>(models + 1).fill(0);
  const dealt = new Array<number>(cells + 1).fill(0);
  let damageDealt = 0;
  final.forEach((p, id) => {
    const cell = Math.floor(id / uses);
    const alive = id === dead ? 0 : Math.floor(cell / wounds) + 1;
    const remaining = id === dead ? 0 : (alive - 1) * wounds + (cell % wounds) + 1;
    destroyed[models - alive]! += p;
    dealt[cells - remaining]! += p;
    damageDealt += p * (cells - remaining);
  });
  const modelsDestroyed = destroyed.reduce((sum, p, count) => sum + p * count, 0);
  return { damageDealt, modelsDestroyed, modelsDestroyedDistribution: destroyed, woundsDealtDistribution: dealt };
}

/**
 * One line's attacks allocated into the target, starting from `start` (a state distribution from
 * an earlier line), else from the unit at full strength with every zeroing use left.
 */
function allocateFrom(model: AttackModel, zeroing: DamageZeroing, start?: readonly number[]): Allocated {
  if (model.unmodelled.length > 0) throw new Error(`allocate: ${model.unmodelled.join(", ")} not modelled by exact allocation`);
  const models = integral(model.modelCount, "target models");
  const wounds = integral(model.wounds, "target Wounds");
  const uses = zeroing.uses + 1;
  if (models === 0 || wounds === 0) return { final: [1], models: 0, wounds: 1, uses };
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
  // An ability mortal wound: one Damage, rolling the mortal-wound Feel No Pain.
  const one = woundsLost([{ value: 1, probability: 1 }], model.mortalWoundLost);
  const mortals = model.rollMortals;
  const zeros = (): number[] => new Array<number>(dead + 1).fill(0);
  // States by the ability mortal wounds still to inflict: layer k waits on k of them.
  type Layers = number[][];
  let state: Layers = [start ? [...start] : zeros()];
  if (!start) state[0]![dead - 1] = 1;
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
    // Normal damage, then the ability's mortal wounds, then the Devastating Wounds events: every
    // ability mortal wound is inflicted here, so the outcome lands in layer 0.
    const target = pending[0] ??= zeros();
    let current = state[0]!;
    events.forEach((row, normalEvents) => {
      if (normalEvents > 0) current = step(current, normal, true);
      let afterWounds = current;
      for (let wounds = 0; wounds < row[0]!.length; wounds += 1) {
        if (!row.some((cell) => cell.slice(wounds).some((p) => p > 0))) break;
        if (wounds > 0) afterWounds = step(afterWounds, one, false);
        let after = afterWounds;
        row.forEach((cell, mortalEvents) => {
          if (mortalEvents > 0) after = step(after, mortal, false);
          const p = cell[wounds]!;
          if (p > 0) after.forEach((q, id) => { target[id]! += p * q; });
        });
      }
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

  // The ability's mortal wounds the step-by-step path leaves pending, one wound each after all
  // normal damage: layer k takes k of them.
  let final = pending[pending.length - 1] ?? zeros();
  for (let k = pending.length - 2; k >= 0; k -= 1) {
    final = step(final, one, false);
    (pending[k] ?? []).forEach((q, id) => { final[id]! += q; });
  }

  return { final, models, wounds, uses };
}

/**
 * One allocation group of an attached target unit (rules 05.03 and 05.04): one for each CHARACTER
 * model, and one for the other models with the same W, Sv and InSv.
 */
export type TargetGroup = { character: boolean };

/** {@link allocateAttached}'s result: the unit's, and each group's models destroyed. */
export type AttachedAllocationOutput = AllocationSequenceOutput & {
  /** For each group in the order given, the probability of each number of its models destroyed. */
  groups: Array<{ modelsDestroyedDistribution: number[] }>;
};

/** The largest number of target states {@link allocateAttached} tracks before it refuses. */
export const MAX_ATTACHED_STATES = 200_000;

/** The fields of an attack's model that every group of an attached target must share. */
function sharedRolls(model: AttackModel): string {
  const { modelsFiring, attacksStat, attacksReroll, attacksBonus, rapidFireStat, torrent, hit, sustainedStat, lethal, wound, devastating, precision, rollMortals } = model;
  return JSON.stringify([modelsFiring, attacksStat, attacksReroll ?? null, attacksBonus, rapidFireStat, torrent, hit.pass, hit.crit, sustainedStat, lethal, wound.pass, wound.crit, devastating, precision, rollMortals]);
}

/**
 * Exact allocation of several attack lines into an attached unit, fired in the order given.
 * `lines[l][g]` is line `l` crunched against group `g`: the same attacker and context, with the
 * group's own profile, model count and defensive buffs. Each group must see the same Hit and Wound
 * rolls, so give every group the attached unit's keywords, its Toughness, the highest among the
 * Bodyguard models (05.02.01), and its models as `context.targetModelCount`, which Blast and Cleave
 * count.
 *
 * `groups` is the defender's allocation order, CHARACTER groups after every other group. The
 * current group is the first with a model left; an attack's save, Damage and Feel No Pain are that
 * group's, and the damaged model takes the next attack. A line with [PRECISION] starts on the first
 * CHARACTER group with a model left and keeps it current until the line is resolved or the group is
 * destroyed. Saves are made as each wound reaches the current group rather than all at once and
 * sorted lowest first, which is exact while every group has the same save.
 *
 * With one group this is {@link allocateSequence}. Without an explicit `defences.zeroing`, the
 * first line's first group supplies the damage-zeroing defence, shared across the groups.
 */
export function allocateAttached(
  lines: ReadonlyArray<readonly EngineInput[]>,
  groups: readonly TargetGroup[],
  dataset?: Dataset,
  defences: AllocationDefences = {},
): AttachedAllocationOutput {
  if (groups.length === 0) throw new Error("allocateAttached: the target needs at least one group");
  const firstCharacter = groups.findIndex((group) => group.character);
  if (firstCharacter >= 0 && groups.slice(firstCharacter).some((group) => !group.character)) {
    throw new Error("allocateAttached: no CHARACTER group can come before a non-CHARACTER group");
  }
  for (const line of lines) {
    if (line.length !== groups.length) throw new Error(`allocateAttached: every line needs one input per group (${groups.length}), got ${line.length}`);
  }
  const crunched = lines.map((line) => line.map((input) => crunchModel(input, dataset)));
  let zeroing = defences.zeroing;
  if (zeroing === undefined && crunched.length > 0) {
    const { unit, model: perModel } = crunched[0]![0]!.output.resolved.damageZeroing;
    if (unit > 0 && perModel > 0) throw new Error("allocate: unit-wide and per-model damage zeroing together are not modelled");
    if (unit > 0) zeroing = { uses: unit, per: "unit" };
    else if (perModel > 0) zeroing = { uses: perModel, per: "model" };
  }
  const resolvedZeroing = zeroingOf(zeroing === undefined ? {} : { zeroing });
  if (groups.length === 1) {
    const out = crunched.length === 0
      ? { damageDealt: 0, modelsDestroyed: 0, modelsDestroyedDistribution: [1], woundsDealtDistribution: [1] }
      : allocateSequence(lines.map((line) => line[0]!), dataset, { zeroing: resolvedZeroing });
    return { ...out, groups: [{ modelsDestroyedDistribution: out.modelsDestroyedDistribution }] };
  }
  const geometry = crunched[0]?.map(({ model }) => ({ models: integral(model.modelCount, "target models"), wounds: integral(model.wounds, "target Wounds") }));
  if (geometry === undefined) throw new Error("allocateAttached: give at least one line to read the target's groups from");
  let state: number[] | undefined;
  for (const line of crunched) {
    const models = line.map(({ model }) => model);
    models.forEach((model, g) => {
      if (model.unmodelled.length > 0) throw new Error(`allocate: ${model.unmodelled.join(", ")} not modelled by exact allocation`);
      if (model.modelCount !== geometry[g]!.models || model.wounds !== geometry[g]!.wounds) throw new Error("allocateAttached: every line must target the same groups");
      if (sharedRolls(model) !== sharedRolls(models[0]!)) {
        throw new Error("allocateAttached: the groups disagree on the attack's Hit or Wound rolls; give each group the attached unit's keywords, Toughness and model count");
      }
    });
    state = allocateGroupsFrom(models, groups, geometry, resolvedZeroing, state);
  }
  return summarizeGroups(state!, geometry, resolvedZeroing.uses + 1);
}

type GroupGeometry = { models: number; wounds: number };

/** Mixed-radix strides of the groups' remaining wounds, and the number of cells. */
function groupStrides(geometry: readonly GroupGeometry[]): { strides: number[]; cells: number } {
  const strides: number[] = [];
  let cells = 1;
  for (const { models, wounds } of geometry) {
    strides.push(cells);
    cells *= models * wounds + 1;
  }
  return { strides, cells };
}

/**
 * One line's attacks into the groups, from `start` (an earlier line's states) or the unit at full
 * strength. A state is the wounds each group has left, plus zeroing uses left: a group has at
 * most one damaged model, so its wounds left say how many models it has and how hurt the damaged
 * one is.
 */
function allocateGroupsFrom(
  models: readonly AttackModel[],
  groups: readonly TargetGroup[],
  geometry: readonly GroupGeometry[],
  zeroing: DamageZeroing,
  start?: readonly number[],
): number[] {
  const model = models[0]!;
  const uses = zeroing.uses + 1;
  const { strides, cells } = groupStrides(geometry);
  const size = cells * uses;
  if (size > MAX_ATTACHED_STATES) throw new Error(`allocate: the attached unit's ${size} states exceed the exact allocation bound (${MAX_ATTACHED_STATES})`);
  const left = (cell: number, g: number) => Math.floor(cell / strides[g]!) % (geometry[g]!.models * geometry[g]!.wounds + 1);
  const full = geometry.reduce((sum, { models: m, wounds: w }, g) => sum + m * w * strides[g]!, 0);
  const zeros = (): number[] => new Array<number>(size).fill(0);
  const initial = start ? [...start] : zeros();
  if (!start) initial[full * uses + uses - 1] = 1;

  // What one wound, critical wound or mortal wound does to the current group.
  const split = models.some((m) => m.criticalWound !== undefined) && !model.devastating;
  const params = models.map((m) => {
    const critical = m.criticalWound ?? { unsaved: m.unsaved, damage: m.damage };
    return {
      wound: { unsaved: m.unsaved, removed: woundsLost(m.damage, m.woundLost), zeroable: true },
      critical: { unsaved: critical.unsaved, removed: woundsLost(critical.damage, m.woundLost), zeroable: true },
      one: { unsaved: 1, removed: woundsLost([{ value: 1, probability: 1 }], m.mortalWoundLost), zeroable: false },
      dev: { unsaved: 1, removed: woundsLost(m.criticalWound?.damage ?? m.damage, m.mortalWoundLost), zeroable: false },
    };
  });
  type Kind = "wound" | "critical" | "one" | "dev";
  const firstAlive = (cell: number, order: readonly number[]) => order.find((g) => left(cell, g) > 0) ?? -1;
  const defaultOrder = groups.map((_, g) => g);
  const characters = defaultOrder.filter((g) => groups[g]!.character);

  // The line's attacks from one share of the start, `chosen` the group [PRECISION] keeps current.
  const run = (from: number[], chosen: number): number[] => {
    const current = Array.from({ length: cells }, (_, cell) => (chosen >= 0 && left(cell, chosen) > 0 ? chosen : firstAlive(cell, defaultOrder)));
    const step = (state: readonly number[], kind: Kind): number[] => {
      const out = zeros();
      for (let id = 0; id < size; id += 1) {
        const p = state[id]!;
        if (p === 0) continue;
        const cell = Math.floor(id / uses);
        const g = current[cell]!;
        if (g < 0) { out[id]! += p; continue; }
        const { unsaved, removed, zeroable } = params[g]![kind];
        if (unsaved < 1) out[id]! += p * (1 - unsaved);
        const hit = p * unsaved;
        if (hit === 0) continue;
        const unused = id % uses;
        if (zeroable && unused > 0) { out[id - 1]! += hit; continue; }
        const { wounds } = geometry[g]!;
        const remaining = left(cell, g);
        const alive = Math.ceil(remaining / wounds);
        const onModel = remaining - (alive - 1) * wounds;
        removed.forEach((q, amount) => {
          if (q === 0) return;
          const kills = amount >= onModel;
          const next = amount === 0 ? remaining : kills ? (alive - 1) * wounds : remaining - amount;
          const refilled = kills && zeroing.per === "model" ? uses - 1 : unused;
          out[(cell + (next - remaining) * strides[g]!) * uses + refilled]! += hit * q;
        });
      }
      return out;
    };
    const tableModel: AttackModel = { ...model, unsaved: 1, ...(split ? { criticalWound: { unsaved: 1, damage: model.damage } } : {}) };
    const per = trim(perAttack(tableModel));
    const counts = attackCounts(model);
    const most = Math.max(...counts.keys());
    const work = most * (most * (per.length - 1) + 1) * (most * (per[0]!.length - 1) + 1) * (most * (per[0]![0]!.length - 1) + 1);
    if (work > MAX_EVENT_WORK) throw new Error(`allocate: ${most} attacks exceed the exact allocation bound (work ${work} > ${MAX_EVENT_WORK})`);
    const mortals = model.rollMortals;
    type Layers = number[][];
    const pending: Layers = [];
    const gather = (into: Layers, layers: Layers, weight: number): void => layers.forEach((layer, k) => {
      const target = into[k] ??= zeros();
      layer.forEach((q, id) => { target[id]! += weight * q; });
    });
    const stepAll = (layers: Layers, kind: Kind): Layers => layers.map((layer) => step(layer, kind));
    const shiftAll = (layers: Layers, by: number): Layers => by === 0 ? layers : [...Array.from({ length: by }, zeros), ...layers];
    if (split) {
      // Critical wounds with their own save or Damage land in the order their hits wound.
      const normalHit = model.torrent ? 1 : model.hit.pass - model.hit.crit;
      const critHit = model.torrent ? 0 : model.hit.crit;
      const extras = model.sustainedStat == null ? [[0, 1] as [number, number]] : quantityDistribution(model.sustainedStat);
      const blend = (parts: ReadonlyArray<readonly [number, Layers]>): Layers => {
        const out: Layers = [zeros()];
        for (const [weight, layers] of parts) if (weight > 0) gather(out, layers, weight);
        return out;
      };
      const woundRoll = (layers: Layers, extra: number): Layers => blend([
        [1 - model.wound.pass, layers],
        [model.wound.pass - model.wound.crit, shiftAll(stepAll(layers, "wound"), mortals.wound)],
        [model.wound.crit, shiftAll(stepAll(layers, "critical"), mortals.wound + mortals.criticalWound + extra)],
      ]);
      const firstWound = (layers: Layers): Layers => model.lethal
        ? shiftAll(stepAll(layers, "wound"), mortals.wound)
        : woundRoll(layers, mortals.criticalWoundOfCriticalHit);
      const attack = (layers: Layers): Layers => {
        const parts: Array<readonly [number, Layers]> = [[1 - normalHit - critHit, layers], [normalHit, shiftAll(woundRoll(layers, 0), mortals.hit)]];
        if (critHit > 0) {
          let after = firstWound(shiftAll(layers, mortals.hit + mortals.criticalHit));
          let done = 0;
          for (const [count, probability] of [...extras].sort((a, b) => a[0] - b[0])) {
            for (; done < integral(count, "Sustained Hits"); done += 1) after = woundRoll(after, 0);
            parts.push([critHit * probability, after]);
          }
        }
        return blend(parts);
      };
      let layers: Layers = [from];
      for (let attacks = 0; attacks <= most; attacks += 1) {
        const weight = counts.get(attacks) ?? 0;
        if (weight > 0) gather(pending, layers, weight);
        if (attacks === most) break;
        layers = attack(layers);
      }
    } else {
      // Wounds, then the ability's mortal wounds, then Devastating Wounds' mortal wounds.
      let events: Joint = [[[0]]];
      let acc: Joint = [[[1]]];
      for (let attacks = 0; attacks <= most; attacks += 1) {
        const weight = counts.get(attacks) ?? 0;
        if (weight > 0) events = add(events, acc, weight);
        if (attacks < most) acc = convolve(acc, per);
      }
      const target = pending[0] ??= zeros();
      let afterNormal = from;
      events.forEach((row, normalEvents) => {
        if (normalEvents > 0) afterNormal = step(afterNormal, "wound");
        let afterOnes = afterNormal;
        for (let ones = 0; ones < row[0]!.length; ones += 1) {
          if (!row.some((cell) => cell.slice(ones).some((p) => p > 0))) break;
          if (ones > 0) afterOnes = step(afterOnes, "one");
          let after = afterOnes;
          row.forEach((cell, devEvents) => {
            if (devEvents > 0) after = step(after, "dev");
            const p = cell[ones]!;
            if (p > 0) after.forEach((q, id) => { target[id]! += p * q; });
          });
        }
      });
    }
    let final = pending[pending.length - 1] ?? zeros();
    for (let k = pending.length - 2; k >= 0; k -= 1) {
      final = step(final, "one");
      (pending[k] ?? []).forEach((q, id) => { final[id]! += q; });
    }
    return final;
  };

  if (!model.precision || characters.length === 0) return run(initial, -1);
  // [PRECISION] picks a CHARACTER group at the start of the line: split the start by which one.
  const out = zeros();
  const shares = new Map<number, number[]>();
  initial.forEach((p, id) => {
    if (p === 0) return;
    const chosen = firstAlive(Math.floor(id / uses), characters);
    const share = shares.get(chosen) ?? zeros();
    share[id]! += p;
    shares.set(chosen, share);
  });
  for (const [chosen, share] of shares) run(share, chosen).forEach((q, id) => { out[id]! += q; });
  return out;
}

function summarizeGroups(final: readonly number[], geometry: readonly GroupGeometry[], uses: number): AttachedAllocationOutput {
  const { strides } = groupStrides(geometry);
  const total = geometry.reduce((sum, { models }) => sum + models, 0);
  const totalWounds = geometry.reduce((sum, { models, wounds }) => sum + models * wounds, 0);
  const destroyed = new Array<number>(total + 1).fill(0);
  const dealt = new Array<number>(totalWounds + 1).fill(0);
  const byGroup = geometry.map(({ models }) => new Array<number>(models + 1).fill(0));
  let damageDealt = 0;
  final.forEach((p, id) => {
    if (p === 0) return;
    const cell = Math.floor(id / uses);
    let killed = 0;
    let lost = 0;
    geometry.forEach(({ models, wounds }, g) => {
      const remaining = Math.floor(cell / strides[g]!) % (models * wounds + 1);
      const dead = models - Math.ceil(remaining / wounds);
      byGroup[g]![dead]! += p;
      killed += dead;
      lost += models * wounds - remaining;
    });
    destroyed[killed]! += p;
    dealt[lost]! += p;
    damageDealt += p * lost;
  });
  const modelsDestroyed = destroyed.reduce((sum, p, count) => sum + p * count, 0);
  return {
    damageDealt,
    modelsDestroyed,
    modelsDestroyedDistribution: destroyed,
    woundsDealtDistribution: dealt,
    groups: byGroup.map((distribution) => ({ modelsDestroyedDistribution: distribution })),
  };
}
