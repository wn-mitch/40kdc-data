/**
 * The weapon lines of the combined unit and which of them its models actually use. Every profile
 * of every phase-eligible weapon is a line, so a player can inspect it; the package's
 * `unitLoadoutDamage` decides which lines fire and with how many models (each model fires its
 * Pistols or its other ranged weapons, and uses one ordinary melee weapon), the same scoring the
 * damage matrix uses.
 */
import {
  groupsWithGrantedWeapons,
  unitLoadoutDamage,
  validateCandidateLoadout,
  withGrantedWeapons,
  type Buff,
  type CandidateLoadoutLegality,
  type Dataset,
  type EngineContext,
  type PistolChoice,
  type SelectedWeaponProfile,
  type Unit,
  type UnitLoadout,
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
  /** The unit's wargear legality, which checks a member's counts and finds its model groups. */
  rules: UnitLoadout;
};

export type WeaponLine = {
  id: string;
  weaponId: string;
  profileIndex: number;
  label: string;
  weaponRaw: Weapon;
  ownerMemberId: string;
};

/**
 * Models that use one line with the same wargear: the loadout scoring's row for them. Its
 * `modelWargear` decides which bearer-only wargear rules reach them, and `rerollOne` whether they
 * spend the unit's re-roll-one permissions.
 */
export type LineRow = Pick<SelectedWeaponProfile, "count" | "modelWargear" | "rerollOne">;

/** A member's models as the legality check grouped them, with the weapons their wargear grants. */
type MemberModels = {
  modelCount: number;
  groups: NonNullable<CandidateLoadoutLegality["groups"]> | null;
  /** Every item the member's models carry, granted weapons included. */
  carried: string[];
};

export type LineSelection = {
  /** Models firing each used line, by line id; a line absent here is not used. */
  firing: Map<string, number>;
  /** The loadout scoring's rows behind each used line, by line id; their counts sum to its `firing`. */
  rows: Map<string, LineRow[]>;
  /** Each member's model groups, by member id, for the rows of a line the scoring leaves unused. */
  models: Map<string, MemberModels>;
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
  const rules = ds.loadoutOf(unit);
  return {
    unit,
    counts: rules.base(modelCount) ?? new Map(),
    bounds: rules.bounds(modelCount) ?? new Map(),
    modelCount,
    rules,
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
 * carry. A member's `grants` add the weapons its wargear equips, and its `buffs` and `context`
 * replace the shared ones (its own levers less its printed rules for wargear it leaves out, read
 * as that member).
 */
export function selectLines(input: {
  ds: Dataset;
  members: readonly {
    memberId: string;
    loadout: MemberLoadout;
    counts: ReadonlyMap<string, number>;
    grants?: readonly WeaponGrant[];
    buffs?: readonly Buff[];
    context?: EngineContext;
  }[];
  target: { unit: Unit; modelCount: number };
  buffs: readonly Buff[];
  context: EngineContext;
}): LineSelection {
  const firing = new Map<string, number>();
  const rows = new Map<string, LineRow[]>();
  const models = new Map<string, MemberModels>();
  const pistolChoice = new Map<string, PistolChoice>();
  const violations = new Map<string, string[]>();
  let total = 0;
  for (const member of input.members) {
    const { unit, modelCount, rules } = member.loadout;
    // The damage matrix's legality check; its model groups drive the per-model Pistol choice.
    const legality = validateCandidateLoadout({ unit, modelCount, counts: member.counts, loadout: rules });
    if (!legality.legal) violations.set(member.memberId, legality.violations.map((violation) => violation.message));
    const scored = unitLoadoutDamage({
      dataset: input.ds,
      unit: member.loadout.unit,
      modelCount: member.loadout.modelCount,
      counts: member.counts,
      target: input.target,
      buffs: member.buffs ?? input.buffs,
      context: member.context ?? input.context,
      groups: legality.groups,
      grants: member.grants,
    });
    for (const selected of scored.selected) {
      const id = lineId(member.memberId, selected.weaponId, selected.profileIndex);
      firing.set(id, (firing.get(id) ?? 0) + selected.count);
      const row: LineRow = {
        count: selected.count,
        ...(selected.modelWargear ? { modelWargear: selected.modelWargear } : {}),
        ...(selected.rerollOne ? { rerollOne: selected.rerollOne } : {}),
      };
      rows.set(id, [...(rows.get(id) ?? []), row]);
    }
    const grants = member.grants ?? [];
    models.set(member.memberId, {
      modelCount,
      groups: legality.groups ? groupsWithGrantedWeapons(legality.groups, grants) : null,
      carried: [...withGrantedWeapons(member.counts, grants)].filter(([, n]) => n > 0).map(([id]) => id).sort(),
    });
    pistolChoice.set(member.memberId, scored.pistolChoice);
    total += scored.total;
  }
  return { firing, rows, models, pistolChoice, violations, total };
}

/**
 * The rows `carried` models use a line with. A used line takes the loadout scoring's rows. An
 * unused line, crunched as if its carriers fired it, splits them by the model groups that carry
 * it, and its first row spends the re-roll-one permissions. Without groups that account for every
 * carrier, a lone model is its own bearer group and a larger unit's rows know no bearer, so its
 * bearer-only rules are left out, as the loadout scoring leaves them out.
 */
export function lineRows(selection: LineSelection | null, line: WeaponLine, carried: number): LineRow[] {
  const used = selection?.rows.get(line.id);
  if (used) return used;
  const member = selection?.models.get(line.ownerMemberId);
  if (!member) return [{ count: carried, rerollOne: true }];
  const grouped: LineRow[] = (member.groups ?? []).flatMap((group) => {
    const copies = group.weapons.find((weapon) => weapon.id === line.weaponId)?.count ?? 0;
    return copies > 0
      ? [{ count: copies * group.count, modelWargear: group.weapons.filter((weapon) => weapon.count > 0).map((weapon) => weapon.id) }]
      : [];
  });
  const rows: LineRow[] = grouped.length > 0 && grouped.reduce((sum, row) => sum + row.count, 0) === carried
    ? grouped
    : [member.modelCount === 1 ? { count: carried, modelWargear: member.carried } : { count: carried }];
  return rows.map((row, index) => (index === 0 ? { ...row, rerollOne: true } : row));
}
