import { closed, CompileError, effect, type CompileLeaf } from "./compile-fragments.js";
import { trigger, triggerLeaves } from "./compile-triggers.js";

/**
 * Container fragments (batch 5). `compile.ts` delegates here in two ways:
 *
 * - Wrapping leaves (`aura-range`, `leader-target`, `for-each-unit-select`, `rules-bundle-marker`)
 *   sit anywhere among an otherwise ordinary ability's leaves; `compile.ts` finds them during its
 *   own leaf walk and calls the matching `wrap*` function (`compile-wrappers.ts`) on the body it
 *   already assembled, the same way it wraps a `select-unit` leaf into `select-units` or `designate-target`.
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
/** Openers each of whose options leads with a named-option leaf. */
const NAMED_OPTION_CONTAINERS = new Set(["stance-select-open", "issue-orders-open", "dice-pool-allocation-open"]);
/** Openers whose options may number just one (the DSL's own `actions`/`outcomes` array allows it). */
const ONE_OR_MORE_CONTAINERS = new Set(["resource-action-menu-open"]);

export function isContainerOpener(familyId: string): boolean {
  return LEADING_CONTAINERS.has(familyId);
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
  // One shared allowance over these options only ("the assault doctrine or tactical doctrine").
  if (leaf.parameters.option_ids !== undefined) modifier.option_ids = [...(closed(leaf, "option_ids") as string[])];
  const node: Node = { type: "stance-selection-capacity", modifier };
  if (leaf.parameters.scope !== undefined) node.scope = closed(leaf, "scope");
  return node;
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
function effectsOf(leaves: readonly CompileLeaf[], attacker: Record<string, unknown> | string | null = null): Node {
  if (leaves.length === 0) throw new CompileError("An option has no effect.");
  const bad = leaves.find((leaf) => leaf.role !== "EFFECT");
  if (bad) {
    // An option with its own moment or conditions ("Each time a model in this unit makes a
    // Pile-in move, …") compiles like a whole ability of its own, as one ability-part.
    if (nestedCompiler) return nestedCompiler(leaves);
    throw new CompileError(`An option here can only hold effect leaves; ${bad.family_id} has no place inside it.`);
  }
  const nodes = leaves.map((leaf) => effect(leaf, { attached: false, attacker, incoming: false }));
  return nodes.length === 1 ? nodes[0]! : { type: "sequence", steps: nodes };
}

/**
 * Compiles an option's leaves as a self-contained ability (trigger, conditions, effects), set by
 * `planContainers` for the duration of one plan: `compile.ts` owns that pipeline, and passing it in
 * keeps this module free of an import cycle.
 */
let nestedCompiler: ((leaves: readonly CompileLeaf[]) => Node) | null = null;

/** A named option's leading `named-option` leaf, and the plain effect leaves after it. */
function namedOption(group: readonly CompileLeaf[], forRequirement: boolean): { name: unknown; effect: Node; marker: CompileLeaf } {
  const marker = group[0];
  if (!marker || marker.family_id !== "named-option") throw new CompileError("Each option here needs a leading named-option leaf giving its name.");
  const hasRequirement = marker.parameters.requirement_type !== undefined || marker.parameters.requirement_any_of !== undefined;
  if (forRequirement !== hasRequirement) {
    throw new CompileError(forRequirement
      ? "A dice-pool-allocation option's named-option leaf needs a dice requirement."
      : "This option's named-option leaf carries a dice requirement, but nothing here uses one.");
  }
  return { name: closed(marker, "label"), effect: effectsOf(group.slice(1)), marker };
}

function buildChoice(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  // A DSL choice's options carry no names, so a named-option heading adds nothing to its option.
  const options = groups.map((group) => effectsOf(group[0]?.family_id === "named-option" ? group.slice(1) : group));
  const node: Node = { type: "choice", options };
  if (head.parameters.choice_label !== undefined) node.choice_label = closed(head, "choice_label");
  const min = head.parameters.min_choices;
  const max = head.parameters.max_choices;
  if (min !== undefined || max !== undefined) {
    if (min === undefined || max === undefined) throw new CompileError("choice-open needs both min_choices and max_choices, or neither.");
    node.min_choices = closed(head, "min_choices");
    node.max_choices = closed(head, "max_choices");
  }
  return head.parameters.or_random === undefined ? node : orRandom(node, options, head.parameters.or_random as { dice: string; count: number });
}

/**
 * "either select one from the list below, or randomly select two by rolling two D6": a choice
 * between the selection and rolling count dice on a table whose faces are the options in order.
 */
function orRandom(selection: Node, options: Node[], random: { dice: string; count: number }): Node {
  const faces = random.dice === "D3" ? 3 : 6;
  if (options.length !== faces) throw new CompileError(`Randomly selecting by rolling a ${random.dice} needs exactly ${faces} numbered options; found ${options.length}.`);
  const table: Node = { type: "dice-table", dice: random.dice, outcomes: options.map((effect, at) => ({ results: [at + 1], effect: structuredClone(effect) })) };
  if (random.count > 1) table.count = random.count;
  return { type: "choice", options: [selection, table] };
}

function buildStanceSelect(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const options = groups.map((group) => {
    const { name, effect: optionEffect } = namedOption(group, false);
    return { name, effect: optionEffect };
  });
  const node: Node = { type: "stance-select", mode: closed(head, "mode"), options };
  if (head.parameters.scope !== undefined) node.scope = closed(head, "scope");
  // "in addition to any other combat doctrine": the pick joins the active options instead of replacing them.
  if (head.parameters.additive === true) node.additive = true;
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
    const requirement = marker.parameters.requirement_any_of !== undefined
      ? { any_of: closed(marker, "requirement_any_of") }
      : { type: closed(marker, "requirement_type"), min_value: closed(marker, "requirement_min_value") };
    return { name, requirement, effect: optionEffect };
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
    const triggers = whenLeaves.flatMap((leaf) => triggerLeaves(leaf).map((each) => trigger(each)));
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
    // "This ability can be used even if this unit is embarked" (compile-embarked-permission.ts).
    select: { scope, count: 1, timing: closed(head, "timing"), selection_policy: "one-time", ...(head.parameters.allow_while_embarked === true ? { allow_while_embarked: true } : {}) },
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
export function planContainers(
  list: readonly CompileLeaf[], sentenceOf: readonly number[], nested: ((leaves: readonly CompileLeaf[]) => Node) | null = null, bullets: readonly boolean[] = [],
): ContainerPlan {
  const outer = nestedCompiler;
  nestedCompiler = nested;
  try {
    return planContainerNodes(list, sentenceOf, bullets);
  } finally {
    nestedCompiler = outer;
  }
}

function planContainerNodes(list: readonly CompileLeaf[], sentenceOf: readonly number[], bullets: readonly boolean[]): ContainerPlan {
  const nodes = new Map<number, Node>();
  const consumed = new Set<number>();
  list.forEach((leaf, index) => {
    if (!LEADING_CONTAINERS.has(leaf.family_id)) return;
    const groups: CompileLeaf[][] = [];
    let current: CompileLeaf[] = [];
    let currentSentence: number | null = null;
    // A choice-open also starts an option at each bullet ("■"), whatever the punctuation. Its options
    // are bullet-certain when every boundary between them is a bullet, not a sentence break inside one.
    let sentenceBoundaries = 0;
    let bulletBoundaries = 0;
    // Under a named-option container each option begins at its marker, whatever the punctuation
    // ("roll one D6: on a 4+" stays in one option; a heading with no full stop does not leak).
    // A choice whose options carry named-option markers splits at them too.
    const byMarker = NAMED_OPTION_CONTAINERS.has(leaf.family_id)
      || (leaf.family_id === "choice-open" && list.slice(index + 1).some((item) => item.family_id === "named-option"));
    for (let cursor = index + 1; cursor < list.length && !LEADING_CONTAINERS.has(list[cursor]!.family_id); cursor += 1) {
      const sentence = sentenceOf[cursor]!;
      const bulletStarts = leaf.family_id === "choice-open" && bullets[cursor] === true;
      const starts = byMarker ? list[cursor]!.family_id === "named-option" : currentSentence === null || sentence !== currentSentence || bulletStarts;
      if (starts) {
        if (currentSentence !== null) {
          if (bulletStarts) bulletBoundaries += 1;
          else sentenceBoundaries += 1;
        }
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
    // Ability-wide sentences between an opener and its first named option ("You can only activate
    // each one once per battle round", "until the end of the battle round") carry no option of
    // their own; their leaves go back to the ordinary pipeline, which already places a usage
    // limit, a duration or a gate on the whole ability.
    // The same holds for any opener whose leading groups have no effect at all ("this model has
    // that ability", "until the start of your next Command phase"): no option is only a gate.
    while (!SINGLE_BODY_CONTAINERS.has(leaf.family_id) && groups.length && groups[0]![0]!.family_id !== "named-option" && groups[0]!.every((item) => item.role !== "EFFECT")) {
      for (const returned of groups.shift()!) consumed.delete(list.indexOf(returned));
    }
    if (SINGLE_BODY_CONTAINERS.has(leaf.family_id)) {
      if (groups.length !== 1) throw new CompileError(`${leaf.family_id} needs exactly one sentence after it, its own effect.`);
    } else if (ONE_OR_MORE_CONTAINERS.has(leaf.family_id)) {
      if (groups.length < 1) throw new CompileError(`${leaf.family_id} needs at least one option after it.`);
    } else if (groups.length < 2) {
      throw new CompileError(`${leaf.family_id} needs at least two options after it, one sentence each.`);
    }
    // An option compiles as a whole ability only where its bounds are certain: a named option's
    // marker, or a single body. Sentence-split options ("…; if that test is passed, gain 1CP")
    // can cut one option in two, so those keep refusing a non-effect leaf.
    const outer = nestedCompiler;
    const bulletCertain = leaf.family_id === "choice-open" && bulletBoundaries > 0 && sentenceBoundaries === 0;
    if (!byMarker && !SINGLE_BODY_CONTAINERS.has(leaf.family_id) && !bulletCertain) nestedCompiler = null;
    try {
      nodes.set(index, buildContainer(leaf, groups));
    } finally {
      nestedCompiler = outer;
    }
  });
  return { nodes, consumed };
}
