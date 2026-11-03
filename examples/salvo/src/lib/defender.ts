/**
 * The defending side's build choices — its detachment, the Stratagems it uses on the target, the
 * target's Enhancement and which of its optional abilities it uses — and the attacker's nearby
 * support units. The defensive buffs are read under target perspective with the same eligibility
 * walk the attacker's levers use.
 */
import {
  baseWargear,
  canTakeEnhancement,
  equippedBuffs,
  isLegalLeverSelection,
  reachesOtherUnits,
  type Buff,
  type BuffSource,
  type Dataset,
  type Detachment,
  type AbilityNeed,
  type EngineContext,
  type Enhancement,
  type Phase,
  type StackableBuff,
  type StackableBuffGroup,
  type UnitView,
} from "@alpaca-software/40kdc-data";

export type DefenderBuild = {
  detachmentId: string | null;
  stratagemIds: readonly string[];
  enhancementId: string | null;
  /** The target's wargear by id, with how many models carry each; its out-of-the-box loadout's when null. */
  wargear?: Readonly<Record<string, number>> | null;
  /** Ids of the {@link defenderLevers} the defender turns on; an id no longer offered is ignored. */
  leverIds?: readonly string[];
};

/** The defender's optional abilities as toggleable levers, with the pools that cap them. */
export type DefenderLevers = { buffs: StackableBuff[]; groups: StackableBuffGroup[] };

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
 * The target's defensive buffs: its army, detachment and own abilities, the opted-in Stratagems,
 * its Enhancement and the optional abilities the build turns on, read with the target's wargear,
 * as the damage matrix reads them. Its printed rules for wargear it does not carry do not apply. A
 * choice that no longer fits the unit (another detachment, an ineligible bearer, a lever no longer
 * offered) contributes nothing. Throws when the turned-on levers exceed a pool's allowance.
 */
export function defenderBuffs(ds: Dataset, unit: UnitView, build: DefenderBuild, baseContext: EngineContext): Buff[] {
  const targetWargear = build.wargear ?? defaultTargetWargear(ds, unit);
  const context: EngineContext = { ...baseContext, targetWargear };
  const always = equippedBuffs(unit.raw, new Map(Object.entries(targetWargear)), buildBuffs(ds, unit, build, context));
  const chosen = new Set(build.leverIds ?? []);
  if (chosen.size === 0) return always;
  const levers = defenderLevers(ds, unit, build, baseContext);
  const on = new Set(levers.buffs.filter((lever) => chosen.has(lever.id)).map((lever) => lever.id));
  if (!isLegalLeverSelection(levers.buffs, levers.groups, on)) {
    throw new Error("the defender's selected abilities exceed an allowance");
  }
  return [...always, ...levers.buffs.filter((lever) => on.has(lever.id)).flatMap((lever) => lever.buffs)];
}

/**
 * The target's optional abilities as opt-in levers: the activatable levers of the abilities
 * {@link defenderBuffs} walks (an optional ability, a usage-limited activation, a choice) and of
 * its Enhancement, read with the target's wargear. A lever behind an undecided condition appears
 * once that condition is answered true in the context's `conditionFacts`; a lever whose every
 * buff comes from wargear the target does not carry is left out.
 */
