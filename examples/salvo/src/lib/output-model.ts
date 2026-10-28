/**
 * What the output pane derives from Salvo's choices before it renders: the attacker's levers, the
 * target's defensive buffs, the combined unit's members and each weapon line's attributed crunch.
 * A failure is returned as an `error` for the pane to show, never thrown.
 */
import {
  attributeStages,
  baseWargear,
  loadoutHitModifier,
  loadoutWargearScoring,
  profileEngineInput,
  resolveUnitWeapon,
  withGrantedWeapons,
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

export type LeverSelection = { buffs: StackableBuff[]; groups: StackableBuffGroup[]; error?: string };

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

/**
 * `context` with the combined unit's wargear: each member's out-of-the-box loadout, which Salvo
 * does not edit, summed. Rules gated on the unit's wargear read it, as the damage matrix's do.
 */
export function withUnitWargear(ds: Dataset, factionId: string | null, memberIds: readonly (string | null)[], context: EngineContext): EngineContext {
  const wargear: Record<string, number> = {};
  for (const { unit, loadout } of memberUnits(ds, factionId, memberIds)) {
    for (const [id, count] of Object.entries(baseWargear(ds, unit.raw, loadout.modelCount))) wargear[id] = (wargear[id] ?? 0) + count;
  }
  return { ...context, attackerWargear: wargear };
}

/**
 * The combined unit's ability, army, detachment, attached and support levers, read with the
 * unit's wargear. These are weapon-independent and shared by every weapon line, so no weapon profiles are passed: crunch
 * injects each line's own weapon keywords, and passing them here too would double-count additive
 * keyword effects.
 */
export function attackerLevers(
  ds: Dataset,
  attacker: {
    unitId: string | null;
    factionId: string | null;
    detachmentId: string | null;
    attachedUnitIds: readonly string[];
    supportUnitIds: readonly string[];
  },
  context: EngineContext,
): LeverSelection {
  if (!attacker.unitId) return { buffs: [], groups: [] };
  try {
    return ds.stackableBuffsFor(
      {
        unitId: attacker.unitId,
        factionId: attacker.factionId ?? undefined,
        detachmentId: attacker.detachmentId ?? undefined,
        attachedUnitIds: [...attacker.attachedUnitIds],
        supportingUnitIds: activeSupport(ds, attacker.factionId, [attacker.unitId, ...attacker.attachedUnitIds], attacker.supportUnitIds),
        weaponProfiles: [],
      },
      withUnitWargear(ds, attacker.factionId, [attacker.unitId, ...attacker.attachedUnitIds], context),
    );
  } catch (err) {
    return { buffs: [], groups: [], error: (err as Error).message };
  }
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
