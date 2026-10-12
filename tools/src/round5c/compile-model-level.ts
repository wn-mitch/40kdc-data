import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { severalTargets } from "./compile-target-groups.js";
import { MOMENT_UNIT } from "./family-extensions-16-model-keyword-scope.js";

/**
 * Model-level unit-filters ("friendly **K** model") that name the individual models an aura
 * reaches, whose roll a roll moment is, or which model a passive destruction destroyed. The
 * folding itself sits in compile-unit-filters.ts and the anaphor binding in
 * compile-antecedent.ts; these are the shared tests and the aura's lowering.
 */

type Node = Record<string, unknown>;

/** The DSL unit-ref value an aura's recipient compiles to before its wrap (compile-antecedent.ts AURA_RECIPIENT). */
const RECIPIENT = "recipient";

/**
 * "when a saving throw is failed for a" + filter: a named roll with no subject of its own, right
 * before the filter (nothing but a connective between them), whose roll the filter's units make.
 */
export function rollOwnerEvent(event: CompileLeaf | undefined, filter: CompileLeaf | undefined): boolean {
  return event?.family_id === "event" && filter?.family_id === "unit-filter" && event.fragment === filter.fragment
    && (event.parameters.kind === "after-roll" || event.parameters.kind === "before-roll")
    && event.parameters.subject === undefined && event.parameters.owner === undefined && event.parameters.subject_filter === undefined
    && (event.end_byte === undefined || filter.start_byte >= event.end_byte);
}

/**
 * "when a friendly X model … is destroyed": a destruction that names no destroyer, so a
 * unit-filter describing it names what was destroyed (the trigger's object), not the destroyer
 * (its subject). The destruction may name whose model it was only as the filter's own side.
 */
export function destroyedObject(moment: CompileLeaf | undefined, filter: CompileLeaf | undefined): boolean {
  return moment?.family_id === "event" && (moment.parameters.kind === "model-destroyed" || moment.parameters.kind === "unit-destroyed")
    && moment.parameters.by === undefined && moment.parameters.object_filter === undefined && filter?.family_id === "unit-filter"
    && (moment.parameters.object_owner === undefined || (filter.parameters.side !== "any" && moment.parameters.object_owner === filter.parameters.side));
}

/**
 * "When this unit destroys a" + "enemy CHARACTER model": a model-destroyed event with a model-level
 * unit-filter right after it in the same sentence. The filter names the destroyed model, so it
 * folds into the event's object (compile-unit-filters.ts foldDestroyedModelAfter).
 */
export function destroyedModelAfter(event: CompileLeaf | undefined, filter: CompileLeaf | undefined): boolean {
  // An object the event can name: a friendly or enemy owner and unit keywords, and nothing else. Any other
  // filter ("an enemy model (excluding MONSTER models)", a side-less one) keeps its own fold.
  const plain = filter !== undefined && (filter.parameters.side === "friendly" || filter.parameters.side === "enemy")
    && Array.isArray(filter.parameters.keywords) && filter.parameters.keywords.length > 0
    && Object.keys(filter.parameters).every((key) => ["side", "keywords", "level"].includes(key) || filter.parameters[key] === undefined);
  return event?.family_id === "event" && event.parameters.kind === "model-destroyed" && filter?.family_id === "unit-filter"
    && filter.parameters.level === "model" && plain && event.fragment === filter.fragment && event.end_byte !== undefined && filter.start_byte >= event.end_byte;
}

/**
 * The folded filter as what a destroyed moment destroyed. A bare model destruction is a model in
 * this unit ("a CULT model in your unit is destroyed"), which the filter narrows; one with an
 * owner ("a friendly X model … is destroyed") is any such model. A unit's destruction cannot be a
 * model's.
 */
export function destroyedFilter(moment: CompileLeaf, filter: CompileLeaf, dsl: Node): Node {
  if (filter.parameters.level === "model" && moment.parameters.kind !== "model-destroyed") throw new CompileError("A unit-filter naming models cannot be what a unit's destruction destroys.");
  if (moment.parameters.kind !== "model-destroyed" || moment.parameters.object_owner !== undefined) return dsl;
  if (dsl.excluding !== undefined || dsl.member_of !== undefined) throw new CompileError("A destroyed model of this unit cannot also exclude or belong to another unit.");
  return { ...dsl, member_of: "this-unit" };
}

