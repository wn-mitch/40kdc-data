import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { trigger, triggerLeaves } from "./compile-triggers.js";
import { canonicalDurationName } from "./compile-durations.js";
import { condition, duration } from "./compile-conditions.js";

/**
 * The resource-action-menu container (Battle Focus's Agile Manoeuvres): its actions, their
 * eligibility and triggers, and the pool's gain and spend. `compile-containers.ts` plans the
 * groups, one per menu-action marker, and passes its own option-effect builder in.
 */

type Node = Record<string, unknown>;
type EffectsOf = (leaves: readonly CompileLeaf[]) => Node;

/** Battle Focus's own two eligibility.requires shapes (menu-action's two eligibility_* flags — see the batch report for why these are fixed shapes, not a general vocabulary). */
function boundEligibilityRequires(marker: CompileLeaf): Node[] {
  const boundVar = closed(marker, "binds_event_variable");
  const requires: Node[] = [];
  if (marker.parameters.eligibility_engaged_with_bound_at_phase_start === true) {
    requires.push({ type: "unit-state", parameters: { subject: "selected-unit", state: "engaged", with: { event_var: boundVar }, at: "phase-start" } });
  }
  if (marker.parameters.eligibility_after_bound_hit_roll === true) {
    requires.push(
      { type: "phase-is", parameters: { phase: "shooting" } },
      { type: "player-turn-is", parameters: { turn: "opponent-turn" } },
      { type: "happened", parameters: { event: "after-roll", object: "selected-unit", filter: { roll: "hit", result: "success", by: { event_var: boundVar } }, window: "event" } },
    );
  }
  return requires;
}

/** The one bound state a menu action's selected unit must be in: engaged with the moment's enemy at the start of the phase. */
function isBoundEngagedState(leaf: CompileLeaf): boolean {
  const p = leaf.parameters;
  return leaf.role === "CONDITION" && leaf.family_id === "unit-state" && p.subject === "selected-unit" && p.with === "event-subject"
    && p.at === "phase-start" && p.negated !== true && Array.isArray(p.states) && p.states.length === 1 && p.states[0] === "engaged";
}

/** The one hit a menu action's selected unit must have taken from the moment's attacks, with no attack filter. */
function isBoundHitLeaf(leaf: CompileLeaf): boolean {
  return leaf.role === "CONDITION" && leaf.family_id === "hit-by-attacks" && leaf.parameters.subject === "selected-unit"
    && Object.keys(leaf.parameters).length === 1;
}

/**
 * A menu-action's own eligibility and triggers, read from ordinary leaves in its group rather than
 * flags, in any order before the effect starts. A `unit-keyword` CONDITION becomes `requires_keyword`
 * (negated: `excludes_keyword`); a `select-unit` becomes `selector_count: 1` with the keywords of the
 * unit-filter folded into it (scope must be friendly or left out); a bound `unit-state` and a bound
 * `hit-by-attacks` become `requires`. Every other EVENT leaf is a trigger. The first leaf of none of
 * these starts the effect. Returns the eligibility, the trigger leaves and how many leaves they used.
 */
