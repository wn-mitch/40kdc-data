/**
 * The defending side's build choices — its detachment, the Stratagems it uses on the target and
 * the target's Enhancement — and the attacker's nearby support units. The defensive buffs are read
 * under target perspective with the same eligibility walk the attacker's levers use.
 */
import {
  canTakeEnhancement,
  reachesOtherUnits,
  type Buff,
  type BuffSource,
  type Dataset,
  type Detachment,
  type EngineContext,
  type Enhancement,
  type Phase,
  type UnitView,
} from "@alpaca-software/40kdc-data";

export type DefenderBuild = {
  detachmentId: string | null;
  stratagemIds: readonly string[];
  enhancementId: string | null;
};

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
 * and its Enhancement. A choice that no longer fits the unit (another detachment, an ineligible
 * bearer) contributes nothing.
 */
export function defenderBuffs(ds: Dataset, unit: UnitView, build: DefenderBuild, context: EngineContext): Buff[] {
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