/** A compiled destruction trigger whose destroyed unit or model is a folded filter and which names no destroyer. */
export function destroyedFilterObject(trigger: Node): boolean {
  return (trigger.event === "destroyed" || trigger.event === "model-destroyed") && trigger.subject === undefined
    && trigger.object !== null && typeof trigger.object === "object";
}

/** The DSL unit-filter of the models a model-level aura reaches; "other" excludes only this model. */
export function modelRecipientFilter(filter: CompileLeaf, dsl: Node): Node {
  if (filter.parameters.held_in !== undefined) throw new CompileError("An aura cannot reach a model held off the battlefield.");
  return filter.parameters.other === true ? { ...dsl, excluding: "this-model" } : dsl;
}

/**
 * "select one friendly NECRONS model": the selector picks a model (select-units target_kind).
 * "Other" is checked by the caller against the bearer's size (compile.ts), since it excludes only
 * the bearer's unit. Refuses a per-model usage-scope, which may cap each selected model or each
 * bearer. A per-model usage-limit is the selection's own cap (compile-selection-limit.ts).
 */
export function modelSelection(filter: CompileLeaf, leaves: readonly CompileLeaf[]): Node {
  if (filter.parameters.level !== "model") return {};
  if (leaves.some((leaf) => leaf.family_id === "usage-scope" && leaf.parameters.per === "model")) {
    throw new CompileError("A per-model usage scope on a model selection may limit each selected model or each bearer; it has no decided reading yet.");
  }
  return { target_kind: "model" };
}

/** The families a Stratagem's leaves carry (the same set compile.ts reads as a Stratagem). */
const STRATAGEM_LEAVES = new Set(["use-window", "stratagem-target", "triggering-target", "target-binding"]);

/**
 * "in your unit" after a model-level unit-filter ("select one CHARACTER model in your unit"): the
 * unit the selected model must share, which compile-wrappers.ts reads as an eligibility. In an
 * ability it is the bearer's unit. A Stratagem has no bearer, so there it names the target unit,
 * and only a single-target Stratagem has a decided reading.
 */
export function membershipOf(membership: CompileLeaf, list: readonly CompileLeaf[]): "this-unit" | "stratagem-target" | "antecedent" {
  if (membership.parameters.relation !== "in") throw new CompileError("A selected model's membership is only being a model of its unit.");
  // "that unit's Character models": the moment's unit, bound by compile-antecedent.ts.
  if (membership.parameters.of === MOMENT_UNIT) return MOMENT_UNIT;
  if (list.some((leaf) => STRATAGEM_LEAVES.has(leaf.family_id))) {
    if (membership.parameters.of !== "stratagem-target") throw new CompileError("A Stratagem's selected model is in its target unit; name the target, since a Stratagem has no bearer to say this unit.");
    if (severalTargets(list)) throw new CompileError("A Stratagem with several targets has no decided target for a selected model's membership yet.");
    return "stratagem-target";
  }
  if (membership.parameters.of !== "this-unit") throw new CompileError("A selected model's membership in an ability names this unit, the bearer's unit.");
  return "this-unit";
}

/** Keys whose subtree tests a condition: a recipient there would become "any such model". */
const GATE_KEYS = new Set(["condition", "operands", "eligibility"]);

/**
 * A model-level aura ("While a friendly **K** model is within 6\" of this model, that model …"):
 * no aura wrapper, since the DSL aura reaches units. Each effect's recipient becomes the folded
 * filter with the range as its `within`, so each such model in range receives it, not its whole
 * unit. Refuses a range with no `of`, a capped range, a recipient under a gate, a body that never
 * names the recipient, and a trigger whose unit is the recipient.
 */
export function wrapModelAura(leaf: CompileLeaf, body: Node, triggers: readonly Node[]): Node {
  if (leaf.parameters.of === undefined) throw new CompileError("A model-level aura must say what its range is measured from.");
  if (leaf.parameters.range_cap_inches !== undefined) throw new CompileError("A model-level aura's range cannot carry a cap; the DSL unit-filter's within has none.");
  if (leaf.parameters.keywords !== undefined) throw new CompileError("A model-level aura takes its keywords from its unit-filter alone.");
  if (JSON.stringify(triggers).includes(`"${RECIPIENT}"`)) {
    throw new CompileError("A model-level aura's recipient cannot be a trigger's unit; the moment would no longer be bound to the model the effect reaches.");
  }
  const within: Node = { range: { inches: closed(leaf, "inches") }, of: closed(leaf, "of"), ...(leaf.parameters.wholly === true ? { wholly: true } : {}) };
  const recipient: Node = { ...(leaf.parameters.model_recipient as Node), within };
  let named = 0;
  const substitute = (value: unknown, key: string | null): unknown => {
    if (value === RECIPIENT) { named += 1; return structuredClone(recipient); }
    if (key !== null && GATE_KEYS.has(key) && JSON.stringify(value).includes(`"${RECIPIENT}"`)) {
      throw new CompileError("A condition on each model a model-level aura reaches has no DSL shape yet; it would test whether any such model meets it.");
    }
    if (Array.isArray(value)) return value.map((item) => substitute(item, null));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Node).map(([inner, item]) => [inner, substitute(item, inner)]));
  };
  const result = substitute(body, null) as Node;
  if (named === 0) throw new CompileError("A model-level aura's effects never name the model it reaches; author the range as a unit-position condition.");
  return result;
}

