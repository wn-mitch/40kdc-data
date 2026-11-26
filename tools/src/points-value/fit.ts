/**
 * The price model: a robust (Huber), lightly ridged linear fit of first-copy points on each
 * datasheet's measured features, with the value features (offense, durability, Move, OC) held
 * non-negative. Its coefficients are the price list; applied to a unit's `bare` measures with its
 * ability flags off they give the unit's stat-line price, and the rest of its full prediction is
 * what its datasheet abilities are priced at.
 *
 * @packageDocumentation
 */
import { CORE_FLAGS, INFANTRY_TARGET_IDS, TYPE_KEYWORDS, UTILITY_FLAGS, type AuraGain, type Measures, type UnitFeatures } from "./features.js";

/** The value features, each with the unit it is priced per. */
export const VALUE_FEATURES = [
  { id: "shoot-infantry", label: "Shooting vs infantry", per: "expected wound dealt (mean of GEQ/MEQ/TEQ)" },
  { id: "shoot-armour", label: "Shooting vs vehicles/monsters", per: "expected wound dealt (mean of Predator/Knight/C'tan)" },
  { id: "fight-infantry", label: "Melee vs infantry", per: "expected wound dealt (mean of GEQ/MEQ/TEQ)" },
  { id: "fight-armour", label: "Melee vs vehicles/monsters", per: "expected wound dealt (mean of Predator/Knight/C'tan)" },
  { id: "dur-light", label: "Durability vs small arms", per: "S4 AP0 D1 hit-on-3+ attack needed to destroy the unit" },
  { id: "dur-heavy", label: "Durability vs heavy weapons", per: "attack needed to destroy it (mean of plasma, anti-tank, power fist)" },
  { id: "M", label: "Move", per: "inch" },
  { id: "OC", label: "Objective Control", per: "point of OC across the unit" },
  { id: "cp", label: "Command points generated", per: "CP a datasheet rule gains (each rule counted once)" },
  { id: "resource", label: "Other resources generated", per: "die, token or point of a faction pool a datasheet rule gains (each rule counted once)" },
] as const;

const VALUE_IDS: readonly string[] = VALUE_FEATURES.map((feature) => feature.id);
const FLAG_IDS: readonly string[] = [...CORE_FLAGS, ...UTILITY_FLAGS];

/** Every feature name of the model, in column order (the intercept is separate). */
export function featureNames(units: readonly UnitFeatures[]): string[] {
  const factions = [...new Set(units.map((unit) => `faction:${unit.factionId}`))].sort();
  return [...VALUE_IDS, ...FLAG_IDS.map((id) => `flag:${id}`), ...TYPE_KEYWORDS.map((k) => `type:${k}`), "role:leader", "role:support", ...factions];
}

const mean = (values: readonly number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** The value features of one set of measures (offense buckets and durability). */
export function measureFeatures(measures: Partial<Measures>): Record<string, number> {
  const bucket = (phase: string, infantry: boolean) =>
    mean(Object.entries(measures.offense?.[phase] ?? {}).filter(([id]) => INFANTRY_TARGET_IDS.has(id) === infantry).map(([, value]) => value));
  const d = measures.durability ?? {};
  return {
    "shoot-infantry": bucket("shooting", true),
    "shoot-armour": bucket("shooting", false),
    "fight-infantry": bucket("fight", true),
    "fight-armour": bucket("fight", false),
    "dur-light": d["small-arms"] ?? 0,
    "dur-heavy": mean([d.plasma ?? 0, d["anti-tank"] ?? 0, d["power-fist"] ?? 0]),
  };
}

/** `base` with `delta` added cell by cell: a unit's measures with what its rules add to a nearby unit. */
export function addMeasures(base: Measures, delta: Partial<Measures> | undefined): Measures {
  if (!delta) return base;
  const offense = Object.fromEntries(Object.entries(base.offense).map(([phase, targets]) =>
    [phase, Object.fromEntries(Object.entries(targets).map(([id, value]) => [id, value + (delta.offense?.[phase]?.[id] ?? 0)]))]));
  const durability = Object.fromEntries(Object.entries(base.durability).map(([id, value]) => [id, value + (delta.durability?.[id] ?? 0)]));
  return { offense, durability };
}

/**
 * One unit's feature row. `full` uses its full measures, plus `aura` (what its rules add to the
 * nearby unit it is priced beside), its flags and the resources it generates; `bare` its bare
 * measures with every ability flag and resource off (its stat line, weapons, chassis, role and
 * faction kept).
 */
export function featureRow(unit: UnitFeatures, names: readonly string[], mode: "full" | "bare", aura?: Partial<Measures>): number[] {
  const measures = mode === "full" ? addMeasures(unit.full, aura) : unit.bare;
  const values: Record<string, number> = { ...measureFeatures(measures), M: unit.M, OC: unit.OC };
  if (mode === "full") {
    for (const flag of unit.flags) values[`flag:${flag}`] = 1;
    values.cp = unit.resources?.cp ?? 0;
    values.resource = unit.resources?.other ?? 0;
  }
  for (const keyword of unit.keywords) values[`type:${keyword}`] = 1;
  if (unit.role !== "unit") values[`role:${unit.role}`] = 1;
  values[`faction:${unit.factionId}`] = 1;
  return names.map((name) => values[name] ?? 0);
}

export interface PriceModel {
  names: string[];
  intercept: number;
  /** Points per unit of each feature, in column order. */
  coefficients: number[];
}

export function predict(model: PriceModel, row: readonly number[]): number {
  return row.reduce((sum, value, index) => sum + value * model.coefficients[index], model.intercept);
}

/** Solves `A x = b` for symmetric positive-definite `A` (Cholesky). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const L = A.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(sum, 1e-12)) : sum / L[j][j];
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
    y[i] = sum / L[i][i];
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
}

export interface FitOptions {
  /** Ridge penalty on standardized columns; faction columns take `factionRidge`. */
  ridge?: number;
  factionRidge?: number;
  /** Huber threshold in points: residuals past it are down-weighted. */
  huber?: number;
}

