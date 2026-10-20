import { keywordMatchesPredicate } from "../scope.js";
import type { EngineContext, ScenarioObjective, UnitState } from "./buffs.js";

export type FilterVerdict = boolean | "unknown";

type Side = "attacker" | "target";

/** States the context lists per unit; the rest are fixed for a unit in an attack, or unknown. */
const LISTED_STATES: ReadonlySet<string> = new Set<UnitState>(["engaged", "battle-shocked", "hidden"]);

/**
 * Evaluate only facts present in the crunch; never infer model membership from keywords. `owner`
 * says whose the filter is relative to the filtered unit: the ability belongs to `side` when the
 * unit is friendly, and to the other side when it is an enemy.
 */
export function matchesUnitFilter(filter: unknown, context: EngineContext, side: Side, owner: "friendly" | "enemy" = "friendly"): FilterVerdict {
  if (!isObject(filter)) return "unknown";
  const abilitySide: Side = owner === "friendly" ? side : side === "attacker" ? "target" : "attacker";
  let unknown = false;
  const predicate: { all_of?: string[]; any_of?: string[]; none_of?: string[]; not_all_of?: string[] } = {};
  const memberSide = filter.member_of === "this-unit" ||
    (side === "attacker" ? filter.member_of === "attacker" : filter.member_of === "defender");
  const keywords = side === "attacker" ? context.attackerKeywords : context.targetKeywords;
  for (const key of ["all_of", "any_of", "none_of", "not_all_of"] as const) {
    const value = filter[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) return "unknown";
    predicate[key] = value;
  }
  if (filter.level === "model" && Object.keys(predicate).length > 0) unknown = true;
  if (Object.keys(predicate).length > 0) {
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
    } else if (key === "level" && value === "unit") {
      continue;
    } else if (key === "level" && value === "model" && filter.attachment_role !== undefined && memberSide) {
      // The selected unit's actual membership can identify its whole bodyguard/leader model pool.
      continue;
    } else if (key === "attachment_role" && filter.level === "model" && memberSide) {
      const role = side === "attacker" ? context.attackerAttachmentRole : context.targetAttachmentRole;
      if (role === undefined) unknown = true;
      else if (role !== value) return false;
    } else if (key === "member_of" && memberSide && filter.attachment_role !== undefined) {
      continue;
    } else {
      unknown = true;
    }
  }
  return unknown ? "unknown" : true;
}

/**
 * Whether one of the unit's objectives meets every property of an objective filter. Ownership and
 * territory are read from the ability's side.
 */
function withinObjective(filter: Record<string, unknown>, objectives: readonly ScenarioObjective[] | undefined, abilitySide: Side): FilterVerdict {
  if (objectives === undefined) return "unknown";
  const other: Side = abilitySide === "attacker" ? "target" : "attacker";
  const sideOf = (relative: unknown): Side | undefined => relative === "friendly" ? abilitySide : relative === "enemy" ? other : undefined;
  let unknown = false;
  for (const objective of objectives) {
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
      if (holds === false) {
        verdict = false;
        break;
      }
      if (holds === "unknown") verdict = "unknown";
    }
    if (verdict === true) return true;
    if (verdict === "unknown") unknown = true;
  }
  return unknown ? "unknown" : false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
