/**
 * Mortal wounds an ability inflicts on an enemy unit outside an attack: after a Charge move, at the
 * start of a phase, when a unit is selected. Each is a {@link MortalWoundSource}: the expected
 * number of mortal wounds the target suffers each time its moment comes, before Feel No Pain.
 *
 * Mortal wounds an attack's own hit or wound rolls inflict are not sources; the buff layer turns
 * them into a `mortal-wounds-on-roll` contribution the engine applies per attack.
 *
 * @packageDocumentation
 */
import type { EngineContext } from "./buffs.js";
import type { ConditionNeed } from "./condition-facts.js";
import { quantityDistribution } from "./damage-roll.js";
import { evaluateCondition, undecidedNeeds, type UnsupportedFragment } from "./from-dsl.js";

/** Mortal wounds one ability inflicts on the target at one moment. */
export type MortalWoundSource = {
  /** The ability id, then `?<option index>` for each enclosing `choice` option. */
  id: string;
  /**
   * When they are inflicted: the trigger's event and its distinguishing filter value
   * (`move-ended:charge`, `phase-started:shooting`), or null for an ability with no trigger.
   */
  moment: string | null;
  /**
   * Expected mortal wounds the target suffers each time the moment comes, before Feel No Pain,
   * when every condition in `needs` holds.
   */
  expected: number;
  /** Leaf conditions the context leaves undecided; answering one false removes the source. */
  needs: ConditionNeed[];
};

export type MortalWoundTranslation = { sources: MortalWoundSource[]; unsupported: UnsupportedFragment[] };

type WalkState = {
  probability: number;
  moment: string | null;
  needs: ConditionNeed[];
  id: string;
  /** Whether the nearest enclosing `select-units` selects enemy units. */
  selectedEnemy?: boolean;
  /** Whether the nearest trigger's subject is an enemy unit. */
  subjectEnemy?: boolean;
  /** Whether the nearest `for-each-unit` reaches enemy units. */
  recipientEnemy?: boolean;
};

const SELF_TARGETS = new Set(["this-unit", "this-model", "bearer", "self", "attacker"]);

/**
 * The mortal wounds `effect` (with the record's own `trigger`) inflicts on an enemy unit outside an
 * attack. A condition the context leaves undecided is reported as a need and assumed to hold; one
 * it decides false removes what it gates. `phase-is` conditions never gate a source: the moment
 * names when it happens, whatever phase the attack is made in. Mortal wounds the ability's own
 * unit suffers are not sources.
 */
