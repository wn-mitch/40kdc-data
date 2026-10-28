import { keywordMatchesPredicate } from "../scope.js";
import type { EngineContext, ScenarioNeighbour, ScenarioObjective, UnitState } from "./buffs.js";

export type FilterVerdict = boolean | "unknown";

type Side = "attacker" | "target";

/** States the context lists per unit; the rest are fixed for a unit in an attack, or unknown. */
const LISTED_STATES: ReadonlySet<string> = new Set<UnitState>(["engaged", "battle-shocked", "hidden"]);

type KeywordPredicate = { all_of?: string[]; any_of?: string[]; none_of?: string[]; not_all_of?: string[] };

/**
 * Evaluate only facts present in the crunch; never infer model membership from keywords. A
 * model-level keyword predicate holds when every model of the unit meets it and fails when none
 * can: each model carries at least the context's model keywords and at most the unit's keywords.
 * `owner`
 * says whose the filter is relative to the filtered unit: the ability belongs to `side` when the
 * unit is friendly, and to the other side when it is an enemy.
 */
export function matchesUnitFilter(filter: unknown, context: EngineContext, side: Side, owner: "friendly" | "enemy" = "friendly"): FilterVerdict {
  if (!isObject(filter)) return "unknown";
  const abilitySide: Side = owner === "friendly" ? side : side === "attacker" ? "target" : "attacker";
  let unknown = false;
  const predicate: KeywordPredicate = {};
  const memberSide = filter.member_of === "this-unit" ||
    (side === "attacker" ? filter.member_of === "attacker" : filter.member_of === "defender");
  const keywords = side === "attacker" ? context.attackerKeywords : context.targetKeywords;
  for (const key of ["all_of", "any_of", "none_of", "not_all_of"] as const) {
    const value = filter[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) return "unknown";
    predicate[key] = value;
  }
  const modelPredicate = filter.level === "model" && Object.keys(predicate).length > 0;
  let everyModelMatches = false;
  if (modelPredicate) {
    const verdict = modelKeywordVerdict(predicate, side === "attacker" ? context.attackerModelKeywords : context.targetModelKeywords, keywords);
    if (verdict === false) return false;
    if (verdict === "unknown") unknown = true;
    everyModelMatches = verdict === true;
  } else if (Object.keys(predicate).length > 0) {
    if (keywords === undefined) unknown = true;
    else if (!keywordMatchesPredicate(predicate, keywords)) return false;
  }
  for (const [key, value] of Object.entries(filter)) {
    if (key in predicate) continue;
    if (key === "owner") {
      if (value !== "any" && value !== owner) return false;
    } else if (key === "unit_ids") {
      if (filter.level !== "unit" || !Array.isArray(value) || value.length === 0 || !value.every((id) => typeof id === "string")) return "unknown";
      const id = side === "attacker" ? context.attackerUnitId : context.targetUnitId;
      if (id === undefined) unknown = true;
      else if (!value.includes(id)) return false;
    } else if (key === "any_of_filters") {
      if (!Array.isArray(value) || value.length === 0) return "unknown";
      const results = value.map((item) => matchesUnitFilter(item, context, side, owner));
      if (!results.includes(true)) {
        if (!results.includes("unknown")) return false;
        unknown = true;
      }
    } else if (key === "state" && value === "benefit-of-cover") {
      const covered = side === "attacker" ? context.attackerInCover : context.targetInCover;
      if (covered === false) return false;
      if (covered === undefined) unknown = true;
    } else if (key === "state" && value === "on-battlefield") {
      continue;
    } else if (key === "state" && (value === "in-strategic-reserves" || value === "in-cult-ambush")) {
      return false;
    } else if (key === "state" && typeof value === "string" && LISTED_STATES.has(value)) {
      const states = side === "attacker" ? context.attackerStates : context.targetStates;
      if (states === undefined) unknown = true;
      else if (!states.includes(value as UnitState)) return false;
    } else if (key === "designated" && typeof value === "string") {
      const designations = side === "attacker" ? context.attackerDesignations : context.targetDesignations;
      if (designations === undefined) unknown = true;
      else if (!designations.some((designation) => designation.toLowerCase() === value.toLowerCase())) return false;
    } else if (key === "within" && isObject(value) && value.wholly !== true && isObject(value.of) && isObject(value.of.objective)) {
      const verdict = value.range === "objective-control"
        ? withinObjective(value.of.objective, side === "attacker" ? context.attackerObjectives : context.targetObjectives, abilitySide)
        : "unknown";
      if (verdict === false) return false;
      if (verdict === "unknown") unknown = true;
    } else if (key === "within" && isObject(value) && value.wholly !== true &&
      ((side === "attacker" && value.of === "defender") || (side === "target" && value.of === "attacker") ||
        ((value.of === "this-unit" || value.of === "ability-unit") && abilitySide !== side))) {
      if (value.range === "half-weapon") {
        if (context.withinHalfRange === false) return false;
        if (context.withinHalfRange === undefined) unknown = true;
        continue;
      }
      let range = value.range;
      if (isObject(range) && Array.isArray(range.per_battle_round) && context.battleRound !== undefined) {
        range = range.per_battle_round[Math.min(Math.max(context.battleRound - 1, 0), range.per_battle_round.length - 1)];
      }
      if (!isObject(range) || typeof range.inches !== "number" || context.distanceInches === undefined) unknown = true;
      else if (context.distanceInches > range.inches) return false;
    } else if (key === "within" && isObject(value) && value.wholly !== true && isObject(value.of) && isNeighbourFilter(value.of)) {
      const verdict = isObject(value.range) && typeof value.range.inches === "number" && Object.keys(value.range).length === 1
        ? withinNeighbour(value.of, value.range.inches, side === "attacker" ? context.attackerNeighbours : context.targetNeighbours, side === abilitySide)
        : "unknown";
      if (verdict === false) return false;
      if (verdict === "unknown") unknown = true;
    } else if (key === "level" && value === "unit") {
      continue;
    } else if (key === "level" && value === "model" && everyModelMatches && filter.attachment_role === undefined) {
      // Every model of the unit meets the keyword predicate, so the filter selects the whole unit.
      continue;
    } else if (key === "level" && value === "model" && filter.attachment_role !== undefined && memberSide) {
      // The selected unit's actual membership can identify its whole bodyguard/leader model pool.
      continue;
    } else if (key === "attachment_role" && filter.level === "model" && memberSide) {
      const role = side === "attacker" ? context.attackerAttachmentRole : context.targetAttachmentRole;
      if (role === undefined) unknown = true;
      else if (role !== value) return false;
    } else if (key === "member_of" && memberSide && (filter.attachment_role !== undefined || (filter.level === "model" && everyModelMatches))) {
      // The unit is a member of the combined unit, and its role or its every model's keywords
      // place it among the selected models.
      continue;
    } else {
      unknown = true;
    }
  }
  return unknown ? "unknown" : true;
}

