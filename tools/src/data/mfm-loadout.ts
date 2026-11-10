/**
 * Checks a unit's wargear against its MFM `loadout` (unit-composition `loadout`), the structure GW's
 * own app validates against. A loadout is legal when its models can be assigned picks that produce
 * exactly the unit's item counts:
 *
 * - each model makes `picks` choices from every slot on its row, or from its row's alternate slots
 *   instead of all of them; a slot without a row is filled once for the unit;
 * - every limit holds on the copies of its row (or of the unit): the copies above the row's stock,
 *   or all copies when the limit lists the stock itself, must be the sum of at most the limit's
 *   cap of its choices, each taken at most `per_choice` times. A stock item listed alongside a
 *   non-stock item in a choice is the item that model keeps, and is not counted;
 * - in a uniform set, every model on the row (or in the unit) that takes no substitute carries the
 *   same main option;
 * - a row (or the unit's own wargear) whose every option for an item is a checkbox carries at most
 *   one copy per such option, or its stock copies when more: the app takes a checkbox once. A row
 *   the app shows per model (see {@link checkboxCaps}) gets that cap on each of its models.
 */

export interface MfmItem { id: string; count: number }
export interface MfmLoadoutRules {
  stock: { model?: string; models: number; items: MfmItem[] }[];
  templates: { model: string; items: MfmItem[] }[];
  slots: { model?: string; picks: number; repeats: boolean; alternate: boolean; choices: MfmItem[][] }[];
  limits: { model?: string; breakpoints: { models: number; choices: number; per_choice?: number }[]; choices: MfmItem[][] }[];
  uniform: { model?: string; choices: { items: MfmItem[]; substitute: boolean }[] }[];
  options: { model?: string; id: string; input: "checkbox" | "stepper"; default: number }[];
}

export interface MfmLoadoutViolation {
  code: "unknown-item" | "no-assignment" | "too-many-options";
  message: string;
}

/** Item copies keyed by id. */
export type Copies = Map<string, number>;

/** More bundles than this on one row is reported rather than searched. */
export const MAX_BUNDLES = 20_000;

export const add = (into: Copies, items: readonly MfmItem[], times = 1) => {
  for (const item of items) into.set(item.id, (into.get(item.id) ?? 0) + item.count * times);
};
export const copiesOf = (items: readonly MfmItem[], times = 1): Copies => {
  const out: Copies = new Map();
  add(out, items, times);
  return out;
};
export const contains = (bundle: Copies, items: readonly MfmItem[]) =>
  items.length > 0 && items.every((item) => (bundle.get(item.id) ?? 0) >= item.count);

/**
 * Every multiset of `picks` choices from `choices`. A choice repeats only when `repeats`, except the
 * empty choice ("take nothing"), which can fill any number of picks.
 */
export function pickCombinations(choices: readonly MfmItem[][], picks: number, repeats: boolean): MfmItem[][] {
  const out: MfmItem[][] = [];
  const hasEmpty = choices.some((choice) => choice.length === 0);
  const walk = (from: number, left: number, acc: MfmItem[]) => {
    if (left === 0) {
      out.push(acc);
      return;
    }
    for (let i = from; i < choices.length; i++) {
      walk(repeats || choices[i].length === 0 ? i : i + 1, left - 1, [...acc, ...choices[i]]);
    }
  };
  walk(0, repeats || hasEmpty ? picks : Math.min(picks, choices.length), []);
  return out;
}

/**
 * A slot's choices, with "take nothing" added when the slot is an add-on: none of its choices is
 * part of `stock`, the wargear its holder starts with. A slot holding a stock choice is a swap,
 * which the holder always fills.
 */
export function slotChoices(slot: MfmLoadoutRules["slots"][number], stock: Copies): MfmItem[][] {
  const swap = slot.choices.some((choice) => contains(stock, choice) || choice.length === 0);
  return swap ? slot.choices : [...slot.choices, []];
}

/**
 * The bundles one model of `model` can carry: one pick combination per slot, multiplied out,
 * dropping any partial bundle `fitsCopies` refuses (the checker refuses one holding more copies
 * than the unit has). A partial bundle only gains copies as slots are added, so `fitsCopies` must
 * refuse every bundle that grows from one it refuses. More than `maxBundles` gives null.
 */
