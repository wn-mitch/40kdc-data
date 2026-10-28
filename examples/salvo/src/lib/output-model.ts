/**
 * What the output pane derives from Salvo's choices before it renders: the attacker's levers, the
 * target's defensive buffs, the combined unit's members and each weapon line's attributed crunch.
 * A failure is returned as an `error` for the pane to show, never thrown.
 */
import {
  attributeStages,
  resolveBuffs,
  type AbilityMortalWounds,
  baseWargear,
  combinedWargear,
  loadoutHitModifier,
  loadoutWargearScoring,
  profileEngineInput,
  resolveUnitWeapon,
  withGrantedWeapons,
  type AbilityNeed,
  type AttributedStage,
  type Buff,
  type Dataset,
  type EngineContext,
  type StackableBuff,
  type StackableBuffGroup,
  type Unit,
  type UnitView,
  type Weapon,
  type WeaponGrant,
} from "@alpaca-software/40kdc-data";

import { activeSupport, defenderBuffs, type DefenderBuild } from "./defender.js";
import type { ManualTarget } from "./store.svelte.js";
import { memberLoadout, type MemberLoadout, type WeaponLine } from "./weapon-lines.js";

export type LeverSelection = { buffs: StackableBuff[]; groups: StackableBuffGroup[]; needs: AbilityNeed[]; error?: string };

export type MemberUnit = { memberId: string; unit: UnitView; loadout: MemberLoadout };

export type LineResult = WeaponLine & { models: number; attributed: AttributedStage[]; error?: string };

/**
 * What a member's loadout wargear changes about scoring it: the weapons that wargear grants (e.g. a
 * drone's carbine), those weapons' records for their lines, and the shared buffs less the member's
 * printed rules for wargear it leaves out.
 */
export type MemberWargear = { grants: WeaponGrant[]; granted: Weapon[]; buffs: Buff[]; error?: string };

/** A unit carrying the manual target's stat block. */
export function synthTarget(t: ManualTarget): Unit {
  return {
    id: "salvo-manual-target",
    name: "Manual target",
    faction_id: "salvo-manual",
    profiles: [
      {
        name: "manual",
        M: 6,
        T: t.T,
        W: t.W,
        Sv: t.Sv,
        ...(t.invuln !== null ? { invuln_sv: t.invuln } : {}),
        Ld: 7,
        OC: 1,
      },
    ],
    keywords: t.keywords,
    faction_keywords: [],
    model_count: { min: t.modelCount, max: t.modelCount },
    game_version: { edition: "11th", dataslate: "pre-launch-provisional" },
  } as Unit;
}

export type AttackerChoice = {
  unitId: string | null;
  factionId: string | null;
  detachmentId: string | null;
  attachedUnitIds: readonly string[];
  supportUnitIds: readonly string[];
};

/** One member's levers, read as that member, and the context its lines crunch under. */
export type MemberLevers = { memberId: string; context: EngineContext; levers: LeverSelection };

/**
 * Each member's role in the combined unit: the selected unit is the Bodyguard when the attached
 * units can lead it, else it leads them.
 */
export function memberRoles(ds: Dataset, unitId: string, attachedUnitIds: readonly string[]): Record<string, "leader" | "bodyguard"> {
  const leaders = new Set(ds.leadersAttachableTo(unitId).map((unit) => unit.id));
  const leads = attachedUnitIds.length > 0 && attachedUnitIds.every((id) => leaders.has(id));
  return Object.fromEntries([
    [unitId, leads ? "bodyguard" : "leader"],
    ...attachedUnitIds.map((id) => [id, leads ? "leader" : "bodyguard"] as const),
  ]);
}

/**
 * The wargear of the combined unit's out-of-the-box loadouts, which Salvo does not edit: what its
 * `unit-wargear` conditions read, as one unit for all rules purposes (core rule 19.01).
 */
export function unitWargear(ds: Dataset, members: readonly MemberUnit[]): Record<string, number> {
  return combinedWargear(members.map((member) => baseWargear(ds, member.unit.raw, member.loadout.modelCount)));
}

/**
 * `context` as one member of the combined unit reads it, as the damage matrix reads each member:
 * its own unit, role (when attached), model keywords and unhurt Wounds unless the scenario states
 * them, with the combined unit's `wargear` (see {@link unitWargear}).
 */