export function defenderLevers(ds: Dataset, unit: UnitView, build: DefenderBuild, baseContext: EngineContext): DefenderLevers {
  const targetWargear = build.wargear ?? defaultTargetWargear(ds, unit);
  const context: EngineContext = { ...baseContext, targetWargear };
  const detachmentId = defenderDetachmentId(ds, unit, build);
  const { buffs, groups } = ds.defensiveLeversFor(
    { unitId: unit.id, factionId: unit.factionId, detachmentId, optedInStratagemIds: [...build.stratagemIds] },
    context,
  );
  const levers = [...buffs];
  const pools = [...groups];
  const enhancement = enhancementAbility(ds, unit, detachmentId, build.enhancementId);
  if (enhancement) {
    const source: BuffSource = { kind: "ability", abilityId: enhancement.id, abilityKind: "unit" };
    for (const act of enhancement.describeBuffs(source, enhancementContext(unit, context), "target").activatable) {
      if (act.capRaise || act.requiresOption || act.excludesOption || levers.some((lever) => lever.id === act.id)) continue;
      levers.push({
        id: act.id,
        label: `${enhancement.name} — ${act.label}`,
        buffs: act.buffs,
        enabled: false,
        source,
        ...(act.group ? { group: act.group.id } : {}),
        ...(act.groups?.length ? { groups: act.groups.map((group) => group.id) } : {}),
        ...(act.requires ? { requires: act.requires } : {}),
      });
      for (const group of [...(act.group ? [act.group] : []), ...(act.groups ?? [])]) {
        if (!pools.some((pool) => pool.id === group.id)) {
          pools.push({ id: group.id, abilityId: enhancement.id, label: enhancement.name, maxActivations: group.maxActivations });
        }
      }
    }
  }
  const carried = new Map(Object.entries(targetWargear));
  const equipped = levers
    .map((lever) => ({ ...lever, buffs: equippedBuffs(unit.raw, carried, lever.buffs) }))
    .filter((lever, index) => lever.buffs.length > 0 || levers[index].buffs.length === 0);
  return { buffs: equipped, groups: pools.filter((pool) => equipped.some((lever) => lever.group === pool.id || lever.groups?.includes(pool.id))) };
}

/**
 * The defending unit's undecided leaf conditions, for the abilities {@link defenderBuffs} walks.
 * The build's Enhancement is read the same way, as a target-perspective ability.
 */
export function defenderNeeds(ds: Dataset, unit: UnitView, build: DefenderBuild, baseContext: EngineContext): AbilityNeed[] {
  const context: EngineContext = { ...baseContext, targetWargear: build.wargear ?? defaultTargetWargear(ds, unit) };
  const detachmentId = defenderDetachmentId(ds, unit, build);
  const needs = ds.defensiveNeedsFor(
    { unitId: unit.id, factionId: unit.factionId, detachmentId, optedInStratagemIds: [...build.stratagemIds] },
    context,
  );
  const ability = enhancementAbility(ds, unit, detachmentId, build.enhancementId);
  if (!ability) return needs;
  const { unsupported } = ability.describeBuffs({ kind: "ability", abilityId: ability.id, abilityKind: "unit" }, enhancementContext(unit, context), "target");
  return [...needs, ...unsupported.flatMap((item) => (item.needs ?? []).map((need) => ({ ...need, abilityId: ability.id, label: ability.name })))];
}

function buildBuffs(ds: Dataset, unit: UnitView, build: DefenderBuild, context: EngineContext): Buff[] {
  const detachmentId = defenderDetachmentId(ds, unit, build);
  const buffs = ds.defensiveBuffsFor(
    { unitId: unit.id, factionId: unit.factionId, detachmentId, optedInStratagemIds: [...build.stratagemIds] },
    context,
  );
  const ability = enhancementAbility(ds, unit, detachmentId, build.enhancementId);
  if (!ability) return buffs;
  const source: BuffSource = { kind: "ability", abilityId: ability.id, abilityKind: "unit" };
  return [...buffs, ...ability.getBuffs(source, enhancementContext(unit, context), "target")];
}

/** The build's detachment, when it is one of the unit's faction: another faction's rules never reach the unit. */
function defenderDetachmentId(ds: Dataset, unit: UnitView, build: DefenderBuild): string | undefined {
  return build.detachmentId && ds.detachments.getInFaction(build.detachmentId, unit.factionId) ? build.detachmentId : undefined;
}

/** The ability of the build's Enhancement, when the detachment offers it and the unit can take it. */
function enhancementAbility(ds: Dataset, unit: UnitView, detachmentId: string | undefined, enhancementId: string | null) {
  if (!detachmentId || !enhancementId) return undefined;
  const enhancement = defenderEnhancements(ds, unit, detachmentId).find((item) => item.id === enhancementId);
  if (!enhancement?.ability_id) return undefined;
  return ds.abilities.getInFaction(enhancement.ability_id, unit.factionId) ?? ds.abilities.getAny(enhancement.ability_id);
}

/** The context an Enhancement on the target is read under: the target's id and keywords. */
function enhancementContext(unit: UnitView, context: EngineContext): EngineContext {
  const keywords = [...unit.keywords, ...unit.factionKeywords].map((keyword) => keyword.toLowerCase());
  return { ...context, targetUnitId: context.targetUnitId ?? unit.id, targetKeywords: context.targetKeywords ?? keywords };
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
