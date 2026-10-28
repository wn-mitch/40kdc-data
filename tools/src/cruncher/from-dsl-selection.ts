/**
 * Unit selections as player levers. A `select-units` effect whose nested effect reaches the
 * `selected-unit` is a choice the player makes on the table ("select one friendly DESTROYER CULT
 * unit within 9\"", "select one enemy unit visible to this unit"): which unit is picked, whether
 * the range and visibility hold, and whether a gating roll succeeded are not known to the
 * cruncher. The translator therefore offers the selection's buffs as one opt-in lever on the unit
 * the selection can reach, and records what the player vouches for in the lever's `requires`.
 *
 * This module decides what a selection means for the crunched unit; the translator walks the
 * effect it returns.
 */
import type { BuffApplicability, BuffSource, EngineContext } from "./buffs.js";
import { matchesUnitFilter } from "./unit-filter.js";

/** What a selection contributes to the crunched unit. */
export type SelectionPlan =
  /** Not a selection lever: the translator keeps its general handling. */
  | { kind: "none" }
  /** The crunched unit cannot be the selected unit, so nothing reaches it. */
  | { kind: "skip" }
  | { kind: "unsupported"; reason: string }
  | {
      kind: "lever";
      /** The nested effect with `selected-unit` read from the crunched unit's side. */
      effect: unknown;
      /** Gates on the selected unit's keywords, when it is the other side of the attack. */
      applicability?: BuffApplicability;
      /** DSL fragments the player vouches for: the selection, then any gating roll. */
      requires: unknown[];
      /** Lever label prefix. */
      label: string;
    };

const SELECTED_UNIT = "selected-unit";

/**
 * Plan a `select-units` node for the crunched unit under `perspective`.
 *
 * - A friendly selection reaches the crunched unit when its keywords match the selector. When the
 *   eligibility excludes the ability's own unit, the unit holding the ability cannot pick itself,
 *   so the lever exists only when another unit provides the ability (`abilityKind: "support"`).
 * - An enemy selection reaches the other side of the attack: the defender when the crunched unit
 *   attacks, the attacker when it is attacked.
 * - A top-level dice gate with no failure branch becomes the lever's content; its roll joins
 *   `requires`.
 *
 * Model selections stay unresolved without model identity. Named unit bindings are retargeted
 * only within their own selection; nested selections retain their independent scope.
 */
export function planSelection(
  node: Record<string, unknown>,
  source: BuffSource,
  perspective: "attacker" | "target",
  context: EngineContext,
): SelectionPlan {
  const selector = isObject(node.selector) ? node.selector : undefined;
  const filter = selector && isObject(selector.filter) ? selector.filter : undefined;
  if (!selector || !filter || (filter.owner !== "friendly" && filter.owner !== "enemy")) return { kind: "none" };
  if (filter.level === "model" || filter.model_names != null) return { kind: "none" };
  const binding = typeof selector.bind_as === "string" ? selector.bind_as : undefined;
  if (!referencesSelectedUnit(node.effect, binding)) return { kind: "none" };
  if (isObject(selector.count) && selector.count.max === 0) return { kind: "skip" };
  const { effect: _effect, ...selection } = node;
  const requires: unknown[] = [selection];

  let effect: unknown;
  let applicability: BuffApplicability | undefined;
  let label: string;
  if (filter.owner === "friendly") {
    const excludesSelf = filter.excluding === "ability-unit" || filter.excluding === "this-unit" || excludesAbilityUnit(selector.eligibility);
    if (excludesSelf && !(source.kind === "ability" && source.abilityKind === "support")) return { kind: "skip" };
    const { within: _within, visible: _visible, excluding: _excluding, ...knownFilter } = filter;
    const verdict = matchesUnitFilter(knownFilter, context, perspective === "attacker" ? "attacker" : "target");
    if (verdict === false) return { kind: "skip" };
    if (verdict === "unknown") return { kind: "unsupported", reason: "select-units: candidate identity or state is unavailable" };
    effect = retarget(node.effect, SELECTED_UNIT, binding);
    label = "Selected unit";
  } else {
    const other = perspective === "attacker" ? "defender" : "attacker";
    const { within: _within, visible: _visible, excluding: _excluding, ...knownFilter } = filter;
    applicability = perspective === "attacker" ? { targetFilter: knownFilter } : { attackerFilter: knownFilter };
    effect = retarget(node.effect, other, binding);
    label = "Selected enemy unit";
  }

  if (isObject(effect) && effect.type === "dice-gated") {
    if (effect.on_fail != null) return { kind: "unsupported", reason: "select-units: a dice gate with a failure branch is not a single lever" };
    const { on_success, on_fail: _fail, ...roll } = effect;
    requires.push(roll);
    effect = on_success;
  }
  return { kind: "lever", effect, ...(applicability ? { applicability } : {}), requires, label };
}

