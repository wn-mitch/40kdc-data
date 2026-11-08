import { CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * A unit-state "embarked within <Transport>" that already holds the filter of the units it is
 * about (compile-unit-filters.ts sets `subject_filter`), in the same fragment as `filter`.
 */
export function embarkedStateBefore(previous: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  if (previous?.family_id !== "unit-state" || previous.fragment !== filter.fragment || previous.parameters.subject_filter === undefined) return false;
  const p = previous.parameters;
  return Array.isArray(p.states) && p.states.length === 1 && p.states[0] === "embarked" && p.with !== undefined;
}

/**
 * Whether the filter at `at` is the unit an embarked-within state names: the next leaf of its
 * fragment (past "from your army" owners) is a unit-state of the state embarked with a Transport,
 * about the filter before it. The subject reads `antecedent` before bindAntecedents and
 * `filtered-units` after it, and this runs on both sides of that, so it keys on the state and its
 * Transport, not the subject's spelling.
 */
export function claimedByEmbarkedState(list: readonly CompileLeaf[], at: number, fragment: string | undefined): boolean {
  let after = at + 1;
  while (list[after]?.family_id === "unit-owner" && list[after]!.fragment === fragment) after += 1;
  const state = list[after];
  if (state === undefined || state.family_id !== "unit-state" || state.fragment !== fragment) return false;
  const p = state.parameters;
  return Array.isArray(p.states) && p.states.length === 1 && p.states[0] === "embarked" && p.with !== undefined && (p.subject === "antecedent" || p.subject === "filtered-units");
}

const union = (left: unknown, right: unknown): string[] => [...new Set([...(Array.isArray(left) ? left as string[] : []), ...(Array.isArray(right) ? right as string[] : [])])].sort();

/**
 * "TORMENTORS units embarked within it (excluding Battle-shocked units)": the exclusion after the
 * state narrows the units the state is about, not the Transport. The state keeps its filter, with
 * the exclusion's keywords, abilities and negated states added. Anything else after the state
 * (a keyword to require, an ability, a state to hold, another side) has no DSL shape and is refused.
 */
export function foldEmbarkedExclusion(state: CompileLeaf, filter: CompileLeaf, dslFilter: Node): CompileLeaf {
  const subject = state.parameters.subject_filter as Node;
  const refuse = (): never => { throw new CompileError("A unit-filter after a named unit embarked within a Transport can only exclude (a side, states, or excluded_* keywords or abilities); anything else has no DSL shape."); };
  const p = filter.parameters;
  const allowed = new Set(["side", "states", "excluded_keywords", "excluded_all_keywords", "excluded_abilities"]);
  for (const [key, value] of Object.entries(p)) if (value !== undefined && !allowed.has(key)) refuse();
  if (p.side !== "any" && p.side !== subject.owner) refuse();
  // States are only the negations the filter spells as not-battle-shocked and unengaged; a held state is a positive requirement.
  if (Array.isArray(p.states) && p.states.some((item) => item !== "not-battle-shocked" && item !== "unengaged")) refuse();
  const none = union(subject.none_of, dslFilter.none_of);
  if (none.some((keyword) => Array.isArray(subject.all_of) && (subject.all_of as string[]).includes(keyword))) throw new CompileError("A unit-filter cannot both require and exclude the same keyword.");
  const notStates = union(subject.not_states, dslFilter.not_states);
  if (typeof subject.state === "string" && notStates.includes(subject.state)) throw new CompileError("A unit-filter cannot both hold and exclude the same state.");
  const lacks = union(subject.lacks_ability, dslFilter.lacks_ability);
  if (Array.isArray(subject.has_ability) && lacks.some((ability) => (subject.has_ability as string[]).includes(ability))) throw new CompileError("A unit-filter cannot both require and exclude the same ability.");
  if (subject.not_all_of !== undefined && dslFilter.not_all_of !== undefined && JSON.stringify(subject.not_all_of) !== JSON.stringify(dslFilter.not_all_of)) refuse();
  const narrowed: Node = {
    ...subject,
    ...(none.length ? { none_of: none } : {}),
    ...(notStates.length ? { not_states: notStates } : {}),
    ...(lacks.length ? { lacks_ability: lacks } : {}),
    ...(dslFilter.not_all_of !== undefined ? { not_all_of: dslFilter.not_all_of } : {}),
  };
  return { ...state, end_byte: filter.end_byte ?? state.end_byte, parameters: { ...state.parameters, subject_filter: narrowed } };
}