function menuActionHead(marker: CompileLeaf, group: readonly CompileLeaf[]): { eligibility: Node; triggers: CompileLeaf[]; consumed: number } {
  const requiresKeyword: string[] = [];
  const excludesKeyword: string[] = [];
  const requires: Node[] = [];
  const triggers: CompileLeaf[] = [];
  let selectorCount: number | undefined;
  let cursor = 0;
  while (group[cursor]) {
    const leaf = group[cursor]!;
    if (leaf.role === "CONDITION" && leaf.family_id === "unit-keyword") {
      const keywords = closed(leaf, "keywords") as string[];
      (leaf.parameters.negated === true ? excludesKeyword : requiresKeyword).push(...keywords);
    } else if (leaf.role === "EVENT" && leaf.family_id === "select-unit") {
      if (selectorCount !== undefined) throw new CompileError("A menu-action selects one unit: give it one select-unit.");
      if (leaf.parameters.scope !== undefined && leaf.parameters.scope !== "friendly") throw new CompileError("A menu-action's select-unit selects a friendly unit; an enemy select-unit has no eligibility shape.");
      if (leaf.parameters.count !== undefined && leaf.parameters.count !== 1) throw new CompileError("A menu-action's select-unit selects one unit.");
      selectorCount = 1;
      const filter = (leaf.parameters.filter ?? {}) as Record<string, unknown>;
      const { keywords, excluded_keywords: excluded, ...others } = filter as { keywords?: string[]; excluded_keywords?: string[] } & Record<string, unknown>;
      if (Object.keys(others).length) throw new CompileError(`A menu-action's selected unit is named only by its keywords; the DSL holds no ${Object.keys(others).join(", ")} for it.`);
      requiresKeyword.push(...(keywords ?? []));
      excludesKeyword.push(...(excluded ?? []));
    } else if (isBoundEngagedState(leaf)) {
      if (marker.parameters.binds_event_variable === undefined) throw new CompileError("A menu-action's bound state needs the event variable its moment binds.");
      requires.push({ type: "unit-state", parameters: { subject: "selected-unit", state: "engaged", with: { event_var: closed(marker, "binds_event_variable") }, at: "phase-start" } });
    } else if (isBoundHitLeaf(leaf)) {
      if (marker.parameters.binds_event_variable === undefined) throw new CompileError("A menu-action's bound hit needs the event variable its moment binds.");
      requires.push({ type: "happened", parameters: { event: "after-roll", object: "selected-unit", filter: { roll: "hit", result: "success", by: { event_var: closed(marker, "binds_event_variable") } }, window: "event" } });
    } else if (leaf.family_id === "phase-window") {
      // "In your opponent's Shooting phase, just after …": the action is available only then.
      const gate = condition(leaf);
      requires.push(...(gate.operator === "and" ? gate.operands as Node[] : [gate]));
    } else if (leaf.role === "EVENT") {
      triggers.push(leaf);
    } else {
      break;
    }
    cursor += 1;
  }
  const filter: Node = {};
  if (requiresKeyword.length) filter.all_of = requiresKeyword;
  if (excludesKeyword.length) filter.none_of = excludesKeyword;
  const eligibility: Node = Object.keys(filter).length ? { filter } : {};
  if (selectorCount !== undefined) eligibility.count = { min: selectorCount, max: selectorCount };
  if (requires.length) eligibility.requires = requires;
  return { eligibility, triggers, consumed: cursor };
}

/**
 * An action's own terms printed among its effect leaves, taken out of the effect: a duration leaf
 * ("Until the end of the phase, …") is how long the action lasts, and a usage-limit of once per
 * phase per unit ("You can trigger this … more than once per phase (provided a different unit
 * performs it each time)") makes it repeatable by different units.
 */
function actionTerms(leaves: readonly CompileLeaf[]): { body: CompileLeaf[]; lasts?: string; repeatable: boolean } {
  const body: CompileLeaf[] = [];
  let lasts: string | undefined;
  let repeatable = false;
  for (const leaf of leaves) {
    if (leaf.role === "DURATION") {
      if (lasts !== undefined) throw new CompileError("A menu-action has one duration; this one has two duration leaves.");
      lasts = duration(leaf);
    } else if (leaf.family_id === "usage-limit") {
      if (leaf.parameters.frequency !== "once-per-phase" || leaf.parameters.per !== "unit") throw new CompileError("A menu-action's own usage-limit is once per phase per unit (repeatable by a different unit); no other limit has a place in an action.");
      repeatable = true;
    } else {
      body.push(leaf);
    }
  }
  return { body, lasts, repeatable };
}

