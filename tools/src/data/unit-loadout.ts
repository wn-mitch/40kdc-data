/**
 * One unit's wargear legality at any model count, behind one interface: its MFM loadout rules
 * (unit-composition `loadout`) where the dump provides them, else the authored wargear options.
 * {@link Dataset.loadoutOf} hands these out; every in-repo consumer reads loadouts through it.
 *
 * Under MFM rules a unit's model count can split across its loadout rows more than one way when
 * its tiers allow it ({@link mfmRowSplits}). A loadout is legal when it is legal on any split.
 * Defaults, the maximal loadout and candidates use the bulk split ({@link mfmRows}).
 */
import type { Unit, WargearOption } from "../generated.js";
import {
  baseLoadout,
  checkUnitLegality,
  completeLoadout,
  groupLoadout,
  loadoutCandidates,
  maximalLoadout,
  weaponBounds,
  LOADOUT_CANDIDATES_DEFAULT_LIMIT,
  type CompletedLoadout,
  type LoadoutGroup,
  type LoadoutModel,
  type LoadoutTier,
  type Violation,
  type WeaponBound,
} from "./loadout.js";
import { checkMfmLoadout, defaultMfmLoadout, type MfmItem } from "./mfm-loadout.js";
import { mfmWeaponBounds } from "./mfm-loadout-bounds.js";
import { forEachMfmConfiguration, mfmAssignment, type MfmConfiguration } from "./mfm-loadout-search.js";
import { mfmBaseLoadout, mfmRows, mfmRowSplits, mfmUnitCandidates, type MfmComposition } from "./mfm-loadout-unit.js";

/** A unit's wargear legality at a model count. Counts are copies across the whole unit. */
export interface UnitLoadout {
  /** `mfm` when the unit's MFM loadout rules decide, `wargear-options` when its authored options do. */
  readonly source: "mfm" | "wargear-options";
  /**
   * The out-of-the-box loadout. Null when no squad size has `modelCount` models. Under MFM rules a
   * few dump defaults break their own rules; {@link check} reports those.
   */
  base(modelCount: number): Map<string, number> | null;
  /** Each item's fewest and most copies on any legal loadout; null when the size cannot be built. */
  bounds(modelCount: number): Map<string, WeaponBound> | null;
  /**
   * The legal loadout that adds the most copies over {@link base} (Σ max(0, count − base)); ties go
   * to the first in search order. Null when the size has no legal loadout.
   */
  maximal(modelCount: number): Map<string, number> | null;
  /** Violations of `counts` on a unit of `modelCount` models, by id then code; empty when legal. */
  check(modelCount: number, counts: ReadonlyMap<string, number>): Violation[];
  /** How `counts` sit on the models; null for one model, or when no legal assignment exists. */
  groups(modelCount: number, counts: ReadonlyMap<string, number>): LoadoutGroup[] | null;
  /**
   * A legal loadout holding at least `explicit`'s copies of each item and nothing beyond the
   * greater of `explicit` and the default: a sparse source list with its implied defaults filled
   * in. Null when no such loadout exists.
   */
  complete(modelCount: number, explicit: ReadonlyMap<string, number>): CompletedLoadout | null;
  /** Legal loadouts as encoded candidate strings, up to `limit`, then a truncation marker. */
  candidates(modelCount: number, limit?: number): string[];
}

interface Composition extends MfmComposition {
  models: readonly (LoadoutModel & { name: string; min: number; max: number })[];
  tiers?: readonly LoadoutTier[] & MfmComposition["tiers"];
}

