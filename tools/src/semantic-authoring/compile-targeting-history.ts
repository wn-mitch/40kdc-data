/**
 * Past targeting as DSL `happened` conditions on targets-selected: the targeted family ("an enemy
 * unit that targeted a friendly unengaged X unit"), and target-is-selected when it names who
 * selected which unit ("if one or more units with this ability are selected as a target of that
 * charge"). Split out of `compile-conditions.ts`, which calls it.
 */

import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { FOLLOWING_FILTER } from "./families/shared.js";

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
 * Bind a Stratagem target to the unit an enemy selected as a target. Historical wording carries a
 * `targeted` leaf; a friendly unit the triggering attacks destroyed a model in was attacked; an
 * immediate targets-selected event already carries its object filter. In every form the TARGET is
 * the attacked unit, never the enemy actor.
 */
export function bindTargetedTarget(list: readonly CompileLeaf[]): CompileLeaf[] {
  const targets = list.filter(attackedTarget);
  if (targets.length !== 1) return [...list];
  const targeted = list.filter((leaf) => leaf.family_id === "targeted" && leaf.fragment === "WHEN" && leaf.parameters.subject === "event-subject"
    && leaf.parameters.object === FOLLOWING_FILTER && leaf.parameters.following_filter !== undefined);
  if (targeted.length === 1) {
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
  if (targeted.length > 1) return [...list];
  // "if those attacks destroyed a model in a friendly X unit. That X unit.": the unit that lost the model was attacked.
  const lost = destroyedMemberFilters(list);
  if (lost.length === 1) {
    return list.map((leaf) => leaf === targets[0] ? { ...leaf, parameters: { ...leaf.parameters, attacked_filter: lost[0] } } : leaf);
  }
  if (lost.length > 1) return [...list];
  const immediate = list.filter((leaf) => leaf.family_id === "event" && leaf.fragment === "WHEN"
    && leaf.parameters.kind === "enemy-selected-targets" && leaf.parameters.object_filter !== undefined);
  if (immediate.length !== 1) return [...list];
  const filter = immediate[0]!.parameters.object_filter as Node;
  if (filter.owner === "enemy") return [...list];
  return list.map((leaf) => leaf === targets[0]
    ? { ...leaf, parameters: { ...leaf.parameters, attacked_filter: filter } }
    : leaf);
}
/** The friendly units a WHEN clause's triggering attacks destroyed a model in, as their unit filters. */
function destroyedMemberFilters(list: readonly CompileLeaf[]): Node[] {
  return list.flatMap((leaf) => {
    if (leaf.fragment !== "WHEN" || leaf.family_id !== "unit-activity" || leaf.parameters.negated === true) return [];
    if (!((leaf.parameters.activities ?? []) as string[]).includes("destroyed-models-by-triggering-attacks")) return [];
    return ((leaf.parameters.destructions ?? []) as Node[]).flatMap((destruction) => {
      const member = (destruction.object as Node | undefined)?.member_of as Node | undefined;
      return member !== undefined && typeof member === "object" && member.owner === "friendly" ? [structuredClone(member)] : [];
    });
  });
}

const ATTACKED_FILTER_KEYS: Readonly<Record<string, true>> = {
  owner: true,
  all_of: true,
  any_of: true,
  none_of: true,
  not_all_of: true,
  state: true,
  not_states: true,
  level: true,
  unit_ids: true,
};


/**
 * The attacked unit's filter as eligibility checks on the Stratagem's target, beyond the keywords
 * and exact identities its TARGET leaf already requires.
 */
export function attackedChecks(
  filter: Node | undefined,
  allRequired: readonly string[] = [],
  anyRequired: readonly string[] = [],
  idsRequired: readonly string[] = [],
): Node[] {
  if (filter === undefined) return [];
  const unknown = Object.keys(filter).filter((key) => !(key in ATTACKED_FILTER_KEYS));
  if (unknown.length) throw new CompileError(`The attacked unit's ${unknown.join(", ")} has no Stratagem target eligibility form yet.`);
  if (filter.level !== undefined && filter.level !== "unit") throw new CompileError("A Stratagem's attacked target must be a unit, not a model.");
  const keywordCheck = (key: "all_of" | "any_of", keywords: string[]): Node[] => keywords.length ? [{ type: "matches", parameters: { filter: { [key]: keywords } } }] : [];
  const allOf = ((filter.all_of as string[] | undefined) ?? []).filter((keyword) => !allRequired.includes(keyword));
  const anyOf = (filter.any_of as string[] | undefined) ?? [];
  const sameAny = anyOf.length === anyRequired.length && anyOf.every((keyword) => anyRequired.includes(keyword));
  const unitIds = (filter.unit_ids as string[] | undefined) ?? [];
  const sameIds = unitIds.length === idsRequired.length && unitIds.every((id) => idsRequired.includes(id));
  return [
    ...keywordCheck("all_of", allOf),
    ...(sameAny ? [] : keywordCheck("any_of", anyOf)),
    ...(unitIds.length && !sameIds ? [{ type: "matches", parameters: { filter: { level: "unit", unit_ids: unitIds } } }] : []),
    ...(filter.none_of !== undefined ? [{ type: "matches", parameters: { filter: { none_of: filter.none_of } } }] : []),
    ...(filter.not_all_of !== undefined ? [{ type: "matches", parameters: { filter: { not_all_of: filter.not_all_of } } }] : []),
    ...(filter.state !== undefined ? [{ type: "matches", parameters: { filter: { state: filter.state } } }] : []),
    ...(filter.not_states !== undefined ? [{ type: "matches", parameters: { filter: { not_states: filter.not_states } } }] : []),
  ];
}