export function rowBundles(
  rules: MfmLoadoutRules,
  model: string,
  fitsCopies: (bundle: Copies) => boolean,
  maxBundles = MAX_BUNDLES,
): Copies[] | null {
  const slots = rules.slots.filter((slot) => slot.model === model);
  const template = rules.templates.find((entry) => entry.model === model)?.items ?? [];
  if (slots.length === 0) return [copiesOf(template)];
  const stock = modelStock(rules, model);
  const fits = (bundle: MfmItem[]) => fitsCopies(copiesOf(bundle));
  const product = (group: typeof slots): Copies[] | null => {
    let bundles: MfmItem[][] = [[]];
    for (const slot of group) {
      const picks = pickCombinations(slotChoices(slot, stock), slot.picks, slot.repeats);
      bundles = bundles.flatMap((bundle) => picks.map((pick) => [...bundle, ...pick])).filter(fits);
      if (bundles.length > maxBundles) return null;
    }
    return bundles.map((bundle) => copiesOf(bundle));
  };
  const regular = slots.filter((slot) => !slot.alternate);
  const alternate = slots.filter((slot) => slot.alternate);
  const base = product(regular);
  const alt = alternate.length > 0 ? product(alternate) : [];
  if (base === null || alt === null) return null;
  const seen = new Set<string>();
  return [...base, ...alt].filter((bundle) => {
    const key = JSON.stringify([...bundle].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What one model of `model` starts with: its stock template, or its default copies over its model count. */
function modelStock(rules: MfmLoadoutRules, model: string): Copies {
  const out = copiesOf(rules.templates.find((entry) => entry.model === model)?.items ?? []);
  const row = rules.stock.find((entry) => entry.model === model);
  if (row && row.models > 0) for (const item of row.items) out.set(item.id, Math.max(out.get(item.id) ?? 0, Math.ceil(item.count / row.models)));
  return out;
}

/**
 * The default unit's model counts and item copies. A row with models but no default copies of its
 * own carries its stock template on each model; unit-level stock is counted once.
 */
export function defaultMfmLoadout(rules: MfmLoadoutRules): { models: Map<string, number>; counts: Map<string, number> } {
  const models = new Map<string, number>();
  const counts: Copies = new Map();
  for (const row of rules.stock) {
    if (row.model === undefined) {
      add(counts, row.items);
      continue;
    }
    models.set(row.model, row.models);
    // A row the default unit has no models of lists what a model brings when added, not stock.
    if (row.models === 0) continue;
    if (row.items.length > 0) add(counts, row.items);
    else add(counts, rules.templates.find((entry) => entry.model === row.model)?.items ?? [], row.models);
  }
  return { models, counts };
}

/**
 * The most copies of each item the app lets `model` (or the unit's own wargear, when undefined)
 * carry with `models` models on the row: items whose every option there is a checkbox, one copy per
 * checkbox, raised to the row's stock copies where the default already holds more. A row the
 * default unit has at most one model of and whose stock options are all checkboxes is shown per
 * model (Carnifexes), so its caps are per model.
 */
export function checkboxCaps(rules: MfmLoadoutRules, model: string | undefined, models = 1): Map<string, number> {
  const caps = new Map<string, number>();
  const steppers = new Set<string>();
  for (const option of rules.options) {
    if (option.model !== model) continue;
    if (option.input === "stepper") steppers.add(option.id);
    else caps.set(option.id, (caps.get(option.id) ?? 0) + 1);
  }
  for (const id of steppers) caps.delete(id);
  for (const row of rules.stock) {
    if (row.model !== model) continue;
    for (const item of row.items) if (caps.has(item.id)) caps.set(item.id, Math.max(caps.get(item.id)!, item.count));
  }
  if (model !== undefined && perModelRow(rules, model)) for (const [id, cap] of caps) caps.set(id, cap * models);
  return caps;
}

/** Whether the app shows `model`'s widgets once per model rather than once for the row. */
function perModelRow(rules: MfmLoadoutRules, model: string): boolean {
  const defaultModels = rules.stock.find((row) => row.model === model)?.models ?? 0;
  const stock = rules.options.filter((option) => option.model === model && option.default > 0);
  return defaultModels <= 1 && stock.length > 0 && stock.every((option) => option.input === "checkbox");
}

const withinCaps = (copies: (id: string) => number, caps: ReadonlyMap<string, number>) =>
  [...caps].every(([id, cap]) => copies(id) <= cap);

/** The unit's own picks: one pick combination per slot without a row, multiplied out. */
export function unitPicksOf(rules: MfmLoadoutRules): Copies[] {
  let unitPicks: Copies[] = [new Map()];
  const unitStock = copiesOf(rules.stock.filter((row) => row.model === undefined).flatMap((row) => row.items));
  for (const slot of rules.slots.filter((entry) => entry.model === undefined)) {
    const picks = pickCombinations(slotChoices(slot, unitStock), slot.picks, slot.repeats);
    unitPicks = unitPicks.flatMap((acc) => picks.map((pick) => {
      const next = new Map(acc);
      add(next, pick);
      return next;
    }));
  }
  return unitPicks;
}

/** A uniform set's main options: its choices that are not substitutes and carry an item. */
const uniformMains = (set: MfmLoadoutRules["uniform"][number]) =>
  set.choices.filter((choice) => !choice.substitute && choice.items.length > 0);

/** Every way to fix each uniform set's main option: one index per set into its main options. */
export function uniformAttempts(rules: MfmLoadoutRules): number[][] {
  let attempts: number[][] = [[]];
  for (const set of rules.uniform) {
    const mains = uniformMains(set);
    attempts = attempts.flatMap((attempt) => Array.from({ length: Math.max(1, mains.length) }, (_, k) => [...attempt, k]));
  }
  return attempts;
}

/**
 * Whether a model of `row` may carry `bundle` when each uniform set's main option is the one
 * `attempt` fixes: a model in a set's scope that takes another main option without a substitute
 * is excluded.
 */
export function uniformAllows(rules: MfmLoadoutRules, row: string, bundle: Copies, attempt: readonly number[]): boolean {
  return rules.uniform.every((set, s) => {
    if (set.model !== undefined && set.model !== row) return true;
    const mains = uniformMains(set);
    if (mains.length === 0) return true;
    if (set.choices.some((choice) => choice.substitute && contains(bundle, choice.items))) return true;
    return mains.every((main, k) => k === attempt[s] || !contains(bundle, main.items));
  });
}

/** The cap a limit's breakpoints give a unit of `models` models. */
export function limitCap(limit: MfmLoadoutRules["limits"][number], models: number): { cap: number; perChoice: number | undefined } {
  const row = [...limit.breakpoints].sort((a, b) => a.models - b.models).filter((point) => point.models <= models).pop();
  return { cap: row?.choices ?? 0, perChoice: row?.per_choice };
}

/**
 * A limit's test, fixed to a scope's stock baseline and a unit of `unitModels` models: given the
 * scope's copies of each of `ids` (in that order), whether they fit the limit, or with `atLeast`,
 * whether some allowed sum of its choices covers them instead, which holds for every partial count
 * a fitting count can grow from. The copies above the baseline, or all copies when the limit lists
 * the baseline itself as a choice, must be the sum of at most the cap of its choices.
 */
export function compileLimit(
  limit: MfmLoadoutRules["limits"][number],
  unitModels: number,
  baseline: Copies,
): { ids: string[]; holds: (copies: readonly number[], atLeast: boolean) => boolean } {
  const { cap, perChoice } = limitCap(limit, unitModels);
  const isStock = (id: string) => (baseline.get(id) ?? 0) > 0;
  const stockChoice = limit.choices.some((choice) =>
    choice.length > 0 && choice.every((item) => baseline.get(item.id) === item.count));
  const choices = limit.choices.map((choice) =>
    choice.some((item) => !isStock(item.id)) ? choice.filter((item) => !isStock(item.id)) : choice);
  const ids = [...new Set(limit.choices.flat().map((item) => item.id))];
  const over = ids.map((id) => (stockChoice ? 0 : baseline.get(id) ?? 0));
  const vectors = choices.map((choice) => ids.map((id) => choice.filter((item) => item.id === id).reduce((n, item) => n + item.count, 0)));
  const answers = new Map<string, boolean>();
  const holds = (copies: readonly number[], atLeast: boolean): boolean => {
    const target = ids.map((_, i) => Math.max(0, copies[i] - over[i]));
    const answerKey = `${atLeast ? 1 : 0}|${target.join(",")}`;
    const known = answers.get(answerKey);
    if (known !== undefined) return known;
    const memo = new Set<string>();
    const fits = (index: number, left: number, rest: number[]): boolean => {
      if (rest.every((n) => n <= 0)) return true;
      if (index >= vectors.length || left === 0) return false;
      const key = `${index}|${left}|${rest.join(",")}`;
      if (memo.has(key)) return false;
      const most = Math.min(left, perChoice ?? left);
      for (let use = most; use >= 0; use--) {
        const next = rest.map((n, i) => (atLeast ? Math.max(0, n - vectors[index][i] * use) : n - vectors[index][i] * use));
        if (next.some((n) => n < 0)) continue;
        if (fits(index + 1, left - use, next)) return true;
      }
      memo.add(key);
      return false;
    };
    const answer = fits(0, cap, target);
    answers.set(answerKey, answer);
    return answer;
  };
  return { ids, holds };
}

/** Whether `copies` of a limit's items fit it, given the scope's stock baseline (see {@link compileLimit}). */
export function limitHolds(
  limit: MfmLoadoutRules["limits"][number],
  unitModels: number,
  copies: Copies,
  baseline: Copies,
  atLeast = false,
): boolean {
  const { ids, holds } = compileLimit(limit, unitModels, baseline);
  return holds(ids.map((id) => copies.get(id) ?? 0), atLeast);
}

/**
 * Violations of `rules` by a unit with `models` models per row carrying `counts` item copies. An
 * empty result means some assignment of picks to models produces exactly `counts`.
 */
export function checkMfmLoadout(
  rules: MfmLoadoutRules,
  models: ReadonlyMap<string, number>,
  counts: ReadonlyMap<string, number>,
): MfmLoadoutViolation[] {
  const rows = [...models].filter(([, n]) => n > 0).map(([model]) => model).sort();
  const unitModels = [...models.values()].reduce((sum, n) => sum + n, 0);

  // The baseline a limit measures against: each row's stock template, once per model.
  const baselineOf = (model: string | undefined): Copies => {
    const out: Copies = new Map();
    for (const row of rows) {
      if (model !== undefined && row !== model) continue;
      add(out, rules.templates.find((entry) => entry.model === row)?.items ?? [], models.get(row) ?? 0);
    }
    return out;
  };

  const bundlesByRow = new Map<string, Copies[]>();
  for (const row of rows) {
    const bundles = rowBundles(rules, row, (bundle) => [...bundle].every(([id, n]) => n <= (counts.get(id) ?? 0)));
    if (bundles === null) return [{ code: "too-many-options", message: `${row}: more than ${MAX_BUNDLES} wargear combinations to search` }];
    bundlesByRow.set(row, bundles);
  }
  const unitCaps = checkboxCaps(rules, undefined);
  const rowCaps = new Map(rows.map((row) => [row, checkboxCaps(rules, row, models.get(row) ?? 0)]));
  const unitPicks = unitPicksOf(rules);

  const reachable = new Set<string>();
  for (const bundles of bundlesByRow.values()) for (const bundle of bundles) for (const [id, n] of bundle) if (n > 0) reachable.add(id);
  for (const picks of unitPicks) for (const [id, n] of picks) if (n > 0) reachable.add(id);
  // Items a model or the unit could carry at all, before bundles are pruned against the counts,
  // so a count no assignment fits is reported as that rather than as an item nobody can carry.
  const carriable = new Set<string>();
  const scoped = (model: string | undefined) => model === undefined || rows.includes(model);
  for (const slot of rules.slots) if (scoped(slot.model)) for (const choice of slot.choices) for (const item of choice) carriable.add(item.id);
  for (const entry of [...rules.templates, ...rules.stock]) if (scoped(entry.model)) for (const item of entry.items) carriable.add(item.id);
  const unknown = [...counts].filter(([id, n]) => n > 0 && !carriable.has(id)).map(([id]) => id).sort();
  if (unknown.length === 0 && [...counts].some(([id, n]) => n > 0 && !reachable.has(id))) {
    return [{ code: "no-assignment", message: "no assignment of wargear choices to models gives these counts" }];
  }
  if (unknown.length > 0) {
    return [{ code: "unknown-item", message: `no model of this unit can carry ${unknown.join(", ")}` }];
  }

  const ids = [...new Set([...counts.keys(), ...reachable])].sort();
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  const vector = (copies: Copies) => {
    const out = new Array<number>(ids.length).fill(0);
    for (const [id, n] of copies) out[indexOf.get(id)!] += n;
    return out;
  };

  const attempts = uniformAttempts(rules);

  const total = vector(new Map(counts));
  for (const attempt of attempts) {
    const allowed = new Map<string, number[][]>();
    for (const row of rows) {
      const bundles = bundlesByRow.get(row)!.filter((bundle) => uniformAllows(rules, row, bundle, attempt));
      allowed.set(row, bundles.map(vector));
    }
    for (const unitPick of unitPicks) {
      if (!withinCaps((id) => unitPick.get(id) ?? 0, unitCaps)) continue;
      const pick = vector(unitPick);
      const rest = total.map((n, i) => n - pick[i]);
      if (rest.some((n) => n < 0)) continue;
      // A unit-wide limit counts the unit's copies, which the counts fix.
      if (!rules.limits.every((limit) => limit.model !== undefined || limitHolds(limit, unitModels, new Map(counts), baselineOf(undefined)))) continue;
      const rowLimits = (row: string, totals: number[]) => withinCaps((id) => totals[indexOf.get(id)!] ?? 0, rowCaps.get(row)!) && rules.limits.every((limit) => {
        if (limit.model !== row) return true;
        const copies: Copies = new Map();
        totals.forEach((n, i) => { if (n > 0) copies.set(ids[i], n); });
        return limitHolds(limit, unitModels, copies, baselineOf(row));
      });
      if (assign(rows, allowed, models, rest, rowLimits)) return [];
    }
  }
  return [{ code: "no-assignment", message: "no assignment of wargear choices to models gives these counts within the unit's limits" }];
}

/**
 * Searches for per-row bundle counts that use every model and exactly `rest` copies, where each
 * row's own copies pass `rowAccepts`.
 */
function assign(
  rows: readonly string[],
  allowed: ReadonlyMap<string, number[][]>,
  models: ReadonlyMap<string, number>,
  rest: number[],
  rowAccepts: (row: string, totals: number[]) => boolean,
): boolean {
  // Failures depend only on the row, the copies left at the row's start and the search position
  // within it, so they are cached on those.
  const failed = new Set<string>();
  const walkRow = (r: number, left: number[]): boolean => {
    if (r === rows.length) return left.every((n) => n === 0);
    const row = rows[r];
    const bundles = allowed.get(row)!;
    const start = left;
    const startKey = start.join(",");
    const walkBundle = (b: number, modelsLeft: number, current: number[]): boolean => {
      if (modelsLeft === 0) {
        return rowAccepts(row, start.map((n, i) => n - current[i])) && walkRow(r + 1, current);
      }
      if (b >= bundles.length) return false;
      const key = `${r}|${startKey}|${b}|${modelsLeft}|${current.join(",")}`;
      if (failed.has(key)) return false;
      const bundle = bundles[b];
      let most = modelsLeft;
      for (let i = 0; i < bundle.length; i++) if (bundle[i] > 0) most = Math.min(most, Math.floor(current[i] / bundle[i]));
      for (let take = most; take >= 0; take--) {
        const next = take === 0 ? current : current.map((n, i) => n - bundle[i] * take);
        if (walkBundle(b + 1, modelsLeft - take, next)) return true;
      }
      failed.add(key);
      return false;
    };
    return walkBundle(0, models.get(row) ?? 0, left);
  };
  return walkRow(0, rest);
}
