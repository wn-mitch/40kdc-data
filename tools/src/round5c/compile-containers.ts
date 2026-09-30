import { closed, CompileError, effect, type CompileLeaf } from "./compile-fragments.js";
import { trigger } from "./compile-conditions.js";

/**
 * Container fragments (batch 5). `compile.ts` delegates here in two ways:
 *
 * - Wrapping leaves (`aura-range`, `leader-target`, `for-each-unit-select`, `rules-bundle-marker`)
 *   sit anywhere among an otherwise ordinary ability's leaves; `compile.ts` finds them during its
 *   own leaf walk and calls the matching `wrap*` function on the body it already assembled, the
 *   same way it already wraps a `select-unit` leaf into `select-units` or `designate-target`.
 * - Container openers (`choice-open`, `stance-select-open`, `issue-orders-open`,
 *   `dice-pool-allocation-open`, all role EFFECT) fold every leaf sentence after them, up to the
 *   next opener or the end of the ability, into one option each. `planContainers` computes the
 *   container node at the opener's own position and which leaf indexes it consumed;
 *   `compile.ts` treats the opener as one ordinary planned effect at that position and skips the
 *   consumed leaves everywhere else — so an opener composes with an earlier select-unit or
 *   for-each-unit-select, an earlier roll, and ability parts exactly like any other effect.
 */

type Node = Record<string, unknown>;

const LEADING_CONTAINERS = new Set([
  "choice-open", "stance-select-open", "issue-orders-open", "dice-pool-allocation-open",
  "risk-reward-open", "resource-action-menu-open", "persistent-designation-open", "select-objective-open",
]);
/** Openers that wrap a single combined body instead of splitting into two or more options. */
const SINGLE_BODY_CONTAINERS = new Set(["persistent-designation-open", "select-objective-open"]);
/** Openers whose options may number just one (the DSL's own `actions`/`outcomes` array allows it). */
const ONE_OR_MORE_CONTAINERS = new Set(["resource-action-menu-open"]);

export function isContainerOpener(familyId: string): boolean {
  return LEADING_CONTAINERS.has(familyId);
}

/** Families `compile.ts` treats as body-wrapping markers rather than ordinary conditions/events. */
export const WRAP_CONDITION_FAMILIES = new Set(["aura-range", "leader-target"]);

// ---------------------------------------------------------------------------------------------
// Wrapping leaves: fold the already-assembled body of an otherwise ordinary ability into one
// more layer. Order (aura, then leader-target, then for-each-unit, then rules-bundle) matches
// how `compile.ts` calls them; a real ability is expected to use at most one of these at once.
// ---------------------------------------------------------------------------------------------

export function wrapAura(leaf: CompileLeaf, body: Node): Node {
  const modifier: Node = { range: closed(leaf, "inches"), effect: body };
  const keywords = leaf.parameters.keywords as string[] | undefined;
  if (keywords?.length) modifier.eligible = { required_keywords: keywords };
  // Version 2 (batch 7a): the aura's range, extensions included, never exceeds this many inches.
  if (leaf.parameters.range_cap_inches !== undefined) modifier.range_cap = closed(leaf, "range_cap_inches");
  return { type: "aura", target: closed(leaf, "side") === "friendly" ? "friendly-within-aura" : "enemy-within-aura", modifier };
}

/**
 * The DSL's `grant.effect` here is targetless (dispatched to the resolved leader model, not to a
 * unit-ref): a single effect with `target` stripped. A sequence or another container has no
 * place there; the ability needs to grant exactly one effect to the leader.
 */
export function wrapLeaderTarget(leaf: CompileLeaf, body: Node): Node {
  if (typeof body.type !== "string" || "steps" in body || "effect" in body) {
    throw new CompileError("leader-target needs exactly one plain effect to grant to the leader model, not a sequence or another container.");
  }
  const { target: _target, ...granted } = body;
  const keywords = leaf.parameters.leader_keywords as string[] | undefined;
  return {
    type: "leader-model-ability-grant",
    source: "bearer-unit",
    beneficiary: "leading-leader-model",
    ...(keywords?.length ? { leader_filter: { keywords } } : {}),
    attached_unit_filter: null,
    duration: "while-leading",
    grant: { recipient: "beneficiary", effect: granted },
    recipient_binding: "beneficiary-only",
  };
}

