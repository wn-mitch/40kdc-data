/**
 * Expected damage of one unit with a chosen loadout: which weapons and profiles its models
 * actually use (one ordinary melee weapon per model, Pistols or other ranged weapons per model)
 * and what each deals. The damage matrix and interactive tools share this so the same scenario
 * scores the same.
 */
import {
  attributeStages,
  crunch,
  profileCanTarget,
  type Buff,
  type EngineContext,
  type EngineInput,
  type StageLift,
} from "../cruncher/index.js";
import type { Dataset } from "../data/dataset.js";
import { isMeleeProfile } from "../data/weapon-profile.js";
import { completeLoadout, type LoadoutGroup, type LoadoutModel } from "../data/loadout.js";
import type { Unit, WargearOption, Weapon } from "../generated.js";
import { groupsWithGrantedWeapons, withGrantedWeapons, type WeaponGrant } from "./weapon-grants.js";
import {
  bigGunsHitModifier,
  scoreLoadoutWeapons,
  type LoadoutDamageResult,
  type ProfileDamage,
  type ProfileScorer,
  type SelectedWeaponProfile,
} from "./loadout-scoring.js";

export interface UnitLoadoutDamageInput {
  dataset: Dataset;
  unit: Unit;
  modelCount: number;
  /** Equipment counts across the unit's models, by weapon id. */
  counts: ReadonlyMap<string, number>;
  /** The target, at the model count it is attacked at. */
  target: { unit: Unit; modelCount: number };
  /** Buffs every profile shares; each profile's own weapon keywords are added by the engine. */
  buffs: readonly Buff[];
  /** Its `phase` picks ranged or melee weapons; `attackerStates` including `engaged` applies the Pistol rule's engaged case. */
  context: EngineContext;
  /**
   * Which models carry what, for the per-model Pistol choice. Taken from `completeLoadout` when
   * omitted and the wargear data allows; `null` makes the whole unit choose together.
   */
  groups?: readonly LoadoutGroup[] | null;
  /** Wargear data for completing `groups`. */
  options?: readonly WargearOption[];
  models?: readonly LoadoutModel[];
  /** Scores one profile; defaults to a crunch with `buffs`. */
  scoreProfile?: ProfileScorer;
  /** Weapons the loadout's wargear equips its carriers with; see {@link unitWeaponGrants}. */
  grants?: readonly WeaponGrant[];
}

/** The unit's own copy of a weapon, falling back to any faction's. */
export function resolveUnitWeapon(dataset: Dataset, unit: Unit, weaponId: string): Weapon | undefined {
  return dataset.weapons.getInFaction(weaponId, unit.faction_id)?.raw ?? dataset.weapons.getAny(weaponId)?.raw;
}

/**
 * The engine input for `modelsFiring` models attacking with one profile, with the Hit roll
 * modifier the loadout rules impose (Big Guns Never Tire) added as a buff.
 */
export function profileEngineInput(args: {
  weapon: Weapon;
  profileIndex: number;
  target: { unit: Unit; modelCount: number };
  modelsFiring: number;
  buffs: readonly Buff[];
  context: EngineContext;
  hitModifier?: number;
}): EngineInput {
  const buffs: Buff[] = args.hitModifier
    ? [...args.buffs, { source: { kind: "manual", label: "Big Guns Never Tire" }, contribution: { type: "hit-mod", value: args.hitModifier } }]
    : [...args.buffs];
  return {
    attacker: { weapon: args.weapon, profileIndex: args.profileIndex },
    target: { unit: args.target.unit, profileIndex: 0, modelCount: args.target.modelCount },
    modelsFiring: args.modelsFiring,
    buffs,
    context: args.context,
  };
}

const isMonsterOrVehicle = (unit: Unit) =>
  (unit.keywords ?? []).some((keyword) => ["monster", "vehicle"].includes(keyword.toLowerCase()));
const isEngaged = (context: EngineContext) => context.attackerStates?.includes("engaged") === true;

/** The Hit roll modifier the loadout rules give one of the unit's profiles in `context`; 0 when none applies. */
export function loadoutHitModifier(unit: Unit, profile: Weapon["profiles"][number], context: EngineContext): number {
  return context.phase !== "fight" && isEngaged(context) && isMonsterOrVehicle(unit) ? bigGunsHitModifier(profile) : 0;
}

/** A profile the engine cannot score, with why. */
export interface UnscoreableProfile {
  weapon: Weapon;
  profileIndex: number;
  reason: string;
}

/** Why a profile's hits cannot be rolled: it prints no hit skill (BS or WS) and no Torrent. */
export function missingHitSkill(profile: Weapon["profiles"][number]): string | undefined {
  const stat = isMeleeProfile(profile) ? "WS" : "BS";
  if (typeof (profile.stats as Record<string, unknown>)[stat] === "number") return undefined;
  if ((profile.keywords ?? []).some((keyword) => keyword.keyword_id === "torrent")) return undefined;
  return `profile "${profile.name}" prints no ${stat} and no Torrent, so its hits cannot be rolled`;
}

/**
 * A profile scorer that crunches one model's attacks with `buffs`, skipping profiles that cannot
 * target the unit. With `onUnscoreable`, a profile whose hits cannot be rolled ({@link missingHitSkill})
 * is reported and skipped instead of failing the crunch; a buff that grants it Torrent still scores it.
 */