/**
 * A keyword predicate over a unit's models: true when every model meets it, false when no model
 * can, else unknown. Every model carries `every` and no model carries more than `any`. Clauses that
 * need more keywords (all_of, any_of) are settled for every model by `every` and for none by `any`;
 * clauses that need fewer (none_of, not_all_of) the other way round.
 */
function modelKeywordVerdict(predicate: KeywordPredicate, every: readonly string[] | undefined, any: readonly string[] | undefined): FilterVerdict {
  let allModels = true;
  for (const key of ["all_of", "any_of", "none_of", "not_all_of"] as const) {
    const value = predicate[key];
    if (value === undefined) continue;
    const clause = { [key]: value };
    const [least, most] = key === "all_of" || key === "any_of" ? [every, any] : [any, every];
    if (most !== undefined && !keywordMatchesPredicate(clause, most)) return false;
    if (least === undefined || !keywordMatchesPredicate(clause, least)) allModels = false;
  }
  return allModels ? true : "unknown";
}

/**
 * Whether one of the unit's objectives meets every property of an objective filter. Ownership and
 * territory are read from the ability's side.
 */
function withinObjective(filter: Record<string, unknown>, objectives: readonly ScenarioObjective[] | undefined, abilitySide: Side): FilterVerdict {
  if (objectives === undefined) return "unknown";
  let unknown = false;
  for (const objective of objectives) {
    const verdict = objectiveMatches(filter, objective, abilitySide);
    if (verdict === true) return true;
    if (verdict === "unknown") unknown = true;
  }
  return unknown ? "unknown" : false;
}

