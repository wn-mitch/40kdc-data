import type { EngineContext } from "../cruncher/index.js";
import type { Weapon } from "../generated.js";
import { isMeleeProfile } from "../data/weapon-profile.js";

export interface ProfileDamage {
  damage: number;
  stages?: readonly { name: string; expected: number }[];
}

export interface ProfileScoreRequest<C extends EngineContext = EngineContext> {
  weapon: Weapon;
  profileIndex: number;
  modelsFiring: number;
  context: C;
  /** A Hit roll modifier the loadout rules impose on this profile, such as Big Guns Never Tire's −1. */
  hitModifier?: number;
}

export type ProfileScorer<C extends EngineContext = EngineContext> = (
  request: ProfileScoreRequest<C>,
) => ProfileDamage | null;

export interface LoadoutWeapon {
  weapon: Weapon;
  count: number;
}

export interface SelectedWeaponProfile {
  weaponId: string;
  profileIndex: number;
  profileName: string;
  count: number;
  damagePerModel: number;
  damage: number;
  extraAttacks: boolean;
  /** The Hit roll modifier the loadout rules imposed on this profile; absent when none. */
  hitModifier?: number;
  stages: readonly { name: string; expected: number }[];
}

/** Identically-equipped models: `count` models, each carrying `weapons` (per-model counts). */
export interface ModelLoadoutGroup {
  count: number;
  weapons: readonly { id: string; count: number }[];
}

/**
 * How shooting applied the Pistol rule: `none` when it did not bind (fight, an
 * exempt Monster or Vehicle, or no model mixing Pistols with other ranged
 * weapons), `per-model` when each model chose from its own loadout,
 * `unit-wide` when no per-model loadout was known and every model made the same
 * choice, a lower bound on the per-model optimum, and `engaged` when the unit
 * was within Engagement Range: only Pistols fire, except that a Monster or
 * Vehicle fires everything with −1 to hit for non-Pistol weapons.
 */
export type PistolChoice = "none" | "per-model" | "unit-wide" | "engaged";

export interface LoadoutDamageResult {
  total: number;
  selected: SelectedWeaponProfile[];
  pistolChoice: PistolChoice;
}

interface Candidate extends SelectedWeaponProfile {}

type ProfileFilter = (profile: Weapon["profiles"][number]) => boolean;

const isPistolProfile: ProfileFilter = (profile) =>
  (profile.keywords ?? []).some((keyword) => keyword.keyword_id === "pistol");

/** Big Guns Never Tire: an engaged Monster or Vehicle shoots its non-Pistol weapons at −1 to hit. */
export const bigGunsHitModifier = (profile: Weapon["profiles"][number]): number => (isPistolProfile(profile) ? 0 : -1);

function bestProfile<C extends EngineContext>(
  entry: LoadoutWeapon,
  phase: "shooting" | "fight",
  context: C,
  score: ProfileScorer<C>,
  include: ProfileFilter = () => true,
  hitModifier: (profile: Weapon["profiles"][number]) => number = () => 0,
): Candidate | null {
  if (entry.count <= 0) return null;
  const wantMelee = phase === "fight";
  let best: Candidate | null = null;
  for (let profileIndex = 0; profileIndex < entry.weapon.profiles.length; profileIndex++) {
    const profile = entry.weapon.profiles[profileIndex];
    if (isMeleeProfile(profile) !== wantMelee || !include(profile)) continue;
    const modifier = hitModifier(profile);
    const scored = score({
      weapon: entry.weapon,
      profileIndex,
      modelsFiring: 1,
      context,
      ...(modifier !== 0 ? { hitModifier: modifier } : {}),
    });
    if (!scored || !Number.isFinite(scored.damage) || scored.damage < 0) continue;
    const candidate: Candidate = {
      weaponId: entry.weapon.id,
      profileIndex,
      profileName: profile.name,
      count: entry.count,
      damagePerModel: scored.damage,
      damage: scored.damage * entry.count,
      extraAttacks: (profile.keywords ?? []).some(
        (keyword) => keyword.keyword_id === "extra-attacks",
      ),
      ...(modifier !== 0 ? { hitModifier: modifier } : {}),
      stages: scored.stages ?? [],
    };
    if (
      best === null ||
      candidate.damagePerModel > best.damagePerModel ||
      (candidate.damagePerModel === best.damagePerModel &&
        candidate.profileIndex < best.profileIndex)
    ) {
      best = candidate;
    }
  }
  return best;
}

const byWeaponThenProfile = (a: SelectedWeaponProfile, b: SelectedWeaponProfile) =>
  a.weaponId.localeCompare(b.weaponId) || a.profileIndex - b.profileIndex;

const withCount = (candidate: Candidate, count: number): SelectedWeaponProfile => ({
  ...candidate,
  count,
  damage: candidate.damagePerModel * count,
});

/**
 * Shooting under the Pistol rule: each model fires either its Pistols or its
 * other ranged weapons, whichever deals more. Per-model loadouts come from
 * `groups`; a lone model is its own group; otherwise the whole unit makes one
 * choice.
 */
