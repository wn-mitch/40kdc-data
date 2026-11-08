/**
 * Bounded exhaustive oracles for the lever and loadout searches: every legal lever set and every
 * legal option plan, scored, for spaces small enough to enumerate. They exist to check the local
 * searches, not to replace them in the matrix.
 */
import type { LeverSpace } from "./lever-search.js";
import { countsFromPlan, optionSettings, type LoadoutSpace, type OptionPlan } from "./loadout-search.js";

/** The highest-scoring legal lever set; ties keep the first set in subset order. */
export function exhaustiveLevers<Result extends { total: number }>(space: LeverSpace<Result>, maxLevers = 16): Result {
  const ids = space.levers.map((lever) => lever.id);
  if (ids.length > maxLevers) throw new Error(`exhaustive levers: ${ids.length} levers exceeds the bound of ${maxLevers}`);
  let best: Result | null = null;
  for (let mask = 0; mask < 2 ** ids.length; mask++) {
    const selected = ids.filter((_, index) => (mask >> index) & 1);
    if (!space.legal(selected)) continue;
    const result = space.score(selected);
    if (!best || result.total > best.total) best = result;
  }
  if (!best) throw new Error("exhaustive levers: no legal lever set");
  return best;
}

/** The highest-scoring legal option plan; ties keep the first plan in enumeration order. */
export function exhaustiveLoadout<Result extends { total: number }>(space: LoadoutSpace<Result>, maxPlans = 100_000): Result {
  const settings = space.scaffold.options.map((_, index) => optionSettings(space.scaffold, index));
  const size = settings.reduce((product, choices) => product * choices.length, 1);
  if (size > maxPlans) throw new Error(`exhaustive loadout: ${size} plans exceeds the bound of ${maxPlans}`);
  let best: Result | null = null;
  const visit = (index: number, plan: OptionPlan[]) => {
    if (index === settings.length) {
      const counts = countsFromPlan(space.scaffold.base, space.scaffold.options, plan);
      if (!counts || !space.legal(counts)) return;
      const result = space.score(counts);
      if (!best || result.total > best.total) best = result;
      return;
    }
    for (const setting of settings[index]) visit(index + 1, [...plan, setting]);
  };
  visit(0, []);
  if (!best) throw new Error("exhaustive loadout: no legal plan");
  return best;
}
