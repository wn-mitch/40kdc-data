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
function frameFilter(leaf: CompileLeaf | undefined): leaf is CompileLeaf & { parameters: { attack_type: "melee" | "ranged" } } {
  if (leaf?.family_id !== "attack-filter") return false;
  const { attack_type: type, negated, ...rest } = leaf.parameters;
  return (type === "melee" || type === "ranged") && Object.keys(rest).length === 0 && negated !== true;
}

/**
 * The attack-filter after a unit-filter (past any "from your army" of its side) and the
 * consecutive subjectless rolls after it in the same fragment, or null when that is not the shape.
 */
export function attackFrameRolls(list: readonly CompileLeaf[], index: number, filter: CompileLeaf): { frame: number; rolls: CompileLeaf[] } | null {
  let frame = index + 1;
  while (list[frame]?.family_id === "unit-owner" && list[frame]!.parameters.owner === filter.parameters.side) frame += 1;
  const attack = list[frame];
  if (!frameFilter(attack) || attack.fragment !== filter.fragment) return null;
  const rolls: CompileLeaf[] = [];
  for (let at = frame + 1; subjectlessRoll(list[at]) && list[at]!.fragment === filter.fragment; at += 1) rolls.push(list[at]!);
  return rolls.length > 0 ? { frame, rolls } : null;
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
