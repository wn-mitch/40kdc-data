/**
 * A unit's MFM loadout at a model count: how the count splits across the loadout's model rows, and
 * the default wargear at that size.
 */
import { add, checkMfmLoadout, defaultMfmLoadout, type Copies, type MfmItem, type MfmLoadoutRules, type MfmLoadoutViolation } from "./mfm-loadout.js";
import { mfmWeaponBounds } from "./mfm-loadout-bounds.js";
import { mfmAssignment, mfmConfigurations, type MfmConfiguration } from "./mfm-loadout-search.js";

/** The composition fields the split reads: its model rows and squad-size tiers. */
export interface MfmComposition {
  models: readonly { name: string; min: number; max: number }[];
  tiers?: readonly { models: readonly { name: string; min: number; max: number }[] }[];
  loadout?: MfmLoadoutRules;
}

/**
 * The model-count range a loadout row has in a tier. A row written `name#k`, with `k` a positive
 * decimal integer, is the k-th of the tier's rows of that name; any other name covers all of the
 * tier's rows with that exact name.
 */
function rowRange(tier: readonly { name: string; min: number; max: number }[], row: string): { min: number; max: number } | null {
  const hash = row.lastIndexOf("#");
  const suffix = hash > 0 ? row.slice(hash + 1) : "";
  const k = /^[1-9][0-9]*$/.test(suffix) ? Number(suffix) : NaN;
  if (!Number.isNaN(k)) {
    const entry = tier.filter((model) => model.name === row.slice(0, hash))[k - 1];
    return entry ? { min: entry.min, max: entry.max } : null;
  }
  const entries = tier.filter((model) => model.name === row);
  if (entries.length === 0) return null;
  return entries.reduce((sum, model) => ({ min: sum.min + model.min, max: sum.max + model.max }), { min: 0, max: 0 });
}

type Range = { min: number; max: number };

/**
 * Each tier's model-count range per loadout row, in declaration order, rows in stock order. A row
 * the tier does not list keeps its default count.
 */
function tierRanges(composition: MfmComposition): { defaults: Map<string, number>; tiers: Map<string, Range>[] } | null {
  const rules = composition.loadout;
  if (!rules) return null;
  const tiers = composition.tiers && composition.tiers.length > 0 ? composition.tiers.map((tier) => tier.models) : [composition.models];
  const defaults = defaultMfmLoadout(rules).models;
  return {
    defaults,
    tiers: tiers.map((tier) => new Map([...defaults].map(([row, n]) => [row, rowRange(tier, row) ?? { min: n, max: n }]))),
  };
}

const total = (ranges: ReadonlyMap<string, Range>, side: "min" | "max") => [...ranges.values()].reduce((sum, range) => sum + range[side], 0);

/**
 * The loadout rows' model counts for a unit of `modelCount` models, or null when no tier holds that
 * count. The first tier (in declaration order) whose range holds the count fixes each row's range;
 * the default unit's rows are clamped into it, and the difference goes to (or comes from) the row
 * with the most default models that has room, ties to the first in stock order, until the count
 * is reached.
 */
export function mfmRows(composition: MfmComposition, modelCount: number): Map<string, number> | null {
  const found = tierRanges(composition);
  if (!found) return null;
  const { defaults } = found;
  const order = [...defaults.keys()];
  for (const ranges of found.tiers) {
    if (modelCount < total(ranges, "min") || modelCount > total(ranges, "max")) continue;
    const rows = new Map(order.map((row) => {
      const { min, max } = ranges.get(row)!;
      return [row, Math.min(max, Math.max(min, defaults.get(row)!))];
    }));
    let delta = modelCount - [...rows.values()].reduce((sum, n) => sum + n, 0);
    while (delta !== 0) {
      const grow = delta > 0;
      const candidates = order.filter((row) => (grow ? rows.get(row)! < ranges.get(row)!.max : rows.get(row)! > ranges.get(row)!.min));
      // The tier's range holds the count, so some row has room.
      const row = candidates.reduce((best, next) => (defaults.get(next)! > defaults.get(best)! ? next : best));
      const room = grow ? ranges.get(row)!.max - rows.get(row)! : rows.get(row)! - ranges.get(row)!.min;
      const step = Math.min(room, Math.abs(delta));
      rows.set(row, rows.get(row)! + (grow ? step : -step));
      delta += grow ? -step : step;
    }
    return rows;
  }
  return null;
}