export function mortalWoundSources(
  abilityId: string,
  effect: unknown,
  trigger: unknown,
  context: EngineContext,
  rating?: string | number,
): MortalWoundTranslation {
  const { phase: _phase, ...ctx } = context;
  const sources: MortalWoundSource[] = [];
  const unsupported: UnsupportedFragment[] = [];

  const decide = (raw: unknown, state: WalkState): WalkState | null => {
    const condition = withoutPhase(raw);
    if (condition === null) return state;
    const verdict = evaluateCondition(condition, ctx as EngineContext, "attacker");
    if (verdict === false) return null;
    if (verdict === true) return state;
    const needs = undecidedNeeds(condition, ctx as EngineContext, "attacker");
    return { ...state, needs: mergeNeeds(state.needs, needs) };
  };

  const enterTrigger = (value: unknown, state: WalkState): WalkState | null => {
    const triggers = (Array.isArray(value) ? value : [value]).filter(isObject);
    if (triggers.length === 0) return state;
    let next: WalkState = { ...state, moment: triggers.map(momentOf).join("|") };
    const subjects = triggers.map((item) => (isObject(item.subject) ? item.subject.owner : undefined));
    // A nested moment with no subject of its own ("roll for that unit") keeps the enclosing one.
    if (subjects.some((owner) => owner !== undefined)) {
      next.subjectEnemy = subjects.every((owner) => owner === "enemy") ? true : subjects.every((owner) => owner === "friendly") ? false : undefined;
    }
    // Alternative moments are each enough on their own; only a single trigger's condition gates.
    if (triggers.length === 1) {
      const gated = decide(triggers[0]!.condition, next);
      if (gated === null) return null;
      next = gated;
    }
    return next;
  };

  const walk = (node: unknown, state: WalkState): void => {
    if (!isObject(node) || state.probability === 0) return;
    switch (node.type) {
      case "sequence":
      case "rules-bundle":
        for (const step of Array.isArray(node.steps) ? node.steps : []) walk(step, state);
        return;
      case "ability-part": {
        const next = node.trigger == null ? state : enterTrigger(node.trigger, state);
        if (next) walk(node.effect, next);
        return;
      }
      case "conditional": {
        const next = decide(node.condition, state);
        if (next) walk(node.effect, next);
        return;
      }
      case "select-units": {
        const selector = isObject(node.selector) ? node.selector : {};
        const owner = isObject(selector.filter) ? selector.filter.owner : undefined;
        const next = decide(selector.eligibility, { ...state, selectedEnemy: owner === "enemy" ? true : owner === "friendly" ? false : undefined });
        if (next) walk(node.effect, next);
        return;
      }
      case "for-each-unit": {
        const selector = isObject(node.selector) ? node.selector : {};
        const filter = isObject(selector.filter) ? selector.filter : {};
        const next = filter.owner === "enemy" ? reaches(filter, state) : null;
        if (filter.owner !== "enemy") {
          if (filter.owner !== "friendly" && containsMortalWounds(node.effect)) report(node, "mortal-wounds: for-each-unit reaches units of either side");
          return;
        }
        if (next) walk(node.effect, { ...next, recipientEnemy: true });
        return;
      }
      case "roll":
        walk(node.effect, state);
        return;
      case "choice":
        (Array.isArray(node.options) ? node.options : []).forEach((option, index) => walk(option, { ...state, id: `${state.id}?${index}` }));
        return;
      case "dice-gated": {
        const success = gateProbability(node);
        if (success === null) return report(node, "dice-gated: only a fixed threshold on rolled dice is modelled");
        walk(node.on_success, { ...state, probability: state.probability * success });
        walk(node.on_fail, { ...state, probability: state.probability * (1 - success) });
        return;
      }
      case "dice-table": {
        if (node.distinct === true) return report(node, "dice-table: distinct results are not modelled");
        const faces = node.dice === "D3" ? 3 : 6;
        const dice = typeof node.count === "number" ? node.count : 1;
        for (const outcome of Array.isArray(node.outcomes) ? node.outcomes : []) {
          if (!isObject(outcome) || !Array.isArray(outcome.results)) continue;
          const hits = outcome.results.filter((face) => typeof face === "number" && face >= 1 && face <= faces).length;
          walk(outcome.effect, { ...state, probability: state.probability * dice * (hits / faces) });
        }
        return;
      }
      case "mortal-wounds":
        return inflict(node, state);
      default:
        if (containsMortalWounds(node)) report(node, `mortal-wounds inside "${String(node.type)}" are not modelled`);
    }
  };

  const report = (node: unknown, reason: string): void => {
    unsupported.push({ reason, effectFragment: node });
  };

  /**
   * The state once the target is one of the units `filter` reaches, or null when the context rules
   * it out. Its range and other unit facts are needs on the target.
   */
  const reaches = (filter: Record<string, unknown>, state: WalkState): WalkState | null => {
    const { owner: _owner, ...rest } = filter;
    if (Object.keys(rest).length === 0) return state;
    return decide({ type: "matches", parameters: { subject: "target", filter: rest } }, state);
  };

  const inflict = (node: Record<string, unknown>, state: WalkState): void => {
    if (isObject(node.target) && (node.target.owner === "enemy" || node.target.owner === "any") && !("selection_var" in node.target) && !("event_var" in node.target)) {
      const next = reaches(node.target, state);
      if (next) inflict({ ...node, target: "defender" }, next);
      return;
    }
    const onTarget = targetIsEnemy(node.target, state);
    if (onTarget === false) return;
    if (onTarget === undefined) return report(node, `mortal-wounds: cannot tell whether ${JSON.stringify(node.target)} is the target`);
    const modifier = isObject(node.modifier) ? node.modifier : {};
    const roll = isObject(modifier.roll) ? modifier.roll : {};
    let models: number | undefined;
    if (roll.per_model !== undefined || roll.for_each !== undefined) {
      const counted = modelsRolling(roll, state);
      if (typeof counted === "string") return report(node, `mortal-wounds: ${counted}`);
      if (counted.state === null) return;
      models = counted.models;
      state = counted.state;
    }
    const expected = expectedMortalWounds(modifier, rating, models);
    if (typeof expected === "string") return report(node, `mortal-wounds: ${expected}`);
    const existing = sources.find((source) => source.id === state.id && source.moment === state.moment);
    if (existing) {
      existing.expected += state.probability * expected;
      existing.needs = mergeNeeds(existing.needs, state.needs);
    } else {
      sources.push({ id: state.id, moment: state.moment, expected: state.probability * expected, needs: [...state.needs] });
    }
  };

  /** How many models roll dice for a per-model roll, or why that is not known. */
  const modelsRolling = (roll: Record<string, unknown>, state: WalkState): { models: number; state: WalkState | null } | string => {
    const own = ctx.attackerModelCount;
    const target = ctx.targetModelCount;
    if (roll.per_model !== undefined) {
      const ref = roll.per_model;
      const onTarget = typeof ref === "string" ? targetIsEnemy(ref, state) : undefined;
      const count = ref === "this-unit" ? own : onTarget === true ? target : undefined;
      if (ref !== "this-unit" && onTarget !== true) return `dice rolled for each model of ${JSON.stringify(ref)} are not modelled`;
      return count === undefined ? "the number of models rolling is not in the context" : { models: count, state };
    }
    const each = isObject(roll.for_each) ? roll.for_each : {};
    const filter = isObject(each.filter) ? each.filter : {};
    const ownModels = filter.level === "model" && filter.member_of === "this-unit" && Object.keys(filter).every((key) => ["level", "member_of", "owner"].includes(key));
    if (!ownModels) return "dice rolled for each of a subset of models are not modelled";
    if (own === undefined) return "the number of models rolling is not in the context";
    // Which of the unit's models meet the eligibility is a fact about all of them: answered yes, every model rolls.
    return { models: own, state: decide(each.eligibility, state) };
  };

  const start = enterTrigger(trigger, { probability: 1, moment: null, needs: [], id: abilityId });
  if (start) walk(effect, start);
  return { sources: sources.filter((source) => source.expected > 0), unsupported };
}

