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
import { completeLoadout, type LoadoutGroup, type LoadoutModel } from "../data/loadout.js";
import type { Unit, WargearOption, Weapon } from "../generated.js";
import {
  bigGunsHitModifier,
  scoreLoadoutWeapons,
  type LoadoutDamageResult,
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

/** A profile scorer that crunches one model's attacks with `buffs`, skipping profiles that cannot target the unit. */
export function crunchProfileScorer(dataset: Dataset, target: { unit: Unit; modelCount: number }, buffs: readonly Buff[]): ProfileScorer {
  return ({ weapon, profileIndex, modelsFiring, context, hitModifier }) => {
    if (!profileCanTarget(weapon.profiles[profileIndex], target.unit)) return null;
    const output = crunch(profileEngineInput({ weapon, profileIndex, target, modelsFiring, buffs, context, hitModifier }), dataset);
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

export function unitLoadoutDamage(input: UnitLoadoutDamageInput): LoadoutDamageResult & { groups: readonly LoadoutGroup[] | null } {
  const groups = input.groups !== undefined
    ? input.groups
    : input.options && input.models
      ? completeLoadout(input.unit, input.modelCount, input.options, input.models, new Map(input.counts))?.groups ?? null
      : null;
  const scored = scoreLoadoutWeapons({
    phase: input.context.phase === "fight" ? "fight" : "shooting",
    modelCount: input.modelCount,
    pistolsExclusive: !isMonsterOrVehicle(input.unit),
    inEngagementRange: isEngaged(input.context),
    groups,
    weapons: [...input.counts].flatMap(([weaponId, count]) => {
      const weapon = resolveUnitWeapon(input.dataset, input.unit, weaponId);
      return weapon ? [{ weapon, count }] : [];
    }),
    context: input.context,
    scoreProfile: input.scoreProfile ?? crunchProfileScorer(input.dataset, input.target, input.buffs),
  });
  return { ...scored, groups };
}