export function memberContext(
  member: MemberUnit,
  role: "leader" | "bodyguard" | undefined,
  context: EngineContext,
  wargear: Record<string, number>,
): EngineContext {
  const unit = member.unit.raw;
  const wounds = unit.profiles?.[0]?.W;
  const own = [...new Set([...(unit.keywords ?? []), ...(unit.faction_keywords ?? [])].map((keyword) => keyword.toLowerCase()))].sort();
  return {
    ...context,
    attackerUnitId: unit.id,
    ...(role ? { attackerAttachmentRole: role } : {}),
    // The member's models carry its own keywords, every one of them, and no other member's.
    attackerModelKeywords: own,
    attackerMemberKeywords: own,
    ...(context.attackerWounds === undefined && typeof wounds === "number" ? { attackerWounds: { remaining: wounds, starting: wounds } } : {}),
    attackerWargear: wargear,
  };
}

/**
 * The combined unit's ability, army, detachment, attached and support levers, read per member:
 * each member with the others attached, under its own {@link memberContext}. These are
 * weapon-independent and shared by every weapon line of the member, so no weapon profiles are
 * passed unless `weaponProfiles` asks for the selected unit's: crunch injects each line's own
 * weapon keywords, and passing them here too would double-count additive keyword effects.
 */
export function memberLevers(
  ds: Dataset,
  attacker: AttackerChoice,
  context: EngineContext,
  weaponProfiles: { weaponId: string; profileIndex: number }[] = [],
): MemberLevers[] {
  if (!attacker.unitId) return [];
  const members = memberUnits(ds, attacker.factionId, [attacker.unitId, ...attacker.attachedUnitIds]);
  const ids = members.map((member) => member.memberId);
  const roles = memberRoles(ds, attacker.unitId, attacker.attachedUnitIds);
  const wargear = unitWargear(ds, members);
  return members.map((member, index) => {
    const attached = members.length > 1;
    const own = memberContext(member, attached ? roles[member.memberId] : undefined, context, wargear);
    try {
      return {
        memberId: member.memberId,
        context: own,
        levers: ds.stackableBuffsFor(
          {
            unitId: member.memberId,
            factionId: attacker.factionId ?? undefined,
            detachmentId: attacker.detachmentId ?? undefined,
            attachedUnitIds: ids.filter((id) => id !== member.memberId),
            ...(attached ? { attachmentRoles: roles } : {}),
            supportingUnitIds: activeSupport(ds, attacker.factionId, ids, attacker.supportUnitIds),
            weaponProfiles: index === 0 ? weaponProfiles : [],
          },
          own,
        ),
      };
    } catch (err) {
      return { memberId: member.memberId, context: own, levers: { buffs: [], groups: [], needs: [], error: (err as Error).message } };
    }
  });
}

/** Every member's levers, one per id, with their groups: what the toggles and the selection check read. */
export function unionLevers(perMember: readonly MemberLevers[]): LeverSelection {
  const buffs = new Map<string, StackableBuff>();
  const groups = new Map<string, StackableBuffGroup>();
  const needs = new Map<string, AbilityNeed>();
  for (const { levers } of perMember) {
    for (const lever of levers.buffs) if (!buffs.has(lever.id)) buffs.set(lever.id, lever);
    for (const group of levers.groups) if (!groups.has(group.id)) groups.set(group.id, group);
    for (const need of levers.needs) needs.set(`${need.abilityId}\u0000${need.key}`, need);
  }
  const error = perMember.find(({ levers }) => levers.error)?.levers.error;
  return { buffs: [...buffs.values()], groups: [...groups.values()], needs: [...needs.values()], ...(error ? { error } : {}) };
}

/** The buffs of the enabled levers, leaving out weapon-keyword levers, which the engine injects per line. */
export function enabledLeverBuffs(levers: readonly StackableBuff[], isEnabled: (lever: StackableBuff) => boolean): Buff[] {
  return levers.filter((lever) => lever.source.kind !== "weapon-keyword" && isEnabled(lever)).flatMap((lever) => lever.buffs);
}

