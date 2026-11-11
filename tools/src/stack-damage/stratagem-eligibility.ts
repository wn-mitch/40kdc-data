import type { EligibilityInput, EligibleAbility } from "../abilities-resolver/index.js";
import type { Phase } from "../generated.js";
import type { Dataset, StackableBuff, StackableBuffGroup } from "../data/dataset.js";
import { abilityRefId } from "../data/ability-refs.js";
import type { Unit } from "../generated.js";

/** A stack member's datasheet by unit id, for the unit facts an event needs. */
export type UnitLookup = (id: string) => Unit | undefined;

type Verdict = boolean | undefined;
type TargetRestriction = { side?: unknown; selects?: unknown; bound_to?: unknown; eligibility?: unknown };

/**
 * The public resolver intentionally accepts Stratagems whose target eligibility needs battlefield
 * state. Stack damage has no such state, but it can still reject a Stratagem when its target or
 * bound friendly trigger names a different datasheet.
 */
export function stackEligibleAbilities(dataset: Dataset, input: EligibilityInput, phase: Phase): EligibleAbility[] {
  return filterStackEligibleAbilities(dataset, input, dataset.eligibleAbilities(input, phase));
}

/** Apply stack damage's resolvable target and trigger restrictions to broad resolver results. */
export function filterStackEligibleAbilities(dataset: Dataset, input: EligibilityInput, abilities: readonly EligibleAbility[]): EligibleAbility[] {
  return abilities.filter((entry) =>
    entry.source.kind !== "detachment-stratagem" || stratagemAllowsUnitIds(
      dataset,
      entry.source.stratagemId,
      entry.ability.raw.trigger,
      [input.unitId, ...(input.attachedUnitIds ?? [])],
      unitLookup(dataset, input.factionId),
    ));
}

/** Remove a locally ineligible Stratagem and its dependent choice levers from a stack pool. */
export function filterStackableStratagems(
  buffs: readonly StackableBuff[],
  groups: readonly StackableBuffGroup[],
  broad: readonly EligibleAbility[],
  eligible: readonly EligibleAbility[],
): { buffs: StackableBuff[]; groups: StackableBuffGroup[] } {
  const allStratagems = new Set(broad.filter((entry) => entry.source.kind === "detachment-stratagem").map((entry) => entry.ability.id));
  const allowedStratagems = new Set(eligible.filter((entry) => entry.source.kind === "detachment-stratagem").map((entry) => entry.ability.id));
  return {
    buffs: buffs.filter((buff) => buff.source.kind !== "ability" || buff.source.abilityKind !== "detachment-stratagem" || allowedStratagems.has(buff.source.abilityId)),
    groups: groups.filter((group) => group.abilityId === undefined || !allStratagems.has(group.abilityId) || allowedStratagems.has(group.abilityId)),
  };
}

/** Each member's datasheet, preferring the stack's faction copy of a shared id. */
export function unitLookup(dataset: Dataset, factionId: string | undefined): UnitLookup {
  return (id) => (factionId ? dataset.units.getInFaction(id, factionId) : undefined)?.raw ?? dataset.units.getAny(id)?.raw;
}

function stratagemAllowsUnitIds(dataset: Dataset, stratagemId: string, trigger: unknown, memberIds: readonly string[], units: UnitLookup): boolean {
  const stratagem = dataset.stratagems.get(stratagemId);
  const raw = stratagem?.target_restrictions as TargetRestriction | TargetRestriction[] | null | undefined;
  if (!raw) return true;
  const targets = (Array.isArray(raw) ? raw : [raw]).filter((target) => target.side !== "enemy");
  if (targets.length === 0) return true;
  const triggerSubject = trigger !== null && typeof trigger === "object" && !Array.isArray(trigger) && "subject" in trigger
    ? trigger.subject
    : undefined;
  return targets.some((target) => {
    const candidates = target.selects === "model" ? memberIds.map((id) => [id]) : [memberIds];
    return candidates.some((ids) =>
      conditionVerdict(target.eligibility, ids, units) !== false &&
      (target.bound_to !== "triggering-unit" || friendlyTriggerVerdict(triggerSubject, ids) !== false));
  });
}

