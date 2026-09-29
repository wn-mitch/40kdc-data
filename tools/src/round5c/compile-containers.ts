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
export function selectUnit(selection: CompileLeaf, body: Node): Node {
  return {
    type: "select-units",
    selector: {
      owner: selection.parameters.scope === "friendly" ? "friendly" : "enemy",
      count: 1,
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

/** One option's effect: every leaf in its sentence must be a plain EFFECT leaf. */
function effectsOf(leaves: readonly CompileLeaf[]): Node {
  const bad = leaves.find((leaf) => leaf.role !== "EFFECT");
  if (bad) throw new CompileError(`An option here can only hold effect leaves; ${bad.family_id} has no place inside it.`);
  if (leaves.length === 0) throw new CompileError("An option has no effect.");
  const nodes = leaves.map((leaf) => effect(leaf, { attached: false, attacker: null, incoming: false }));
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
  const reward = rewardGroups.length === 1 ? effectsOf(rewardGroups[0]!) : { type: "choice", options: rewardGroups.map((group) => effectsOf(group)) };
  return { type: "risk-reward", reward, risk: { test: closed(head, "test"), on_fail: onFail } };
}

/** resource-action-menu: each group is led by menu-action, whose own next leaf is that action's trigger (`when`). */
function buildResourceActionMenu(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const actions = groups.map((group) => {
    const marker = group[0];
    if (!marker || marker.family_id !== "menu-action") throw new CompileError("Each resource-action-menu action needs a leading menu-action leaf.");
    const when = group[1];
    if (!when || when.role !== "EVENT") throw new CompileError("A menu-action needs its own trigger leaf (an EVENT leaf) right after it.");
    const cost: Node = { pool_id: marker.parameters.cost_pool_id !== undefined ? closed(marker, "cost_pool_id") : closed(head, "pool_id"), amount: closed(marker, "cost_amount") };
    if (marker.parameters.cost_resource_label !== undefined) cost.resource_label = closed(marker, "cost_resource_label");
    const action: Node = { id: closed(marker, "action_id"), label: closed(marker, "label"), when: trigger(when), cost, effect: effectsOf(group.slice(2)) };
    if (marker.parameters.duration !== undefined) action.duration = closed(marker, "duration");
    if (marker.parameters.repeatable_if_different_unit === true) action.usage = { repeatable_if_different_unit: true };
    return action;
  });
  const node: Node = { type: "resource-action-menu", menu_id: closed(head, "menu_id"), pool_id: closed(head, "pool_id"), actions };
  const sharedUsage: Node = {};
  if (head.parameters.unit_max_manoeuvres_per_phase !== undefined) sharedUsage.unit_max_manoeuvres_per_phase = closed(head, "unit_max_manoeuvres_per_phase");
  if (head.parameters.default_manoeuvre_max_per_phase !== undefined) sharedUsage.default_manoeuvre_max_per_phase = closed(head, "default_manoeuvre_max_per_phase");
  if (Object.keys(sharedUsage).length) node.shared_usage = sharedUsage;
  return node;
}

function buildPersistentDesignation(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const scope = closed(head, "scope") as string;
  return {
    type: "persistent-designation",
    designation: closed(head, "designation"),
    select: { scope, count: 1, timing: closed(head, "timing"), selection_policy: "one-time" },
    consumer: {
      relation: scope === "enemy-unit" ? "attacks-selected-unit" : "within-selected-marker",
      beneficiary: closed(head, "beneficiary") === "this-model" ? "bearer" : "unit",
      effect: effectsOf(groups[0]!),
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
