/**
 * Levers that come from outside the crunched unit's own ability list: Enhancements a model in the
 * unit could take, ability records another ability grants to the unit, and raises to the cap of a
 * lever pool. {@link Dataset.stackableBuffsFor} assembles them with the unit's own levers.
 */
import type { BuffSource, EngineContext } from "../cruncher/buffs.js";
import type { ActivatableBuff, EffectTranslation, UnsupportedFragment } from "../cruncher/from-dsl.js";
import type { Enhancement } from "../generated.js";
import type { Dataset, StackableBuff, StackableBuffGroup } from "./dataset.js";
import type { AbilityView, UnitView } from "./entities.js";

/** Lower-cased union of the units' keywords and faction keywords. */
export function combinedKeywordsLower(units: readonly UnitView[]): string[] {
  const out = new Set<string>();
  for (const unit of units) {
    for (const keyword of [...unit.keywords, ...unit.factionKeywords]) out.add(keyword.toLowerCase());
  }
  return [...out];
}

/**
 * Whether `bearer` can take `enhancement` under the Select Enhancements rules the roster validator
 * enforces: a CHARACTER (or an Upgrade), not an EPIC HERO, with a model that may take
 * Enhancements, carrying every keyword of one restriction group and none of the exclusions.
 */
export function canTakeEnhancement(ds: Dataset, enhancement: Enhancement, bearer: UnitView): boolean {
  const keywords = new Set(combinedKeywordsLower([bearer]));
  const has = (keyword: string) => keywords.has(keyword.toLowerCase());
  if (!has("character") && enhancement.upgrade_tag !== true) return false;
  if (bearer.raw.role === "epic-hero" || has("epic hero")) return false;
  const rows = ds.unitCompositionOf(bearer.raw)?.models ?? [];
  if (rows.length > 0 && rows.every((model) => model.excluded_from_enhancements === true)) return false;
  const eligible = enhancement.keyword_restriction_groups
    ? enhancement.keyword_restriction_groups.some((group) => group.every(has))
    : (enhancement.keyword_restrictions ?? []).every(has);
  return eligible && !(enhancement.exclusion_keywords ?? []).some(has);
}

/** What a cost-bearing provider charges when its lever is on. */
export type LeverCost = { cp?: number; points?: number };

/** Levers one ability contributes, with the pools they belong to and the cap raises to resolve. */
export type AbilityLevers = {
  buffs: StackableBuff[];
  groups: StackableBuffGroup[];
  capRaises: Map<StackableBuff, { ability: string; by: number }>;
};

/**
 * The levers one eligible ability gives the crunched unit.
 *
 * - Buffs it applies outright form one lever `idBase`, on by default when `enabled`.
 * - A cost-bearing provider (`gate`: a Stratagem, an Enhancement) is one opt-in lever `idBase`
 *   carrying the cost, even when it applies no buff itself; its choices and the records it grants
 *   name it in `requiresLever`, so the cost is paid once.
 * - Its choices are opt-in levers in their own pools; a lever raising another pool's cap is
 *   returned in `capRaises` for {@link resolveCapRaises}.
 * - Each ability record it grants to the unit (not already among `held`) is translated as the
 *   unit's own ability, with the provider's default state.
 */