/** Evaluate only unit-id facts; unknown battlefield predicates intentionally remain permissive. */
function conditionVerdict(condition: unknown, ids: readonly string[], units?: UnitLookup): Verdict {
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) return undefined;
  if ("operator" in condition && typeof condition.operator === "string") {
    if (!("operands" in condition) || !Array.isArray(condition.operands)) return undefined;
    const values = condition.operands.map((operand) => conditionVerdict(operand, ids, units));
    if (condition.operator === "and") return values.includes(false) ? false : values.every((value) => value === true) ? true : undefined;
    if (condition.operator === "or") return values.includes(true) ? true : values.every((value) => value === false) ? false : undefined;
    if (condition.operator === "not" && values.length === 1) return values[0] === undefined ? undefined : !values[0];
    return undefined;
  }
  if (units && "type" in condition && condition.type === "happened" && "parameters" in condition) {
    return eventVerdict(condition.parameters, ids, units);
  }
  if (!("type" in condition) || condition.type !== "matches" || !("parameters" in condition)) return undefined;
  const { parameters } = condition;
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) return undefined;
  if ("subject" in parameters && parameters.subject !== "this-unit") return undefined;
  return "filter" in parameters ? filterVerdict(parameters.filter, ids) : undefined;
}

/** A trigger subject is a unit filter, not a condition wrapper. */
function friendlyTriggerVerdict(subject: unknown, ids: readonly string[]): Verdict {
  if (subject !== null && typeof subject === "object" && !Array.isArray(subject) && "owner" in subject &&
    subject.owner !== undefined && subject.owner !== "friendly") return undefined;
  return filterVerdict(subject, ids);
}

/** Evaluate only unit-id facts; another predicate keeps the result unknown. */
function filterVerdict(filter: unknown, ids: readonly string[], inheritedLevel?: unknown): Verdict {
  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) return undefined;
  let unknown = false;
  const level = "level" in filter ? filter.level : inheritedLevel;
  for (const [key, value] of Object.entries(filter)) {
    if (key === "level") {
      if (value !== "unit") unknown = true;
    } else if (key === "unit_ids") {
      if (level !== "unit" || !Array.isArray(value) || !value.every((id): id is string => typeof id === "string")) unknown = true;
      else if (!value.some((id) => ids.includes(id))) return false;
    } else if (key === "any_of_filters") {
      if (!Array.isArray(value) || value.length === 0) {
        unknown = true;
        continue;
      }
      const alternatives = value.map((alternative) => filterVerdict(alternative, ids, level));
      if (alternatives.includes(true)) continue;
      if (alternatives.every((alternative) => alternative === false)) return false;
      unknown = true;
    } else if (key === "owner") {
      if (value !== "friendly" && value !== "any") return false;
    } else {
      unknown = true;
    }
  }
  return unknown ? undefined : true;
}

/** Subjects that name the unit an event is checked for: the stack itself or the unit the event happened to. */
const OWN_SUBJECTS: ReadonlySet<unknown> = new Set([undefined, "this-unit", "event-subject"]);

/**
 * What the members' datasheets say about an event the unit must have taken part in: using an
 * ability needs every member to have it (a unit is set up by Deep Strike only when all of it can
 * be), and disembarking needs every member to be able to embark. False when a member cannot;
 * otherwise undefined, since whether the event happened is battlefield state.
 */