/** Whether a count, per-model roll or select-unit claims the model-level filter beside a membership (its own membership handling). */
const COUNTING = new Set(["count-scale", "scale-cap", "for-each-unit-select", "unit-size"]);

/** The unit-filter beside `index` (the next leaf, past any unit-owners of the same fragment), or -1. */
function modelFilterBeside(list: readonly CompileLeaf[], index: number, step: -1 | 1): number {
  const fragment = list[index]!.fragment;
  let at = index + step;
  while (list[at]?.family_id === "unit-owner" && list[at]!.fragment === fragment) at += step;
  const leaf = list[at];
  return leaf?.family_id === "unit-filter" && leaf.fragment === fragment && leaf.parameters.level === "model" ? at : -1;
}

/**
 * "Character models in this unit" / "that unit's Character models": a membership leaf right after
 * (or before) a model-level unit-filter, with only unit-owners between, becomes that filter's
 * `member_of`, the unit its models belong to. A count, a per-model roll and a select-unit with
 * its own membership keep their existing handling and are not folded. A filter with one
 * membership takes no second; a membership on an any-side filter refuses, since its units
 * receive an effect.
 */
export function groupMembership(input: readonly CompileLeaf[]): CompileLeaf[] {
  if (!input.some((leaf) => leaf.family_id === "membership")) return [...input];
  const list = [...input];
  const drop = new Set<number>();
  list.forEach((leaf, index) => {
    if (leaf.family_id !== "membership") return;
    const after = modelFilterBeside(list, index, -1);
    const at = after >= 0 ? after : modelFilterBeside(list, index, 1);
    if (at < 0) return;
    const filter = list[at]!;
    // "within 12\" of a CRYPTEK model in your unit" after a reference to the selected unit: the
    // unit the reference's model shares is the selected unit, not the bearer's (compile-unit-filters.ts).
    const reference = list[at - 1];
    const selectedReference = reference?.family_id === "unit-position" && reference.fragment === filter.fragment
      && reference.parameters.of === "following-filter" && reference.parameters.subject === "selected-unit";
    if (!selectedReference && list.some((other) => other.fragment === leaf.fragment && COUNTING.has(other.family_id))) return;
    if (list[at - 1]?.family_id === "select-unit") return;
    if (filter.parameters.member_of !== undefined) throw new CompileError("A unit-filter takes one membership; two are not decided.");
    if (filter.parameters.side === "any") throw new CompileError("A unit-filter whose units receive an effect must say friendly or enemy.");
    if (selectedReference && leaf.parameters.relation !== "in") throw new CompileError("A selected model's membership is only being a model of its unit.");
    const of = selectedReference ? "selected-unit" : membershipOf(leaf, list);
    // The effect after the pair names this model as its subject. The membership's group is the
    // filter's units, which a this-model effect does not take (design 3.2 rule 7).
    const effect = nextEffectAfter(list, Math.max(index, at));
    if (effect?.parameters.subject === "this-model") throw new CompileError(`${effect.family_id} limits this model to its models with keywords; name its unit instead.`);
    list[at] = { ...filter, parameters: { ...filter.parameters, member_of: of } };
    drop.add(index);
  });
  return drop.size === 0 ? list : list.filter((_leaf, index) => !drop.has(index));
}

/** The first leaf after `index` in its fragment that is not a unit-owner, or undefined. */
function nextEffectAfter(list: readonly CompileLeaf[], index: number): CompileLeaf | undefined {
  const fragment = list[index]?.fragment;
  let at = index + 1;
  while (list[at]?.family_id === "unit-owner" && list[at]!.fragment === fragment) at += 1;
  const leaf = list[at];
  return leaf !== undefined && leaf.fragment === fragment ? leaf : undefined;
}