/** The view for `unit` with its faction-scoped `composition` and `options`. */
export function unitLoadout(unit: Unit, composition: unknown, options: readonly WargearOption[]): UnitLoadout {
  const c = composition as Composition | undefined;
  return c?.loadout ? mfmView(unit, c) : optionsView(unit, c, options);
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sortViolations(violations: Violation[]): Violation[] {
  return violations.sort((a, b) => byCodeUnit(a.id, b.id) || byCodeUnit(a.code, b.code));
}

/** A row's model name: `name#k` names the k-th row called `name`. */
function modelName(row: string): string {
  const hash = row.lastIndexOf("#");
  return hash > 0 && /^[1-9][0-9]*$/.test(row.slice(hash + 1)) ? row.slice(0, hash) : row;
}

const weaponsOf = (items: readonly MfmItem[]) => items.map((item) => ({ id: item.id, count: item.count }));

/**
 * A configuration's models as loadout groups: rows in `rowOrder` ({@link mfmGroupRowOrder}), a
 * row's bundles most models first (ties in search order), bundles of one model name with the same
 * items merged into the first, and the unit's own wargear last as one unnamed group.
 */
/**
 * The order groups list a composition's loadout rows in: by the position of the row's model name
 * among the composition's models, then in stock order. A name the models lack sorts last.
 */
export function mfmGroupRowOrder(composition: MfmComposition): string[] {
  const names = composition.models.map((model) => model.name);
  const rank = (row: string) => {
    const at = names.indexOf(modelName(row));
    return at < 0 ? names.length : at;
  };
  return [...defaultMfmLoadout(composition.loadout!).models.keys()]
    .map((row, at) => ({ row, at }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.at - b.at)
    .map(({ row }) => row);
}

export function mfmGroups(configuration: MfmConfiguration, rowOrder: readonly string[]): LoadoutGroup[] {
  const rank = (row: string) => {
    const at = rowOrder.indexOf(row);
    return at < 0 ? rowOrder.length : at;
  };
  const bundles = configuration.groups
    .map((bundle, at) => ({ bundle, at }))
    .sort((a, b) => rank(a.bundle.model) - rank(b.bundle.model) || b.bundle.count - a.bundle.count || a.at - b.at);
  const out: LoadoutGroup[] = [];
  for (const { bundle } of bundles) {
    const name = modelName(bundle.model);
    const key = JSON.stringify(bundle.items);
    const same = out.find((group) => group.model_name === name && JSON.stringify(group.weapons) === key);
    if (same) same.count += bundle.count;
    else out.push({ model_name: name, count: bundle.count, weapons: weaponsOf(bundle.items) });
  }
  if (configuration.unit.length > 0) out.push({ model_name: null, count: 1, weapons: weaponsOf(configuration.unit) });
  return out;
}

function mfmView(unit: Unit, composition: Composition): UnitLoadout {
  const rules = composition.loadout!;
  const rowOrder = mfmGroupRowOrder(composition);
  const memo = <T>(compute: (modelCount: number) => T) => {
    const cache = new Map<number, T>();
    return (modelCount: number) => {
      if (!cache.has(modelCount)) cache.set(modelCount, compute(modelCount));
      return cache.get(modelCount)!;
    };
  };
  const splits = memo((modelCount) => mfmRowSplits(composition, modelCount));
  const baseAt = (rows: ReadonlyMap<string, number>) => mfmBaseLoadout(rules, rows)?.counts ?? null;
  const base = memo((modelCount) => {
    const rows = mfmRows(composition, modelCount);
    return rows ? baseAt(rows) : null;
  });
  // Bounds on any split: the widest range any split with a legal configuration gives each item. A
  // split that cannot carry an item gives it 0–0.
  const bounds = memo((modelCount) => {
    const found = splits(modelCount).map((rows) => mfmWeaponBounds(rules, rows)).filter((each) => each !== null);
    if (found.length === 0) return null;
    const ids = [...new Set(found.flatMap((each) => [...each.keys()]))].sort(byCodeUnit);
    return new Map(ids.map((id) => {
      const ranges = found.map((each) => each.get(id) ?? { min: 0, max: 0 });
      return [id, { min: Math.min(...ranges.map((range) => range.min)), max: Math.max(...ranges.map((range) => range.max)) }];
    }));
  });
  const legalOn = (modelCount: number, counts: ReadonlyMap<string, number>) =>
    splits(modelCount).find((rows) => checkMfmLoadout(rules, rows, counts).length === 0) ?? null;

  return {
    source: "mfm",
    base: (modelCount) => {
      const found = base(modelCount);
      return found && new Map(found);
    },
    bounds: (modelCount) => {
      const found = bounds(modelCount);
      return found && new Map([...found].map(([id, range]) => [id, { ...range }]));
    },
    maximal(modelCount) {
      const rows = mfmRows(composition, modelCount);
      const stock = rows && baseAt(rows);
      if (!rows) return null;
      let best: Map<string, number> | null = null;
      let most = -1;
      forEachMfmConfiguration(rules, rows, (configuration) => {
        let added = 0;
        for (const [id, n] of configuration.counts) added += Math.max(0, n - (stock?.get(id) ?? 0));
        if (added > most) {
          most = added;
          best = configuration.counts;
        }
      });
      return best;
    },
    check(modelCount, counts) {
      const all = splits(modelCount);
      if (all.length === 0) {
        return [{ id: unit.id, code: "invalid-model-count", message: `${unit.id}: no squad size has ${modelCount} models` }];
      }
      if (legalOn(modelCount, counts)) return [];
      const ranges = bounds(modelCount) ?? new Map<string, WeaponBound>();
      const out: Violation[] = [];
      for (const id of new Set([...counts.keys(), ...ranges.keys()])) {
        const n = counts.get(id) ?? 0;
        const { min, max } = ranges.get(id) ?? { min: 0, max: 0 };
        if (n > max) out.push({ id, code: "exceeds-max", message: `${unit.id}: ${n} × ${id} exceeds the most a legal loadout carries (${max})` });
        else if (n < min) out.push({ id, code: "below-min", message: `${unit.id}: ${n} × ${id} is below the fewest a legal loadout carries (${min})` });
      }
      if (out.length === 0) {
        out.push({ id: unit.id, code: "swap-conflict", message: `${unit.id}: no legal whole-model assignment carries exactly these counts` });
      }
      return sortViolations(out);
    },
    groups(modelCount, counts) {
      if (modelCount <= 1) return null;
      for (const rows of splits(modelCount)) {
        const found = mfmAssignment(rules, rows, counts);
        if (found) return mfmGroups(found, rowOrder);
      }
      return null;
    },
    complete(modelCount, explicit) {
      for (const rows of splits(modelCount)) {
        const ceiling = new Map(baseAt(rows) ?? []);
        for (const [id, n] of explicit) ceiling.set(id, Math.max(n, ceiling.get(id) ?? 0));
        let found: MfmConfiguration | null = null;
        forEachMfmConfiguration(rules, rows, (configuration) => {
          if (![...explicit].every(([id, n]) => (configuration.counts.get(id) ?? 0) >= n)) return false;
          found = configuration;
          return true;
        }, ceiling);
        if (found) {
          const { counts } = found as MfmConfiguration;
          return { counts: new Map(counts), groups: modelCount > 1 ? mfmGroups(found, rowOrder) : null };
        }
      }
      return null;
    },
    candidates: (modelCount, limit = LOADOUT_CANDIDATES_DEFAULT_LIMIT) =>
      mfmUnitCandidates(composition, modelCount, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : LOADOUT_CANDIDATES_DEFAULT_LIMIT),
  };
}

/** A unit the dump gives no loadout rules: its authored wargear options decide. */
function optionsView(unit: Unit, composition: Composition | undefined, options: readonly WargearOption[]): UnitLoadout {
  const models = composition?.models;
  const tiers = composition?.tiers;
  const sizes = (tiers?.length ? tiers.map((tier) => tier.models) : models ? [models] : []).map((rows) => ({
    min: rows.reduce((sum, row) => sum + (row.min ?? 0), 0),
    max: rows.reduce((sum, row) => sum + (row.max ?? 0), 0),
  }));
  // A unit without a composition has no recorded sizes; any count is taken as given.
  const buildable = (modelCount: number) => sizes.length === 0 || sizes.some((size) => modelCount >= size.min && modelCount <= size.max);
  return {
    source: "wargear-options",
    base: (modelCount) => (buildable(modelCount) ? baseLoadout(unit, modelCount, options, models).counts : null),
    bounds: (modelCount) => (buildable(modelCount) ? weaponBounds(unit, modelCount, options, models) : null),
    maximal: (modelCount) => (buildable(modelCount) ? maximalLoadout(unit, modelCount, options, models).counts : null),
    check: (modelCount, counts) => checkUnitLegality(unit, modelCount, options, new Map(counts), models, tiers),
    groups: (modelCount, counts) => groupLoadout(unit, modelCount, options, models, new Map(counts)),
    complete: (modelCount, explicit) => completeLoadout(unit, modelCount, options, models, new Map(explicit)),
    candidates: (modelCount, limit) => loadoutCandidates(unit, modelCount, options, models, tiers, limit),
  };
}
