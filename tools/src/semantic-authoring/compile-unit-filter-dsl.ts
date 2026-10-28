import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { matchedPoolOf } from "./compile-matched-set.js";
import { MATCHED_UNITS } from "./families/shared.js";
import { collapsedAlternatives, dslAlternatives } from "./compile-filter-alternatives.js";
import type { FilterAlternative } from "./unit-filter-alternatives.js";

/** A filter's negated states as the DSL's not_states: unengaged is not engaged. */
function notStates(states: readonly string[] | undefined): string[] {
  return [...(states?.includes("unengaged") ? ["engaged"] : []), ...(states?.includes("not-battle-shocked") ? ["battle-shocked"] : [])];
}

/** Where a held unit waits, as the DSL unit-state it is in. */
export const HELD_STATES: Record<string, string> = { "strategic-reserves": "in-strategic-reserves", "cult-ambush": "in-cult-ambush" };

/** The states a unit-filter holds as its one DSL `state` (unengaged and not-battle-shocked are negations). */
const POSITIVE_FILTER_STATES: readonly string[] = ["battle-shocked", "engaged", "hidden"];

const positiveFilterStates = (states: readonly string[] | undefined): string[] => (states ?? []).filter((state) => POSITIVE_FILTER_STATES.includes(state));

/**
 * A filter's positive state: the DSL carries one `state` per unit-filter, so a filter that holds two
 * (or a state and a held unit's Reserves state) is refused, as is engaged with unengaged. `held` is
 * the DSL unit-state of a held unit, if the filter names one.
 */
export function assertOneFilterState(states: readonly string[] | undefined, held: string | undefined): void {
  if (states?.includes("engaged") && states.includes("unengaged")) throw new CompileError("A unit-filter cannot be both engaged and unengaged.");
  const positive = positiveFilterStates(states);
  if (positive.length > 1) throw new CompileError(`A unit-filter holds one state; it cannot be both ${positive.join(" and ")}.`);
  if (positive.length === 1 && held !== undefined) {
    const named = positive[0] === "battle-shocked" ? "Battle-shocked" : positive[0];
    throw new CompileError(`A unit-filter holds one state; a held unit cannot also be ${named} here.`);
  }
}

/**
 * The who as the DSL's own unit-filter (a unit-ref "any unit that…"), for a trigger's subject or
 * an attack's target. Unengaged is not engaged (`not_states`); a held unit is in its Reserves state.
 */