/** The target's defensive buffs under the defender's build; none for the manual stat block (no unit id). */
export function targetDefences(
  ds: Dataset,
  targetUnitId: string | null,
  build: DefenderBuild,
  context: EngineContext,
): { buffs: Buff[]; error?: string } {
  if (!targetUnitId) return { buffs: [] };
  const unit = ds.units.getAny(targetUnitId);
  if (!unit) return { buffs: [], error: `Target unit ${targetUnitId} is not in the dataset` };
  try {
    return { buffs: defenderBuffs(ds, unit, build, context) };
  } catch (err) {
    return { buffs: [], error: (err as Error).message };
  }
}

/**
 * The selected unit and its attached members, each resolved within the selected faction so a
 * shared chassis (e.g. `chaos-land-raider`) uses that faction's copy. Unknown ids are skipped.
 */
export function memberUnits(ds: Dataset, factionId: string | null, memberIds: readonly (string | null)[]): MemberUnit[] {
  return memberIds.flatMap((memberId) => {
    if (!memberId) return [];
    const unit = (factionId && ds.units.getInFaction(memberId, factionId)) || ds.units.getAny(memberId);
    return unit ? [{ memberId, unit, loadout: memberLoadout(ds, unit.raw) }] : [];
  });
}

/**
 * A member's loadout wargear, scored the way the damage matrix scores it (the package's
 * `loadoutWargearScoring`). Granted weapons the member already lists get no extra line.
 */
export function memberWargear(input: {
  ds: Dataset;
  factionId: string | null;
  member: MemberUnit;
  counts: ReadonlyMap<string, number>;
  buffs: readonly Buff[];
  context: EngineContext;
}): MemberWargear {
  const unit = input.member.unit.raw;
  try {
    const scoring = loadoutWargearScoring({
      dataset: input.ds,
      unit,
      factionId: input.factionId ?? unit.faction_id,
      counts: input.counts,
      buffs: input.buffs,
      context: input.context,
    });
    const listed = new Set(input.member.unit.weapons.map((weapon) => weapon.id));
    const granted: Weapon[] = [];
    for (const grant of scoring.grants.grants) {
      if (listed.has(grant.weaponId) || granted.some((weapon) => weapon.id === grant.weaponId)) continue;
      const weapon = resolveUnitWeapon(input.ds, unit, grant.weaponId);
      if (weapon) granted.push(weapon);
    }
    return { grants: scoring.grants.grants, granted, buffs: scoring.buffs };
  } catch (err) {
    return { grants: [], granted: [], buffs: [...input.buffs], error: (err as Error).message };
  }
}

/** How many copies of `weaponId` the member's wargear grants across its models. */
export function grantedCopies(grants: readonly WeaponGrant[], counts: ReadonlyMap<string, number>, weaponId: string): number {
  return (withGrantedWeapons(counts, grants).get(weaponId) ?? 0) - (counts.get(weaponId) ?? 0);
}

/**
 * One weapon line crunched with the shared buffs and the models firing it, with the leave-one-out
 * attribution of each stage. The engine input is the one the loadout scoring used, including the
 * owner's Big Guns Never Tire Hit roll modifier.
 */
export function crunchLine(input: {
  ds: Dataset;
  line: WeaponLine;
  owner: Unit | undefined;
  models: number;
  target: { unit: Unit; modelCount: number };
  buffs: readonly Buff[];
  context: EngineContext;
}): LineResult {
  const { ds, line, owner, models, context } = input;
  if (models <= 0) return { ...line, models, attributed: [], error: "no models carry this weapon" };
  try {
    const profile = line.weaponRaw.profiles[line.profileIndex];
    const attributed = attributeStages(
      profileEngineInput({
        weapon: line.weaponRaw,
        profileIndex: line.profileIndex,
        target: input.target,
        modelsFiring: models,
        buffs: [...input.buffs],
        context,
        hitModifier: owner && profile ? loadoutHitModifier(owner, profile, context) : 0,
      }),
      ds,
    );
    return { ...line, models, attributed };
  } catch (err) {
    return { ...line, models, attributed: [], error: (err as Error).message };
  }
}

/** One mortal-wound source as Salvo toggles it, keyed by its id and moment. */
export type MortalSourceChoice = AbilityMortalWounds & { key: string };