/**
 * Bind a quantified recipient to its actual candidate filter. Unlike a selection,
 * every matching pool receives the effect; no count or player choice is invented.
 * Nested selections and loops establish their own recipient bindings.
 */
export function bindEachRecipient(node: Record<string, unknown>, snapshotTarget?: "recipient"): unknown | undefined {
  const selector = isObject(node.selector) ? node.selector : undefined;
  if (!selector || !isObject(selector.filter) || (snapshotTarget === undefined && selector.eligibility !== undefined)) return undefined;
  let boundRecipient = false;
  let otherTarget = false;
  const bind = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(bind);
    if (!isObject(value) || value.type === "select-units" || value.type === "for-each-unit") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const recipient = child === "recipient" ||
        (typeof selector.bind_as === "string" && isObject(child) && child.selection_var === selector.bind_as);
      out[key] = key === "target" && recipient ? snapshotTarget ?? selector.filter : bind(child);
      if (key === "target") {
        boundRecipient ||= recipient;
        otherTarget ||= !recipient;
      }
    }
    return out;
  };
  const effect = bind(node.effect);
  return boundRecipient && !otherTarget ? effect : undefined;
}


/** Does the effect name the selected unit as a target anywhere, outside a nested selection? */
function referencesSelectedUnit(node: unknown, binding?: string): boolean {
  if (Array.isArray(node)) return node.some((child) => referencesSelectedUnit(child, binding));
  if (!isObject(node)) return false;
  if (node.type === "select-units") return false;
  if (node.target === SELECTED_UNIT || (binding !== undefined && isObject(node.target) && node.target.selection_var === binding)) return true;
  if (isObject(node.target) && (node.target.member_of === SELECTED_UNIT ||
      (binding !== undefined && isObject(node.target.member_of) && node.target.member_of.selection_var === binding))) return true;
  for (const key in node) {
    if (key !== "target" && referencesSelectedUnit(node[key], binding)) return true;
  }
  return false;
}

/** Copy the effect with each `selected-unit` target replaced, leaving nested selections alone. */
function retarget(node: unknown, target: string, binding?: string): unknown {
  if (Array.isArray(node)) return node.map((child) => retarget(child, target, binding));
  if (!isObject(node) || node.type === "select-units") return node;
  const out: Record<string, unknown> = {};
  for (const key in node) {
    const value = node[key];
    const selected = value === SELECTED_UNIT || (binding !== undefined && isObject(value) && value.selection_var === binding);
    out[key] = (key === "target" || key === "member_of") && selected
      ? key === "member_of" && target === SELECTED_UNIT ? "this-unit" : target
      : retarget(value, target, binding);
  }
  return out;
}

