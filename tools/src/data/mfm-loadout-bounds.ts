/**
 * Each item's fewest and most copies over a unit's legal configurations under its MFM loadout
 * rules.
 *
 * Legality depends only on the items a cap or limit counts, so the search walks those items'
 * copies and carries, for every other item, the fewest and most copies any path to the same state
 * holds. Rows are independent once their counted copies are fixed, so a unit's interval for an
 * item is the sum of its rows' intervals, and the bounds are exact.
 */
import { uniformAllows, uniformAttempts, type Copies, type MfmLoadoutRules } from "./mfm-loadout.js";
import { searchTests, spaceOf } from "./mfm-loadout-search.js";

/** Counted copies with the fewest (`lo`) and most (`hi`) copies of every other item. */
interface State {
  own: number[];
  lo: number[];
  hi: number[];
}

/** Adds `state` under `key`, widening the intervals of a state already there. */
function merge(into: Map<number | string, State>, key: number | string, state: State): void {
  const known = into.get(key);
  if (!known) {
    into.set(key, state);
    return;
  }
  for (let i = 0; i < state.lo.length; i++) {
    if (state.lo[i] < known.lo[i]) known.lo[i] = state.lo[i];
    if (state.hi[i] > known.hi[i]) known.hi[i] = state.hi[i];
  }
}

/**
 * Each item's fewest and most copies over the unit's legal configurations at `models` models per
 * row, for every item it can carry; null when it has no legal configuration.
 */
export function mfmWeaponBounds(
  rules: MfmLoadoutRules,
  models: ReadonlyMap<string, number>,
): Map<string, { min: number; max: number }> | null {
  const space = spaceOf(rules, models);
  const counted = space.constrained;
  const countedSet = new Set(counted);
  const free = space.ids.filter((id) => !countedSet.has(id));
  const tests = searchTests(rules, models, space, counted);
  const freeOf = (copies: Copies) => free.map((id) => copies.get(id) ?? 0);
  const lows = space.ids.map(() => Number.POSITIVE_INFINITY);
  const highs = space.ids.map(() => Number.NEGATIVE_INFINITY);
  const countedAt = counted.map((id) => space.ids.indexOf(id));
  const freeAt = free.map((id) => space.ids.indexOf(id));
  let legal = false;

  for (const attempt of uniformAttempts(rules)) {
    const rowResults = space.rows.map((row) => {
      // Bundles with the same counted copies are one choice; each other item ranges over theirs.
      const groups = new Map<number | string, State>();
      for (const bundle of space.bundles.get(row)!) {
        if (!uniformAllows(rules, row, bundle, attempt)) continue;
        const own = tests.vector(bundle);
        const copies = freeOf(bundle);
        merge(groups, tests.keyOf(own), { own, lo: copies, hi: [...copies] });
      }
      let layer = new Map<number | string, State & { left: number }>();
      const n = models.get(row) ?? 0;
      const zero = () => free.map(() => 0);
      layer.set(tests.at(tests.keyOf(counted.map(() => 0)), tests.maxModels + 1, n), { own: counted.map(() => 0), lo: zero(), hi: zero(), left: n });
      for (const group of groups.values()) {
        const next = new Map<number | string, State & { left: number }>();
        for (const state of layer.values()) {
          for (let take = 0; take <= state.left; take++) {
            const own = take === 0 ? state.own : state.own.map((k, i) => k + group.own[i] * take);
            // The tests only tighten as copies are added, so a failing take ends the loop.
            if (take > 0 && (!tests.rowHolds(row, own, true) || !tests.unitHolds(own, true))) break;
            const left = state.left - take;
            const key = tests.at(tests.keyOf(own), tests.maxModels + 1, left);
            const lo = state.lo.map((k, i) => k + group.lo[i] * take);
            const hi = state.hi.map((k, i) => k + group.hi[i] * take);
            const known = next.get(key);
            if (known) merge(next as Map<number | string, State>, key, { own, lo, hi });
            else next.set(key, { own, lo, hi, left });
          }
        }
        layer = next;
      }
      const results = new Map<number | string, State>();
      for (const state of layer.values()) {
        if (state.left === 0 && tests.rowHolds(row, state.own, false)) merge(results, tests.keyOf(state.own), state);
      }
      return [...results.values()];
    });

    for (const unitPick of space.unitPicks) {
      if (![...tests.unitCaps].every(([id, cap]) => (unitPick.get(id) ?? 0) <= cap)) continue;
      const start = tests.vector(unitPick);
      if (!tests.unitHolds(start, true)) continue;
      let states = new Map<number | string, State>([[tests.keyOf(start), { own: start, lo: freeOf(unitPick), hi: freeOf(unitPick) }]]);
      for (const results of rowResults) {
        const next = new Map<number | string, State>();
        for (const state of states.values()) {
          for (const result of results) {
            const own = state.own.map((k, i) => k + result.own[i]);
            if (!tests.unitHolds(own, true)) continue;
            merge(next, tests.keyOf(own), {
              own,
              lo: state.lo.map((k, i) => k + result.lo[i]),
              hi: state.hi.map((k, i) => k + result.hi[i]),
            });
          }
        }
        states = next;
      }
      for (const state of states.values()) {
        if (!tests.unitHolds(state.own, false)) continue;
        legal = true;
        countedAt.forEach((at, i) => {
          lows[at] = Math.min(lows[at], state.own[i]);
          highs[at] = Math.max(highs[at], state.own[i]);
        });
        freeAt.forEach((at, i) => {
          lows[at] = Math.min(lows[at], state.lo[i]);
          highs[at] = Math.max(highs[at], state.hi[i]);
        });
      }
    }
  }
  if (!legal) return null;
  return new Map(space.ids.map((id, i) => [id, { min: lows[i], max: highs[i] }]));
}
