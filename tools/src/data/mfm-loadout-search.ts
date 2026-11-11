/**
 * Enumerates the legal wargear configurations of a unit under its MFM loadout rules (see
 * {@link checkMfmLoadout} for what legal means): the configurations themselves, and how a given
 * configuration's copies sit on its models.
 *
 * Each row's distinct copies are found once, lazily: the walk decides how many of the row's models
 * carry each bundle (in bundle order, most first). Rows then combine in code-unit order, after the
 * unit's own picks. A partial configuration stops as soon as a checkbox cap is exceeded or no
 * allowed sum of a limit's choices can still cover its copies; both only tighten as copies are
 * added, so no legal configuration is cut. States are keyed on the items the search tracks, so a
 * search that tracks few items visits few states.
 */
import {
  add,
  bareModels,
  checkboxCaps,
  compileLimit,
  limitHolds,
  rowBundles,
  uniformAllows,
  uniformAttempts,
  unitPicksOf,
  type Copies,
  type MfmItem,
  type MfmLoadoutRules,
} from "./mfm-loadout.js";

/** `count` models of loadout row `model`, each carrying `items` (per model, ascending by id). */
export interface MfmRowBundle {
  model: string;
  count: number;
  items: MfmItem[];
}

/** A legal configuration: the unit's item copies and the models that carry them. */
export interface MfmConfiguration {
  counts: Map<string, number>;
  /** Rows in code-unit order, bundles in bundle order. The unit's own wargear has no row. */
  groups: MfmRowBundle[];
  /** The unit's own wargear (slots and stock without a row). */
  unit: MfmItem[];
}

/** More bundles than this on one row is refused rather than searched. */
export const MAX_SEARCH_BUNDLES = 200_000;