/**
 * Every way a unit of `modelCount` models splits across its loadout rows under some tier: the
 * {@link mfmRows} split first, then the rest by tier in declaration order, each tier's in
 * ascending order of the rows' counts (rows in stock order). Each split is listed once. Empty when
 * no tier holds the count.
 */
export function mfmRowSplits(composition: MfmComposition, modelCount: number): Map<string, number>[] {
  const bulk = mfmRows(composition, modelCount);
  const found = tierRanges(composition);
  if (!bulk || !found) return [];
  const order = [...found.defaults.keys()];
  const keyOf = (rows: ReadonlyMap<string, number>) => order.map((row) => rows.get(row)).join(",");
  const out = [bulk];
  const seen = new Set([keyOf(bulk)]);
  for (const ranges of found.tiers) {
    const lows = order.map((row) => ranges.get(row)!.min);
    const highs = order.map((row) => ranges.get(row)!.max);
    const counts: number[] = [];
    const walk = (i: number, left: number) => {
      if (i === order.length) {
        if (left !== 0) return;
        const rows = new Map(order.map((row, at) => [row, counts[at]]));
        const key = keyOf(rows);
        if (!seen.has(key)) {
          seen.add(key);
          out.push(rows);
        }
        return;
      }
      // The rows after this one must still be able to take what is left.
      const restLow = lows.slice(i + 1).reduce((sum, n) => sum + n, 0);
      const restHigh = highs.slice(i + 1).reduce((sum, n) => sum + n, 0);
      for (let n = Math.max(lows[i], left - restHigh); n <= Math.min(highs[i], left - restLow); n++) {
        counts.push(n);
        walk(i + 1, left - n);
        counts.pop();
      }
    };
    walk(0, modelCount);
  }
  return out;
}

/**
 * The default wargear of a unit with `rows` models per loadout row: the default unit's copies, plus
 * a row's template for each model it has beyond the default and less one for each it has fewer.
 * Null when removing models would take copies the default does not have.
 */
export function mfmResizedDefault(rules: MfmLoadoutRules, rows: ReadonlyMap<string, number>): Map<string, number> | null {
  const { models, counts } = defaultMfmLoadout(rules);
  const out: Copies = new Map(counts);
  for (const [row, n] of rows) {
    const delta = n - (models.get(row) ?? 0);
    if (delta === 0) continue;
    add(out, rules.templates.find((entry) => entry.model === row)?.items ?? [], delta);
  }
  if ([...out.values()].some((n) => n < 0)) return null;
  return new Map([...out].filter(([, n]) => n > 0));
}

/**
 * The default wargear of a unit with `rows` models per loadout row, scaling each row's default
 * copies per model. Null when a row's copies do not split evenly over its default models, or a
 * row the default unit has none of is given models.
 */
export function mfmScaledDefault(rules: MfmLoadoutRules, rows: ReadonlyMap<string, number>): Map<string, number> | null {
  const out: Copies = new Map();
  for (const row of rules.stock) {
    if (row.model === undefined) {
      add(out, row.items);
      continue;
    }
    const n = rows.get(row.model) ?? 0;
    if (n === 0) continue;
    if (row.models === 0) return null;
    const items = row.items.length > 0 ? row.items : (rules.templates.find((entry) => entry.model === row.model)?.items ?? []).map((item) => ({ ...item, count: item.count * row.models }));
    for (const item of items) {
      if ((item.count * n) % row.models !== 0) return null;
      out.set(item.id, (out.get(item.id) ?? 0) + (item.count * n) / row.models);
    }
  }
  return out;
}

/**
 * The base loadout of a unit with `rows` models per loadout row: the default resized by templates
 * ({@link mfmResizedDefault}) when it is legal, else the default scaled per model
 * ({@link mfmScaledDefault}) when that is, else the resized default with `legal` false. Null when
 * neither can be built.
 */