export function abilityLevers(
  ds: Dataset,
  args: {
    ability: AbilityView;
    source: BuffSource;
    rating?: string | number;
    ctx: EngineContext;
    factionId: string;
    idBase: string;
    label: string;
    enabled: boolean;
    gate?: { cost: LeverCost; group?: string };
    /** Record ids the unit already holds or was already granted; extended with each new grant. */
    held: Set<string>;
  },
): AbilityLevers {
  const { ability, source, ctx, idBase, label, gate } = args;
  const out: AbilityLevers = { buffs: [], groups: [], capRaises: new Map() };
  const translation = ability.describeBuffs(source, ctx, "attacker", args.rating);
  const grants = grantedRecordIds(translation).filter(({ abilityId }) => !args.held.has(abilityId));
  const levers: StackableBuff[] = [];
  const requiresLever = gate ? idBase : undefined;

  for (const act of translation.activatable) {
    const lever: StackableBuff = { ...leverFromActivatable(act, `${ability.name} — ${act.label}`, source), ...(requiresLever ? { requiresLever } : {}) };
    if (act.group && !out.groups.some((group) => group.id === act.group!.id)) {
      out.groups.push({ id: act.group.id, label: ability.name, maxActivations: act.group.maxActivations });
    }
    if (act.capRaise) out.capRaises.set(lever, act.capRaise);
    levers.push(lever);
  }
  for (const { abilityId } of grants) {
    args.held.add(abilityId);
    const granted = grantedRecordLevers(ds, abilityId, args.factionId, { abilityId: ability.id, source, enabled: gate ? false : args.enabled, requiresLever }, ctx);
    if (!granted) continue;
    levers.push(...granted.buffs);
    out.groups.push(...granted.groups);
  }

  if (gate) {
    if (translation.applied.length > 0 || levers.length > 0) {
      out.buffs.push({ id: idBase, label, buffs: translation.applied, enabled: false, source, cost: gate.cost, ...(gate.group ? { group: gate.group } : {}) });
    }
  } else if (translation.applied.length > 0) {
    out.buffs.push({ id: idBase, label, buffs: translation.applied, enabled: args.enabled, source });
  }
  out.buffs.push(...levers);
  return out;
}

/**
 * One lever per (Enhancement, bearer) pair a detachment offers the combined unit, costing the
 * Enhancement's points, in a pool of one per bearer (a model takes at most one Enhancement). The
 * bearer's model-scoped effects stay on that model when it is not the crunched unit (core rule
 * 19.04), as for any attached member's ability.
 */
export function enhancementLevers(
  ds: Dataset,
  args: { detachmentId: string | undefined; crunchedUnitId: string; bearers: readonly UnitView[]; ctx: EngineContext; factionId: string; held: Set<string> },
): AbilityLevers {
  const out: AbilityLevers = { buffs: [], groups: [], capRaises: new Map() };
  if (!args.detachmentId) return out;
  const seen = new Set<string>();
  const offered = [...ds.enhancements].filter((enhancement) => {
    if (enhancement.detachment_id !== args.detachmentId || seen.has(enhancement.id)) return false;
    seen.add(enhancement.id);
    return true;
  });
  for (const bearer of args.bearers) {
    const group = `enhancement@${bearer.id}`;
    const before = out.buffs.length;
    for (const enhancement of offered) {
      if (!enhancement.ability_id || !canTakeEnhancement(ds, enhancement, bearer)) continue;
      const ability = ds.abilities.getInFaction(enhancement.ability_id, bearer.factionId) ?? ds.abilities.getAny(enhancement.ability_id);
      if (!ability) continue;
      const source: BuffSource = bearer.id === args.crunchedUnitId
        ? { kind: "ability", abilityId: ability.id, abilityKind: "unit" }
        : { kind: "ability", abilityId: ability.id, abilityKind: "attached", sourceUnitId: bearer.id };
      const levers = abilityLevers(ds, {
        ability, source, ctx: args.ctx, factionId: args.factionId,
        idBase: `enhancement:${enhancement.id}@${bearer.id}`, label: `${enhancement.name} (${bearer.name})`,
        enabled: false, gate: { cost: { points: enhancement.cost }, group }, held: new Set(args.held),
      });
      out.buffs.push(...levers.buffs);
      out.groups.push(...levers.groups);
      for (const [lever, raise] of levers.capRaises) out.capRaises.set(lever, raise);
    }
    if (out.buffs.length > before) out.groups.push({ id: group, label: `Enhancement on ${bearer.name}`, maxActivations: 1 });
  }
  return out;
}

/** A lever from a translator activatable; `group` keeps the activatable's pool id. */
export function leverFromActivatable(act: ActivatableBuff, label: string, source: BuffSource): StackableBuff {
  return {
    id: act.id,
    label,
    buffs: act.buffs,
    enabled: false,
    source,
    ...(act.group ? { group: act.group.id } : {}),
    ...(act.requires ? { requires: act.requires } : {}),
  };
}