export function wrapForEachUnit(leaf: CompileLeaf, body: Node): Node {
  return {
    type: "for-each-unit",
    selector: {
      owner: closed(leaf, "scope") === "friendly" ? "friendly" : "enemy",
      ...(leaf.parameters.distance === "within" ? { within_inches: closed(leaf, "inches") } : {}),
    },
    effect: body,
  };
}

/** The container batch's one flat (non-wrapping) effect: stance-selection-capacity. */
export function containerEffect(leaf: CompileLeaf): Node | undefined {
  if (leaf.family_id !== "stance-selection-capacity") return undefined;
  const modifier: Node = {
    stance_id: closed(leaf, "stance_id"),
    additional_selections: closed(leaf, "additional_selections"),
    allocation: closed(leaf, "allocation"),
  };
  if (leaf.parameters.option_id !== undefined) modifier.option_id = closed(leaf, "option_id");
  const node: Node = { type: "stance-selection-capacity", modifier };
  if (leaf.parameters.scope !== undefined) node.scope = closed(leaf, "scope");
  return node;
}

export function wrapRulesBundle(body: Node): Node {
  const steps = body.type === "sequence" && Array.isArray(body.steps) ? (body.steps as Node[]) : [body];
  return { type: "rules-bundle", steps };
}

/**
 * `select-unit`'s own two wraps (pre-batch-5, moved here so `compile.ts` stays under the line
 * ceiling): a selection with no attack on it is only who "that unit" names, so it becomes a
 * `select-units` around the effects; one with an attack becomes a `designate-target`.
 */
export function selectUnit(selection: CompileLeaf, body: Node, extra: { maxCount?: Node; eligibility?: Node | null } = {}): Node {
  return {
    type: "select-units",
    selector: {
      owner: selection.parameters.scope === "friendly" ? "friendly" : "enemy",
      // "Select up to 2/3/4 units by battle size" selects a number, not exactly one.
      ...(extra.maxCount ? { max_count: extra.maxCount } : { count: 1 }),
      ...(extra.eligibility ? { eligibility: extra.eligibility } : {}),
      ...(selection.parameters.distance === "within" ? { within_inches: selection.parameters.inches } : {}),
      ...(selection.parameters.visible === true ? { visibility_required: true } : {}),
    },
    effect: body,
  };
}