/** A search that cannot run: a row with more bundle choices than the search takes on. */
export class MfmSearchTooLarge extends Error {
  constructor(readonly row: string) {
    super(`${row}: more than ${MAX_SEARCH_BUNDLES} wargear combinations to search`);
  }
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The largest of `values`, or 0 for none; a loop, as a row can hold more bundles than a spread takes. */
const largest = (values: readonly number[]) => values.reduce((most, n) => (n > most ? n : most), 0);

/** The stock a limit on `model` (or on the unit, when undefined) measures above: templates per model. */
function rowBaseline(rules: MfmLoadoutRules, models: ReadonlyMap<string, number>, rows: readonly string[], model: string | undefined): Copies {
  const out: Copies = new Map();
  for (const row of rows) {
    if (model !== undefined && row !== model) continue;
    add(out, rules.templates.find((entry) => entry.model === row)?.items ?? [], models.get(row) ?? 0);
  }
  return out;
}

/** The rows, bundles and unit picks a search over `rules` at `models` walks. */
export interface Space {
  rows: string[];
  unitModels: number;
  bundles: Map<string, Copies[]>;
  unitPicks: Copies[];
  /** Every item the unit can carry, ascending. */
  ids: string[];
  /** Items a cap or limit counts, ascending. */
  constrained: string[];
}

export function spaceOf(rules: MfmLoadoutRules, models: ReadonlyMap<string, number>): Space {
  const rows = [...models].filter(([, n]) => n > 0).map(([model]) => model).sort(byCodeUnit);
  const unitModels = [...models.values()].reduce((sum, n) => sum + n, 0);
  const bundles = new Map<string, Copies[]>();
  for (const row of rows) {
    // One model's bundle is part of its row's copies, so a bundle its row's caps or limits
    // already refuse is never carried.
    const caps = checkboxCaps(rules, row, models.get(row) ?? 0);
    const baseline = rowBaseline(rules, models, rows, row);
    const limits = rules.limits.filter((limit) => limit.model === row);
    const found = rowBundles(rules, row, (bundle) =>
      [...caps].every(([id, cap]) => (bundle.get(id) ?? 0) <= cap) &&
      limits.every((limit) => limitHolds(limit, unitModels, bundle, baseline, true)), MAX_SEARCH_BUNDLES);
    if (found === null) throw new MfmSearchTooLarge(row);
    bundles.set(row, found);
  }
  const unitPicks = unitPicksOf(rules);
  const ids = new Set<string>();
  for (const copies of [...[...bundles.values()].flat(), ...unitPicks]) for (const [id, n] of copies) if (n > 0) ids.add(id);
  const constrained = new Set<string>();
  for (const row of [undefined, ...rows]) for (const id of checkboxCaps(rules, row).keys()) constrained.add(id);
  for (const limit of rules.limits) for (const item of limit.choices.flat()) constrained.add(item.id);
  return {
    rows,
    unitModels,
    bundles,
    unitPicks,
    ids: [...ids].sort(byCodeUnit),
    constrained: [...constrained].filter((id) => ids.has(id)).sort(byCodeUnit),
  };
}

/** A generator's items by position, produced on first request and kept for later ones. */
function lazy<T>(items: Iterator<T>): (k: number) => T | undefined {
  const cache: T[] = [];
  let done = false;
  return (k) => {
    while (!done && cache.length <= k) {
      const next = items.next();
      if (next.done) done = true;
      else cache.push(next.value);
    }
    return cache[k];
  };
}

/** One leaf of a search: the tracked copies and the witness that reached them. */
interface Leaf {
  totals: number[];
  picks: { row: string; bundle: number; take: number }[];
  unitPick: number;
}

export interface Bounds {
  /** Partial copies above these are cut. */
  ceiling?: readonly number[];
}

/**
 * The rule tests a search over `tracked` items runs: the tracked copies of a set of copies, each
 * row's caps and limits on its own copies, the unit's limits on its copies, and a key for a
 * vector of tracked copies (a number where it fits, else a string).
 */
export function searchTests(rules: MfmLoadoutRules, models: ReadonlyMap<string, number>, space: Space, tracked: readonly string[], bounds: Bounds = {}) {
  const indexOf = new Map(tracked.map((id, i) => [id, i]));
  const vector = (copies: Copies) => {
    const out = new Array<number>(tracked.length).fill(0);
    for (const [id, n] of copies) {
      const i = indexOf.get(id);
      if (i !== undefined) out[i] += n;
    }
    return out;
  };
  const baselineOf = (model: string | undefined) => rowBaseline(rules, models, space.rows, model);
  const unitCaps = checkboxCaps(rules, undefined);
  const rowCaps = new Map(space.rows.map((row) => [row, checkboxCaps(rules, row, models.get(row) ?? 0)]));
  const rowBaselines = new Map(space.rows.map((row) => [row, baselineOf(row)]));
  const unitBaseline = baselineOf(undefined);
  // Each limit's test reads its items from the tracked copies; every item a limit counts is tracked.
  const compiled = (limit: MfmLoadoutRules["limits"][number], baseline: Copies) => {
    const { ids, holds } = compileLimit(limit, space.unitModels, baseline);
    const at = ids.map((id) => indexOf.get(id));
    return (totals: readonly number[], atLeast: boolean) => holds(at.map((i) => (i === undefined ? 0 : totals[i])), atLeast);
  };
  const rowLimits = new Map(space.rows.map((row) => [row, rules.limits.filter((limit) => limit.model === row).map((limit) => compiled(limit, rowBaselines.get(row)!))]));
  const unitLimits = rules.limits.filter((limit) => limit.model === undefined).map((limit) => compiled(limit, unitBaseline));
  const withinCaps = (totals: readonly number[], caps: ReadonlyMap<string, number>) =>
    [...caps].every(([id, cap]) => {
      const i = indexOf.get(id);
      return i === undefined || totals[i] <= cap;
    });
  const rowHolds = (row: string, own: readonly number[], atLeast: boolean) =>
    withinCaps(own, rowCaps.get(row)!) && rowLimits.get(row)!.every((holds) => holds(own, atLeast));
  const unitHolds = (totals: readonly number[], atLeast: boolean) => unitLimits.every((holds) => holds(totals, atLeast));
  const underCeiling = (totals: readonly number[]) =>
    bounds.ceiling === undefined || totals.every((n, i) => n <= bounds.ceiling![i]);

  // Search states are keyed by number where they fit: each tracked item's copies in a radix one
  // more than the most the unit could carry, then the position in the walk.
  const most = tracked.map((_, i) => {
    let n = 0;
    for (const row of space.rows) {
      const per = largest(space.bundles.get(row)!.map((bundle) => bundle.get(tracked[i]) ?? 0));
      n += per * (models.get(row) ?? 0);
    }
    return n + largest(space.unitPicks.map((pick) => pick.get(tracked[i]) ?? 0));
  });
  const weights: number[] = [];
  let span = 1;
  for (const n of most) {
    weights.push(span);
    span *= n + 1;
  }
  const maxModels = largest(space.rows.map((row) => models.get(row) ?? 0));
  const maxBundles = largest([...space.bundles.values()].map((list) => list.length));
  const numeric = span * (maxModels + 1) * (maxBundles + 1) * (space.rows.length + 1) < Number.MAX_SAFE_INTEGER;
  const keyOf = (totals: readonly number[]): number | string =>
    numeric ? totals.reduce((sum, n, i) => sum + n * weights[i], 0) : totals.join(",");
  const at = (key: number | string, radix: number, position: number): number | string =>
    typeof key === "number" ? key * radix + position : `${key}|${position}`;
  return { vector, unitCaps, rowHolds, unitHolds, underCeiling, keyOf, at, maxModels, maxBundles };
}

/**
 * Walks every legal configuration of `space`, tracking only `tracked` items, and calls `visit` on
 * each distinct tracked total (the first configuration to reach it). `visit` returns true to stop.
 */
function search(
  rules: MfmLoadoutRules,
  models: ReadonlyMap<string, number>,
  space: Space,
  tracked: readonly string[],
  visit: (leaf: Leaf) => boolean,
  bounds: Bounds = {},
): void {
  const { vector, unitCaps, rowHolds, unitHolds, underCeiling, keyOf, at, maxModels, maxBundles } = searchTests(rules, models, space, tracked, bounds);
  type RowResult = { own: number[]; picks: Leaf["picks"] };
  const seen = new Set<number | string>();
  for (const attempt of uniformAttempts(rules)) {
    // Bundles with the same tracked copies are interchangeable to the search, so only the first
    // of each is walked. Both searches here track every item, and rowBundles already drops
    // repeated bundles, so this removes nothing today; it keeps a narrower search exact and small.
    const allowed = new Map(space.rows.map((row) => {
      const kept: { index: number; vector: number[] }[] = [];
      const keys = new Set<number | string>();
      space.bundles.get(row)!.forEach((bundle, index) => {
        if (!uniformAllows(rules, row, bundle, attempt)) return;
        const projected = vector(bundle);
        const key = keyOf(projected);
        if (keys.has(key)) return;
        keys.add(key);
        kept.push({ index, vector: projected });
      });
      return [row, kept] as const;
    }));
    // Each row's distinct own copies, found once: a row's copies are part of the unit's, so a row
    // the unit's limits or the ceiling already refuse is cut here too.
    const rowResults = space.rows.map((row) => lazy(rowCopies(row, allowed.get(row)!, models.get(row) ?? 0, bareModels(rules, row))));
    for (let u = 0; u < space.unitPicks.length; u++) {
      const unitPick = space.unitPicks[u];
      if (![...unitCaps].every(([id, cap]) => (unitPick.get(id) ?? 0) <= cap)) continue;
      const start = vector(unitPick);
      if (!underCeiling(start) || !unitHolds(start, true)) continue;
      // Combinations already walked under this unit pick: their completions were visited.
      const walked = new Set<number | string>();
      const picks: Leaf["picks"][] = [];
      const combine = (r: number, totals: number[]): boolean => {
        if (r === space.rows.length) {
          if (!unitHolds(totals, false)) return false;
          const key = keyOf(totals);
          if (seen.has(key)) return false;
          seen.add(key);
          return visit({ totals, picks: picks.flat(), unitPick: u });
        }
        const key = at(keyOf(totals), space.rows.length + 1, r);
        if (walked.has(key)) return false;
        walked.add(key);
        for (let k = 0; ; k++) {
          const result = rowResults[r](k);
          if (result === undefined) break;
          const next = totals.map((n, i) => n + result.own[i]);
          if (!underCeiling(next) || !unitHolds(next, true)) continue;
          picks.push(result.picks);
          const stop = combine(r + 1, next);
          picks.pop();
          if (stop) return true;
        }
        return false;
      };
      if (combine(0, start)) return;
    }
  }

  /**
   * The distinct copies `n` models of `row` can carry within its caps and limits, each with the
   * first picks found for it; up to `bare` of the models may carry nothing, picked as bundle -1.
   * The walk picks the next bundle any remaining model carries, from bundle `b` on, and how many
   * carry it (most first), so it recurses no deeper than the row's models.
   */
  function* rowCopies(row: string, bundles: readonly { index: number; vector: number[] }[], n: number, bare: number): Generator<RowResult> {
    const found = new Set<number | string>();
    const walked = new Set<number | string>();
    const picks: Leaf["picks"] = [];
    function* walk(b: number, left: number, own: number[]): Generator<RowResult> {
      if (left <= bare) {
        const key = keyOf(own);
        if (!found.has(key) && rowHolds(row, own, false)) {
          found.add(key);
          yield { own, picks: left === 0 ? [...picks] : [...picks, { row, bundle: -1, take: left }] };
        }
        if (left === 0) return;
      }
      const prefix = at(keyOf(own), maxModels + 1, left);
      for (let j = b; j < bundles.length; j++) {
        // Walking on from bundle j with these copies covers every later bundle too, so a
        // position already walked ends the loop.
        const key = at(prefix, maxBundles + 1, j);
        if (walked.has(key)) return;
        walked.add(key);
        const { index, vector: bundle } = bundles[j];
        for (let take = left; take >= 1; take--) {
          const next = own.map((k, i) => k + bundle[i] * take);
          if (!underCeiling(next) || !rowHolds(row, next, true) || !unitHolds(next, true)) continue;
          picks.push({ row, bundle: index, take });
          yield* walk(j + 1, left - take, next);
          picks.pop();
        }
      }
    }
    yield* walk(0, n, new Array<number>(tracked.length).fill(0));
  }
}

const itemsOf = (copies: Copies): MfmItem[] =>
  [...copies].filter(([, n]) => n > 0).sort(([a], [b]) => byCodeUnit(a, b)).map(([id, count]) => ({ id, count }));

function configurationOf(space: Space, leaf: Leaf): MfmConfiguration {
  const counts = new Map<string, number>();
  leaf.totals.forEach((n, i) => { if (n > 0) counts.set(space.ids[i], n); });
  return {
    counts,
    groups: leaf.picks.map(({ row, bundle, take }) => ({ model: row, count: take, items: bundle < 0 ? [] : itemsOf(space.bundles.get(row)![bundle]) })),
    unit: itemsOf(space.unitPicks[leaf.unitPick]),
  };
}

/**
 * The unit's distinct legal configurations at `models` models per row, in search order, up to
 * `limit`; `truncated` says more exist.
 */
export function mfmConfigurations(
  rules: MfmLoadoutRules,
  models: ReadonlyMap<string, number>,
  limit: number,
): { configurations: MfmConfiguration[]; truncated: boolean } {
  const space = spaceOf(rules, models);
  const configurations: MfmConfiguration[] = [];
  let truncated = false;
  search(rules, models, space, space.ids, (leaf) => {
    if (configurations.length === limit) {
      truncated = true;
      return true;
    }
    configurations.push(configurationOf(space, leaf));
    return false;
  });
  return { configurations, truncated };
}

/**
 * How `counts` sit on the unit's models at `models` models per row: the first configuration the
 * search finds with exactly these copies, or null when none is legal.
 */
export function mfmAssignment(
  rules: MfmLoadoutRules,
  models: ReadonlyMap<string, number>,
  counts: ReadonlyMap<string, number>,
): MfmConfiguration | null {
  const space = spaceOf(rules, models);
  const known = new Set(space.ids);
  if ([...counts].some(([id, n]) => n > 0 && !known.has(id))) return null;
  const ceiling = space.ids.map((id) => counts.get(id) ?? 0);
  let found: MfmConfiguration | null = null;
  search(rules, models, space, space.ids, (leaf) => {
    if (!leaf.totals.every((n, i) => n === ceiling[i])) return false;
    found = configurationOf(space, leaf);
    return true;
  }, { ceiling });
  return found;
}

/**
 * Calls `visit` on each distinct legal configuration at `models` models per row, in search order,
 * until it returns true. With `ceiling`, only configurations carrying no more than its copies of
 * each item are walked; an item it leaves out may not be carried.
 */
export function forEachMfmConfiguration(
  rules: MfmLoadoutRules,
  models: ReadonlyMap<string, number>,
  visit: (configuration: MfmConfiguration) => boolean | void,
  ceiling?: ReadonlyMap<string, number>,
): void {
  const space = spaceOf(rules, models);
  const bounds = ceiling ? { ceiling: space.ids.map((id) => ceiling.get(id) ?? 0) } : {};
  search(rules, models, space, space.ids, (leaf) => visit(configurationOf(space, leaf)) === true, bounds);
}
