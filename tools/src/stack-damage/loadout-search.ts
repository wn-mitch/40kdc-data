/**
 * Wargear choice for one unit as a coordinate search.
 *
 * A unit with MFM loadout rules has its distinct legal loadouts listed up front
 * ({@link mfmLoadouts}). A short list is scored whole; a longer one is searched from the base
 * loadout, each move taking the first loadout that scores higher among those within L1 distance 2
 * of the current one (one copy swapped, added or dropped), then within 4, then within 8.
 *
 * A unit without them searches over option plans. A plan sets, for every wargear option, which
 * replacement branch is taken and how many times. Single-option moves change one option's setting.
 * When none improves, pairwise moves change two options that replace a weapon in common together,
 * which reaches combinations whose parts only pay off jointly (one option giving up the weapon
 * another needs). The search alternates the two until neither improves the total.
 */
import type { LoadoutGroup, LoadoutModel } from "../data/loadout.js";
import { forEachMfmConfiguration } from "../data/mfm-loadout-search.js";
import { mfmRowSplits, type MfmComposition } from "../data/mfm-loadout-unit.js";
import { mfmGroupRowOrder, mfmGroups } from "../data/unit-loadout.js";
import type { WargearOption } from "../generated.js";

/** A unit's distinct legal loadouts under its MFM rules, in search order, each with its models. */
export interface MfmLoadouts {
  loadouts: { counts: Map<string, number>; groups: LoadoutGroup[] | null }[];
  /** Position in `loadouts` by {@link countsKey}. */
  byKey: Map<string, number>;
}

export interface LoadoutScaffold {
  models: LoadoutModel[];
  modelCount: number;
  /** Authored wargear options; empty for a unit with MFM rules. */
  options: WargearOption[];
  caps: number[];
  base: Map<string, number>;
  /** Every item some legal loadout can carry. */
  carriable: string[];
  /** Present when the unit's MFM loadout rules decide its loadouts. */
  mfm?: MfmLoadouts;
}

/** A loadout's copies as ascending `id:count` pairs, zero counts left out. */
export function countsKey(counts: ReadonlyMap<string, number>): string {
  return [...counts].filter(([, n]) => n !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, n]) => `${id}:${n}`).join(",");
}

/**
 * The distinct legal loadouts of a unit of `modelCount` models under `composition`'s MFM rules: each
 * row split in {@link mfmRowSplits} order, each split's configurations in search order, a loadout
 * listed at its first configuration.
 */
export function mfmLoadouts(composition: MfmComposition, modelCount: number): MfmLoadouts {
  const out: MfmLoadouts = { loadouts: [], byKey: new Map() };
  const rowOrder = mfmGroupRowOrder(composition);
  for (const rows of mfmRowSplits(composition, modelCount)) {
    forEachMfmConfiguration(composition.loadout!, rows, (configuration) => {
      const key = countsKey(configuration.counts);
      if (out.byKey.has(key)) return;
      out.byKey.set(key, out.loadouts.length);
      out.loadouts.push({ counts: configuration.counts, groups: modelCount > 1 ? mfmGroups(configuration, rowOrder) : null });
    });
  }
  return out;
}

/** MFM loadout lists up to this long are scored whole. */
export const MFM_EXHAUSTIVE_LOADOUTS = 512;
/** The L1 distances an MFM move widens through when no nearer loadout scores higher. */
const MFM_RADII = [2, 4, 8];

function distance(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): number {
  let out = 0;
  for (const [id, n] of left) out += Math.abs(n - (right.get(id) ?? 0));
  for (const [id, n] of right) if (!left.has(id)) out += Math.abs(n);
  return out;
}

export interface OptionPlan {
  branch: number;
  count: number;
}

/** A unit's wargear choices: which equipment counts are legal and what each scores. */
export interface LoadoutSpace<Result extends { total: number }> {
  scaffold: LoadoutScaffold;
  legal(counts: ReadonlyMap<string, number>): boolean;
  score(counts: ReadonlyMap<string, number>): Result;
}

const EPSILON = 1e-9;
/** Pairs whose joint settings exceed this are left to single-option moves. */
const PAIR_SETTINGS_LIMIT = 4096;
/** A guard against a non-terminating search; each accepted move strictly raises the total. */
const MAX_MOVES = 256;

function applyOptionOnce(counts: ReadonlyMap<string, number>, option: WargearOption, branch: number): Map<string, number> | null {
  const next = new Map(counts);
  for (const id of option.replaces ?? []) {
    const have = next.get(id) ?? 0;
    if (have <= 0) return null;
    next.set(id, have - 1);
  }
  for (const id of option.replacement ?? option.replacement_choice?.[branch] ?? []) next.set(id, (next.get(id) ?? 0) + 1);
  for (const [id, count] of next) if (count === 0) next.delete(id);
  return next;
}

/** Equipment counts after applying every option of `plan` to the base loadout, or null if a replacement runs out. */
export function countsFromPlan(base: ReadonlyMap<string, number>, options: readonly WargearOption[], plan: readonly OptionPlan[]): Map<string, number> | null {
  let counts = new Map(base);
  for (let index = 0; index < options.length; index++) {
    for (let copy = 0; copy < plan[index].count; copy++) {
      const next = applyOptionOnce(counts, options[index], plan[index].branch);
      if (!next) return null;
      counts = next;
    }
  }
  return counts;
}