/** Does the eligibility forbid selecting the unit that holds the ability (`not same-unit ability-unit`)? */
function excludesAbilityUnit(condition: unknown): boolean {
  if (!isObject(condition)) return false;
  if (condition.operator === "not" && Array.isArray(condition.operands)) {
    return condition.operands.some((operand) => isObject(operand) && operand.type === "same-unit" &&
      isObject(operand.parameters) && operand.parameters.as === "ability-unit");
  }
  if (condition.operator === "and" && Array.isArray(condition.operands)) return condition.operands.some(excludesAbilityUnit);
  return false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


/** The unit-ref naming the unit whose action fired the enclosing trigger. */
const EVENT_SUBJECT = "event-subject";

/** Internal binding: the event's subject is another unit, so the effect never reaches the buffed unit. */
export const OTHER_UNIT = "other-unit";

/** Moments a unit makes itself; one that names no subject is the ability's own unit's (the DSL's default). */
const OWNED_MOMENTS = new Set(["selected", "move-started", "move-ended", "targets-selected", "attacks-resolved"]);

/** Who acts in a trigger: its subject, else `this-unit` for a unit's own moment; clock and destruction events have none. */
function triggerSubject(trigger: Record<string, unknown>): unknown {
  return trigger.subject ?? (typeof trigger.event === "string" && OWNED_MOMENTS.has(trigger.event) ? "this-unit" : undefined);
}

/**
 * Bind `event-subject` effects when the trigger says who acts. `this-unit` names the ability's
 * own unit, as does an absent subject on a unit's own moment ({@link triggerSubject}). A friendly
 * unit filter the buffed unit matches names the buffed unit; one it fails names another unit.
 * Seen from the target, an enemy unit filter the attacker matches names the attacker (the enemy
 * whose action fired the trigger is the one attacking); one it fails names another unit. The
 * binding is left in place when a clock or destruction event names no subject, an enemy seen from the
 * attacker, differs across alternative triggers, or cannot be checked, so the translator reports
 * it. A nested ability part with its own trigger binds its own subject.
 */
export function bindEventSubject(
  trigger: unknown,
  effect: unknown,
  context: EngineContext,
  perspective: "attacker" | "target",
): unknown {
  const triggers = (Array.isArray(trigger) ? trigger : [trigger]).filter(isObject);
  if (triggers.length === 0) return effect;
  const subject = triggerSubject(triggers[0]!);
  if (triggers.some((item) => JSON.stringify(triggerSubject(item)) !== JSON.stringify(subject))) return effect;
  if (subject === "this-unit") return rebindEventSubject(effect, "this-unit");
  if (isObject(subject) && subject.owner === "enemy" && perspective === "target") {
    const attacker = matchesUnitFilter(subject, context, "attacker", "enemy");
    if (attacker === "unknown") return effect;
    return rebindEventSubject(effect, attacker ? "attacker" : OTHER_UNIT);
  }
  if (!isObject(subject) || subject.owner !== "friendly") return effect;
  const verdict = matchesUnitFilter(subject, context, perspective);
  if (verdict === "unknown") return effect;
  // `selected-unit`, not `this-unit`: in a supporting unit's ability `this-unit` names the provider.
  return rebindEventSubject(effect, verdict ? SELECTED_UNIT : OTHER_UNIT);
}

/**
 * The binding {@link bindEventSubject} makes for a unit that meets the trigger's subject, for static
 * checks that have no unit to test, with the perspective to judge it from: an enemy subject is the
 * attacker seen from the target. An unbound subject is left in place.
 */
export function assumeEventSubjectMatches(trigger: unknown, effect: unknown): { effect: unknown; perspective: "attacker" | "target" } {
  const triggers = (Array.isArray(trigger) ? trigger : [trigger]).filter(isObject);
  const unbound = { effect, perspective: "attacker" as const };
  if (triggers.length === 0) return unbound;
  const subject = triggerSubject(triggers[0]!);
  if (triggers.some((item) => JSON.stringify(triggerSubject(item)) !== JSON.stringify(subject))) return unbound;
  if (subject === "this-unit") return { effect: rebindEventSubject(effect, "this-unit"), perspective: "attacker" };
  if (!isObject(subject)) return unbound;
  if (subject.owner === "enemy") return { effect: rebindEventSubject(effect, "attacker"), perspective: "target" };
  return subject.owner === "friendly" ? { effect: rebindEventSubject(effect, SELECTED_UNIT), perspective: "attacker" } : unbound;
}

/** Returns `node` itself when it holds no `event-subject` target to rebind. */
function rebindEventSubject(node: unknown, to: string): unknown {
  if (Array.isArray(node)) {
    const children = node.map((child) => rebindEventSubject(child, to));
    return children.some((child, index) => child !== node[index]) ? children : node;
  }
  if (!isObject(node) || (node.type === "ability-part" && node.trigger != null)) return node;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const key in node) {
    const value = node[key];
    out[key] = key === "target" && value === EVENT_SUBJECT ? to : rebindEventSubject(value, to);
    if (out[key] !== value) changed = true;
  }
  return changed ? out : node;
}
