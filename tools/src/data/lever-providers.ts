/**
 * Levers that come from outside the crunched unit's own ability list: Enhancements a model in the
 * unit could take, ability records another ability grants to the unit, and raises to the cap of a
 * lever pool. {@link Dataset.stackableBuffsFor} assembles them with the unit's own levers.
 */
import type { BuffSource, EngineContext } from "../cruncher/buffs.js";
import type { ActivatableBuff, EffectTranslation, StanceOptionRef, UnsupportedFragment } from "../cruncher/from-dsl.js";
import type { ConditionNeed } from "../cruncher/condition-facts.js";
import type { Enhancement } from "../generated.js";
import type { Dataset, StackableBuff, StackableBuffGroup } from "./dataset.js";
import { meetsEnhancementGroups } from "./enhancement-eligibility.js";
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
 * Lower-cased keywords and faction keywords every one of the units carries. The data lists keywords
 * per datasheet, so these are the keywords every model of the combined unit carries.
 */
export function sharedKeywordsLower(units: readonly UnitView[]): string[] {
  const [first, ...rest] = units.map((unit) => new Set(combinedKeywordsLower([unit])));
  if (!first) return [];
  return [...first].filter((keyword) => rest.every((keywords) => keywords.has(keyword)));
}

/**
 * The Toughness of a (combined) unit: its Bodyguard's when Leaders or Support units are attached,
 * as for an attack against it, taking the highest model's. `roles` (unit id → role) wins over the
 * datasheet's own `attachment_role`. Undefined when no unit prints a Toughness.
 */
export function combinedToughness(units: readonly UnitView[], roles?: Readonly<Record<string, string>>): number | undefined {
  const role = (unit: UnitView) => roles?.[unit.id] ?? unit.raw.attachment_role;
  const bodyguard = units.filter((unit) => role(unit) !== "leader" && role(unit) !== "support");
  const toughness = (bodyguard.length > 0 ? bodyguard : units)
    .flatMap((unit) => (unit.raw.profiles ?? []).map((profile) => profile.T))
    .filter((t): t is number => typeof t === "number");
  return toughness.length > 0 ? Math.max(...toughness) : undefined;
}

/**
 * Whether `bearer` can take `enhancement` under the Select Enhancements rules the roster validator
 * enforces: a CHARACTER (or an Upgrade), not an EPIC HERO, with a model that may take
 * Enhancements, meeting one eligibility group (its keywords, or its datasheet and keywords) and
 * carrying none of the exclusions.
 */
export function canTakeEnhancement(ds: Dataset, enhancement: Enhancement, bearer: UnitView): boolean {
  const keywords = new Set(combinedKeywordsLower([bearer]));
  const has = (keyword: string) => keywords.has(keyword.toLowerCase());
  if (!has("character") && enhancement.upgrade_tag !== true) return false;
  if (bearer.raw.role === "epic-hero" || has("epic hero")) return false;
  const rows = ds.unitCompositionOf(bearer.raw)?.models ?? [];
  if (rows.length > 0 && rows.every((model) => model.excluded_from_enhancements === true)) return false;
  const eligible = meetsEnhancementGroups(enhancement, bearer.id, has);
  return eligible && !(enhancement.exclusion_keywords ?? []).some(has);
}

/** What a cost-bearing provider charges when its lever is on. */
export type LeverCost = { cp?: number; points?: number };

/** Canonical capacity allocation, including immutable option references. */
export type CapacityRaise = NonNullable<ActivatableBuff["capRaise"]>;

/** Levers one ability contributes, with the pools they belong to and the cap raises to resolve. */
export type AbilityLevers = {
  buffs: StackableBuff[];
  groups: StackableBuffGroup[];
  capRaises: Map<StackableBuff, CapacityRaise>;
  /** Levers gated on a stance option, for {@link resolveOptionRequirements}. */
  optionRequirements: Map<StackableBuff, OptionGate>;
  /** Leaf conditions the context leaves undecided, with the ability that raised each. */
  needs: AbilityNeed[];
};

/** A {@link ConditionNeed} with the ability whose condition raised it. */
export type AbilityNeed = ConditionNeed & { abilityId: string; label: string };

/** Each need an ability's translation reports, tagged with that ability. */
export function abilityNeeds(unsupported: readonly UnsupportedFragment[], abilityId: string, label: string): AbilityNeed[] {
  return unsupported.flatMap((item) => (item.needs ?? []).map((need) => ({ ...need, abilityId, label })));
}

/** The stance option a lever applies under, or does not apply under. */
export type OptionGate = Pick<ActivatableBuff, "requiresOption" | "excludesOption">;

