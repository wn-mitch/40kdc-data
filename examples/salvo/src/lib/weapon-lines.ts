/**
 * The weapon lines of the combined unit and which of them its models actually use. Every profile
 * of every phase-eligible weapon is a line, so a player can inspect it; the package's
 * `unitLoadoutDamage` decides which lines fire and with how many models (each model fires its
 * Pistols or its other ranged weapons, and uses one ordinary melee weapon), the same scoring the
 * damage matrix uses.
 */
import {
  baseLoadout,
  unitLoadoutDamage,
  validateCandidateLoadout,
  weaponBounds,
  type Buff,
  type Dataset,
  type EngineContext,
  type LoadoutModel,
  type PistolChoice,
  type Unit,
  type WargearOption,
  type Weapon,
  type WeaponBound,
  type WeaponGrant,
} from "@alpaca-software/40kdc-data";

export type MemberLoadout = {
  unit: Unit;
  /**
   * The base loadout: every model in its out-of-the-box configuration, the legal default a unit
   * ships with. It includes wargear that has no weapon line (e.g. a medikit or a totem).
   */
  counts: Map<string, number>;
  bounds: Map<string, WeaponBound>;
  modelCount: number;
  options: WargearOption[];
  models: LoadoutModel[];
};

export type WeaponLine = {
  id: string;
  weaponId: string;
  profileIndex: number;
  label: string;
  weaponRaw: Weapon;
  ownerMemberId: string;
};

export type LineSelection = {
  /** Models firing each used line, by line id; a line absent here is not used. */
  firing: Map<string, number>;
  pistolChoice: Map<string, PistolChoice>;
  /** Wargear rules each member's counts break, by member id; a member with none is absent. */
  violations: Map<string, string[]>;
  /** Expected damage after Feel No Pain across the used lines. */
  total: number;
};

export function lineId(memberId: string, weaponId: string, profileIndex: number): string {
  return `${memberId}:${weaponId}:${profileIndex}`;
}

/** A member's wargear loadout at its minimum model count. */
export function memberLoadout(ds: Dataset, unit: Unit): MemberLoadout {
  const modelCount = unit.model_count?.min ?? 1;
  const options = ds.wargearOptionsOf(unit);
  const models = (ds.unitCompositionOf(unit) as { models?: LoadoutModel[] } | undefined)?.models ?? [];
  return {
    unit,
    counts: baseLoadout(unit, modelCount, options, models).counts,
    bounds: weaponBounds(unit, modelCount, options, models),
    modelCount,
    options,
    models,
  };
}

/**
 * How many of a member's models carry a weapon by default: its base-loadout count, or 0 for a
 * weapon no model carries out of the box (a wargear option's replacement or an alternative
 * loadout's weapon).
 */
export function defaultWeaponCount(loadout: MemberLoadout, weaponId: string): number {
  return loadout.counts.get(weaponId) ?? 0;
}

/**
 * The equipment counts of a member's models: `carried` for each of `weaponIds` (the weapons Salvo
 * shows lines for), plus the base-loadout count of any other wargear, which Salvo does not edit
 * but the legality check needs to account for every model.
 */
export function memberCounts(
  loadout: MemberLoadout,
  weaponIds: readonly string[],
  carried: (weaponId: string) => number,
): Map<string, number> {
  const shown = new Set(weaponIds);
  const counts = new Map([...loadout.counts].filter(([id]) => !shown.has(id)));
  for (const id of shown) {
    const n = carried(id);
    if (n > 0) counts.set(id, n);
  }
  return counts;
}

/** One line per profile of every weapon of `type` across the members, labelled by unit when there are several. */
export function weaponLines(
  members: readonly { memberId: string; name: string; weapons: readonly Weapon[] }[],
  type: "ranged" | "melee",
): WeaponLine[] {
  const lines: WeaponLine[] = [];
  for (const member of members) {
    for (const weapon of member.weapons) {
      if (weapon.type !== type) continue;
      weapon.profiles.forEach((profile, profileIndex) => {
        const weaponPart = weapon.profiles.length > 1 ? `${weapon.name} — ${profile.name}` : weapon.name;
        lines.push({
          id: lineId(member.memberId, weapon.id, profileIndex),
          weaponId: weapon.id,
          profileIndex,
          label: members.length > 1 ? `${member.name} · ${weaponPart}` : weaponPart,
          weaponRaw: weapon,
          ownerMemberId: member.memberId,
        });
      });
    }
  }
  return lines;
}

/**
 * Which lines each member fires and with how many models, given the weapon counts its models
 * carry. A member's `grants` add the weapons its wargear equips, and its `buffs` replace the
 * shared ones (the shared buffs less its printed rules for wargear it leaves out).
 */
export function selectLines(input: {
  ds: Dataset;
  members: readonly {
    memberId: string;
    loadout: MemberLoadout;
    counts: ReadonlyMap<string, number>;
    grants?: readonly WeaponGrant[];
    buffs?: readonly Buff[];
  }[];
  target: { unit: Unit; modelCount: number };
  buffs: readonly Buff[];
  context: EngineContext;
}): LineSelection {
  const firing = new Map<string, number>();
  const pistolChoice = new Map<string, PistolChoice>();
  const violations = new Map<string, string[]>();
  let total = 0;
  for (const member of input.members) {
    const { unit, modelCount, options, models } = member.loadout;
    // The damage matrix's legality check; its model groups drive the per-model Pistol choice.
    const legality = validateCandidateLoadout({ unit, modelCount, options, counts: member.counts, models });
    if (!legality.legal) violations.set(member.memberId, legality.violations.map((violation) => violation.message));
    const scored = unitLoadoutDamage({
      dataset: input.ds,
      unit: member.loadout.unit,
      modelCount: member.loadout.modelCount,
      counts: member.counts,
      target: input.target,
      buffs: member.buffs ?? input.buffs,
      context: input.context,
      groups: legality.groups,
      grants: member.grants,
    });
    for (const selected of scored.selected) {
      const id = lineId(member.memberId, selected.weaponId, selected.profileIndex);
      firing.set(id, (firing.get(id) ?? 0) + selected.count);
    }
    pistolChoice.set(member.memberId, scored.pistolChoice);
    total += scored.total;
  }
  return { firing, pistolChoice, violations, total };
}