/**
 * Whether one objective meets every property of an objective filter, read from the ability's side.
 * A property the objective leaves out, or the filter states in a form the scenario cannot settle,
 * is unknown.
 */
export function objectiveMatches(filter: Record<string, unknown>, objective: ScenarioObjective, abilitySide: Side): FilterVerdict {
  const other: Side = abilitySide === "attacker" ? "target" : "attacker";
  const sideOf = (relative: unknown): Side | undefined => relative === "friendly" ? abilitySide : relative === "enemy" ? other : undefined;
  let verdict: FilterVerdict = true;
  for (const [key, wanted] of Object.entries(filter)) {
    let holds: FilterVerdict;
    if (key === "controlled_by") {
      holds = objective.controller === undefined ? "unknown"
        : wanted === "any" ? objective.controller !== "none"
        : sideOf(wanted) === undefined ? "unknown" : objective.controller === sideOf(wanted);
    } else if (key === "designated" && typeof wanted === "string") {
      holds = objective.designations === undefined ? "unknown"
        : objective.designations.some((designation) => designation.toLowerCase() === wanted.toLowerCase());
    } else if (key === "role") {
      holds = objective.role === undefined ? "unknown" : objective.role === wanted;
    } else if (key === "home_of") {
      holds = objective.homeOf === undefined || sideOf(wanted) === undefined ? "unknown" : objective.homeOf === sideOf(wanted);
    } else if (key === "territory") {
      const territory = wanted === "your-territory" ? abilitySide : wanted === "enemy-territory" ? other : wanted === "no-mans-land" ? "no-mans-land" : undefined;
      holds = objective.territory === undefined || territory === undefined ? "unknown" : objective.territory === territory;
    } else if (key === "name") {
      holds = objective.name === undefined ? "unknown" : objective.name === wanted;
    } else {
      holds = "unknown";
    }
    if (holds === false) return false;
    if (holds === "unknown") verdict = "unknown";
  }
  return verdict;
}

/** A `within.of` that names other units by keyword and owner. */
function isNeighbourFilter(of: Record<string, unknown>): boolean {
  return Object.keys(of).length > 0 && Object.entries(of).every(([key, value]) =>
    key === "owner" ? value === "friendly" || value === "enemy" || value === "any"
      : (key === "all_of" || key === "any_of" || key === "none_of" || key === "not_all_of") &&
        Array.isArray(value) && value.every((item) => typeof item === "string"));
}

/**
 * Whether a unit near the filtered unit meets a `within.of` filter within `inches`. The filter's
 * owner is relative to the ability's side; a neighbour's owner is relative to the filtered unit, so
 * they agree only when the ability belongs to the filtered unit's side.
 */
function withinNeighbour(of: Record<string, unknown>, inches: number, neighbours: readonly ScenarioNeighbour[] | undefined, sameSide: boolean): FilterVerdict {
  if (neighbours === undefined) return "unknown";
  const predicate: KeywordPredicate = {};
  for (const key of ["all_of", "any_of", "none_of", "not_all_of"] as const) if (of[key] !== undefined) predicate[key] = of[key] as string[];
  return neighbours.some((neighbour) => {
    const owner = sameSide ? neighbour.owner : neighbour.owner === "friendly" ? "enemy" : "friendly";
    if (of.owner !== undefined && of.owner !== "any" && of.owner !== owner) return false;
    return neighbour.distanceInches <= inches && keywordMatchesPredicate(predicate, neighbour.keywords);
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