/**
 * The ability records a translation grants to the crunched unit ("friendly BLOOD LEGIONS units gain
 * Blessings of Khorne"): each unsupported `ability-grant` naming a record that reaches the unit.
 * The translator has already dropped grants whose filter excludes the unit or that name the
 * providing unit itself, so a grant that reached `unsupported` with a self or friendly-filter target
 * reaches the crunched unit.
 */
export function grantedRecordIds(translation: EffectTranslation): { abilityId: string; fragment: UnsupportedFragment }[] {
  const out: { abilityId: string; fragment: UnsupportedFragment }[] = [];
  for (const item of translation.unsupported) {
    const node = item.effectFragment as Record<string, unknown> | null;
    if (!node || typeof node !== "object" || node.type !== "ability-grant") continue;
    const modifier = node.modifier as Record<string, unknown> | undefined;
    if (!modifier || typeof modifier.ability !== "string" || modifier.definition != null) continue;
    const target = node.target;
    const reaches = typeof target === "string"
      ? GRANT_RECIPIENTS.has(target)
      : target !== null && typeof target === "object" && (target as Record<string, unknown>).owner === "friendly";
    if (reaches && !out.some((grant) => grant.abilityId === modifier.ability)) out.push({ abilityId: modifier.ability, fragment: item });
  }
  return out;
}

/** Grant targets that name the crunched unit (or the aura recipient it is) once the translator let the grant through. */
const GRANT_RECIPIENTS = new Set(["this-unit", "ability-unit", "recipient", "selected-unit"]);

/**
 * Translate a granted record as the crunched unit's own ability and return its buffs as levers the
 * grant provides. The record's own choices keep their pools; buffs it applies outright form one
 * lever. Ids are prefixed with the granting ability so two grants of the same record stay
 * distinct. Undefined when the record does not resolve.
 */
export function grantedRecordLevers(
  ds: Dataset,
  grantedId: string,
  factionId: string,
  provider: { abilityId: string; source: BuffSource; enabled: boolean; requiresLever?: string },
  ctx: EngineContext,
): { buffs: StackableBuff[]; groups: StackableBuffGroup[] } | undefined {
  const record = ds.abilities.getInFaction(grantedId, factionId) ?? ds.abilities.getAny(grantedId);
  if (!record) return undefined;
  // The granted ability is held by the crunched unit: its "this unit" is the crunched unit.
  const held: BuffSource = { kind: "ability", abilityId: record.id, abilityKind: "unit" };
  const { applied, activatable } = record.describeBuffs(held, ctx, "attacker");
  const buffs: StackableBuff[] = [];
  const groups = new Map<string, StackableBuffGroup>();
  const prefix = `${provider.abilityId}>`;
  const dependency = provider.requiresLever ? { requiresLever: provider.requiresLever } : {};
  if (applied.length > 0) {
    buffs.push({ id: `${prefix}${record.id}`, label: record.name, buffs: applied, enabled: provider.enabled, source: provider.source, ...dependency });
  }
  for (const act of activatable) {
    const lever = leverFromActivatable(act, `${record.name} — ${act.label}`, provider.source);
    const group = act.group ? `${prefix}${act.group.id}` : undefined;
    if (act.group && group && !groups.has(group)) groups.set(group, { id: group, label: record.name, maxActivations: act.group.maxActivations });
    buffs.push({ ...lever, id: `${prefix}${act.id}`, ...(group ? { group } : {}), ...dependency });
  }
  return { buffs, groups: [...groups.values()] };
}

/**
 * Resolve each cap-raising lever to the pool it raises: the pool whose label (the owning ability's
 * name) matches the ability the DSL names, compared on letters and digits only
 * ("techno-sorcerous-augmentations" names "Technosorcerous Augmentations"). A lever whose pool the
 * unit does not have is dropped: there is nothing for it to raise.
 */
export function resolveCapRaises(
  levers: StackableBuff[],
  pending: Map<StackableBuff, { ability: string; by: number }>,
  groups: readonly StackableBuffGroup[],
): StackableBuff[] {
  const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return levers.flatMap((lever) => {
    const raise = pending.get(lever);
    if (!raise) return [lever];
    const group = groups.find((candidate) => squash(candidate.label) === squash(raise.ability));
    return group ? [{ ...lever, raisesCap: { group: group.id, by: raise.by } }] : [];
  });
}