/** `act`'s stance option gate, if it has one. */
function optionGate(act: ActivatableBuff): OptionGate | undefined {
  if (act.requiresOption) return { requiresOption: act.requiresOption };
  if (act.excludesOption) return { excludesOption: act.excludesOption };
  return undefined;
}

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
  const out: AbilityLevers = { buffs: [], groups: [], capRaises: new Map(), optionRequirements: new Map(), needs: [] };
  const translation = ability.describeBuffs(source, ctx, "attacker", args.rating);
  out.needs.push(...abilityNeeds(translation.unsupported, ability.id, label));
  const grants = grantedRecordIds(translation).filter(({ abilityId }) => !args.held.has(abilityId));
  const levers: StackableBuff[] = [];
  const requiresLever = gate ? idBase : undefined;

  for (const act of translation.activatable) {
    const lever: StackableBuff = { ...leverFromActivatable(act, `${ability.name} — ${act.label}`, source), ...(requiresLever ? { requiresLever } : {}) };
    for (const group of [...(act.group ? [act.group] : []), ...(act.groups ?? [])]) {
      if (!out.groups.some((existing) => existing.id === group.id)) {
        out.groups.push({ ...group, label: ability.name, abilityId: ability.id });
      }
    }
    if (act.capRaise) out.capRaises.set(lever, act.capRaise);
    const gated = optionGate(act);
    if (gated) out.optionRequirements.set(lever, gated);
    levers.push(lever);
  }
  for (const { abilityId } of grants) {
    args.held.add(abilityId);
    const granted = grantedRecordLevers(ds, abilityId, args.factionId, { abilityId: ability.id, source, enabled: gate ? false : args.enabled, requiresLever }, ctx);
    if (!granted) continue;
    levers.push(...granted.buffs);
    out.groups.push(...granted.groups);
    for (const [lever, raise] of granted.capRaises) out.capRaises.set(lever, raise);
    for (const [lever, option] of granted.optionRequirements) out.optionRequirements.set(lever, option);
    out.needs.push(...granted.needs);
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
  args: { detachmentId: string | undefined; crunchedUnitId: string | undefined; bearers: readonly UnitView[]; ctx: EngineContext; factionId: string; held: Set<string> },
): AbilityLevers {
  const out: AbilityLevers = { buffs: [], groups: [], capRaises: new Map(), optionRequirements: new Map(), needs: [] };
  if (!args.detachmentId) return out;
  const seen = new Set<string>();
  // Every game mode: the detachment is already chosen (possibly a Combat Patrol
  // one, by id), so its enhancements are a lookup, not a listing.
  const offered = [...ds.forGameMode("all").enhancements].filter((enhancement) => {
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
      if (!ability || args.held.has(ability.id)) continue;
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
      for (const [lever, option] of levers.optionRequirements) out.optionRequirements.set(lever, option);
      out.needs.push(...levers.needs);
    }
    if (out.buffs.length > before) out.groups.push({ id: group, label: `Enhancement on ${bearer.name}`, maxActivations: 1 });
  }
  return out;
}

/** Preserve the primary pool and every intersecting parent activation pool. */
export function leverFromActivatable(act: ActivatableBuff, label: string, source: BuffSource): StackableBuff {
  return {
    id: act.id,
    label,
    buffs: act.buffs,
    enabled: false,
    source,
    ...(act.group ? { group: act.group.id } : {}),
    ...(act.groups?.length ? { groups: act.groups.map((group) => group.id) } : {}),
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
    // Only a fully admitted record grant may be expanded. Unknown target predicates
    // and model isolation diagnostics must remain unsupported, not become buffs.
    if (item.reason !== 'effect type "ability-grant" is not modelled by the buff layer') continue;
    const node = item.effectFragment as Record<string, unknown> | null;
    if (!node || typeof node !== "object" || node.type !== "ability-grant") continue;
    const modifier = node.modifier as Record<string, unknown> | undefined;
    if (!modifier || typeof modifier.ability !== "string" || modifier.definition != null) continue;
    const target = node.target;
    const reaches = typeof target === "string"
      ? target === "this-unit" || target === "ability-unit" || target === "recipient" || target === "selected-unit"
      : target !== null && typeof target === "object" && "owner" in target && target.owner === "friendly"
        && !("level" in target && target.level === "model");
    if (reaches && !out.some((grant) => grant.abilityId === modifier.ability)) out.push({ abilityId: modifier.ability, fragment: item });
  }
  return out;
}

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
): AbilityLevers | undefined {
  const record = ds.abilities.getInFaction(grantedId, factionId) ?? ds.abilities.getAny(grantedId);
  if (!record) return undefined;
  // The granted ability is held by the crunched unit: its "this unit" is the crunched unit.
  const held: BuffSource = { kind: "ability", abilityId: record.id, abilityKind: "unit" };
  const { applied, activatable, unsupported } = record.describeBuffs(held, ctx, "attacker");
  const buffs: StackableBuff[] = [];
  const groups = new Map<string, StackableBuffGroup>();
  const capRaises = new Map<StackableBuff, CapacityRaise>();
  const optionRequirements = new Map<StackableBuff, OptionGate>();
  const prefix = `${provider.abilityId}>`;
  const dependency = provider.requiresLever ? { requiresLever: provider.requiresLever } : {};
  if (applied.length > 0) {
    buffs.push({ id: `${prefix}${record.id}`, label: record.name, buffs: applied, enabled: provider.enabled, source: provider.source, ...dependency });
  }
  for (const act of activatable) {
    const lever = leverFromActivatable(act, `${record.name} — ${act.label}`, provider.source);
    const group = act.group ? `${prefix}${act.group.id}` : undefined;
    for (const parent of [...(act.group ? [act.group] : []), ...(act.groups ?? [])]) {
      const id = `${prefix}${parent.id}`;
      if (!groups.has(id)) groups.set(id, { ...parent, id, label: record.name, abilityId: record.id });
    }
    const grantedLever: StackableBuff = {
      ...lever,
      id: `${prefix}${act.id}`,
      ...(group ? { group } : {}),
      ...(act.groups?.length ? { groups: act.groups.map((parent) => `${prefix}${parent.id}`) } : {}),
      ...dependency,
    };
    buffs.push(grantedLever);
    if (act.capRaise) capRaises.set(grantedLever, act.capRaise);
    const gated = optionGate(act);
    if (gated) optionRequirements.set(grantedLever, gated);
  }
  return { buffs, groups: [...groups.values()], capRaises, optionRequirements, needs: abilityNeeds(unsupported, record.id, record.name) };
}

