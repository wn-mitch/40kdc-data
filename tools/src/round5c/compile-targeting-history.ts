/**
 * Past targeting as DSL `happened` conditions on targets-selected: the targeted family ("an enemy
 * unit that targeted a friendly unengaged X unit"), and target-is-selected when it names who
 * selected which unit ("if one or more units with this ability are selected as a target of that
 * charge"). Split out of `compile-conditions.ts`, which calls it.
 */

import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { FOLLOWING_FILTER } from "./family-extensions-11.js";

type Node = Record<string, unknown>;

/** A unit-ref key's value as the DSL names it: the folded unit-filter, or the role itself. */
function unitOf(leaf: CompileLeaf, key: string): unknown {
  if (leaf.parameters[key] !== FOLLOWING_FILTER) return closed(leaf, key);
  const filter = leaf.parameters.following_filter as Node | undefined;
  if (filter === undefined) throw new CompileError(`${leaf.family_id} names the unit-filter after it, but no unit-filter follows it in its clause.`);
  return structuredClone(filter);
}

/** Whether a target-is-selected leaf names who selected which unit (version 2), rather than gating attacks on the selected unit. */
export function namesSelection(leaf: CompileLeaf): boolean {
  return leaf.family_id === "target-is-selected" && leaf.parameters.target !== undefined;
}

/** The happened condition of a targeted or a naming target-is-selected leaf. */
export function targetingCondition(leaf: CompileLeaf): Node {
  if (leaf.family_id === "targeted") {
    const subject = closed(leaf, "subject");
    // This unit is the DSL's default subject, so it is left out.
    const filter: Node = { kind: "attack", ...(leaf.parameters.attack_type !== undefined ? { attack_type: closed(leaf, "attack_type") } : {}) };
    return { type: "happened", parameters: { event: "targets-selected", ...(subject === "this-unit" ? {} : { subject }), object: unitOf(leaf, "object"), filter, window: closed(leaf, "window") } };
  }
  if (namesSelection(leaf)) {
    // The selection the ability's moment made ("of that charge"): its kind is the moment's own.
    const by = closed(leaf, "by");
    return { type: "happened", parameters: { event: "targets-selected", ...(by === "this-unit" ? {} : { subject: by }), object: unitOf(leaf, "target"), window: "event" } };
  }
  throw new CompileError(`${leaf.family_id} is not a past-targeting condition.`);
}

/** A Stratagem TARGET that names the unit its WHEN moment's enemy attacked ("That X unit."). */
const attackedTarget = (leaf: CompileLeaf) => leaf.fragment === "TARGET"
  && (leaf.family_id === "triggering-target" || (leaf.family_id === "target-binding" && leaf.parameters.bound_to === "attacked-unit"));

/**
 * "When an enemy unit that targeted a friendly unengaged X unit has shot." + "That X unit.": the
 * Stratagem's target is the unit that enemy targeted, not the enemy. Runs after unit-filter
 * folding: the targeted leaf's object becomes the Stratagem's own unit (this-unit), and its
 * folded filter moves to the TARGET leaf as `attacked_filter`, which `targetRestrictions` turns
 * into the attacked-unit binding and its eligibility.
 */
export function bindTargetedTarget(list: readonly CompileLeaf[]): CompileLeaf[] {
  const targets = list.filter(attackedTarget);
  const targeted = list.filter((leaf) => leaf.family_id === "targeted" && leaf.fragment === "WHEN" && leaf.parameters.subject === "event-subject"
    && leaf.parameters.object === FOLLOWING_FILTER && leaf.parameters.following_filter !== undefined);
  if (targets.length !== 1 || targeted.length !== 1) return [...list];
  const filter = targeted[0]!.parameters.following_filter as Node;
  // An enemy unit the enemy targeted is never your Stratagem's target.
  if (filter.owner === "enemy") return [...list];
  return list.map((leaf) => {
    if (leaf === targeted[0]) {
      const { following_filter: _filter, ...rest } = leaf.parameters;
      return { ...leaf, parameters: { ...rest, object: "this-unit" } };
    }
    return leaf === targets[0] ? { ...leaf, parameters: { ...leaf.parameters, attacked_filter: filter } } : leaf;
  });
}

/**
 * The attacked unit's filter as eligibility checks on the Stratagem's target, beyond the keywords
 * its TARGET leaf already requires (`allRequired`, every one; `anyRequired`, at least one).
 */
export function attackedChecks(filter: Node | undefined, allRequired: readonly string[] = [], anyRequired: readonly string[] = []): Node[] {
  if (filter === undefined) return [];
  const known = new Set(["owner", "all_of", "any_of", "none_of", "not_all_of", "state", "not_states"]);
  const unknown = Object.keys(filter).filter((key) => !known.has(key));
  if (unknown.length) throw new CompileError(`The attacked unit's ${unknown.join(", ")} has no Stratagem target eligibility form yet.`);
  const keywordCheck = (key: "all_of" | "any_of", keywords: string[]): Node[] => keywords.length ? [{ type: "has-keyword", parameters: { [key]: keywords } }] : [];
  const allOf = ((filter.all_of as string[] | undefined) ?? []).filter((keyword) => !allRequired.includes(keyword));
  const anyOf = (filter.any_of as string[] | undefined) ?? [];
  const sameAny = anyOf.length === anyRequired.length && anyOf.every((keyword) => anyRequired.includes(keyword));
  const not = (node: Node): Node => ({ operator: "not", operands: [node] });
  return [
    ...keywordCheck("all_of", allOf),
    ...(sameAny ? [] : keywordCheck("any_of", anyOf)),
    ...((filter.none_of as string[] | undefined) ?? []).map((keyword) => not({ type: "has-keyword", parameters: { all_of: [keyword] } })),
    ...(filter.not_all_of !== undefined ? [not({ type: "has-keyword", parameters: { all_of: filter.not_all_of } })] : []),
    ...(filter.state !== undefined ? [{ type: "unit-state", parameters: { state: filter.state } }] : []),
    ...((filter.not_states as string[] | undefined) ?? []).map((state) => not({ type: "unit-state", parameters: { state } })),
  ];
}