/** The selected unit and the effects on attacks against it, as the DSL's designate-target. */
export function designation(selection: CompileLeaf, leaves: readonly CompileLeaf[], body: Node, lasting: string | undefined): Node {
  const attack = leaves.find((leaf) => leaf.family_id === "attack" && leaf.start_byte > selection.start_byte) ?? leaves.find((leaf) => leaf.family_id === "attack");
  if (!attack) throw new CompileError("A selected unit needs an attack leaf saying whose attacks against it are affected.");
  const own = attack.parameters.unit === "this-model";
  return {
    type: "designate-target",
    designation: "selected-unit",
    select: {
      scope: selection.parameters.scope === "friendly" ? "friendly-unit" : "enemy-unit",
      count: 1,
      ...(selection.parameters.distance === "within" ? { within_inches: selection.parameters.inches } : {}),
      ...(selection.parameters.visible === true ? { visibility_required: true } : {}),
    },
    applies: { to: own ? "bearer-attacks-target" : "attackers-of-target", effect: body },
    ...(lasting ? { duration: lasting } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Container openers: fold the leaf sentences after an opener into that opener's options.
// ---------------------------------------------------------------------------------------------

/**
 * One option's effect: every leaf in its sentence must be a plain EFFECT leaf. `attacker` is who
 * a roll-target family (re-roll, roll-modifier, ignore-modifiers, roll-auto-result,
 * critical-hit-threshold) defaults to with no attack leaf of its own — `null` keeps the platform
 * default (`this-unit`, the same default an un-contained effect gets); a container whose leaf
 * already names a bearer (persistent-designation's `beneficiary`) passes that name instead, so a
 * reroll inside it targets the same bearer the container itself names, not a second default.
 */
function effectsOf(leaves: readonly CompileLeaf[], attacker: string | null = null): Node {
  const bad = leaves.find((leaf) => leaf.role !== "EFFECT");
  if (bad) throw new CompileError(`An option here can only hold effect leaves; ${bad.family_id} has no place inside it.`);
  if (leaves.length === 0) throw new CompileError("An option has no effect.");
  const nodes = leaves.map((leaf) => effect(leaf, { attached: false, attacker, incoming: false }));
  return nodes.length === 1 ? nodes[0]! : { type: "sequence", steps: nodes };
}

/** A named option's leading `named-option` leaf, and the plain effect leaves after it. */
function namedOption(group: readonly CompileLeaf[], forRequirement: boolean): { name: unknown; effect: Node; marker: CompileLeaf } {
  const marker = group[0];
  if (!marker || marker.family_id !== "named-option") throw new CompileError("Each option here needs a leading named-option leaf giving its name.");
  if (forRequirement === (marker.parameters.requirement_type === undefined)) {
    throw new CompileError(forRequirement
      ? "A dice-pool-allocation option's named-option leaf needs a dice requirement."
      : "This option's named-option leaf carries a dice requirement, but nothing here uses one.");
  }
  return { name: closed(marker, "label"), effect: effectsOf(group.slice(1)), marker };
}

function buildChoice(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const options = groups.map((group) => effectsOf(group));
  const node: Node = { type: "choice", options };
  if (head.parameters.choice_label !== undefined) node.choice_label = closed(head, "choice_label");
  const min = head.parameters.min_choices;
  const max = head.parameters.max_choices;
  if (min !== undefined || max !== undefined) {
    if (min === undefined || max === undefined) throw new CompileError("choice-open needs both min_choices and max_choices, or neither.");
    node.min_choices = closed(head, "min_choices");
    node.max_choices = closed(head, "max_choices");
  }
  return node;
}

function buildStanceSelect(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const options = groups.map((group) => {
    const { name, effect: optionEffect } = namedOption(group, false);
    return { name, effect: optionEffect };
  });
  const node: Node = { type: "stance-select", mode: closed(head, "mode"), options };
  if (head.parameters.scope !== undefined) node.scope = closed(head, "scope");
  const min = head.parameters.min_choices;
  const max = head.parameters.max_choices;
  if (min !== undefined || max !== undefined) {
    if (min === undefined || max === undefined) throw new CompileError("stance-select-open needs both min_choices and max_choices, or neither.");
    node.min_choices = closed(head, "min_choices");
    node.max_choices = closed(head, "max_choices");
  }
  return node;
}

function buildIssueOrders(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const options = groups.map((group) => {
    const { name, effect: optionEffect } = namedOption(group, false);
    return { name, effect: optionEffect };
  });
  const node: Node = { type: "issue-orders", options };
  if (head.parameters.count !== undefined) node.count = closed(head, "count");
  if (head.parameters.range !== undefined) node.range = closed(head, "range");
  if (head.parameters.eligible_keyword !== undefined) node.eligible = { keyword: closed(head, "eligible_keyword") };
  return node;
}

function buildDicePoolAllocation(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const options = groups.map((group) => {
    const { name, effect: optionEffect, marker } = namedOption(group, true);
    return { name, requirement: { type: closed(marker, "requirement_type"), min_value: closed(marker, "requirement_min_value") }, effect: optionEffect };
  });
  return {
    type: "dice-pool-allocation",
    pool: { count: closed(head, "pool_count"), die: closed(head, "pool_die") },
    max_activations: closed(head, "max_activations"),
    options,
  };
}

/** risk-reward: its first group is led by on-fail-open (risk.on_fail); the rest is the reward — one effect, or a choice among several. */
function buildRiskReward(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const [onFailGroup, ...rewardGroups] = groups;
  const marker = onFailGroup![0];
  if (!marker || marker.family_id !== "on-fail-open") throw new CompileError("risk-reward-open's first sentence needs a leading on-fail-open leaf.");
  const onFail = effectsOf(onFailGroup!.slice(1));
  const reward: Node = rewardGroups.length === 1
    ? effectsOf(rewardGroups[0]!)
    : { type: "choice", options: rewardGroups.map((group) => effectsOf(group)) };
  if (rewardGroups.length > 1 && head.parameters.reward_choice_label !== undefined) reward.choice_label = closed(head, "reward_choice_label");
  return { type: "risk-reward", reward, risk: { test: closed(head, "test"), on_fail: onFail } };
}

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

/**
 * A menu-action's own eligibility, read from ordinary leaves in its group rather than flags: a
 * `unit-keyword` CONDITION leaf becomes `requires_keyword` (negated: `excludes_keyword`), and a
 * `select-unit` leaf's presence becomes `selector_count: 1` — the only count any authored record
 * needs so far. Returns the eligibility fields and how many leading leaves they consumed.
 */
function menuActionEligibility(group: readonly CompileLeaf[]): { eligibility: Node; consumed: number } {
  const requiresKeyword: string[] = [];
  const excludesKeyword: string[] = [];
  let selectorCount: number | undefined;
  let cursor = 0;
  while (group[cursor]) {
    const leaf = group[cursor]!;
    if (leaf.role === "CONDITION" && leaf.family_id === "unit-keyword") {
      const keywords = closed(leaf, "keywords") as string[];
      (leaf.parameters.negated === true ? excludesKeyword : requiresKeyword).push(...keywords);
      cursor += 1;
      continue;
    }
    if (leaf.role === "EVENT" && leaf.family_id === "select-unit") {
      selectorCount = 1;
      cursor += 1;
      continue;
    }
    break;
  }
  const eligibility: Node = {};
  if (requiresKeyword.length) eligibility.requires_keyword = requiresKeyword;
  if (excludesKeyword.length) eligibility.excludes_keyword = excludesKeyword;
  if (selectorCount !== undefined) eligibility.selector_count = selectorCount;
  return { eligibility, consumed: cursor };
}

/** resource-action-menu: each group is led by menu-action; the leaves after it (past eligibility) are its trigger(s) (`when`, one or several alternatives), then its effect. */
function buildResourceActionMenu(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const actions = groups.map((group) => {
    const marker = group[0];
    if (!marker || marker.family_id !== "menu-action") throw new CompileError("Each resource-action-menu action needs a leading menu-action leaf.");
    const { eligibility: keywordEligibility, consumed } = menuActionEligibility(group.slice(1));
    let cursor = 1 + consumed;
    const whenLeaves: CompileLeaf[] = [];
    while (group[cursor] && group[cursor]!.role === "EVENT") { whenLeaves.push(group[cursor]!); cursor += 1; }
    if (whenLeaves.length === 0) throw new CompileError("A menu-action needs its own trigger leaf (an EVENT leaf) after its marker and any eligibility leaves.");
    const triggers = whenLeaves.map((leaf) => trigger(leaf));
    const when: Node | Node[] = triggers.length === 1 ? triggers[0]! : triggers;
    if (marker.parameters.binds_event_variable !== undefined && !Array.isArray(when)) when.binds_event_variable = closed(marker, "binds_event_variable");
    const cost: Node = { pool_id: marker.parameters.cost_pool_id !== undefined ? closed(marker, "cost_pool_id") : closed(head, "pool_id"), amount: closed(marker, "cost_amount") };
    if (marker.parameters.cost_resource_label !== undefined) cost.resource_label = closed(marker, "cost_resource_label");
    const action: Node = { id: closed(marker, "action_id"), label: closed(marker, "label"), when, cost, effect: effectsOf(group.slice(cursor)) };
    const eligibility: Node = { ...keywordEligibility };
    const requires = boundEligibilityRequires(marker);
    if (requires.length) eligibility.requires = requires;
    if (Object.keys(eligibility).length) action.eligibility = eligibility;
    if (marker.parameters.duration !== undefined) action.duration = closed(marker, "duration");
    if (marker.parameters.repeatable_if_different_unit === true) action.usage = { repeatable_if_different_unit: true };
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

function buildPersistentDesignation(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const scope = closed(head, "scope") as string;
  const beneficiary = closed(head, "beneficiary") as string;
  return {
    type: "persistent-designation",
    designation: closed(head, "designation"),
    select: { scope, count: 1, timing: closed(head, "timing"), selection_policy: "one-time" },
    consumer: {
      relation: scope === "enemy-unit" ? "attacks-selected-unit" : "within-selected-marker",
      beneficiary: beneficiary === "this-model" ? "bearer" : "unit",
      // The consumer's effect targets the same bearer the container already names — a reroll
      // inside it (no attack leaf of its own) should read "this-model", not fall back to the
      // platform's ordinary "this-unit" default, when beneficiary is this-model.
      effect: effectsOf(groups[0]!, beneficiary),
    },
    duration: "battle",
  };
}

function buildSelectObjective(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const selector: Node = { bind_as: closed(head, "bind_as") };
  selector.count = head.parameters.each === true ? "each" : head.parameters.count !== undefined ? closed(head, "count") : 1;
  if (head.parameters.range_inches !== undefined) selector.range_inches = closed(head, "range_inches");
  if (head.parameters.origin !== undefined) selector.origin = closed(head, "origin") === "this-model" ? "bearer" : "bearer-unit";
  if (head.parameters.controlled_by !== undefined) selector.controlled_by = closed(head, "controlled_by");
  return { type: "select-objective", selector, effect: effectsOf(groups[0]!) };
}

function buildContainer(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  switch (head.family_id) {
    case "choice-open": return buildChoice(head, groups);
    case "stance-select-open": return buildStanceSelect(head, groups);
    case "issue-orders-open": return buildIssueOrders(head, groups);
    case "dice-pool-allocation-open": return buildDicePoolAllocation(head, groups);
    case "risk-reward-open": return buildRiskReward(head, groups);
    case "resource-action-menu-open": return buildResourceActionMenu(head, groups);
    case "persistent-designation-open": return buildPersistentDesignation(head, groups);
    default: return buildSelectObjective(head, groups);
  }
}

export type ContainerPlan = { nodes: Map<number, Node>; consumed: Set<number> };

/**
 * Find every container-opener leaf in `list` and fold the leaves after each one — up to the next
 * opener or the end of the list — into its options, one option per run of same-sentence leaves.
 * `sentenceOf[i]` is `list[i]`'s sentence number, from `compile.ts`'s own placement pass.
 * `consumed` names every option leaf's index, so `compile.ts` can skip it everywhere else; the
 * opener itself keeps its own index and role (EFFECT), becoming one ordinary planned effect whose
 * node is `nodes.get(openerIndex)`.
 */
export function planContainers(list: readonly CompileLeaf[], sentenceOf: readonly number[]): ContainerPlan {
  const nodes = new Map<number, Node>();
  const consumed = new Set<number>();
  list.forEach((leaf, index) => {
    if (!LEADING_CONTAINERS.has(leaf.family_id)) return;
    const groups: CompileLeaf[][] = [];
    let current: CompileLeaf[] = [];
    let currentSentence: number | null = null;
    for (let cursor = index + 1; cursor < list.length && !LEADING_CONTAINERS.has(list[cursor]!.family_id); cursor += 1) {
      const sentence = sentenceOf[cursor]!;
      if (currentSentence === null || sentence !== currentSentence) {
        if (current.length) groups.push(current);
        current = [];
        currentSentence = sentence;
      }
      current.push(list[cursor]!);
      consumed.add(cursor);
    }
    if (current.length) groups.push(current);
    // resource-action-menu-open's own actions must each lead with a menu-action marker; a
    // trailing sentence that doesn't (Battle Focus's own "at the end of the round, clear the
    // pool" ability-part) is not one of its actions — give those leaves back to the ordinary
    // compileLeaves pipeline, which already turns a later trigger+effect into its own part.
    if (leaf.family_id === "resource-action-menu-open") {
      while (groups.length && groups.at(-1)![0]!.family_id !== "menu-action") {
        for (const returned of groups.pop()!) consumed.delete(list.indexOf(returned));
      }
    }
    if (SINGLE_BODY_CONTAINERS.has(leaf.family_id)) {
      if (groups.length !== 1) throw new CompileError(`${leaf.family_id} needs exactly one sentence after it, its own effect.`);
    } else if (ONE_OR_MORE_CONTAINERS.has(leaf.family_id)) {
      if (groups.length < 1) throw new CompileError(`${leaf.family_id} needs at least one option after it.`);
    } else if (groups.length < 2) {
      throw new CompileError(`${leaf.family_id} needs at least two options after it, one sentence each.`);
    }
    nodes.set(index, buildContainer(leaf, groups));
  });
  return { nodes, consumed };
}
