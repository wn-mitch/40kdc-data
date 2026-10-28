import type { Buff } from "../cruncher/index.js";
import type { StackMember, StackSpec, UnitLoadoutResult } from "./model.js";
import { bearerEquippedBuffs, unequippedRules } from "./weapon-grants.js";

/** Each stack member's chosen loadout, by unit id. */
export type MemberLoadouts = ReadonlyMap<string, ReadonlyMap<string, number>>;

function sameCounts(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  const ids = new Set([...left.keys(), ...right.keys()]);
  return [...ids].every((id) => (left.get(id) ?? 0) === (right.get(id) ?? 0));
}

/**
 * The members' loadouts once each is scored against the others' choices. A rule one member's
 * wargear prints reaches the others only while that member's chosen loadout carries the item, so
 * each member is scored first without choices, then against the previous round's until no choice
 * changes (bounded by the member count, as a choice can flip back).
 */
export function settleMemberLoadouts(
  members: readonly StackMember[],
  scoreMember: (member: StackMember, chosen?: MemberLoadouts) => UnitLoadoutResult,
): { member: StackMember; loadout: UnitLoadoutResult }[] {
  const score = (chosen?: MemberLoadouts) => members.map((member) => ({ member, loadout: scoreMember(member, chosen) }));
  let scored = score();
  for (let round = 0; round < members.length; round += 1) {
    const next = score(new Map(scored.map(({ member, loadout }) => [member.unit.id, loadout.counts])));
    const settled = next.every(({ loadout }, index) => sameCounts(loadout.counts, scored[index]!.loadout.counts));
    scored = next;
    if (settled) break;
  }
  return scored;
}

/** `buffs` without the rules the other members' wargear prints for items their `chosen` loadouts leave out. */
export function othersEquippedBuffs(spec: StackSpec, member: StackMember, chosen: MemberLoadouts | undefined, buffs: readonly Buff[]): Buff[] {
  let kept = [...buffs];
  for (const other of spec.members) {
    const counts = other !== member ? chosen?.get(other.unit.id) : undefined;
    if (counts) kept = bearerEquippedBuffs(other.unit.raw, counts, kept);
  }
  return kept;
}

/** The other members' wargear rules `chosen` leaves out, as a `|`-led cache key suffix ("" for none). */
export function othersUnequippedKey(spec: StackSpec, member: StackMember, chosen?: MemberLoadouts): string {
  if (!chosen) return "";
  const dropped = spec.members.filter((other) => other !== member).flatMap((other) => {
    const counts = chosen.get(other.unit.id);
    return counts ? [...unequippedRules(other.unit.raw, counts)].map((abilityId) => `${other.unit.id}:${abilityId}`) : [];
  });
  return dropped.length ? `|${dropped.sort().join("+")}` : "";
}
