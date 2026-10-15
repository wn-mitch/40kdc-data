import type { CompileLeaf } from "./compile-fragments.js";
import { CompileError } from "./compile-fragments.js";

/**
 * "Friendly X units' ranged attacks can: Re-roll one hit roll. Re-roll one wound roll." A unit-filter,
 * then an attack-filter that names the attacks, then rolls with no subject of their own. The rolls
 * are the filter's units' rolls of that attack type, so the attack-filter folds into each roll as
 * its weapon_type and is dropped from the record.
 */

/** Effects that name a roll and take no subject: whose rolls they are comes from a filter before them. */
export const SUBJECTLESS_ROLLS = new Set(["reroll", "roll-modifier", "roll-auto-result"]);
export const subjectlessRoll = (leaf: CompileLeaf | undefined) => leaf !== undefined && SUBJECTLESS_ROLLS.has(leaf.family_id) && leaf.parameters.subject === undefined;

/** Rolls an attack type's weapon_type can scope: attack rolls only, not tests. */
const ATTACK_ROLLS = new Set(["hit", "wound", "damage"]);
/** The rolls a folded attack type can scope, per roll family: roll-auto-result has no weapon_type in the DSL. */
const FOLDABLE_FAMILIES = new Set(["reroll", "roll-modifier"]);

/** A melee or ranged attack-filter with no field but its type, not negated: the only frame that folds. */
export function frameFilter(leaf: CompileLeaf | undefined): leaf is CompileLeaf & { parameters: { attack_type: "melee" | "ranged" } } {
  if (leaf?.family_id !== "attack-filter") return false;
  const { attack_type: type, negated, ...rest } = leaf.parameters;
  return (type === "melee" || type === "ranged") && Object.keys(rest).length === 0 && negated !== true;
}

/** Conditions on the attack's target that a frame keeps ahead of the rolls ("aimed at a unit within 12\""). */
const targetGate = (leaf: CompileLeaf | undefined, filter: CompileLeaf) => leaf?.role === "CONDITION" && leaf.fragment === filter.fragment
  && (leaf.parameters.subject === "target" || leaf.parameters.subject === "defender");

/**
 * The attack-filter after a unit-filter (past any "from your army" of its side), the target gates
 * between that frame and the consecutive subjectless rolls after them in the same fragment, and the
 * index of the last roll; null when that is not the shape.
 */
export function attackFrameRolls(list: readonly CompileLeaf[], index: number, filter: CompileLeaf): { frame: number; gates: CompileLeaf[]; rolls: CompileLeaf[]; last: number } | null {
  let frame = index + 1;
  while (list[frame]?.family_id === "unit-owner" && list[frame]!.parameters.owner === filter.parameters.side) frame += 1;
  const attack = list[frame];
  if (!frameFilter(attack) || attack.fragment !== filter.fragment) return null;
  const gates: CompileLeaf[] = [];
  for (let at = frame + 1; targetGate(list[at], filter); at += 1) gates.push(list[at]!);
  const rolls: CompileLeaf[] = [];
  for (let at = frame + 1 + gates.length; subjectlessRoll(list[at]) && list[at]!.fragment === filter.fragment; at += 1) rolls.push(list[at]!);
  return rolls.length > 0 ? { frame, gates, rolls, last: frame + gates.length + rolls.length } : null;
}

/** A condition that says its subject is the attack's target: a defender operand of an attack-compare, or a subject naming the target. */
function targetCondition(leaf: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  if (leaf?.role !== "CONDITION" || leaf.fragment !== filter.fragment) return false;
  if (leaf.family_id === "attack-compare") return leaf.parameters.left_of === "defender" || leaf.parameters.right_of === "defender";
  return leaf.parameters.subject === "target" || leaf.parameters.subject === "defender";
}

/**
 * "Ranged attacks aimed at friendly X units where the attacker's power beats the target's resilience": the attack-filter
 * right before a unit-filter is the attack, and the filter is its defender. The condition right after
 * the filter must name the target, so a filter that names some other unit ("while enemy units are
 * within Engagement Range") is not the attack's defender. Only a clause-initial frame qualifies, and
 * only a melee or ranged frame that names nothing else.
 */
export function targetFrameBefore(list: readonly CompileLeaf[], index: number): boolean {
  const filter = list[index]!;
  const frame = list[index - 1];
  if (!frameFilter(frame) || frame.fragment !== filter.fragment || !targetCondition(list[index + 1], filter)) return false;
  return !list.slice(0, index - 1).some((leaf) => leaf.fragment === filter.fragment && (leaf.family_id === "attack" || leaf.family_id === "unit-filter" || leaf.family_id === "unit-filter-target"));
}

/**
 * True when a unit-filter that binds an attack's defender (compile-unit-filters.ts) sits earlier in
 * the leaf's fragment. The rolls after it are the attacker's: "attacks that target friendly X units
 * have -1 to wound rolls" modifies the attacking unit's wound roll.
 */
export function defenderBoundBefore(list: readonly CompileLeaf[], index: number): boolean {
  const fragment = list[index]!.fragment;
  return list.slice(0, index).some((leaf) => leaf.fragment === fragment && leaf.family_id === "unit-filter-target" && leaf.parameters.binds_defender === true);
}

/**
 * "Attacks aimed at friendly X units where the attacker's power beats the target's resilience": a clause-initial
 * unit-filter with no attack-filter before it, followed in its fragment by an attack-compare
 * that names the defender. The attack-compare has no other frame, so the filter names the target.
 */
export function defenderCompareAfter(list: readonly CompileLeaf[], index: number): boolean {
  const filter = list[index]!;
  if (list.slice(0, index).some((leaf) => leaf.fragment === filter.fragment)) return false;
  return list[index + 1]?.family_id === "attack-compare" && targetCondition(list[index + 1], filter);
}

/**
 * The rolls with the filter's units and the attack type as their weapon_type. An explicit
 * weapon_type on a roll must be the attack type or all; anything else cannot be one restriction.
 */
export function foldAttackFrame(filter: Record<string, unknown>, frame: CompileLeaf, rolls: readonly CompileLeaf[]): CompileLeaf[] {
  const weapon = (frame.parameters as { attack_type: string }).attack_type;
  return rolls.map((roll) => {
    if (!FOLDABLE_FAMILIES.has(roll.family_id)) throw new CompileError(`An attack-filter cannot scope a ${roll.family_id} effect; name hit, wound or damage rolls.`);
    const named = Array.isArray(roll.parameters.rolls) ? roll.parameters.rolls as unknown[] : [roll.parameters.roll];
    if (!named.every((name) => ATTACK_ROLLS.has(String(name)))) throw new CompileError(`An attack-filter scopes hit, wound or damage rolls only, not ${named.map(String).join(" or ")}.`);
    const explicit = roll.parameters.weapon_type === undefined ? "all" : String(roll.parameters.weapon_type);
    if (explicit !== "all" && explicit !== weapon) throw new CompileError(`A ${weapon} attack-filter and a ${explicit} roll in the same sentence conflict.`);
    return { ...roll, parameters: { ...roll.parameters, subject_filter: filter, weapon_type: weapon } };
  });
}