export function crunchProfileScorer(
  dataset: Dataset,
  target: { unit: Unit; modelCount: number },
  buffs: readonly Buff[],
  onUnscoreable?: (profile: UnscoreableProfile) => void,
): ProfileScorer {
  return ({ weapon, profileIndex, modelsFiring, context, hitModifier }) => {
    if (!profileCanTarget(weapon.profiles[profileIndex], target.unit)) return null;
    const input = profileEngineInput({ weapon, profileIndex, target, modelsFiring, buffs, context, hitModifier });
    const missing = onUnscoreable ? missingHitSkill(weapon.profiles[profileIndex]) : undefined;
    let output: ReturnType<typeof crunch>;
    try {
      output = crunch(input, dataset);
    } catch (error) {
      if (missing === undefined) throw error;
      onUnscoreable!({ weapon, profileIndex, reason: missing });
      return null;
    }
    return {
      damage: output.stages.find((stage) => stage.name === "after-fnp")?.expected ?? 0,
      stages: output.stages.map((stage) => ({ name: stage.name, expected: stage.expected })),
    };
  };
}

/** How much each toggleable buff group lifts a selected profile's damage after Feel No Pain. */
export interface DamageAttribution {
  /** Damage with every buff group removed; weapon keywords stay. */
  baseline: number;
  lifts: StageLift[];
  /** Damage the lifts do not account for, where buffs overlap under a cap. */
  residual: number;
}

/** Leave-one-out attribution of a selected profile's damage, across all the models that use it. */
export function attributeSelectedProfile(args: {
  dataset: Dataset;
  unit: Unit;
  selected: Pick<SelectedWeaponProfile, "weaponId" | "profileIndex" | "count" | "hitModifier">;
  target: { unit: Unit; modelCount: number };
  buffs: readonly Buff[];
  context: EngineContext;
}): DamageAttribution | null {
  const weapon = resolveUnitWeapon(args.dataset, args.unit, args.selected.weaponId);
  if (!weapon) return null;
  const stages = attributeStages(profileEngineInput({
    weapon,
    profileIndex: args.selected.profileIndex,
    target: args.target,
    modelsFiring: args.selected.count,
    buffs: args.buffs,
    context: args.context,
    hitModifier: args.selected.hitModifier,
  }), args.dataset);
  const damage = stages.find((stage) => stage.name === "after-fnp");
  return damage ? { baseline: damage.baseline, lifts: damage.lifts, residual: damage.residual } : null;
}

/**
 * "Re-roll one Hit roll" is one die for the whole unit's attacks, but the engine prices it over one
 * profile's pool. The loadout is scored without it, and its gain is added once, to the selected
 * profile it adds the most to; several such permissions (one Hit and one Wound roll) go to that
 * same profile, which can understate a unit that would spend them on different weapons.
 */
export function unitLoadoutDamage(input: UnitLoadoutDamageInput): LoadoutDamageResult & { groups: readonly LoadoutGroup[] | null } {
  if (!input.buffs.some((buff) => buff.contribution.type === "reroll-one")) return scoredLoadout(input);
  const without = input.buffs.filter((buff) => buff.contribution.type !== "reroll-one");
  const scored = scoredLoadout({ ...input, buffs: without, scoreProfile: crunchProfileScorer(input.dataset, input.target, without) });
  const withOne = crunchProfileScorer(input.dataset, input.target, input.buffs);
  let best: { at: number; gain: number; damage: ProfileDamage } | null = null;
  scored.selected.forEach((selected, at) => {
    const weapon = resolveUnitWeapon(input.dataset, input.unit, selected.weaponId);
    if (!weapon) return;
    const damage = withOne({ weapon, profileIndex: selected.profileIndex, modelsFiring: selected.count, context: input.context, ...(selected.hitModifier !== undefined ? { hitModifier: selected.hitModifier } : {}) });
    if (damage && damage.damage - selected.damage > (best?.gain ?? 0)) best = { at, gain: damage.damage - selected.damage, damage };
  });
  if (best === null) return scored;
  const { at, gain, damage } = best as { at: number; gain: number; damage: ProfileDamage };
  const selected = scored.selected.map((item, index) => index === at
    ? { ...item, damage: damage.damage, damagePerModel: damage.damage / Math.max(1, item.count), stages: damage.stages ?? item.stages }
    : item);
  return { ...scored, selected, total: scored.total + gain };
}

function scoredLoadout(input: UnitLoadoutDamageInput): LoadoutDamageResult & { groups: readonly LoadoutGroup[] | null } {
  const groups = input.groups !== undefined
    ? input.groups
    : input.options && input.models
      ? completeLoadout(input.unit, input.modelCount, input.options, input.models, new Map(input.counts))?.groups ?? null
      : null;
  const grants = input.grants ?? [];
  const counts = withGrantedWeapons(input.counts, grants);
  const scored = scoreLoadoutWeapons({
    phase: input.context.phase === "fight" ? "fight" : "shooting",
    modelCount: input.modelCount,
    pistolsExclusive: !isMonsterOrVehicle(input.unit),
    inEngagementRange: isEngaged(input.context),
    groups: groups && grants.length > 0 ? groupsWithGrantedWeapons(groups, grants) : groups,
    weapons: [...counts].flatMap(([weaponId, count]) => {
      const weapon = resolveUnitWeapon(input.dataset, input.unit, weaponId);
      return weapon ? [{ weapon, count }] : [];
    }),
    context: input.context,
    scoreProfile: input.scoreProfile ?? crunchProfileScorer(input.dataset, input.target, input.buffs),
  });
  return { ...scored, groups };
}