/**
 * Fits the price model to `rows` and `points`. Value features stay non-negative: a value feature
 * fitted negative is fixed at zero and the rest refitted, until none is.
 */
export function fitModel(names: readonly string[], rows: readonly number[][], points: readonly number[], options: FitOptions = {}): PriceModel {
  const { ridge = 1, factionRidge = 4, huber = 25 } = options;
  const p = names.length;
  const center = names.map((_, j) => mean(rows.map((row) => row[j])));
  const scale = names.map((_, j) => Math.sqrt(mean(rows.map((row) => (row[j] - center[j]) ** 2))) || 1);
  const Z = rows.map((row) => row.map((value, j) => (value - center[j]) / scale[j]));
  const yMean = mean(points);
  const fixed = new Set<number>();
  const valueColumns = names.flatMap((name, j) => VALUE_IDS.includes(name) ? [j] : []);
  let beta = new Array<number>(p).fill(0);
  let intercept = yMean;
  for (let round = 0; round <= valueColumns.length; round++) {
    const free = names.map((_, j) => j).filter((j) => !fixed.has(j));
    let weights = points.map(() => 1);
    for (let iteration = 0; iteration < 20; iteration++) {
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      // Weighted centering keeps the intercept out of the penalty.
      const zMean = free.map((j) => Z.reduce((sum, row, i) => sum + weights[i] * row[j], 0) / totalWeight);
      const yWeighted = points.reduce((sum, y, i) => sum + weights[i] * y, 0) / totalWeight;
      const A = free.map(() => new Array<number>(free.length).fill(0));
      const b = new Array<number>(free.length).fill(0);
      Z.forEach((row, i) => {
        const w = weights[i];
        const centered = free.map((j, a) => row[j] - zMean[a]);
        for (let a = 0; a < free.length; a++) {
          b[a] += w * centered[a] * (points[i] - yWeighted);
          for (let c = 0; c <= a; c++) A[a][c] += w * centered[a] * centered[c];
        }
      });
      for (let a = 0; a < free.length; a++) {
        for (let c = 0; c < a; c++) A[c][a] = A[a][c];
        A[a][a] += names[free[a]].startsWith("faction:") ? factionRidge : ridge;
      }
      const solved = solve(A, b);
      const next = new Array<number>(p).fill(0);
      free.forEach((j, a) => { next[j] = solved[a]; });
      intercept = yWeighted - free.reduce((sum, j, a) => sum + next[j] * zMean[a], 0);
      const change = next.reduce((sum, value, j) => sum + Math.abs(value - beta[j]), 0);
      beta = next;
      weights = Z.map((row, i) => {
        const residual = Math.abs(points[i] - row.reduce((sum, z, j) => sum + z * beta[j], intercept));
        return residual <= huber ? 1 : huber / residual;
      });
      if (change < 1e-6) break;
    }
    const negative = valueColumns.filter((j) => !fixed.has(j) && beta[j] < 0);
    if (negative.length === 0) break;
    for (const j of negative) fixed.add(j);
  }
  const coefficients = beta.map((value, j) => value / scale[j]);
  return { names: [...names], intercept: intercept - coefficients.reduce((sum, c, j) => sum + c * center[j], 0), coefficients };
}