function scoreShootingWithPistols<C extends EngineContext>(input: {
  modelCount: number;
  weapons: readonly LoadoutWeapon[];
  groups: readonly ModelLoadoutGroup[] | null | undefined;
  context: C;
  scoreProfile: ProfileScorer<C>;
}): LoadoutDamageResult | null {
  const pistols = new Map<string, Candidate>();
  const others = new Map<string, Candidate>();
  for (const entry of input.weapons) {
    const pistol = bestProfile(entry, "shooting", input.context, input.scoreProfile, isPistolProfile);
    const other = bestProfile(entry, "shooting", input.context, input.scoreProfile, (profile) => !isPistolProfile(profile));
    if (pistol) pistols.set(entry.weapon.id, pistol);
    if (other) others.set(entry.weapon.id, other);
  }
  if (pistols.size === 0 || others.size === 0) return null;

  const counts = new Map(input.weapons.map((entry) => [entry.weapon.id, entry.count]));
  const groups = input.groups?.length
    ? input.groups
    : input.modelCount <= 1
      ? [{ count: 1, weapons: [...counts].map(([id, count]) => ({ id, count })) }]
      : null;
  const unitWide = groups === null;
  const chooseFrom = groups ?? [{ count: 1, weapons: [...counts].map(([id, count]) => ({ id, count })) }];

  const fired = new Map<Candidate, number>();
  let mixed = false;
  for (const group of chooseFrom) {
    const side = (pool: Map<string, Candidate>) => group.weapons.flatMap((weapon) => {
      const candidate = pool.get(weapon.id);
      return candidate && weapon.count > 0 ? [{ candidate, count: weapon.count }] : [];
    });
    const pistolSide = side(pistols);
    const otherSide = side(others);
    if (pistolSide.length > 0 && otherSide.length > 0) mixed = true;
    const damage = (fire: typeof pistolSide) => fire.reduce((sum, { candidate, count }) => sum + candidate.damagePerModel * count, 0);
    // Ties keep the other ranged weapons.
    const fire = damage(pistolSide) > damage(otherSide) ? pistolSide : otherSide;
    for (const { candidate, count } of fire) {
      fired.set(candidate, (fired.get(candidate) ?? 0) + count * group.count);
    }
  }
  if (!mixed) return null;
  const selected = [...fired].map(([candidate, count]) => withCount(candidate, count)).sort(byWeaponThenProfile);
  return {
    total: selected.reduce((sum, candidate) => sum + candidate.damage, 0),
    selected,
    pistolChoice: unitWide ? "unit-wide" : "per-model",
  };
}

/**
 * Scores a unit's resolved loadout using one shared engine context. Shooting uses
 * every ranged weapon, except that when `pistolsExclusive` holds (the unit is not
 * a Monster or Vehicle) each model fires either its Pistols or its other ranged
 * weapons, and only its Pistols when `inEngagementRange`; an engaged Monster or
 * Vehicle fires every ranged weapon at −1 to hit for non-Pistols. In a fight, every Extra Attacks weapon is used and each model chooses
 * at most one ordinary melee weapon, taking the best available choices across
 * the aggregate loadout counts.
 */
export function scoreLoadoutWeapons<C extends EngineContext>(input: {
  phase: "shooting" | "fight";
  modelCount: number;
  weapons: readonly LoadoutWeapon[];
  context: C;
  scoreProfile: ProfileScorer<C>;
  pistolsExclusive?: boolean;
  inEngagementRange?: boolean;
  groups?: readonly ModelLoadoutGroup[] | null;
}): LoadoutDamageResult {
  if (input.phase === "shooting" && input.inEngagementRange) {
    const selected = input.weapons
      .map((entry) => input.pistolsExclusive
        ? bestProfile(entry, "shooting", input.context, input.scoreProfile, isPistolProfile)
        : bestProfile(entry, "shooting", input.context, input.scoreProfile, () => true, bigGunsHitModifier))
      .filter((candidate): candidate is Candidate => candidate !== null)
      .sort(byWeaponThenProfile);
    return {
      total: selected.reduce((sum, candidate) => sum + candidate.damage, 0),
      selected,
      pistolChoice: "engaged",
    };
  }
  if (input.phase === "shooting" && input.pistolsExclusive) {
    const scored = scoreShootingWithPistols({
      modelCount: input.modelCount,
      weapons: input.weapons,
      groups: input.groups,
      context: input.context,
      scoreProfile: input.scoreProfile,
    });
    if (scored) return scored;
  }

  const candidates = input.weapons
    .map((entry) => bestProfile(entry, input.phase, input.context, input.scoreProfile))
    .filter((candidate): candidate is Candidate => candidate !== null);

  if (input.phase === "shooting") {
    return {
      total: candidates.reduce((sum, candidate) => sum + candidate.damage, 0),
      selected: candidates,
      pistolChoice: "none",
    };
  }

  const selected: SelectedWeaponProfile[] = candidates
    .filter((candidate) => candidate.extraAttacks)
    .map((candidate) => ({ ...candidate }));
  let slots = Math.max(0, Math.floor(input.modelCount));
  const ordinary = candidates
    .filter((candidate) => !candidate.extraAttacks)
    .sort(
      (a, b) =>
        b.damagePerModel - a.damagePerModel ||
        a.weaponId.localeCompare(b.weaponId) ||
        a.profileIndex - b.profileIndex,
    );
  for (const candidate of ordinary) {
    if (slots === 0) break;
    const count = Math.min(candidate.count, slots);
    if (count <= 0) continue;
    selected.push(withCount(candidate, count));
    slots -= count;
  }
  selected.sort(
    (a, b) =>
      Number(b.extraAttacks) - Number(a.extraAttacks) ||
      byWeaponThenProfile(a, b),
  );
  return {
    total: selected.reduce((sum, candidate) => sum + candidate.damage, 0),
    selected,
    pistolChoice: "none",
  };
}
