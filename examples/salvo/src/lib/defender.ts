/**
 * The defending side's build choices — its detachment, the Stratagems it uses on the target and
 * the target's Enhancement — and the attacker's nearby support units. The defensive buffs are read
 * under target perspective with the same eligibility walk the attacker's levers use.
 */
import {
  baseWargear,
  canTakeEnhancement,
  equippedBuffs,
  reachesOtherUnits,
  type Buff,
  type BuffSource,
  type Dataset,
  type Detachment,
  type AbilityNeed,
  type EngineContext,
  type Enhancement,
  type Phase,
  type UnitView,
} from "@alpaca-software/40kdc-data";

export type DefenderBuild = {
  detachmentId: string | null;
  stratagemIds: readonly string[];
  enhancementId: string | null;
  /** The target's wargear by id, with how many models carry each; its out-of-the-box loadout's when null. */
  wargear?: Readonly<Record<string, number>> | null;
};

/** The wargear the target's out-of-the-box loadout carries, at its minimum model count. */
export function defaultTargetWargear(ds: Dataset, unit: UnitView): Record<string, number> {
  return baseWargear(ds, unit.raw, unit.raw.model_count?.min ?? 1);
}

/** Wargear records the target can carry: its out-of-the-box items and its options' replacements. */
export function targetWargearChoices(ds: Dataset, unit: UnitView): { id: string; name: string }[] {
  const ids = new Set(Object.keys(defaultTargetWargear(ds, unit)));
  for (const option of ds.wargearOptionsOf(unit.raw)) {
    for (const id of [...(option.replacement ?? []), ...(option.replacement_choice ?? []).flat()]) {
      if (ds.wargear.has(id)) ids.add(id);
    }
  }
  return [...ids].map((id) => ({ id, name: ds.wargear.get(id)?.name ?? id })).sort((a, b) => a.name.localeCompare(b.name));
}

export type StratagemChoice = { id: string; name: string; cpCost: number };

/** The faction's detachments, by name. */
export function defenderDetachments(ds: Dataset, factionId: string): Detachment[] {
  return ds.detachments.byFaction(factionId).slice().sort((a, b) => a.name.localeCompare(b.name));
}

