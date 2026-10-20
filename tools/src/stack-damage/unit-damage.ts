/**
 * Expected damage of one unit with a chosen loadout: which weapons and profiles its models
 * actually use (one ordinary melee weapon per model, Pistols or other ranged weapons per model)
 * and what each deals. The damage matrix and interactive tools share this so the same scenario
 * scores the same.
 */
import { crunch, profileCanTarget, type Buff, type EngineContext } from "../cruncher/index.js";
import type { Dataset } from "../data/dataset.js";
import { completeLoadout, type LoadoutGroup, type LoadoutModel } from "../data/loadout.js";
import type { Unit, WargearOption, Weapon } from "../generated.js";
import {
  scoreLoadoutWeapons,
  type LoadoutDamageResult,
  type ProfileScorer,
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

/** A profile scorer that crunches one model's attacks with `buffs`, skipping profiles that cannot target the unit. */
export function crunchProfileScorer(dataset: Dataset, target: { unit: Unit; modelCount: number }, buffs: readonly Buff[]): ProfileScorer {
  return ({ weapon, profileIndex, modelsFiring, context, hitModifier }) => {
    if (!profileCanTarget(weapon.profiles[profileIndex], target.unit)) return null;
    const profileBuffs: Buff[] = hitModifier
      ? [...buffs, { source: { kind: "manual", label: "Big Guns Never Tire" }, contribution: { type: "hit-mod", value: hitModifier } }]
      : [...buffs];
    const output = crunch({
      attacker: { weapon, profileIndex },
      target: { unit: target.unit, profileIndex: 0, modelCount: target.modelCount },
      modelsFiring,
      buffs: profileBuffs,
      context,
    }, dataset);
    return {
      damage: output.stages.find((stage) => stage.name === "after-fnp")?.expected ?? 0,
      stages: output.stages.map((stage) => ({ name: stage.name, expected: stage.expected })),
    };
  };
}

export function unitLoadoutDamage(input: UnitLoadoutDamageInput): LoadoutDamageResult & { groups: readonly LoadoutGroup[] | null } {
  const keywords = (input.unit.keywords ?? []).map((keyword) => keyword.toLowerCase());
  const groups = input.groups !== undefined
    ? input.groups
    : input.options && input.models
      ? completeLoadout(input.unit, input.modelCount, input.options, input.models, new Map(input.counts))?.groups ?? null
      : null;
  const scored = scoreLoadoutWeapons({
    phase: input.context.phase === "fight" ? "fight" : "shooting",
    modelCount: input.modelCount,
    pistolsExclusive: !keywords.includes("monster") && !keywords.includes("vehicle"),
    inEngagementRange: input.context.attackerStates?.includes("engaged") === true,
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
