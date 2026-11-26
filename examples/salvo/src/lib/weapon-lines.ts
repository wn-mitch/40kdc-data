/**
 * The weapon lines of the combined unit and which of them its models actually use. Every profile
 * of every phase-eligible weapon is a line, so a player can inspect it; the package's
 * `unitLoadoutDamage` decides which lines fire and with how many models (each model fires its
 * Pistols or its other ranged weapons, and uses one ordinary melee weapon), the same scoring the
 * damage matrix uses.
 */
import {
  clampWeaponCount,
  groupsWithGrantedWeapons,
  isMeleeProfile,
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

import { startingLoadout } from "../../../_shared/best-loadout.js";

export type MemberLoadout = {
  unit: Unit;
  /**
   * The starting loadout: the best legal loadout the points-value audit found for the unit at this
   * size, else every model in its out-of-the-box configuration. It includes wargear that has no
   * weapon line (e.g. a medikit or a totem).
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

/** A member's wargear loadout at `models` models, held to its datasheet's range; its minimum when unset. */
export function memberLoadout(ds: Dataset, unit: Unit, models?: number): MemberLoadout {
  const min = unit.model_count?.min ?? 1;
  const max = unit.model_count?.max ?? min;
  const modelCount = Math.min(max, Math.max(min, Math.floor(models ?? min)));
  const rules = ds.loadoutOf(unit);
  return {
    unit,
    counts: startingLoadout(ds, unit, modelCount) ?? new Map(),
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

/** Legal loadouts searched for an edit; past this many the nearest may be missed. */
const CANDIDATE_LIMIT = 2048;

/**
 * The member's counts after the player sets `weaponId` to `n` copies: the legal loadout carrying
 * exactly that many (clamped to the weapon's bounds) that moves the fewest copies from `current`,
 * so taking axes hands back the spears they replace. With no such loadout, `current` with the one
 * count changed, which the legality check then reports.
 */
export function editedCounts(
  loadout: MemberLoadout,
  current: ReadonlyMap<string, number>,
  weaponId: string,
  n: number,
): Map<string, number> {
  const count = loadout.bounds.has(weaponId)
    ? clampWeaponCount(loadout.bounds, weaponId, n)
    : Math.max(0, Math.floor(n) || 0);
  let best: Map<string, number> | null = null;
  let bestDistance = Infinity;
  for (const candidate of loadout.rules.candidates(loadout.modelCount, CANDIDATE_LIMIT)) {
    // `"<witness> => <id>:<n>,…"`; the truncation marker has no counts.
    const arrow = candidate.lastIndexOf(" => ");
    if (arrow < 0) continue;
    const counts = new Map<string, number>();
    for (const item of candidate.slice(arrow + 4).split(",")) {
      const colon = item.lastIndexOf(":");
      if (colon > 0) counts.set(item.slice(0, colon), Number(item.slice(colon + 1)));
    }
    if ((counts.get(weaponId) ?? 0) !== count) continue;
    let distance = 0;
    for (const id of new Set([...counts.keys(), ...current.keys()])) {
      distance += Math.abs((counts.get(id) ?? 0) - (current.get(id) ?? 0));
    }
    if (distance < bestDistance) {
      best = counts;
      bestDistance = distance;
    }
  }
  if (best) return best;
  const next = new Map(current);
  if (count > 0) next.set(weaponId, count);
  else next.delete(weaponId);
  return next;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A line's weapon label: the weapon name, with the profile name after it only when it tells the
 * line apart. A profile named like its weapon (the Castellan axe's "Castellan Axe" melee profile)
 * adds nothing, unless another profile of the same phase shares that name, when its position does.
 */
function profileLabel(weapon: Weapon, profileIndex: number, type: "ranged" | "melee"): string {
  const profile = weapon.profiles[profileIndex]!;
  const inPhase = weapon.profiles.filter((p) => (isMeleeProfile(p) ? "melee" : "ranged") === type);
  if (inPhase.length <= 1) return weapon.name;
  if (!sameName(profile.name, weapon.name) && inPhase.filter((p) => sameName(p.name, profile.name)).length === 1) {
    return `${weapon.name} — ${profile.name}`;
  }
  return `${weapon.name} (profile ${inPhase.indexOf(profile) + 1})`;
}

/** One line per profile of `type` of every weapon across the members, labelled by unit when there are several. */
export function weaponLines(
  members: readonly { memberId: string; name: string; weapons: readonly Weapon[] }[],
  type: "ranged" | "melee",
): WeaponLine[] {
  const lines: WeaponLine[] = [];
  for (const member of members) {
    for (const weapon of member.weapons) {
      weapon.profiles.forEach((profile, profileIndex) => {
        // A weapon can carry both ranged and melee profiles: the profile decides its phase.
        if ((isMeleeProfile(profile) ? "melee" : "ranged") !== type) return;
        const weaponPart = profileLabel(weapon, profileIndex, type);
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