export function mfmBaseLoadout(rules: MfmLoadoutRules, rows: ReadonlyMap<string, number>): { counts: Map<string, number>; legal: boolean } | null {
  const resized = mfmResizedDefault(rules, rows);
  const scaled = mfmScaledDefault(rules, rows);
  for (const counts of [resized, scaled]) {
    if (counts && checkMfmLoadout(rules, rows, counts).length === 0) return { counts, legal: true };
  }
  const fallback = resized ?? scaled;
  return fallback ? { counts: fallback, legal: false } : null;
}

/** A unit's wargear check at a total model count. */
export type MfmUnitViolation = MfmLoadoutViolation | { code: "invalid-model-count"; message: string };

/**
 * Violations of a unit of `modelCount` models carrying `counts`, under its composition's loadout
 * split by {@link mfmRows}; null when the composition has no loadout.
 */
export function mfmUnitViolations(composition: MfmComposition, modelCount: number, counts: ReadonlyMap<string, number>): MfmUnitViolation[] | null {
  if (!composition.loadout) return null;
  const rows = mfmRows(composition, modelCount);
  if (!rows) return [{ code: "invalid-model-count", message: `no squad size of this unit has ${modelCount} models` }];
  return checkMfmLoadout(composition.loadout, rows, counts);
}

/** The base loadout of a unit of `modelCount` models ({@link mfmBaseLoadout}); null when it cannot be built. */
export function mfmUnitBaseLoadout(composition: MfmComposition, modelCount: number): { counts: Map<string, number>; legal: boolean } | null {
  const rows = composition.loadout && mfmRows(composition, modelCount);
  return rows ? mfmBaseLoadout(composition.loadout!, rows) : null;
}

/** Each item's fewest and most copies in a unit of `modelCount` models ({@link mfmWeaponBounds}). */
export function mfmUnitBounds(composition: MfmComposition, modelCount: number): Map<string, { min: number; max: number }> | null {
  const rows = composition.loadout && mfmRows(composition, modelCount);
  return rows ? mfmWeaponBounds(composition.loadout!, rows) : null;
}

/** How `counts` sit on a unit of `modelCount` models ({@link mfmAssignment}). */
export function mfmUnitAssignment(composition: MfmComposition, modelCount: number, counts: ReadonlyMap<string, number>): MfmConfiguration | null {
  const rows = composition.loadout && mfmRows(composition, modelCount);
  return rows ? mfmAssignment(composition.loadout!, rows, counts) : null;
}

/** The marker that ends a candidate list cut at its limit. */
export const MFM_CANDIDATES_TRUNCATED = "…truncated";

const itemList = (items: readonly MfmItem[]) => items.map((item) => `${item.id}:${item.count}`).join(",");

/**
 * A configuration as `<witness> => <counts>`: each group as `<row>×<models>[<items per model>]`
 * in search order, then the unit's own wargear as `unit[<items>]` when it has any, joined by
 * `; `; counts as ascending `id:count` pairs joined by `,`.
 */
export function encodeMfmConfiguration(configuration: MfmConfiguration): string {
  const groups = configuration.groups.map((group) => `${group.model}×${group.count}[${itemList(group.items)}]`);
  if (configuration.unit.length > 0) groups.push(`unit[${itemList(configuration.unit)}]`);
  const counts = [...configuration.counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, count]) => ({ id, count }));
  return `${groups.join("; ")} => ${itemList(counts)}`;
}

/**
 * The legal configurations of a unit of `modelCount` models, encoded by
 * {@link encodeMfmConfiguration} in search order, up to `limit`, then {@link MFM_CANDIDATES_TRUNCATED}
 * when more exist. Empty when the size cannot be built.
 */
export function mfmUnitCandidates(composition: MfmComposition, modelCount: number, limit: number): string[] {
  const rows = composition.loadout && mfmRows(composition, modelCount);
  if (!rows) return [];
  const { configurations, truncated } = mfmConfigurations(composition.loadout!, rows, limit);
  const out = configurations.map(encodeMfmConfiguration);
  if (truncated) out.push(MFM_CANDIDATES_TRUNCATED);
  return out;
}