/** Every distinct setting of one option: not taken, or taken 1..cap times on one branch. */
export function optionSettings(scaffold: LoadoutScaffold, index: number): OptionPlan[] {
  const option = scaffold.options[index];
  const branches = option.replacement ? 1 : option.replacement_choice?.length ?? 1;
  const settings: OptionPlan[] = [{ branch: 0, count: 0 }];
  for (let branch = 0; branch < branches; branch++) {
    for (let count = 1; count <= scaffold.caps[index]; count++) settings.push({ branch, count });
  }
  return settings;
}

/** Options that replace a weapon in common, so taking one changes what the other can do. */
function sharesReplacedWeapon(left: WargearOption, right: WargearOption): boolean {
  const replaced: readonly string[] = right.replaces ?? [];
  return (left.replaces ?? []).some((id) => replaced.includes(id));
}

function samePlan(left: OptionPlan, right: OptionPlan): boolean {
  return left.branch === right.branch && left.count === right.count;
}

/** Score of `plan` when it is buildable and legal, else null. */
export function scorePlan<Result extends { total: number }>(space: LoadoutSpace<Result>, plan: readonly OptionPlan[]): Result | null {
  const counts = countsFromPlan(space.scaffold.base, space.scaffold.options, plan);
  if (!counts || !space.legal(counts)) return null;
  return space.score(counts);
}

/** Plans one single-option move from `plan`, then (lazily) one pairwise move. */
function* moves(scaffold: LoadoutScaffold, plan: readonly OptionPlan[], pairs: boolean): Generator<OptionPlan[]> {
  const settings = scaffold.options.map((_, index) => optionSettings(scaffold, index));
  if (!pairs) {
    for (let index = 0; index < settings.length; index++) {
      for (const setting of settings[index]) {
        if (!samePlan(setting, plan[index])) yield plan.map((entry, at) => at === index ? setting : entry);
      }
    }
    return;
  }
  for (let left = 0; left < settings.length; left++) {
    for (let right = left + 1; right < settings.length; right++) {
      if (!sharesReplacedWeapon(scaffold.options[left], scaffold.options[right])) continue;
      if (settings[left].length * settings[right].length > PAIR_SETTINGS_LIMIT) continue;
      for (const first of settings[left]) {
        if (samePlan(first, plan[left])) continue;
        for (const second of settings[right]) {
          if (samePlan(second, plan[right])) continue;
          yield plan.map((entry, at) => at === left ? first : at === right ? second : entry);
        }
      }
    }
  }
}

/**
 * The best plan the coordinate search reaches from the base loadout, which the caller has checked
 * is legal. Plans that run out of a replaced weapon are skipped; illegal ones are also counted
 * through `rejected`.
 */
export function searchLoadout<Result extends { total: number }>(space: LoadoutSpace<Result>, rejected: () => void = () => {}): Result {
  if (space.scaffold.mfm) return searchMfmLoadout(space, space.scaffold.mfm);
  let plan: OptionPlan[] = space.scaffold.options.map(() => ({ branch: 0, count: 0 }));
  let best = space.score(space.scaffold.base);
  for (let accepted = 0; accepted < MAX_MOVES; accepted++) {
    let improved = false;
    for (const pairs of [false, true]) {
      for (const trialPlan of moves(space.scaffold, plan, pairs)) {
        const counts = countsFromPlan(space.scaffold.base, space.scaffold.options, trialPlan);
        if (!counts) continue;
        if (!space.legal(counts)) {
          rejected();
          continue;
        }
        const trial = space.score(counts);
        if (trial.total > best.total + EPSILON) {
          plan = trialPlan;
          best = trial;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
    if (!improved) return best;
  }
  throw new Error(`loadout search: no fixed point after ${MAX_MOVES} improving moves`);
}

/** The MFM search described above; the base loadout is the start, and ties keep the earlier loadout. */
function searchMfmLoadout<Result extends { total: number }>(space: LoadoutSpace<Result>, mfm: MfmLoadouts): Result {
  let best = space.score(space.scaffold.base);
  if (mfm.loadouts.length <= MFM_EXHAUSTIVE_LOADOUTS) {
    for (const { counts } of mfm.loadouts) {
      const trial = space.score(counts);
      if (trial.total > best.total + EPSILON) best = trial;
    }
    return best;
  }
  let current: ReadonlyMap<string, number> = space.scaffold.base;
  for (let accepted = 0; accepted < MAX_MOVES; accepted++) {
    let improved = false;
    let nearer = 0;
    for (const radius of MFM_RADII) {
      for (const { counts } of mfm.loadouts) {
        const d = distance(counts, current);
        if (d <= nearer || d > radius) continue;
        const trial = space.score(counts);
        if (trial.total > best.total + EPSILON) {
          current = counts;
          best = trial;
          improved = true;
          break;
        }
      }
      if (improved) break;
      nearer = radius;
    }
    if (!improved) return best;
  }
  throw new Error(`loadout search: no fixed point after ${MAX_MOVES} improving moves`);
}
