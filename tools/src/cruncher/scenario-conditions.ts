/**
 * Condition evaluators that read declared scenario state: which rules are active, which regions a
 * unit is in, how many objectives each side controls, and which units make up a combined unit.
 * Each returns "unknown" when the context does not declare the fact it needs.
 */
import { keywordMatchesPredicate } from "../scope.js";
import type { AttachedMember, EngineContext, ScenarioObjective, ScenarioRegion } from "./buffs.js";
import { objectiveMatches } from "./unit-filter.js";

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
  return anyOf(regions.map((entry) => !wholly || entry.wholly === true ? matches(entry) : false));
}

/** True when any verdict holds, false when every one fails, else "unknown". */
function anyOf(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes(true)) return true;
  return verdicts.includes("unknown") ? "unknown" : false;
}

function regionMatcher(region: Record<string, unknown>, abilitySide: Side): ((entry: ScenarioRegion) => Verdict) | undefined {
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
    const tag = region.terrain_area.designated;
    if (tag === undefined) return (entry) => entry.terrainArea === true;
    if (typeof tag !== "string") return undefined;
    // A designated terrain area needs the area's designations; an entry without them is unknown.
    return (entry) => entry.terrainArea !== true ? false
      : entry.designations === undefined ? "unknown"
      : entry.designations.some((designation) => designation.toLowerCase() === tag.toLowerCase());
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
 * objective. Every stated clause must hold. With an objective filter the clauses count only the
 * declared objectives that meet it.
 */
export function evaluateControls(params: Record<string, unknown>, ctx: EngineContext, abilitySide: Side): Verdict {
  const control = params.objective === undefined && ctx.objectivesControlled !== undefined
    ? ctx.objectivesControlled
    : objectiveControl(params.objective ?? {}, ctx.objectives, abilitySide);
  if (control === undefined) return "unknown";
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
 * How many of the declared objectives meeting `filter` each side controls, or undefined when an
 * objective's match, or a matching objective's controller, is unknown.
 */
function objectiveControl(filter: unknown, objectives: readonly ScenarioObjective[] | undefined, abilitySide: Side): { attacker: number; target: number; total: number } | undefined {
  if (objectives === undefined || !isObject(filter)) return undefined;
  const control = { attacker: 0, target: 0, total: 0 };
  for (const objective of objectives) {
    const verdict = objectiveMatches(filter, objective, abilitySide);
    if (verdict === "unknown") return undefined;
    if (!verdict) continue;
    if (objective.controller === undefined) return undefined;
    control.total += 1;
    if (objective.controller !== "none") control[objective.controller] += 1;
  }
  return control;
}

/**
 * `designated`: with `count`, how many units carry the designation that the `by` unit applied;
 * with an objective subject, how many objectives meeting the filter carry it (at least one without
 * `count`).
 */
export function evaluateDesignated(params: Record<string, unknown>, ctx: EngineContext, bySide: Side | undefined, abilitySide: Side): Verdict {
  const tag = params.tag;
  if (typeof tag !== "string") return "unknown";
  const same = (designation: string) => designation.toLowerCase() === tag.toLowerCase();
  const bounds = params.count;
  if (bounds !== undefined && (!isObject(bounds) || (bounds.min !== undefined && typeof bounds.min !== "number") || (bounds.max !== undefined && typeof bounds.max !== "number"))) return "unknown";
  const within = (count: number): boolean => bounds === undefined
    ? count >= 1
    : (bounds.min === undefined || count >= (bounds.min as number)) && (bounds.max === undefined || count <= (bounds.max as number));
  if (isObject(params.subject) && isObject(params.subject.objective)) {
    if (params.by !== undefined || ctx.objectives === undefined) return "unknown";
    let count = 0;
    for (const objective of ctx.objectives) {
      const verdict = objectiveMatches({ ...params.subject.objective, designated: tag }, objective, abilitySide);
      if (verdict === "unknown") return "unknown";
      if (verdict) count += 1;
    }
    return within(count);
  }
  if (bounds !== undefined) {
    if (params.subject !== undefined || bySide === undefined) return "unknown";
    const applied = bySide === "attacker" ? ctx.attackerDesignationsApplied : ctx.targetDesignationsApplied;
    if (applied === undefined) return "unknown";
    const count = Object.entries(applied).filter(([designation]) => same(designation)).reduce((sum, [, units]) => sum + units, 0);
    return within(count);
  }
  // A unit's own designations are a `matches` filter; the schema gives this condition no such form.
  return "unknown";
}

/**
 * `attachment` facts the combined unit's members settle. `own` is the unit the ability belongs to.
 * Leading needs `own` to be a Leader or Support unit with a Bodyguard (both lead, core rule
 * 19.01); led needs another member that is a Leader or Support unit; attached needs another member. `with` narrows those other members by keyword (friendly units
 * only), or at `level: "model"` to members with a model meeting the keywords.
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
  const leads = (member: AttachedMember) => member.role === "leader" || member.role === "support";
  const candidates = role === "leading" ? (leads(self) ? others.filter((member) => member.role === "bodyguard") : [])
    : role === "led" ? others.filter(leads)
    : role === "attached" ? others
    : undefined;
  if (candidates === undefined) return "unknown";
  if (withFilter === undefined) return candidates.length > 0;
  if (!isObject(withFilter)) return "unknown";
  if (withFilter.owner === "enemy") return false;
  if (Object.keys(withFilter).some((key) => key !== "owner" && key !== "level" && key !== "all_of" && key !== "any_of" && key !== "none_of" && key !== "not_all_of")) return "unknown";
  if (withFilter.level !== undefined && withFilter.level !== "unit" && withFilter.level !== "model") return "unknown";
  const predicate: Record<string, string[]> = {};
  for (const key of ["all_of", "any_of", "none_of", "not_all_of"]) {
    const value = withFilter[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return "unknown";
    predicate[key] = value;
  }
  if (withFilter.level !== "model") return candidates.some((member) => keywordMatchesPredicate(predicate, member.keywords));
  return anyOf(candidates.map((member) => memberHasModel(predicate, member.keywords)));
}

/**
 * Whether a unit with `keywords` has a model meeting a keyword predicate. Every model carries the
 * unit's keywords, but a unit's keywords omit its models' own names: a clause needing a keyword
 * holds for every model when the unit carries it and is otherwise unknown, and a clause excluding
 * keywords fails for every model when the unit's keywords already break it.
 */
function memberHasModel(predicate: Record<string, string[]>, keywords: readonly string[]): Verdict {
  let verdict: Verdict = true;
  for (const [key, value] of Object.entries(predicate)) {
    const holds = keywordMatchesPredicate({ [key]: value }, keywords);
    if (key === "none_of" || key === "not_all_of") {
      if (!holds) return false;
      verdict = "unknown";
    } else if (!holds) {
      verdict = "unknown";
    }
  }
  return verdict;
}

/**
 * Bounds on how many models of a unit carry `keyword`: the declared count, else all of them when
 * every model carries it. Undefined otherwise: a unit's keywords omit its models' own names, so a
 * keyword missing from them does not show that no model carries it.
 */
export function keywordModelBounds(keyword: string, declared: Readonly<Record<string, number>> | undefined, modelKeywords: readonly string[] | undefined, modelCount: number | undefined): [number, number] | undefined {
  const same = (item: string) => item.toLowerCase() === keyword.toLowerCase();
  const count = declared === undefined ? undefined : Object.entries(declared).find(([item]) => same(item))?.[1];
  if (count !== undefined) return [count, count];
  if (modelKeywords === undefined || !modelKeywords.some(same)) return undefined;
  return modelCount === undefined ? [1, Infinity] : [modelCount, modelCount];
}

/** Inclusive `min`/`max` bounds against a count known to lie in `[low, high]`. */
export function boundsVerdict(params: Record<string, unknown>, [low, high]: [number, number]): Verdict {
  const min = typeof params.min === "number" ? params.min : undefined;
  const max = typeof params.max === "number" ? params.max : undefined;
  if ((min !== undefined && high < min) || (max !== undefined && low > max)) return false;
  return (min === undefined || low >= min) && (max === undefined || high <= max) ? true : "unknown";
}

/**
 * `happened` for a unit's own moves this turn: whether the unit on `side` made any of the listed
 * moves. Undefined when the condition has another form or the moves are undeclared.
 */
export function evaluateOwnMove(params: Record<string, unknown>, ctx: EngineContext, side: Side | undefined): boolean | undefined {
  const filter = params.filter;
  if (params.event !== "move-ended" || params.window !== "turn" || side === undefined || !isObject(filter)) return undefined;
  if (Object.keys(params).some((key) => key !== "event" && key !== "subject" && key !== "filter" && key !== "window")) return undefined;
  const types = filter.move_types;
  if (Object.keys(filter).length !== 1 || !Array.isArray(types) || types.length === 0 || !types.every((type) => typeof type === "string")) return undefined;
  const moves = side === "attacker" ? ctx.attackerMoves : ctx.targetMoves;
  return moves === undefined ? undefined : types.some((type) => moves.includes(type));
}

/** `roll-result` for a test the ability made, from the declared test results. */
export function evaluateTestResult(params: Record<string, unknown>, ctx: EngineContext): Verdict {
  const { roll, result } = params;
  if (roll !== "leadership" && roll !== "battle-shock" && roll !== "charge") return "unknown";
  if (result !== "success" && result !== "failure") return "unknown";
  const declared = ctx.testResults?.[roll];
  return declared === undefined ? "unknown" : declared === result;
}

const PHASE_EVENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  "selected": ["event", "subject", "filter", "window"],
  "model-destroyed": ["event", "object", "filter", "window", "count"],
  "destroyed": ["event", "object", "filter", "window", "count"],
  "after-roll": ["event", "subject", "object", "filter", "window"],
};

/**
 * `happened` this phase, from the declared phase events: what a unit was selected for, the enemy
 * models and units it destroyed, the models it lost, and the rolls it made or that were made
 * against it. `sideOf` names the unit of the attack a reference is, if either. Undefined when the
 * condition has another form; "unknown" when the fact it reads is undeclared. A kill or roll filter
 * narrower than the declared facts can still rule an event out when none happened.
 */
export function evaluatePhaseEvent(params: Record<string, unknown>, ctx: EngineContext, sideOf: (ref: unknown) => Side | undefined): Verdict | undefined {
  const event = params.event;
  const keys = typeof event === "string" ? PHASE_EVENT_KEYS[event] : undefined;
  if (params.window !== "phase" || keys === undefined || Object.keys(params).some((key) => !keys.includes(key))) return undefined;
  const filter = params.filter === undefined ? {} : params.filter;
  if (!isObject(filter)) return undefined;
  if (event === "selected") {
    const side = sideOf(params.subject);
    if (side === undefined || Object.keys(filter).length !== 1 || typeof filter.to !== "string") return undefined;
    const selected = side === "attacker" ? ctx.attackerSelected : ctx.targetSelected;
    return selected === undefined ? "unknown" : selected.includes(filter.to);
  }
  if (event === "after-roll") return evaluateRolled(params, filter, ctx, sideOf);
  const bounds = params.count === undefined ? { min: 1 } : params.count;
  if (!isObject(bounds)) return undefined;
  const range = event === "model-destroyed" && Object.keys(filter).length === 0
    ? lossRange(params.object, ctx, sideOf)
    : killRange(event === "model-destroyed", params.object, filter, ctx, sideOf);
  if (range === undefined) return undefined;
  return range === "unknown" ? "unknown" : boundsVerdict(bounds, range);
}

/** How many of the object's models the ability's unit lost this phase: this model, or any model of this unit. */
function lossRange(object: unknown, ctx: EngineContext, sideOf: (ref: unknown) => Side | undefined): [number, number] | "unknown" | undefined {
  if (object !== "this-model" && object !== "model-in-this-unit") return undefined;
  const side = sideOf("this-unit");
  const losses = side === "attacker" ? ctx.attackerLosses : side === "target" ? ctx.targetLosses : undefined;
  if (losses === undefined) return "unknown";
  return object === "this-model" ? [0, Math.min(losses, 1)] : [losses, losses];
}

/**
 * How many enemy models (or units) the `by` unit destroyed this phase. A kill by one model, or
 * narrowed by object keywords or attack type, counts at most the unit's kills.
 */
function killRange(models: boolean, object: unknown, filter: Record<string, unknown>, ctx: EngineContext, sideOf: (ref: unknown) => Side | undefined): [number, number] | "unknown" | undefined {
  if (!isObject(object) || object.owner !== "enemy" || filter.by === undefined) return undefined;
  if ((object.level ?? (models ? undefined : "unit")) !== (models ? "model" : "unit")) return undefined;
  const side = sideOf(filter.by);
  if (side === undefined) return undefined;
  const kills = side === "attacker" ? ctx.attackerKills : ctx.targetKills;
  if (kills === undefined) return "unknown";
  const count = models ? kills.models : kills.units;
  const narrowed = filter.by === "this-model" ||
    Object.keys(object).some((key) => key !== "owner" && key !== "level") ||
    Object.keys(filter).some((key) => key !== "by");
  return narrowed ? [0, count] : [count, count];
}

/**
 * `after-roll` this phase: a roll the subject unit made, or with an object (and no subject), one
 * made against the object unit. A filter beyond the roll and result can only rule the roll out.
 */
function evaluateRolled(params: Record<string, unknown>, filter: Record<string, unknown>, ctx: EngineContext, sideOf: (ref: unknown) => Side | undefined): Verdict | undefined {
  const { roll, result } = filter;
  if (typeof roll !== "string" || (result !== "success" && result !== "failure" && result !== "critical")) return undefined;
  if (params.subject !== undefined && params.object !== undefined) return undefined;
  const against = params.object !== undefined;
  const side = sideOf(against ? params.object : params.subject);
  if (side === undefined) return undefined;
  const rolls = against
    ? side === "attacker" ? ctx.attackerRolledAgainst : ctx.targetRolledAgainst
    : side === "attacker" ? ctx.attackerRolls : ctx.targetRolls;
  if (rolls === undefined) return "unknown";
  const rolled = rolls.some((entry) => entry.roll === roll && (entry.result === result || (result === "success" && entry.result === "critical")));
  if (!rolled) return false;
  return Object.keys(filter).some((key) => key !== "roll" && key !== "result") ? "unknown" : true;
}