/** The toggle key of a source: one ability can inflict mortal wounds at more than one moment. */
export function mortalSourceKey(source: Pick<AbilityMortalWounds, "id" | "moment">): string {
  return `${source.id}@${source.moment ?? ""}`;
}

/**
 * The mortal wounds the combined unit's abilities inflict outside its attacks, read per member as
 * {@link memberLevers} reads levers and kept once per key, with the needs each source raises. The
 * combined unit's model count is the default for dice rolled per model.
 */
export function memberMortalSources(
  ds: Dataset,
  attacker: AttackerChoice,
  context: EngineContext,
): { sources: MortalSourceChoice[]; needs: AbilityNeed[]; unverified: string[]; error?: string } {
  if (!attacker.unitId) return { sources: [], needs: [], unverified: [] };
  const members = memberUnits(ds, attacker.factionId, [attacker.unitId, ...attacker.attachedUnitIds]);
  const ids = members.map((member) => member.memberId);
  const roles = memberRoles(ds, attacker.unitId, attacker.attachedUnitIds);
  const models = members.reduce((sum, member) => sum + member.loadout.modelCount, 0);
  const sources = new Map<string, MortalSourceChoice>();
  const needs = new Map<string, AbilityNeed>();
  const unverified = new Set<string>();
  try {
    for (const member of members) {
      const attached = members.length > 1;
      const result = ds.mortalWoundSourcesFor(
        {
          unitId: member.memberId,
          factionId: attacker.factionId ?? undefined,
          detachmentId: attacker.detachmentId ?? undefined,
          attachedUnitIds: ids.filter((id) => id !== member.memberId),
          ...(attached ? { attachmentRoles: roles } : {}),
        },
        { ...context, attackerModelCount: context.attackerModelCount ?? models },
      );
      for (const source of result.sources) {
        if (isProvisional(ds, source.abilityId, attacker.factionId)) {
          unverified.add(source.label);
          continue;
        }
        const key = mortalSourceKey(source);
        if (!sources.has(key)) sources.set(key, { ...source, key });
        for (const need of source.needs) needs.set(`${source.abilityId}\u0000${need.key}`, { ...need, abilityId: source.abilityId, label: source.label });
      }
    }
  } catch (err) {
    return { sources: [], needs: [], unverified: [], error: (err as Error).message };
  }
  return { sources: [...sources.values()], needs: [...needs.values()], unverified: [...unverified] };
}

/**
 * Whether an ability record still carries its pre-launch DSL, which has not been checked against
 * the rule: its mortal wounds are named but never offered as a toggle or counted.
 */
function isProvisional(ds: Dataset, abilityId: string, factionId: string | null): boolean {
  const ability = (factionId ? ds.abilities.getInFaction(abilityId, factionId) : undefined) ?? ds.abilities.getAny(abilityId);
  return ability?.raw.game_version?.dataslate === "pre-launch-provisional";
}

/**
 * The enabled sources' mortal wounds on the target: their expected total, and what is left after
 * the target's Feel No Pain (one on every wound and one on mortal wounds roll independently).
 */
export function mortalSourceLine(
  sources: readonly MortalSourceChoice[],
  enabled: ReadonlySet<string>,
  targetBuffs: readonly Buff[],
  context: EngineContext,
): { damage: number; afterFnp: number } {
  const damage = sources.filter((source) => enabled.has(source.key)).reduce((sum, source) => sum + source.expected, 0);
  if (damage === 0) return { damage, afterFnp: 0 };
  const resolved = resolveBuffs([...targetBuffs], context);
  const survive = (fnp: { threshold: number } | null) => (fnp ? Math.min(1, Math.max(0, (fnp.threshold - 1) / 6)) : 1);
  return { damage, afterFnp: damage * survive(resolved.feelNoPain) * survive(resolved.feelNoPainMortal) };
}

/** The sources' line as stages, for the combined total: damage and after-FNP only. */
export function mortalSourceStages(line: { damage: number; afterFnp: number }): AttributedStage[] {
  const stage = (name: "damage" | "after-fnp", expected: number): AttributedStage =>
    ({ name, expected, detail: "mortal wounds from abilities", baseline: expected, lifts: [], residual: 0, intrinsics: [] });
  return [stage("damage", line.damage), stage("after-fnp", line.afterFnp)];
}