/** Stratagems of the detachment the target unit can be chosen for in `phase`. */
export function defenderStratagems(ds: Dataset, unit: UnitView, detachmentId: string, phase: Phase): StratagemChoice[] {
  const out: StratagemChoice[] = [];
  for (const entry of ds.eligibleAbilities({ unitId: unit.id, factionId: unit.factionId, detachmentId }, phase)) {
    if (entry.source.kind !== "detachment-stratagem") continue;
    const stratagem = ds.stratagems.get(entry.source.stratagemId);
    out.push({ id: entry.source.stratagemId, name: stratagem?.name ?? entry.ability.name, cpCost: entry.source.cpCost });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Enhancements of the detachment the target unit can take. */
export function defenderEnhancements(ds: Dataset, unit: UnitView, detachmentId: string): Enhancement[] {
  const seen = new Set<string>();
  return [...ds.enhancements]
    .filter((enhancement) => {
      if (enhancement.detachment_id !== detachmentId || seen.has(enhancement.id)) return false;
      seen.add(enhancement.id);
      return canTakeEnhancement(ds, enhancement, unit);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The target's defensive buffs: its army, detachment and own abilities, the opted-in Stratagems
 * and its Enhancement, read with the target's wargear, as the damage matrix reads them. Its
 * printed rules for wargear it does not carry do not apply. A choice that no longer fits the unit
 * (another detachment, an ineligible bearer) contributes nothing.
 */
export function defenderBuffs(ds: Dataset, unit: UnitView, build: DefenderBuild, baseContext: EngineContext): Buff[] {
  const targetWargear = build.wargear ?? defaultTargetWargear(ds, unit);
  const context: EngineContext = { ...baseContext, targetWargear };
  return equippedBuffs(unit.raw, new Map(Object.entries(targetWargear)), buildBuffs(ds, unit, build, context));
}

/**
 * The defending unit's undecided leaf conditions, for the abilities {@link defenderBuffs} walks.
 * The build's Enhancement is read the same way, as a target-perspective ability.
 */
export function defenderNeeds(ds: Dataset, unit: UnitView, build: DefenderBuild, baseContext: EngineContext): AbilityNeed[] {
  const context: EngineContext = { ...baseContext, targetWargear: build.wargear ?? defaultTargetWargear(ds, unit) };
  const detachmentId = build.detachmentId && ds.detachments.getInFaction(build.detachmentId, unit.factionId)
    ? build.detachmentId
    : undefined;
  const needs = ds.defensiveNeedsFor(
    { unitId: unit.id, factionId: unit.factionId, detachmentId, optedInStratagemIds: [...build.stratagemIds] },
    context,
  );
  const enhancement = detachmentId && build.enhancementId
    ? defenderEnhancements(ds, unit, detachmentId).find((item) => item.id === build.enhancementId)
    : undefined;
  const ability = enhancement?.ability_id
    ? ds.abilities.getInFaction(enhancement.ability_id, unit.factionId) ?? ds.abilities.getAny(enhancement.ability_id)
    : undefined;
  if (!ability) return needs;
  const keywords = [...unit.keywords, ...unit.factionKeywords].map((keyword) => keyword.toLowerCase());
  const targetContext: EngineContext = { ...context, targetUnitId: context.targetUnitId ?? unit.id, targetKeywords: context.targetKeywords ?? keywords };
  const { unsupported } = ability.describeBuffs({ kind: "ability", abilityId: ability.id, abilityKind: "unit" }, targetContext, "target");
  return [...needs, ...unsupported.flatMap((item) => (item.needs ?? []).map((need) => ({ ...need, abilityId: ability.id, label: ability.name })))];
}

function buildBuffs(ds: Dataset, unit: UnitView, build: DefenderBuild, context: EngineContext): Buff[] {
  // Another faction's detachment rule never reaches the unit.
  const detachmentId = build.detachmentId && ds.detachments.getInFaction(build.detachmentId, unit.factionId)
    ? build.detachmentId
    : undefined;
  const buffs = ds.defensiveBuffsFor(
    { unitId: unit.id, factionId: unit.factionId, detachmentId, optedInStratagemIds: [...build.stratagemIds] },
    context,
  );
  if (!detachmentId || !build.enhancementId) return buffs;
  const enhancement = defenderEnhancements(ds, unit, detachmentId).find((item) => item.id === build.enhancementId);
  if (!enhancement?.ability_id) return buffs;
  const ability = ds.abilities.getInFaction(enhancement.ability_id, unit.factionId) ?? ds.abilities.getAny(enhancement.ability_id);
  if (!ability) return buffs;
  const source: BuffSource = { kind: "ability", abilityId: ability.id, abilityKind: "unit" };
  const keywords = [...unit.keywords, ...unit.factionKeywords].map((keyword) => keyword.toLowerCase());
  const targetContext: EngineContext = { ...context, targetUnitId: context.targetUnitId ?? unit.id, targetKeywords: context.targetKeywords ?? keywords };
  return [...buffs, ...ability.getBuffs(source, targetContext, "target")];
}

/**
 * Units of the faction with an ability that can reach another unit, so they can support the
 * combined unit from nearby; the combined unit's own members are excluded.
 */
export function supportProviders(ds: Dataset, factionId: string, memberIds: readonly string[]): UnitView[] {
  const members = new Set(memberIds);
  const seen = new Set<string>();
  return ds.units.byFaction(factionId)
    .filter((unit) => {
      if (members.has(unit.id) || seen.has(unit.id)) return false;
      seen.add(unit.id);
      return unit.abilities.some((ability) => reachesOtherUnits(ability.raw.effect));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The chosen support units that are still providers for the combined unit. */
export function activeSupport(ds: Dataset, factionId: string | null, memberIds: readonly string[], chosen: readonly string[]): string[] {
  if (!factionId || chosen.length === 0) return [];
  const providers = new Set(supportProviders(ds, factionId, memberIds).map((unit) => unit.id));
  return chosen.filter((id) => providers.has(id));
}