/**
 * The condition with its `phase-is` leaves taken as satisfied (a compound keeps its other operands),
 * or null when nothing else remains. A negated `phase-is` is satisfied too.
 */
function withoutPhase(condition: unknown): Record<string, unknown> | null {
  if (!isObject(condition)) return null;
  if (condition.type === "phase-is") return null;
  if (typeof condition.operator !== "string" || !Array.isArray(condition.operands)) return condition;
  const operands = condition.operands.map(withoutPhase).filter((operand): operand is Record<string, unknown> => operand !== null);
  if (operands.length === 0) return null;
  if (condition.operator === "not") return operands.length === condition.operands.length ? { ...condition, operands } : null;
  return operands.length === 1 ? operands[0]! : { ...condition, operands };
}

/** The trigger's event and the filter value that tells its moments apart. */
function momentOf(trigger: Record<string, unknown>): string {
  const filter = isObject(trigger.filter) ? trigger.filter : {};
  const detail = [filter.phase, filter.to, filter.kind, filter.roll, Array.isArray(filter.move_types) ? filter.move_types.join("+") : undefined, filter.from]
    .find((value): value is string => typeof value === "string" && value.length > 0);
  return detail ? `${String(trigger.event)}:${detail}` : String(trigger.event);
}

/** True when the mortal wounds land on an enemy unit, false on the ability's own side, undefined when unknown. */
function targetIsEnemy(target: unknown, state: WalkState): boolean | undefined {
  if (typeof target === "string") {
    if (SELF_TARGETS.has(target)) return false;
    if (target === "defender") return true;
    if (target === "selected-unit") return state.selectedEnemy;
    if (target === "event-subject") return state.subjectEnemy;
    if (target === "recipient") return state.recipientEnemy;
    return undefined;
  }
  if (isObject(target) && target.owner === "friendly") return false;
  return undefined;
}