/** resource-action-menu: each group is led by menu-action; the leaves after it (past eligibility) are its trigger(s) (`when`, one or several alternatives), then its effect. */
export function buildResourceActionMenu(head: CompileLeaf, groups: CompileLeaf[][], effectsOf: EffectsOf): Node {
  const actions = groups.map((group) => {
    const marker = group[0];
    if (!marker || marker.family_id !== "menu-action") throw new CompileError("Each resource-action-menu action needs a leading menu-action leaf.");
    const { eligibility: ownEligibility, triggers: whenLeaves, consumed } = menuActionHead(marker, group.slice(1));
    let cursor = 1 + consumed;
    if (whenLeaves.length === 0) throw new CompileError("A menu-action needs its own trigger leaf (an EVENT leaf) after its marker and any eligibility leaves.");
    const triggers = whenLeaves.flatMap((leaf) => triggerLeaves(leaf).map((each) => trigger(each)));
    const when: Node | Node[] = triggers.length === 1 ? triggers[0]! : triggers;
    if (marker.parameters.binds_event_variable !== undefined && !Array.isArray(when)) when.binds_event_variable = closed(marker, "binds_event_variable");
    const cost: Node = { pool_id: marker.parameters.cost_pool_id !== undefined ? closed(marker, "cost_pool_id") : closed(head, "pool_id"), amount: closed(marker, "cost_amount") };
    if (marker.parameters.cost_resource_label !== undefined) cost.resource_label = closed(marker, "cost_resource_label");
    const { body, lasts, repeatable } = actionTerms(group.slice(cursor));
    const action: Node = { id: closed(marker, "action_id"), label: closed(marker, "label"), when, cost, effect: effectsOf(body) };
    const eligibility: Node = { ...ownEligibility };
    const flagRequires = boundEligibilityRequires(marker);
    if (flagRequires.length) {
      // A leaf and a flag that state the same requirement would say it twice.
      if (flagRequires.some((flag) => JSON.stringify(eligibility.requires ?? []).includes(JSON.stringify(flag)))) throw new CompileError("A menu-action states a bound requirement both as a leaf and as a flag; keep one.");
      eligibility.requires = [...((eligibility.requires as Node[] | undefined) ?? []), ...flagRequires];
    }
    if (Object.keys(eligibility).length) action.eligibility = eligibility;
    const marked = marker.parameters.duration === undefined ? undefined
      : marker.parameters.duration === "immediate" ? "resolution" : canonicalDurationName(String(closed(marker, "duration")));
    if (marked !== undefined && lasts !== undefined && marked !== lasts) throw new CompileError(`A menu-action's marker says it lasts ${marked}, but its duration leaf says ${lasts}.`);
    const lifetime = lasts ?? marked;
    if (lifetime !== undefined) action.duration = lifetime;
    if (marker.parameters.repeatable_if_different_unit === true || repeatable) action.usage = { repeatable_if_different_unit: true };
    return action;
  });
  const node: Node = { type: "resource-action-menu", menu_id: closed(head, "menu_id"), pool_id: closed(head, "pool_id"), actions };
  const sharedUsage: Node = {};
  if (head.parameters.unit_max_manoeuvres_per_phase !== undefined) sharedUsage.unit_max_manoeuvres_per_phase = closed(head, "unit_max_manoeuvres_per_phase");
  if (head.parameters.default_manoeuvre_max_per_phase !== undefined) sharedUsage.default_manoeuvre_max_per_phase = closed(head, "default_manoeuvre_max_per_phase");
  if (Object.keys(sharedUsage).length) node.shared_usage = sharedUsage;
  return poolLifecycleSequence(head, node);
}

/**
 * pool_gain/pool_spend (Battle Focus): the menu carries no lifecycle of its own, so its pool's
 * population and clearing are each their own sibling ability-part, wrapping the menu into a
 * sequence of up to three steps (gain, the bare menu, spend) — never nested inside one another.
 */
function poolLifecycleSequence(head: CompileLeaf, menu: Node): Node {
  const steps: Node[] = [];
  const gain = head.parameters.pool_gain as { trigger: string; amount: unknown; label?: string } | undefined;
  if (gain) {
    const modifier: Node = { pool: closed(head, "pool_id"), amount: gain.amount };
    if (gain.label !== undefined) modifier.label = gain.label;
    steps.push({ type: "ability-part", trigger: { event: gain.trigger }, effect: { type: "resource-gain", target: "this-model", modifier } });
  }
  steps.push(menu);
  const spend = head.parameters.pool_spend as { trigger: string; amount: unknown; label?: string } | undefined;
  if (spend) {
    const modifier: Node = { pool: closed(head, "pool_id"), amount: spend.amount };
    if (spend.label !== undefined) modifier.label = spend.label;
    steps.push({ type: "ability-part", trigger: { event: spend.trigger }, effect: { type: "resource-spend", target: "this-model", modifier } });
  }
  return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
}