// The Warlord designation needs an explicit army test, attack target or trigger participant.
// Other folds still refuse it rather than silently losing a mustering restriction.
export function dslUnitFilter(filter: CompileLeaf, options: { warlordTest?: boolean; warlordTarget?: boolean } = {}): Record<string, unknown> {
  // "one of those X units": the matched set, which bindMatchedPools attached (compile-matched-set.ts).
  if (filter.parameters.among === MATCHED_UNITS) return matchedPoolOf(filter);
  const p = filter.parameters as { side: string; keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; states?: string[]; other?: boolean; other_than?: string; visible?: boolean; held_in?: string; alternatives?: FilterAlternative[]; designated?: string; not_designated?: string; designated_by?: string; member_of?: string; nested_engaged_with?: Record<string, unknown> };
  if (p.designated === "warlord" && options.warlordTest !== true && options.warlordTarget !== true) throw new CompileError("A unit-filter naming the Warlord needs an army test or explicit event participant.");
  const held = p.held_in === undefined ? undefined : HELD_STATES[p.held_in];
  if (p.held_in !== undefined && held === undefined) throw new CompileError(`A unit held in ${p.held_in} has no DSL unit-state.`);
  assertOneFilterState(p.states, held);
  if (p.any_keywords?.length && p.alternatives?.length) throw new CompileError("A unit-filter holds one any-of; it cannot also hold alternatives.");
  if (filter.parameters.attachment_role !== undefined && (filter.parameters.level !== "model" || p.member_of === undefined)) {
    throw new CompileError("An attachment-role filter needs model level and a bound member_of unit.");
  }
  return {
    owner: p.side,
    ...(Array.isArray(filter.parameters.unit_ids) ? { level: "unit", unit_ids: filter.parameters.unit_ids } : {}),
    ...(p.keywords?.length ? { all_of: p.keywords } : {}),
    ...(p.any_keywords?.length ? { any_of: p.any_keywords } : {}),
    // "A or B C unit": any one alternative, each with its own keywords, exclusions and states.
    ...dslAlternatives(p.alternatives),
    ...(p.excluded_keywords?.length ? { none_of: p.excluded_keywords } : {}),
    ...(positiveFilterStates(p.states).length === 1 ? { state: positiveFilterStates(p.states)[0] } : {}),
    ...(held !== undefined ? { state: held } : {}),
    ...(notStates(p.states).length ? { not_states: notStates(p.states) } : {}),
    ...(Array.isArray(filter.parameters.excluded_all_keywords) ? { not_all_of: filter.parameters.excluded_all_keywords } : {}),
    ...(p.visible === true ? { visible: { to: "this-model" } } : {}),
    // "engaged with an enemy unit engaged with a friendly CHARACTER unit": the unit this one is engaged with (nestedEngagedChain).
    ...(p.nested_engaged_with !== undefined ? { engaged_with: p.nested_engaged_with } : {}),
    ...(p.other === true ? { excluding: p.other_than === "event-subject" ? "event-subject" : "this-unit" } : {}),
    ...(filter.parameters.level === "model" ? { level: "model" } : {}),
    // "Character models in this unit" (groupMembership): the unit the models belong to.
    ...(p.member_of !== undefined ? { member_of: p.member_of } : {}),
    ...(filter.parameters.attachment_role !== undefined ? { attachment_role: filter.parameters.attachment_role } : {}),
    // Attached Leader membership is not possession of the Leader ability.
    ...(filter.parameters.attached_to !== undefined ? attachedLeaders(filter) : {}),
    // "units embarked within this unit" (unit-filter@13): the Transport the units are embarked within.
    ...(filter.parameters.embarked_in !== undefined ? { embarked_in: filter.parameters.embarked_in } : {}),
    // "Bondsman-affected units" (unit-filter@8): the designation, and the unit that applied it.
    ...(p.designated !== undefined ? { designated: p.designated } : {}),
    ...(p.not_designated !== undefined ? { not_designated: p.not_designated } : {}),
    ...(p.designated_by !== undefined ? { designated_by: p.designated_by } : {}),
    // "units with this ability" (compile-holder-abilities.ts) and "(excluding units with X)".
    ...(Array.isArray(filter.parameters.abilities) ? { has_ability: filter.parameters.abilities } : {}),
    ...(Array.isArray(filter.parameters.excluded_abilities) ? { lacks_ability: filter.parameters.excluded_abilities } : {}),
    // A list-building group's datasheets (unit-filter@6): only army construction takes them (compile-army.ts).
    ...(Array.isArray(filter.parameters.datasheets) ? { datasheets: filter.parameters.datasheets } : {}),
  };
}

/** Actual Leader models attached to the named unit, not units merely capable of leading. */
function attachedLeaders(filter: CompileLeaf): Record<string, unknown> {
  if (filter.parameters.member_of !== undefined || Array.isArray(filter.parameters.abilities)) {
    throw new CompileError("A unit-filter for attached Leaders takes no other membership or ability test.");
  }
  return { level: "model", member_of: filter.parameters.attached_to, attachment_role: "leader" };
}

/**
 * The filter's keyword fields, as the folded leaf carries them. Selections, auras and Stratagem
 * targets carry them into their own eligibility (compile-wrappers.ts, compile-conditions.ts); a
 * held unit ("that is in Reserves") is one more state there, its DSL Reserves unit-state.
 */
export function filterOf(filter: CompileLeaf, staticTarget = false): Record<string, unknown> {
  // A matched set is read by its pool: a selection takes the pool's keywords and exclusions, and its range is the select's distance.
  if (filter.parameters.among === MATCHED_UNITS) {
    const pool = matchedPoolOf(filter);
    return { keywords: pool.all_of, ...(pool.none_of !== undefined ? { excluded_keywords: pool.none_of } : {}) };
  }
  // Alternatives that are each one keyword are the any-of the eligibility checks already read.
  const { side: _side, visible: _visible, level: _level, held_in: heldIn, ...rest } = collapsedAlternatives(filter.parameters);
  // Core Stratagem TARGET metadata is static and intentionally retains its narrower contract.
  if (staticTarget && ["designated", "not_designated", "member_of", "attached_to", "embarked_in", "attachment_role"].some((key) => rest[key] !== undefined)) {
    throw new CompileError("This unit-filter relation has no static Stratagem TARGET metadata field.");
  }
  if (heldIn === undefined) return rest;
  const held = HELD_STATES[String(heldIn)];
  if (held === undefined) throw new CompileError(`A unit held in ${String(heldIn)} has no DSL unit-state.`);
  return { ...rest, states: [...((rest.states as string[] | undefined) ?? []), held] };
}
