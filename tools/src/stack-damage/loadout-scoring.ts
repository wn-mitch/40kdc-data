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
  stages: readonly { name: string; expected: number }[];
}

export interface LoadoutDamageResult {
  total: number;
  selected: SelectedWeaponProfile[];
}

interface Candidate extends SelectedWeaponProfile {}

function bestProfile<C extends EngineContext>(
  entry: LoadoutWeapon,
  phase: "shooting" | "fight",
  context: C,
  score: ProfileScorer<C>,
): Candidate | null {
  if (entry.count <= 0) return null;
  const wantMelee = phase === "fight";
  let best: Candidate | null = null;
  for (let profileIndex = 0; profileIndex < entry.weapon.profiles.length; profileIndex++) {
    const profile = entry.weapon.profiles[profileIndex];
    if (isMeleeProfile(profile) !== wantMelee) continue;
    const scored = score({
      weapon: entry.weapon,
      profileIndex,
      modelsFiring: 1,
      context,
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

/**
 * Scores a unit's resolved loadout using one shared engine context. Shooting uses
 * every ranged weapon. In a fight, every Extra Attacks weapon is used and each
 * model chooses at most one ordinary melee weapon, taking the best available
 * choices across the aggregate loadout counts.
 */
export function scoreLoadoutWeapons<C extends EngineContext>(input: {
  phase: "shooting" | "fight";
  modelCount: number;
  weapons: readonly LoadoutWeapon[];
  context: C;
  scoreProfile: ProfileScorer<C>;
}): LoadoutDamageResult {
  const candidates = input.weapons
    .map((entry) => bestProfile(entry, input.phase, input.context, input.scoreProfile))
    .filter((candidate): candidate is Candidate => candidate !== null);

  if (input.phase === "shooting") {
    return {
      total: candidates.reduce((sum, candidate) => sum + candidate.damage, 0),
      selected: candidates,
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
    selected.push({
      ...candidate,
      count,
      damage: candidate.damagePerModel * count,
    });
    slots -= count;
  }
  selected.sort(
    (a, b) =>
      Number(b.extraAttacks) - Number(a.extraAttacks) ||
      a.weaponId.localeCompare(b.weaponId) ||
      a.profileIndex - b.profileIndex,
  );
  return {
    total: selected.reduce((sum, candidate) => sum + candidate.damage, 0),
    selected,
  };
}