/**
 * Resolve a capacity lever by the owning ability's immutable id, never by its
 * display label. Preserve the allocation and exact option references for the
 * selection consumer. Drop it when that stance pool is not available.
 */
export function resolveCapRaises(
  levers: StackableBuff[],
  pending: Map<StackableBuff, CapacityRaise>,
  groups: readonly StackableBuffGroup[],
): StackableBuff[] {
  return levers.flatMap((lever) => {
    const raise = pending.get(lever);
    if (!raise) return [lever];
    const group = groups.find((candidate) => candidate.abilityId === raise.ability && candidate.id.endsWith("?stance"));
    const { ability: _ability, ...allocation } = raise;
    return group ? [{ ...lever, raisesCap: { ...allocation, group: group.id } }] : [];
  });
}

/**
 * Bind each lever gated on a stance option to that option's lever, found by the owning ability's
 * immutable id and the option id. An option that gives no buff of its own has no lever; it gets a
 * buffless one in the stance's pool, so picking it still excludes the other options. Where the
 * stance pool is not available the unit cannot pick the option: a lever requiring it is dropped,
 * and a lever excluding it always applies.
 */
export function resolveOptionRequirements(
  levers: StackableBuff[],
  pending: Map<StackableBuff, OptionGate>,
  groups: readonly StackableBuffGroup[],
  optionLabel: (option: StanceOptionRef) => string,
): StackableBuff[] {
  const added: StackableBuff[] = [];
  const optionLever = (option: StanceOptionRef): string | undefined => {
    const group = groups.find((candidate) => candidate.abilityId === option.ability_id && candidate.id.endsWith("?stance"));
    if (!group) return undefined;
    const suffix = `#${option.option_id}`;
    const found = [...levers, ...added].find((lever) => lever.group === group.id && lever.id.endsWith(suffix));
    if (found) return found.id;
    const sibling = levers.find((lever) => lever.group === group.id)!;
    const id = `${sibling.id.slice(0, sibling.id.lastIndexOf("#"))}${suffix}`;
    added.push({ id, label: `${group.label} — ${optionLabel(option)}`, buffs: [], enabled: false, source: sibling.source, group: group.id, ...(sibling.requiresLever ? { requiresLever: sibling.requiresLever } : {}) });
    return id;
  };
  const resolved = levers.flatMap((lever) => {
    const gate = pending.get(lever);
    if (gate?.requiresOption) {
      const requiresOption = optionLever(gate.requiresOption);
      return requiresOption ? [{ ...lever, requiresOption }] : [];
    }
    if (gate?.excludesOption) {
      const excludesOption = optionLever(gate.excludesOption);
      return [excludesOption ? { ...lever, excludesOption } : lever];
    }
    return [lever];
  });
  return [...resolved, ...added];
}

/** The name of option `optionId` of a `stance-select` in `effect`, if it has one. */
export function stanceOptionName(effect: unknown, optionId: string): string | undefined {
  if (Array.isArray(effect)) {
    for (const item of effect) {
      const found = stanceOptionName(item, optionId);
      if (found) return found;
    }
    return undefined;
  }
  if (effect === null || typeof effect !== "object") return undefined;
  const node = effect as Record<string, unknown>;
  if (node.type === "stance-select" && Array.isArray(node.options)) {
    const option = node.options.find((candidate) => (candidate as { id?: unknown } | null)?.id === optionId) as { name?: unknown } | undefined;
    if (typeof option?.name === "string" && option.name) return option.name;
  }
  for (const value of Object.values(node)) {
    const found = stanceOptionName(value, optionId);
    if (found) return found;
  }
  return undefined;
}
