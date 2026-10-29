import { closed, CompileError, effect, type CompileLeaf } from "./compile-fragments.js";
import { initialOption } from "./compile-stance-initial.js";
import { trigger, triggerLeaves } from "./compile-triggers.js";
import { canonicalDesignation, designationChoices, findReplacementOpeners, refuseEstablishmentCount, replacementTail, splitReplacementTail } from "./compile-redesignate.js";
import { selectionFilter } from "./compile-wrappers.js";
import { buildResourceActionMenu } from "./compile-resource-menu.js";
import { condition, duration } from "./compile-conditions.js";
import { gatedMoment } from "./compile-usability-gate.js";

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
/** A leaf that starts its own moment, duration or usage: the sentence holding it is independent of the one before. */
const OWN_MOMENT_FAMILIES = new Set(["usage-limit", "usage-scope", "phase-window"]);
const opensOwnMoment = (leaf: CompileLeaf) => leaf.role === "EVENT" || leaf.role === "DURATION" || OWN_MOMENT_FAMILIES.has(leaf.family_id) || LEADING_CONTAINERS.has(leaf.family_id);
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
  const stanceId = closed(leaf, "stance_id") as string;
  const modifier: Node = {
    ability_id: stanceId,
    additional_selections: closed(leaf, "additional_selections"),
    allocation: closed(leaf, "allocation"),
  };
  if (leaf.parameters.option_id !== undefined) {
    modifier.option = { ability_id: stanceId, option_id: closed(leaf, "option_id") };
  }
  // One shared allowance over these options only ("the assault doctrine or tactical doctrine").
  if (leaf.parameters.option_ids !== undefined) {
    modifier.options = [...(closed(leaf, "option_ids") as string[])]
      .map((optionId) => ({ ability_id: stanceId, option_id: optionId }));
  }
  return { type: "stance-selection-capacity", modifier };
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
function effectsOf(leaves: readonly CompileLeaf[], attacker: Record<string, unknown> | string | null = null, objective?: string): Node {
  if (leaves.length === 0) throw new CompileError("An option has no effect.");
  const bad = leaves.find((leaf) => leaf.role !== "EFFECT");
  if (bad) {
    // An option with its own moment or conditions ("Each time a model in this unit makes a
    // Pile-in move, …") compiles like a whole ability of its own, as one ability-part.
    if (nestedCompiler) return nestedCompiler(leaves, objective);
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
let nestedCompiler: ((leaves: readonly CompileLeaf[], objective?: string) => Node) | null = null;

/**
 * What choosing any option of the menu being built does, printed once before the first option
 * ("If you do, that unit is no longer readied"); null when nothing is. Set by `planContainers`.
 */
let sharedOptionSteps: Node | null = null;

/**
 * An option with the shared steps added: inside an option's own part, after its moment and before
 * its conditions, so they happen when the option is used and are no gate of its effects.
 */
function withSharedSteps(option: Node, shared: Node): Node {
  const steps = (node: Node) => node.type === "sequence" ? node.steps as Node[] : [node];
  if (option.type === "ability-part") return { ...option, effect: { type: "sequence", steps: [...steps(shared), ...steps(option.effect as Node)] } };
  return { type: "sequence", steps: [...steps(shared), ...steps(option)] };
}

/** A named option's leading `named-option` leaf, and the plain effect leaves after it. */
function namedOption(group: readonly CompileLeaf[], forRequirement: boolean, sourceIndex = 0): { id: string; name: unknown; effect: Node; marker: CompileLeaf } {
  const marker = group[0];
  if (!marker || marker.family_id !== "named-option") throw new CompileError("Each option here needs a leading named-option leaf giving its name.");
  const hasRequirement = marker.parameters.requirement_type !== undefined || marker.parameters.requirement_any_of !== undefined;
  if (forRequirement !== hasRequirement) {
    throw new CompileError(forRequirement
      ? "A dice-pool-allocation option's named-option leaf needs a dice requirement."
      : "This option's named-option leaf carries a dice requirement, but nothing here uses one.");
  }
  // The option's identity is its reviewed option_id: references name it, so it is never derived
  // from the mutable display label or from the option's position.
  const reviewedId = marker.parameters.option_id;
  if (typeof reviewedId !== "string" || reviewedId.length === 0) {
    throw new CompileError(`Option ${sourceIndex + 1}'s named-option leaf needs a reviewed option_id.`);
  }
  const id = reviewedId;
  const effect = effectsOf(group.slice(1));
  return { id, name: closed(marker, "label"), effect: sharedOptionSteps === null ? effect : withSharedSteps(effect, sharedOptionSteps), marker };
}

function buildChoice(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  if (head.parameters.ignore_consumed === true) throw new CompileError("choice-open ignore_consumed is a pick an activation names; a menu of options takes none.");
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
  const options = groups.map((group, index) => {
    const { id, name, effect: optionEffect } = namedOption(group, false, index);
    return { id, name, effect: optionEffect };
  });
  // "At the start of the battle, that unit enters Aegis Protocols": the option in force before any selection (compile-stance-initial.ts).
  const node: Node = { type: "stance-select", mode: closed(head, "mode"), options, ...initialOption(head, options) };
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


/**
 * An issue-orders: its own Orders, one per named option, or none, when an officer's datasheet issues
 * the Orders its faction's army rule lists (`menu_from`, resolved by compile-rule-refs.ts).
 */
function buildIssueOrders(head: CompileLeaf, groups: CompileLeaf[][], rules: readonly CompileLeaf[]): Node {
  const options = groups.map((group, index) => {
    const { id, name, effect: optionEffect } = namedOption(group, false, index);
    return { id, name, effect: optionEffect };
  });
  const node: Node = { type: "issue-orders" };
  if (options.length > 0) node.options = options;
  else if (typeof head.parameters.__menu === "string") node.menu_from = head.parameters.__menu;
  else throw new CompileError("An issue-orders with no Orders of its own needs its faction's one army rule that lists them.");
  if (head.parameters.count !== undefined) node.count = closed(head, "count");
  if (head.parameters.range !== undefined) node.range = { inches: closed(head, "range") };
  if (head.parameters.eligible_keyword !== undefined) node.eligible = { all_of: [closed(head, "eligible_keyword")] };
  if (head.parameters.__eligible !== undefined) node.eligible = head.parameters.__eligible;
  const ruled = orderRules(rules);
  if (ruled.only_options !== undefined && node.menu_from === undefined) throw new CompileError("Only some Orders of a menu: the issue-orders must take its Orders from its army rule.");
  return { ...node, ...ruled };
}

/**
 * When Orders are issued and how long one lasts, printed between the opener and its first Order
 * ("… can issue Orders in your Command phase and at the end of a phase in which they disembarked …
 * Until the start of your next Command phase, the unit you selected is affected by that Order").
 * Each window or moment is one alternative trigger, gated by the conditions after it in its clause;
 * the duration bounds the issued Order; "is affected by that Order" is what issuing one means.
 */
function issueOrdersTiming(leaves: readonly CompileLeaf[]): { trigger: Node | Node[]; duration?: string } | null {
  const moments: Array<{ moment: Node; gates: Node[] }> = [];
  let lifetime: string | undefined;
  for (const leaf of leaves) {
    if (leaf.family_id === "phase-window") {
      // "in your Command phase": Orders are issued in that phase, from its start.
      moments.push({ moment: { event: "phase-started", condition: condition(leaf) }, gates: [] });
    } else if (leaf.role === "EVENT" && leaf.family_id === "event") {
      for (const each of triggerLeaves(leaf)) moments.push({ moment: trigger(each), gates: [] });
    } else if (leaf.role === "CONDITION") {
      const last = moments.at(-1);
      if (!last) throw new CompileError("An issue-orders condition needs the window or moment it gates before it.");
      last.gates.push(condition(leaf));
    } else if (leaf.role === "DURATION") {
      if (lifetime !== undefined) throw new CompileError("An issued Order lasts for one printed duration.");
      lifetime = duration(leaf);
    } else if (!(leaf.family_id === "apply-mark" && leaf.parameters.tag === "affected-by-order" && leaf.parameters.subject === "selected-unit")) {
      throw new CompileError(`${leaf.family_id} has no place in when Orders are issued.`);
    }
  }
  if (moments.length === 0) return lifetime === undefined ? null : { trigger: [], duration: lifetime };
  const triggers = moments.map(({ moment, gates }) => gatedMoment(moment, gates));
  return { trigger: triggers.length === 1 ? triggers[0]! : triggers, ...(lifetime === undefined ? {} : { duration: lifetime }) };
}

/** The issue-orders fields its order-rule leaves set, wherever the record prints them; a repeated rule must agree. */
function orderRules(rules: readonly CompileLeaf[]): Node {
  const out: Node = {};
  const keywords = (key: string, leaf: CompileLeaf) => {
    const all_of = closed(leaf, "keywords") as string[];
    const existing = out[key] as { all_of: string[] } | undefined;
    if (existing && JSON.stringify(existing.all_of) !== JSON.stringify(all_of)) throw new CompileError(`Two order-rule leaves name different ${key} keywords.`);
    out[key] = { all_of };
  };
  const states = (key: string, leaf: CompileLeaf) => {
    out[key] = [...new Set([...((out[key] as string[] | undefined) ?? []), closed(leaf, "state") as string])];
  };
  for (const leaf of rules) {
    switch (leaf.parameters.rule) {
      case "issuer": keywords("issuer", leaf); break;
      case "benefit": keywords("benefit", leaf); break;
      case "one-at-a-time": out.one_at_a_time = true; break;
      case "ineligible-state": states("ineligible_states", leaf); break;
      case "ends-on-state": states("ends_on", leaf); break;
      case "only-orders": {
        if (!Array.isArray(leaf.parameters.__options)) throw new CompileError(`The Orders ${JSON.stringify(leaf.parameters.orders)} are not all Orders of the faction's army rule.`);
        if (out.only_options !== undefined) throw new CompileError("An officer's Orders are narrowed by one only-orders rule.");
        out.only_options = leaf.parameters.__options;
        break;
      }
      default: throw new CompileError(`order-rule ${String(leaf.parameters.rule)} has no issue-orders field.`);
    }
  }
  return out;
}

function buildDicePoolAllocation(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const options = groups.map((group, index) => {
    const { id, name, effect: optionEffect, marker } = namedOption(group, true, index);
    const requirement = marker.parameters.requirement_any_of !== undefined
      ? { any_of: closed(marker, "requirement_any_of") }
      : { type: closed(marker, "requirement_type"), min_value: closed(marker, "requirement_min_value") };
    return { id, name, requirement, effect: optionEffect };
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

/**
 * A persistent designation. With a `replacement` (its trigger, selection and may-clause, see
 * compile-redesignate.ts), the selection is the one that replaces the designated unit when it is
 * destroyed: it binds a selection variable that the consumer and the lifecycle both reference.
 */
function persistentDesignationTiming(list: readonly CompileLeaf[], sentenceOf: readonly number[], index: number): Node | undefined {
  const head = list[index]!;
  if (head.parameters.timing !== "start-of-first-battle-round") return undefined;
  let battleStart = false;
  for (let at = index - 1; at >= 0 && sentenceOf[at] === sentenceOf[index] && list[at]!.role !== "EFFECT"; at -= 1) {
    const item = list[at]!;
    if (item.family_id === "event" && item.parameters.kind === "battle-started") battleStart = true;
  }
  if (battleStart) return { event: "battle-started" };
  return { event: "round-started", condition: { type: "battle-round", parameters: { min: 1, max: 1 } } };
}

function buildPersistentDesignation(head: CompileLeaf, groups: CompileLeaf[][], replacement?: { optional: boolean }, timing?: Node): Node {
  const scope = closed(head, "scope") as string;
  const beneficiary = closed(head, "beneficiary") as string;
  const designation = canonicalDesignation(closed(head, "designation"));
  const bindAs = `${designation}-selection`;
  const objective = scope === "objective-marker";
  const selector: Node = objective
    ? { filter: {}, count: { min: 1, max: 1 }, bind_as: bindAs }
    : {
      filter: selectionFilter({ ...head, parameters: { ...head.parameters, scope: scope === "enemy-unit" ? "enemy" : "friendly" } }),
      count: { min: 1, max: 1 },
      bind_as: bindAs,
    };
  const node: Node = {
    type: "persistent-designation",
    designation,
    select: { kind: objective ? "objective" : "unit", selector },
    selection_policy: replacement ? "replace-on-destroyed" : "one-time",
    ...(head.parameters.allow_while_embarked === true ? { allow_while_embarked: true } : {}),
    consumer: {
      relation: scope === "enemy-unit" ? "attacks-selected-unit" : "within-selected-marker",
      beneficiary: beneficiary === "this-model" ? "this-model" : "this-unit",
      effect: effectsOf(groups[0]!, beneficiary),
    },
    duration: "battle",
  };
  if (replacement) {
    (node.consumer as Node).reference = { selection_var: bindAs };
    node.lifecycle = {
      replace: { event: "on-unit-destroyed", reference: { selection_var: bindAs }, optional: replacement.optional },
      exclusivity: "one-active-per-bearer-unit",
    };
  }
  return timing === undefined ? node : { type: "ability-part", trigger: timing, effect: node };
}

function buildSelectObjective(head: CompileLeaf, groups: CompileLeaf[][]): Node {
  const filter: Node = {};
  if (head.parameters.controlled_by !== undefined) {
    filter.controlled_by = closed(head, "controlled_by") === "your-army" ? "friendly" : "enemy";
  }
  if (head.parameters.range_inches !== undefined) {
    filter.within = {
      range: { inches: closed(head, "range_inches") },
      of: head.parameters.origin !== undefined ? closed(head, "origin") : "this-model",
    };
  } else if (head.parameters.origin !== undefined) {
    // An origin without a distance is the origin's own reach: "an objective your unit is controlling".
    filter.within = { range: "objective-control", of: closed(head, "origin") };
  }
  // Folded from objective-criterion leaves (compile-objective-criteria.ts).
  if (head.parameters.controlled_by_unit !== undefined) filter.controlled_by_unit = head.parameters.controlled_by_unit;
  if (head.parameters.clear_of !== undefined) filter.clear_of = head.parameters.clear_of;
  const selector: Node = { filter, bind_as: closed(head, "bind_as") };
  if (head.parameters.each !== true) {
    const count = head.parameters.count !== undefined ? closed(head, "count") : 1;
    selector.count = { min: count, max: count };
  }
  // The body names the objective this select bound, so a move-end inside it can end nearest that objective.
  return { type: "select-objective", selector, effect: effectsOf(groups[0]!, null, String(selector.bind_as)) };
}

function buildContainer(head: CompileLeaf, groups: CompileLeaf[][], replacement?: { optional: boolean }, timing?: Node, orderRuleLeaves: readonly CompileLeaf[] = []): Node {
  switch (head.family_id) {
    case "choice-open": return buildChoice(head, groups);
    case "stance-select-open": return buildStanceSelect(head, groups);
    case "issue-orders-open": return buildIssueOrders(head, groups, orderRuleLeaves);
    case "dice-pool-allocation-open": return buildDicePoolAllocation(head, groups);
    case "risk-reward-open": return buildRiskReward(head, groups);
    case "resource-action-menu-open": return buildResourceActionMenu(head, groups, (leaves) => effectsOf(leaves));
    case "persistent-designation-open": return buildPersistentDesignation(head, groups, replacement, timing);
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
  list: readonly CompileLeaf[], sentenceOf: readonly number[], nested: ((leaves: readonly CompileLeaf[], objective?: string) => Node) | null = null, bullets: readonly boolean[] = [],
  commas: readonly boolean[] = [], lines: readonly boolean[] = [],
): ContainerPlan {
  const outer = nestedCompiler;
  nestedCompiler = nested;
  try {
    return planContainerNodes(list, sentenceOf, bullets, commas, lines);
  } finally {
    nestedCompiler = outer;
  }
}

function planContainerNodes(list: readonly CompileLeaf[], sentenceOf: readonly number[], bullets: readonly boolean[], commas: readonly boolean[], lines: readonly boolean[]): ContainerPlan {
  const nodes = new Map<number, Node>();
  const consumed = new Set<number>();
  const replacements = findReplacementOpeners(list, (leaf) => LEADING_CONTAINERS.has(leaf.family_id));
  // An order-rule belongs to the record's one issue-orders, wherever it is printed ("OFFICER with this
  // ability can issue Orders" comes before the opener; the Battle-shock rules come after it).
  const orderRuleIndexes = list.flatMap((leaf, index) => leaf.family_id === "order-rule" ? [index] : []);
  if (orderRuleIndexes.length > 0) {
    const openers = list.filter((leaf) => leaf.family_id === "issue-orders-open").length;
    if (openers !== 1) throw new CompileError(`An order-rule needs exactly one issue-orders-open in its record; found ${openers}.`);
    orderRuleIndexes.forEach((index) => consumed.add(index));
  }
  const orderRuleLeaves = orderRuleIndexes.map((index) => list[index]!);
  list.forEach((leaf, index) => {
    if (!LEADING_CONTAINERS.has(leaf.family_id)) return;
    // A container inside a bulleted choice's option is part of that option (below), which compiles it.
    if (consumed.has(index)) return;
    // A replacement opener is the last sentence of its origin's ability part (below), so it builds no container of its own.
    if (replacements.replacements.has(index)) return;
    // An origin with a replacement reads on through it: its trailing sentence is part of the origin.
    const replacement = replacements.origins.get(index);
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
    // A resource-action-menu's actions begin at their menu-action markers: an action's heading, trigger
    // sentence and effect sentence are one action.
    const menu = leaf.family_id === "resource-action-menu-open";
    const optionMarker = menu ? "menu-action" : "named-option";
    const byMarker = NAMED_OPTION_CONTAINERS.has(leaf.family_id) || menu
      || (leaf.family_id === "choice-open" && list.slice(index + 1).some((item) => item.family_id === "named-option"));
    // "select one of the following: ■ … ■ …" with a bullet right after the opener: each bullet is one
    // option, however many sentences it holds, and a container that opens inside a bullet ("Select one
    // objective marker. …") is part of that option rather than the end of the choice.
    const byBullet = !byMarker && leaf.family_id === "choice-open" && bullets[index + 1] === true;
    // A choice-open inside a named option ("Unnatural Fortitude: … select one of the following: ■ … ■ …")
    // is that option's own: it and its options run on to the next named-option marker.
    const nestedChoice = (cursor: number) => byMarker && !menu && current[0]?.family_id === optionMarker && list[cursor]!.family_id === "choice-open";
    for (let cursor = index + 1; cursor < list.length && (replacement !== undefined || byBullet || !LEADING_CONTAINERS.has(list[cursor]!.family_id) || nestedChoice(cursor)); cursor += 1) {
      const sentence = sentenceOf[cursor]!;
      const bulletStarts = leaf.family_id === "choice-open" && bullets[cursor] === true;
      // A bulleted choice ends at a later choice of its own kind, or at a line after the last bullet;
      // another container is an option's own.
      if (byBullet && (list[cursor]!.family_id === "choice-open" || lines[cursor] === true)) break;
      // Each item of a colon-introduced comma list is an option of its own (compile-placement.ts commaItems).
      const itemStarts = leaf.family_id === "choice-open" && commas[cursor] === true;
      if (list[cursor]!.family_id === "order-rule") continue;
      const starts = byMarker ? list[cursor]!.family_id === optionMarker
        : byBullet ? currentSentence === null || bulletStarts
          : currentSentence === null || sentence !== currentSentence || bulletStarts || itemStarts;
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
    // A choice whose option ends in a move-must-end ("…, provided every model … ends that move …") compiles each
    // option as a whole ability, so its move-end and its conditions stay with the move they end. A sentence after
    // the last move option with no move of its own ("Until the end of the turn, …") is no option: it goes back to
    // the ordinary pipeline, as the "in either case" sentence after the options does.
    const moveEndOption = leaf.family_id === "choice-open" && groups.some((group) => group.some((item) => item.family_id === "move-must-end"));
    if (moveEndOption) {
      while (groups.length > 1 && !groups.at(-1)!.some((item) => item.family_id === "make-move")) {
        for (const returned of groups.pop()!) consumed.delete(list.indexOf(returned));
      }
    }
    // resource-action-menu-open's own actions must each lead with a menu-action marker; a
    // trailing sentence that doesn't (Battle Focus's own "at the end of the round, clear the
    // pool" ability-part) is not one of its actions — give those leaves back to the ordinary
    // compileLeaves pipeline, which already turns a later trigger+effect into its own part.
    if (menu) {
      while (groups.length && groups.at(-1)![0]!.family_id !== "menu-action") {
        for (const returned of groups.pop()!) consumed.delete(list.indexOf(returned));
      }
      // The same holds for sentences between the opener and the first action ("At the end of the
      // battle round, all unspent tokens are lost"), and for a sentence after the last action's
      // effect that opens a moment of its own.
      while (groups.length && groups[0]![0]!.family_id !== "menu-action") {
        for (const returned of groups.shift()!) consumed.delete(list.indexOf(returned));
      }
      const last = groups.at(-1);
      if (last) {
        const sentenceAt = (item: CompileLeaf) => sentenceOf[list.indexOf(item)]!;
        const tail = last.findIndex((item, at) => at > 0 && item.role === "EVENT" && sentenceAt(item) !== sentenceAt(last[at - 1]!)
          && last.slice(0, at).some((earlier) => earlier.role === "EFFECT"));
        if (tail > 0) for (const returned of last.splice(tail)) consumed.delete(list.indexOf(returned));
      }
    }
    // Ability-wide sentences between an opener and its first named option ("You can only activate
    // each one once per battle round", "until the end of the battle round") carry no option of
    // their own; their leaves go back to the ordinary pipeline, which already places a usage
    // limit, a duration or a gate on the whole ability.
    // The same holds for any opener whose leading groups have no effect at all ("this model has
    // that ability", "until the start of your next Command phase"): no option is only a gate.
    // Under named-option markers, a leading group that grants "your chosen" option ("Until the end of
    // the battle, …, and that unit has the effect of your chosen Plague") is about the options, not
    // one of them, whatever effects it has of its own.
    const aboutTheOptions = (group: readonly CompileLeaf[]) => byMarker && group.some((item) => item.family_id === "chosen-option-grant");
    // issue-orders keeps its own timing: those sentences say when an Order is issued and how long it lasts.
    let orderTiming: ReturnType<typeof issueOrdersTiming> = null;
    if (leaf.family_id === "issue-orders-open") {
      const firstOrder = groups.findIndex((group) => group[0]!.family_id === "named-option");
      if (firstOrder > 0) orderTiming = issueOrdersTiming(groups.splice(0, firstOrder).flat());
    }
    while (!SINGLE_BODY_CONTAINERS.has(leaf.family_id) && groups.length && groups[0]![0]!.family_id !== "named-option"
      && (groups[0]!.every((item) => item.role !== "EFFECT") || aboutTheOptions(groups[0]!))) {
      for (const returned of groups.shift()!) consumed.delete(list.indexOf(returned));
    }
    // Under named-option markers, an effect printed once before the first option is what choosing
    // any option does ("If you do, that unit is no longer readied"): it is a step of every option.
    let shared: CompileLeaf[] | null = null;
    if (byMarker && groups.length > 1 && groups[0]![0]!.family_id !== "named-option" && groups.slice(1).every((group) => group[0]!.family_id === "named-option")) {
      shared = groups.shift()!;
    }
    let replacementTailOf: { optional: boolean } | undefined;
    let sentences = groups;
    if (replacement !== undefined) {
      const split = splitReplacementTail(groups);
      sentences = split.groups;
      replacementTailOf = replacementTail(split.tail, list[replacement]!);
    }
    if (leaf.family_id === "persistent-designation-open") refuseEstablishmentCount(list, sentenceOf, index);
    // A selected objective's body may span several sentences ("While in range, this model has: A, B, C" splits at
    // each bullet). They fold into one body unless a later sentence opens a moment of its own.
    if (leaf.family_id === "select-objective-open" && sentences.length > 1 && !sentences.slice(1).some((group) => group.some(opensOwnMoment))) {
      sentences = [sentences.flat()];
    }
    if (SINGLE_BODY_CONTAINERS.has(leaf.family_id)) {
      if (sentences.length !== 1) throw new CompileError(`${leaf.family_id} needs exactly one sentence after it, its own effect.`);
    } else if (ONE_OR_MORE_CONTAINERS.has(leaf.family_id)) {
      if (groups.length < 1) throw new CompileError(`${leaf.family_id} needs at least one option after it.`);
    } else if (leaf.family_id === "issue-orders-open" && groups.length === 0) {
      // An officer's Orders come from its faction's army rule (buildIssueOrders).
    } else if (groups.length < 2) {
      throw new CompileError(`${leaf.family_id} needs at least two options after it, one sentence each.`);
    }
    // An option compiles as a whole ability only where its bounds are certain: a named option's
    // marker, or a single body. Sentence-split options ("…; if that test is passed, gain 1CP")
    // can cut one option in two, so those keep refusing a non-effect leaf.
    const outer = nestedCompiler;
    const outerShared = sharedOptionSteps;
    const bulletCertain = leaf.family_id === "choice-open" && bulletBoundaries > 0 && sentenceBoundaries === 0;
    // A menu action's body is effects only: its eligibility and terms are read from the leaves before and among them.
    if ((menu || !byMarker) && !SINGLE_BODY_CONTAINERS.has(leaf.family_id) && !bulletCertain && !moveEndOption) nestedCompiler = null;
    try {
      sharedOptionSteps = shared === null ? null : effectsOf(shared);
      let node = buildContainer(leaf, sentences, replacementTailOf, leaf.family_id === "persistent-designation-open"
        ? persistentDesignationTiming(list, sentenceOf, index) : undefined, orderRuleLeaves);
      // "you can select up to one …" establishes the designation only if the controlling player chooses to.
      if (leaf.family_id === "persistent-designation-open" && designationChoices(list, sentenceOf, index).length > 0) {
        node = node.type === "ability-part" ? { ...node, optional: true } : { type: "ability-part", optional: true, effect: node };
      }
      if (orderTiming !== null) {
        const part: Node = { type: "ability-part" };
        if (!Array.isArray(orderTiming.trigger) || orderTiming.trigger.length > 0) part.trigger = orderTiming.trigger;
        if (orderTiming.duration !== undefined) part.duration = orderTiming.duration;
        node = { ...part, effect: node };
      }
      nodes.set(index, node);
    } finally {
      nestedCompiler = outer;
      sharedOptionSteps = outerShared;
    }
  });
  return { nodes, consumed };
}