/** Expected mortal wounds from a `mortal-wounds` modifier, or why it cannot be computed. */
function expectedMortalWounds(modifier: Record<string, unknown>, rating?: string | number, models?: number): number | string {
  for (const key of Object.keys(modifier)) {
    if (!["count", "max", "per", "roll", "psychic"].includes(key)) return `${key} is not modelled`;
  }
  const count = modifier.count;
  let perWound: Array<[number, number]>;
  try {
    perWound = isObject(count) && count.rating === true
      ? (rating === undefined ? [] : quantityDistribution(rating))
      : quantityDistribution(count);
  } catch {
    return `count ${JSON.stringify(count)} is not a fixed or dice quantity`;
  }
  if (perWound.length === 0) return "count follows the ability's rating, which is not given";
  let total = perWound;
  if (modifier.roll !== undefined || modifier.per !== undefined) {
    const roll = modifier.roll;
    if (modifier.per !== "success" || !isObject(roll)) return `per ${String(modifier.per)} is not modelled`;
    let dice: Array<[number, number]>;
    try {
      dice = quantityDistribution(roll.dice);
    } catch {
      return `dice ${JSON.stringify(roll.dice)} is not a fixed or dice quantity`;
    }
    // Dice for each model: the per-model dice, rolled once for every model.
    if (models !== undefined) dice = sumDistribution(dice, models);
    const success = faceProbability(Number(roll.threshold), typeof roll.comparison === "string" ? roll.comparison : "gte");
    if (success === null) return `threshold ${JSON.stringify(roll.threshold)} is not modelled`;
    total = successTotals(dice, success, perWound);
  }
  const max = typeof modifier.max === "number" ? modifier.max : Infinity;
  return total.reduce((sum, [value, probability]) => sum + Math.min(value, max) * probability, 0);
}

/** Distribution of the summed counts over the dice that succeed. */
function successTotals(dice: Array<[number, number]>, success: number, count: Array<[number, number]>): Array<[number, number]> {
  const out = new Map<number, number>();
  for (const [n, pn] of dice) {
    let sums = new Map<number, number>([[0, 1]]);
    for (let k = 0; k <= n; k += 1) {
      const pk = binomial(n, k) * success ** k * (1 - success) ** (n - k);
      for (const [value, probability] of sums) out.set(value, (out.get(value) ?? 0) + pn * pk * probability);
      sums = convolve(sums, count);
    }
  }
  return [...out].sort(([a], [b]) => a - b);
}

/** Distribution of the sum of `times` independent draws. */
function sumDistribution(draw: Array<[number, number]>, times: number): Array<[number, number]> {
  let sums = new Map<number, number>([[0, 1]]);
  for (let index = 0; index < times; index += 1) sums = convolve(sums, draw);
  return [...sums].sort(([a], [b]) => a - b);
}

function convolve(left: Map<number, number>, right: Array<[number, number]>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [a, pa] of left) for (const [b, pb] of right) out.set(a + b, (out.get(a + b) ?? 0) + pa * pb);
  return out;
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

/** Probability one D6 meets `threshold` under `comparison`; null for a threshold that is not a face. */
function faceProbability(threshold: number, comparison: string): number | null {
  if (!Number.isInteger(threshold)) return null;
  const faces = [1, 2, 3, 4, 5, 6].filter((face) => compare(face, threshold, comparison));
  return faces.length / 6;
}

/** Probability a `dice-gated` node succeeds; null when it is not a fixed threshold on rolled dice. */
function gateProbability(node: Record<string, unknown>): number | null {
  if (node.test !== undefined || node.from !== undefined || node.requirement !== undefined) return null;
  if (typeof node.threshold !== "number") return null;
  let dice: Array<[number, number]>;
  try {
    dice = quantityDistribution(node.dice ?? "D6");
  } catch {
    return null;
  }
  const comparison = typeof node.comparison === "string" ? node.comparison : "gte";
  return dice.reduce((sum, [value, probability]) => sum + (compare(value, node.threshold as number, comparison) ? probability : 0), 0);
}

function compare(value: number, threshold: number, comparison: string): boolean {
  switch (comparison) {
    case "lte": return value <= threshold;
    case "lt": return value < threshold;
    case "gt": return value > threshold;
    case "eq": return value === threshold;
    default: return value >= threshold;
  }
}

function mergeNeeds(left: ConditionNeed[], right: ConditionNeed[]): ConditionNeed[] {
  const out = [...left];
  for (const need of right) if (!out.some((existing) => existing.key === need.key)) out.push(need);
  return out;
}

function containsMortalWounds(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(containsMortalWounds);
  if (!isObject(node)) return false;
  if (node.type === "mortal-wounds") return true;
  return Object.values(node).some(containsMortalWounds);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
