/**
 * Condition evaluators that read declared scenario state: which rules are active, which regions a
 * unit is in, how many objectives each side controls, and which units make up a combined unit.
 * Each returns "unknown" when the context does not declare the fact it needs.
 */
import { keywordMatchesPredicate } from "../scope.js";
import type { AttachedMember, EngineContext, ScenarioRegion } from "./buffs.js";

type Side = "attacker" | "target";
type Verdict = boolean | "unknown";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function other(side: Side): Side {
  return side === "attacker" ? "target" : "attacker";
}

/**
 * `rule-active`: a rule id is active when it, or one of its options or definitions, is listed; an
 * option or definition reference needs that exact entry.
 */
export function evaluateRuleActive(params: Record<string, unknown>, ctx: EngineContext): Verdict {
  const rule = params.rule;
  if (ctx.activeRules === undefined) return "unknown";
  if (typeof rule === "string") {
    return ctx.activeRules.some((entry) => typeof entry === "string" ? entry === rule : entry.ability_id === rule);
  }
  if (!isObject(rule) || typeof rule.ability_id !== "string") return "unknown";
  const key = typeof rule.option_id === "string" ? "option_id" : typeof rule.definition_id === "string" ? "definition_id" : undefined;
  if (key === undefined) return "unknown";
  return ctx.activeRules.some((entry) => typeof entry !== "string" && entry.ability_id === rule.ability_id && entry[key] === rule[key]);
}

/**
 * `in-region` for the unit on `side`. Territory and deployment zones are read from the ability's
 * side (`abilitySide`). "Wholly" and "every model" need an entry that declares the unit wholly in it.
 */
export function evaluateInRegion(params: Record<string, unknown>, ctx: EngineContext, side: Side, abilitySide: Side): Verdict {
  const regions = side === "attacker" ? ctx.attackerRegions : ctx.targetRegions;
  const region = params.region;
  if (regions === undefined || !isObject(region)) return "unknown";
  if (params.models !== undefined && params.models !== "any" && params.models !== "every") return "unknown";
  const wholly = params.wholly === true || params.models === "every";
  const matches = regionMatcher(region, abilitySide);
  if (matches === undefined) return "unknown";
  return regions.some((entry) => matches(entry) && (!wholly || entry.wholly === true));
}

function regionMatcher(region: Record<string, unknown>, abilitySide: Side): ((entry: ScenarioRegion) => boolean) | undefined {
  if (typeof region.territory === "string") {
    switch (region.territory) {
      case "your-territory": return (entry) => entry.territory === abilitySide;
      case "enemy-territory": return (entry) => entry.territory === other(abilitySide);
      case "attacker-territory": return (entry) => entry.territory === "attacker";
      case "no-mans-land": return (entry) => entry.territory === "no-mans-land";
      case "your-deployment-zone": return (entry) => entry.deploymentZone === abilitySide;
      case "enemy-deployment-zone": return (entry) => entry.deploymentZone === other(abilitySide);
      default: return undefined;
    }
  }
  if (isObject(region.terrain_area)) {
    // A designated terrain area needs designations the scenario does not carry.
    return region.terrain_area.designated === undefined ? (entry) => entry.terrainArea === true : undefined;
  }
  if (isObject(region.rule_region) && typeof region.rule_region.region_id === "string") {
    const id = region.rule_region.region_id;
    return (entry) => entry.ruleRegion === id;
  }
  return undefined;
}

function compare(left: number, comparison: unknown, right: number): Verdict {
  switch (comparison) {
    case "gt": return left > right;
    case "gte": return left >= right;
    case "lt": return left < right;
    case "lte": return left <= right;
    case "eq": return left === right;
    default: return "unknown";
  }
}

/**
 * `controls`: objectives the `by` side (friendly unless stated, relative to the ability's side)
 * controls, bounded by `count`, compared with the other side's, or as a `proportion` of every
 * objective. Every stated clause must hold. An objective filter needs per-objective state.
 */
export function evaluateControls(params: Record<string, unknown>, ctx: EngineContext, abilitySide: Side): Verdict {
  const control = ctx.objectivesControlled;
  if (control === undefined || params.objective !== undefined) return "unknown";
  const sideOf = (owner: unknown): Side | undefined => owner === undefined || owner === "friendly" ? abilitySide : owner === "enemy" ? other(abilitySide) : undefined;
  const by = sideOf(params.by);
  if (by === undefined) return "unknown";
  const count = control[by];
  const verdicts: Verdict[] = [];
  if (params.count !== undefined) {
    const bounds = params.count;
    if (!isObject(bounds) || (bounds.min !== undefined && typeof bounds.min !== "number") || (bounds.max !== undefined && typeof bounds.max !== "number")) return "unknown";
    verdicts.push((bounds.min === undefined || count >= bounds.min) && (bounds.max === undefined || count <= bounds.max));
  }
  if (params.compare !== undefined) {
    const against = isObject(params.compare) ? sideOf(params.compare.owner) : undefined;
    if (against === undefined || !isObject(params.compare)) return "unknown";
    verdicts.push(compare(count, params.compare.comparison, control[against]));
  }
  if (params.proportion !== undefined) {
    const proportion = params.proportion;
    if (!isObject(proportion) || typeof proportion.fraction !== "number" || control.total <= 0) return "unknown";
    verdicts.push(compare(count / control.total, proportion.comparison, proportion.fraction));
  }
  // Bare `controls` means at least one objective.
  if (verdicts.length === 0) verdicts.push(count >= 1);
  if (verdicts.includes(false)) return false;
  return verdicts.includes("unknown") ? "unknown" : true;
}

/**
 * `attachment` facts the combined unit's members settle. `own` is the unit the ability belongs to.
 * Leading needs `own` to be a Leader with a Bodyguard; led needs another member that is a Leader;
 * attached needs another member. `with` narrows those other members by keyword (friendly units only).
 */
export function attachmentFromMembers(
  role: unknown,
  withFilter: unknown,
  members: readonly AttachedMember[] | undefined,
  own: string | undefined,
): Verdict {
  if (members === undefined || own === undefined) return "unknown";
  const self = members.find((member) => member.unitId === own);
  if (self === undefined) return false;
  const others = members.filter((member) => member.unitId !== own);
  const candidates = role === "leading" ? (self.role === "leader" ? others.filter((member) => member.role === "bodyguard") : [])
    : role === "led" ? others.filter((member) => member.role === "leader")
    : role === "attached" ? others
    : undefined;
  if (candidates === undefined) return "unknown";
  if (withFilter === undefined) return candidates.length > 0;
  if (!isObject(withFilter)) return "unknown";
  if (withFilter.owner === "enemy") return false;
  if (Object.keys(withFilter).some((key) => key !== "owner" && key !== "all_of" && key !== "any_of" && key !== "none_of" && key !== "not_all_of")) return "unknown";
  const predicate: Record<string, string[]> = {};
  for (const key of ["all_of", "any_of", "none_of", "not_all_of"]) {
    const value = withFilter[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return "unknown";
    predicate[key] = value;
  }
  return candidates.some((member) => keywordMatchesPredicate(predicate, member.keywords));
}