function eventVerdict(parameters: unknown, ids: readonly string[], units: UnitLookup): Verdict {
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) return undefined;
  const params = parameters as Record<string, unknown>;
  if (!OWN_SUBJECTS.has(params.subject)) return undefined;
  const members = ids.map(units);
  if (members.some((unit) => unit === undefined)) return undefined;
  if (params.event === "disembarked") return (members as Unit[]).every(canEmbark) ? undefined : false;
  const filter = params.filter;
  if (params.event === "used" && filter !== null && typeof filter === "object" && !Array.isArray(filter) &&
    (filter as Record<string, unknown>).kind === "ability" && typeof (filter as Record<string, unknown>).id === "string") {
    const abilityId = (filter as Record<string, unknown>).id as string;
    return (members as Unit[]).every((unit) => (unit.ability_ids ?? []).some((ref) => abilityRefId(ref) === abilityId)) ? undefined : false;
  }
  return undefined;
}

/** Whether a unit can embark in a Transport: no Titanic, Aircraft or Monster, and no Vehicle but a Walker. */
function canEmbark(unit: Unit): boolean {
  const keywords = new Set((unit.keywords ?? []).map((keyword) => keyword.toLowerCase()));
  if (keywords.has("titanic") || keywords.has("aircraft") || keywords.has("monster")) return false;
  return !keywords.has("vehicle") || keywords.has("walker");
}

/**
 * Whether a lever's activation can happen for a stack of `ids`: false when every trigger it
 * requires needs an event (its own, or one its condition names) that no member can take part in.
 */
export function activationPossible(requires: readonly unknown[] | undefined, ids: readonly string[], units: UnitLookup): boolean {
  for (const requirement of requires ?? []) {
    if (requirement === null || typeof requirement !== "object" || Array.isArray(requirement)) continue;
    const trigger = (requirement as Record<string, unknown>).trigger;
    const triggers = (Array.isArray(trigger) ? trigger : [trigger])
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item));
    if (triggers.length === 0) continue;
    const verdicts = triggers.map((item) => {
      const own = eventVerdict({ event: item.event, filter: item.filter, subject: ownSubject(item.subject) }, ids, units);
      return own === false ? false : conditionVerdict(item.condition, ids, units);
    });
    if (verdicts.every((verdict) => verdict === false)) return false;
  }
  return true;
}

/** A trigger's subject as an own-unit reference when it is a friendly unit filter. */
function ownSubject(subject: unknown): unknown {
  if (subject === undefined || subject === null) return undefined;
  if (typeof subject === "object" && !Array.isArray(subject)) {
    const owner = (subject as Record<string, unknown>).owner;
    return owner === undefined || owner === "friendly" ? "this-unit" : "other";
  }
  return subject;
}

/**
 * The conditions in a Stratagem's friendly-target eligibility that stack damage cannot decide and
 * so assumes met (battlefield state such as regions, designations and earlier events), each as
 * `type` plus its distinguishing parameter. Keyword checks it decides are not listed.
 */
export function assumedEligibility(dataset: Dataset, stratagemId: string): string[] {
  const raw = dataset.stratagems.get(stratagemId)?.target_restrictions as TargetRestriction | TargetRestriction[] | null | undefined;
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    const condition = node as Record<string, unknown>;
    if (typeof condition.operator === "string" && Array.isArray(condition.operands)) {
      condition.operands.forEach(walk);
      return;
    }
    const params = (condition.parameters ?? {}) as Record<string, unknown>;
    if (condition.type === "matches") {
      const filter = params.filter;
      const keys = filter !== null && typeof filter === "object" ? Object.keys(filter) : [];
      if (keys.every((key) => ["owner", "all_of", "any_of", "none_of", "not_all_of", "unit_ids", "level"].includes(key))) return;
      out.add(`matches ${JSON.stringify(filter)}`);
      return;
    }
    if (condition.type === "happened") {
      const filter = params.filter === undefined ? "" : ` ${JSON.stringify(params.filter)}`;
      if (params.event === "selected") return;
      out.add(`happened ${String(params.event)}${filter}`);
      return;
    }
    if (typeof condition.type === "string") out.add(`${condition.type} ${JSON.stringify(params)}`);
  };
  for (const target of Array.isArray(raw) ? raw : raw ? [raw] : []) if (target.side !== "enemy") walk(target.eligibility);
  return [...out];
}
