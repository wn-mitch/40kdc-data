import type { EligibilityInput, EligibleAbility } from "../abilities-resolver/index.js";
import type { Phase } from "../generated.js";
import type { Dataset, StackableBuff, StackableBuffGroup } from "../data/dataset.js";

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

function stratagemAllowsUnitIds(dataset: Dataset, stratagemId: string, trigger: unknown, memberIds: readonly string[]): boolean {
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
      conditionVerdict(target.eligibility, ids) !== false &&
      (target.bound_to !== "triggering-unit" || friendlyTriggerVerdict(triggerSubject, ids) !== false));
  });
}

/** Evaluate only unit-id facts; unknown battlefield predicates intentionally remain permissive. */
function conditionVerdict(condition: unknown, ids: readonly string[]): Verdict {
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) return undefined;
  if ("operator" in condition && typeof condition.operator === "string") {
    if (!("operands" in condition) || !Array.isArray(condition.operands)) return undefined;
    const values = condition.operands.map((operand) => conditionVerdict(operand, ids));
    if (condition.operator === "and") return values.includes(false) ? false : values.every((value) => value === true) ? true : undefined;
    if (condition.operator === "or") return values.includes(true) ? true : values.every((value) => value === false) ? false : undefined;
    if (condition.operator === "not" && values.length === 1) return values[0] === undefined ? undefined : !values[0];
    return undefined;
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


