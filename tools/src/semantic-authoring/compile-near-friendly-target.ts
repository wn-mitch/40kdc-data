import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** DSL unit-filter fields a Stratagem target's eligibility can carry beyond the keywords the target names. */
const CARRIED = new Set(["owner", "all_of", "any_of", "state", "not_states"]);

/**
 * "When an enemy unit ends a move within 8\" of a friendly K unit. That K unit.": the Stratagem's
 * target is the friendly K unit the distance names, not the enemy mover. The WHEN's distance leaf
 * (a unit-position of the moment's unit, measured to the unit-filter right after it) carries that
 * filter as `following_filter`; when its keywords are the target's own, the target is every unit
 * of the army that filter matches and is within the distance of the moment's unit. The enemy mover
 * is therefore never the target, so the `triggering-unit` binding the target would otherwise get
 * is dropped.
 *
 * The same holds for "if that unit is engaged with a friendly K unit": the target is every K unit of
 * the army engaged with the moment's unit.
 *
 * Returns the target restrictions as they are when the record has no such pair.
 */
export function bindNearFriendlyTarget(list: readonly CompileLeaf[], target: Node | Node[] | null): Node | Node[] | null {
  if (target === null || Array.isArray(target) || target.bound_to !== "triggering-unit") return target;
  const selector = list.find((leaf) => leaf.family_id === "triggering-target");
  if (selector === undefined) return target;
  const enemyMoves = list.some((leaf) => leaf.fragment === "WHEN" && ((leaf.family_id === "unit-filter" && leaf.parameters.side === "enemy")
    || (leaf.family_id === "event" && (leaf.parameters.owner === "enemy" || (leaf.parameters.subject_filter as Node | undefined)?.owner === "enemy"))));
  if (!enemyMoves) return target;
  const pairs = [nearPair(list), engagedPair(list)].filter((pair): pair is Pair => pair !== null);
  if (pairs.length !== 1) return target;
  const { filter, check } = pairs[0]!;
  const named = [...((selector.parameters.keywords as string[] | undefined) ?? [])].sort();
  const measured = [...((filter.all_of as string[] | undefined) ?? [])].sort();
  if (filter.owner !== "friendly" || named.length === 0 || JSON.stringify(named) !== JSON.stringify(measured)) return target;
  // "That Infantry/Mounted unit": the target's any-of keywords (already in its eligibility) must be the filter's own.
  const namedAny = [...((selector.parameters.any_keywords as string[] | undefined) ?? [])].sort();
  const measuredAny = [...((filter.any_of as string[] | undefined) ?? [])].sort();
  if (JSON.stringify(namedAny) !== JSON.stringify(measuredAny)) return target;
  if (Object.keys(filter).some((key) => !CARRIED.has(key))) return target;
  const { bound_to: _bound, eligibility, ...rest } = target;
  const states: Node[] = [
    ...(typeof filter.state === "string" ? [{ type: "matches", parameters: { filter: { state: filter.state } } }] : []),
    ...(filter.not_states !== undefined ? [{ type: "matches", parameters: { filter: { not_states: filter.not_states } } }] : []),
  ];
  const checks = [...(eligibility === undefined ? [] : [eligibility as Node]), ...states, check];
  const { count, ...others } = rest;
  return { count, side: "your-army", ...others, eligibility: checks.length === 1 ? checks[0]! : { operator: "and", operands: checks } };
}

type Pair = { filter: Node; check: Node };

/** "ends a move within 8\" of a friendly K unit": the K unit is within that distance of the moment's unit. */
function nearPair(list: readonly CompileLeaf[]): Pair | null {
  const pair = list.find((leaf) => leaf.family_id === "unit-position" && leaf.fragment === "WHEN" && leaf.parameters.subject === "event-subject"
    && leaf.parameters.of === "following-filter" && leaf.parameters.kind === "within" && leaf.parameters.negated !== true && leaf.parameters.wholly !== true
    && typeof leaf.parameters.inches === "number" && leaf.parameters.range_ref === undefined && leaf.parameters.following_filter !== undefined);
  if (pair === undefined) return null;
  return { filter: pair.parameters.following_filter as Node, check: { type: "matches", parameters: { filter: { within: { of: "event-subject", range: { inches: pair.parameters.inches } } } } } };
}

/**
 * "is selected to make a Fall Back move, if that unit is engaged with a friendly K unit": the K unit is
 * engaged with the moment's unit, or was at the start of the phase ("that was engaged with … ends a
 * Fall Back move").
 */
function engagedPair(list: readonly CompileLeaf[]): Pair | null {
  const pairs = list.filter((leaf) => leaf.family_id === "unit-state" && leaf.fragment === "WHEN" && leaf.parameters.subject === "event-subject"
    && leaf.parameters.with === "following-filter" && leaf.parameters.negated !== true && leaf.parameters.following_filter !== undefined
    && JSON.stringify(leaf.parameters.states) === JSON.stringify(["engaged"]));
  if (pairs.length !== 1) return null;
  const at = pairs[0]!.parameters.at;
  return {
    filter: pairs[0]!.parameters.following_filter as Node,
    check: { type: "unit-state", parameters: { state: "engaged", with: "event-subject", ...(typeof at === "string" ? { at } : {}) } },
  };
}