/** A deterministic pseudo-random stream (mulberry32), so reruns give the same folds and resamples. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CrossValidation {
  folds: number;
  /** Mean absolute error of held-out predictions, in points. */
  mae: number;
  /** Median absolute held-out error as a share of the unit's points. */
  medianRelativeError: number;
  r2: number;
  /** Each unit's held-out prediction, in row order. */
  predictions: number[];
}

/** K-fold cross-validation: each unit is predicted by a model fitted without it. */
export function crossValidate(names: readonly string[], rows: readonly number[][], points: readonly number[], folds = 5, options: FitOptions = {}): CrossValidation {
  const next = random(40);
  const order = rows.map((_, i) => i).sort(() => next() - 0.5);
  const fold = new Array<number>(rows.length);
  order.forEach((i, rank) => { fold[i] = rank % folds; });
  const predictions = new Array<number>(rows.length).fill(0);
  for (let k = 0; k < folds; k++) {
    const train = rows.map((_, i) => i).filter((i) => fold[i] !== k);
    const model = fitModel(names, train.map((i) => rows[i]), train.map((i) => points[i]), options);
    rows.forEach((row, i) => { if (fold[i] === k) predictions[i] = predict(model, row); });
  }
  const errors = points.map((y, i) => y - predictions[i]);
  const yMean = mean(points);
  const relative = errors.map((e, i) => Math.abs(e) / points[i]).sort((a, b) => a - b);
  return {
    folds,
    mae: mean(errors.map(Math.abs)),
    medianRelativeError: relative[Math.floor(relative.length / 2)] ?? 0,
    r2: 1 - errors.reduce((sum, e) => sum + e * e, 0) / points.reduce((sum, y) => sum + (y - yMean) ** 2, 0),
    predictions,
  };
}

/** A 90% bootstrap interval for each coefficient, in column order. */
export function bootstrap(names: readonly string[], rows: readonly number[][], points: readonly number[], samples = 100, options: FitOptions = {}): { low: number[]; high: number[] } {
  const next = random(41);
  const draws: number[][] = [];
  for (let s = 0; s < samples; s++) {
    const picked = rows.map(() => Math.floor(next() * rows.length));
    draws.push(fitModel(names, picked.map((i) => rows[i]), picked.map((i) => points[i]), options).coefficients);
  }
  const quantile = (j: number, q: number) => {
    const sorted = draws.map((draw) => draw[j]).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  };
  return { low: names.map((_, j) => quantile(j, 0.05)), high: names.map((_, j) => quantile(j, 0.95)) };
}

/** The points a measured change is worth under `model`: its value-feature deltas priced. */
export function tweakPoints(model: PriceModel, delta: Partial<Measures>): number {
  const features = measureFeatures(delta);
  const value = (id: string) => {
    const j = model.names.indexOf(id);
    return j < 0 ? 0 : model.coefficients[j];
  };
  // measureFeatures averages only the cells present; a delta with no offense leaves offense at 0.
  return Object.entries(features).reduce((sum, [id, amount]) => {
    if (id.startsWith("dur-") && !delta.durability) return sum;
    if (!id.startsWith("dur-") && !delta.offense) return sum;
    return sum + amount * value(id);
  }, 0);
}

/**
 * The nearby unit a provider is priced beside: of the units its rules reach, less `excluded`
 * (super-heavies, which competitive lists do not field), the one whose gain `model` prices
 * highest. Undefined when its rules reach none.
 */
export function chooseAura(model: PriceModel, unit: UnitFeatures, excluded: ReadonlySet<string> = new Set()): AuraGain | undefined {
  const base = predict(model, featureRow(unit, model.names, "full"));
  let best: { gain: AuraGain; worth: number } | undefined;
  for (const gain of unit.auras ?? []) {
    if (excluded.has(gain.neighbourId)) continue;
    const worth = predict(model, featureRow(unit, model.names, "full", gain.delta)) - base;
    if (worth > (best?.worth ?? 1e-9)) best = { gain, worth };
  }
  return best?.gain;
}
