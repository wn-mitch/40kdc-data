/**
 * Lever selection for one stack as a local search over legal lever sets.
 *
 * A move adds a lever (with the levers it requires and, when needed, a cap-raising provider),
 * removes one (with the levers that require it), or swaps a selected lever for an unselected
 * one. Swaps reach what additions cannot: another option of an exclusive choice, or a second
 * Stratagem when only one may be used. The search takes the first improving move and repeats
 * until no move improves the total.
 */

/** The parts of a pool lever the search reads. */
export interface SearchLever {
  id: string;
  enabled?: boolean;
  requiresLever?: string;
  requiresOption?: string;
  raisesCap?: unknown;
}

/** The levers `lever` needs on: its provider and the stance option it applies under. */
function requirementsOf(levers: readonly SearchLever[], id: string): string[] {
  const lever = levers.find((candidate) => candidate.id === id);
  return [lever?.requiresLever, lever?.requiresOption].filter((required): required is string => required !== undefined);
}

/** A stack's lever choices: which sets are legal and what each scores. */
export interface LeverSpace<Result extends { total: number }> {
  levers: readonly SearchLever[];
  legal(selected: readonly string[]): boolean;
  score(selected: readonly string[]): Result;
}

const EPSILON = 1e-9;
/** A guard against a non-terminating search; each accepted move strictly raises the total. */
const MAX_MOVES = 256;

function withRequirements(levers: readonly SearchLever[], ids: readonly string[]): string[] {
  const output = [...ids];
  for (let index = 0; index < output.length; index++) {
    for (const required of requirementsOf(levers, output[index])) {
      if (!output.includes(required)) output.push(required);
    }
  }
  return output;
}

/** `selected` plus `added` and its requirements, adding cap-raising providers if that alone is illegal. */
export function selectionWith<Result extends { total: number }>(
  space: LeverSpace<Result>,
  selected: readonly string[],
  added: SearchLever,
): string[] | null {
  const base = withRequirements(space.levers, [...selected, added.id]);
  if (space.legal(base)) return base;
  const providers = space.levers.filter((lever) => lever.raisesCap !== undefined && !base.includes(lever.id));
  const choose = (offset: number, additions: string[]): string[] | null => {
    const candidate = withRequirements(space.levers, [...base, ...additions]);
    if (space.legal(candidate)) return candidate;
    for (let index = offset; index < providers.length; index++) {
      const found = choose(index + 1, [...additions, providers[index].id]);
      if (found) return found;
    }
    return null;
  };
  return choose(0, []);
}

/** `selected` without `removed` and every lever that requires it, directly or transitively. */
function selectionWithout(levers: readonly SearchLever[], selected: readonly string[], removed: string): string[] {
  const dropped = new Set([removed]);
  for (let changed = true; changed;) {
    changed = false;
    for (const id of selected) {
      if (!dropped.has(id) && requirementsOf(levers, id).some((required) => dropped.has(required))) {
        dropped.add(id);
        changed = true;
      }
    }
  }
  return selected.filter((id) => !dropped.has(id));
}

/**
 * Candidate selections one move from `selected`: additions, then removals, then swaps. A swap
 * targets only a lever that cannot be added as things stand; an addable one is reached by an
 * addition followed by a removal.
 */
function* moves<Result extends { total: number }>(space: LeverSpace<Result>, selected: readonly string[]): Generator<string[]> {
  const blocked: SearchLever[] = [];
  for (const lever of space.levers) {
    if (selected.includes(lever.id)) continue;
    const candidate = selectionWith(space, selected, lever);
    if (candidate) yield candidate;
    else blocked.push(lever);
  }
  for (const id of selected) {
    const reduced = selectionWithout(space.levers, selected, id);
    if (space.legal(reduced)) yield reduced;
    for (const lever of blocked) {
      const candidate = selectionWith(space, reduced, lever);
      if (candidate) yield candidate;
    }
  }
}

/** The best lever set the local search reaches, starting from the enabled levers when they are legal. */
export function searchLevers<Result extends { total: number }>(space: LeverSpace<Result>): Result {
  let selected = space.levers.filter((lever) => lever.enabled).map((lever) => lever.id);
  if (!space.legal(selected)) selected = [];
  let best = space.score(selected);
  for (let accepted = 0; accepted < MAX_MOVES; accepted++) {
    let improved = false;
    for (const candidate of moves(space, selected)) {
      const result = space.score(candidate);
      if (result.total > best.total + EPSILON) {
        selected = candidate;
        best = result;
        improved = true;
        break;
      }
    }
    if (!improved) return best;
  }
  throw new Error(`lever search: no fixed point after ${MAX_MOVES} improving moves`);
}
