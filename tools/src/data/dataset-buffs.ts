/**
 * The buff stacks {@link Dataset} answers for a unit: the attacker/defender
 * stacks of {@link Dataset.buffsFor} / {@link Dataset.defensiveBuffsFor} and the
 * toggleable levers of {@link Dataset.stackableBuffsFor}. Each walks the unit's
 * eligible abilities and translates their DSL effects through the buff layer.
 *
 * @packageDocumentation
 */
import type { Buff, BuffSource, EngineContext } from "../cruncher/buffs.js";
import type { StanceOptionRef } from "../cruncher/from-dsl.js";
import { sameSnapshotValue } from "../cruncher/recipient-snapshots.js";
import type { Phase } from "../generated.js";
import type { EligibleAbility } from "../abilities-resolver/index.js";
import type { Dataset } from "./dataset.js";
import type { EligibilityInput } from "../abilities-resolver/index.js";
import { printedKeyword, stratagemTargetNames } from "../abilities-resolver/index.js";
import type { AbilityView, UnitView } from "./entities.js";
import { historicalSnapshotAbilities } from "./recipient-snapshots.js";
import {
  abilityLevers,
  combinedKeywordsLower,
  combinedToughness,
  sharedKeywordsLower,
  enhancementLevers,
  leverFromActivatable,
  resolveCapRaises,
  resolveOptionRequirements,
  stanceOptionName,
  type AbilityLevers,
  type AbilityNeed,
  abilityNeeds,
  type OptionGate,
  type CapacityRaise,
  type LeverCost,
} from "./lever-providers.js";

/**
 * {@link EligibilityInput} for the buff collectors, where `unitId` is optional:
 * with no unit selected, only the input's weapon profiles contribute.
 */
export type BuffInput = Omit<EligibilityInput, "unitId"> & { unitId?: string };

/**
 * One toggleable buff lever for damage analysis: the contributions it adds and
 * whether it's on by default. `enabled` is `true` for buffs that always apply
 * (intrinsic keywords, unconditional abilities) and `false` for player
 * decisions — stratagems (CP cost) and activatable gates (dice-pool options,
 * `choice` branches, timing-gated activations). A consumer flips `enabled`,
 * then crunches the enabled subset; an optimizer searches it.
 *
 * @see {@link Dataset.stackableBuffsFor}
 */
export type StackableBuff = {
  /** Stable toggle id (stable across re-enumeration of the same input). */
  id: string;
  /** Human label for the lever. */
  label: string;
  /** Contributions this lever adds when enabled (≥1). */
  buffs: Buff[];
  /** Default selection state. */
  enabled: boolean;
  /** Where the lever came from. */
  source: BuffSource;
  /** Id of the mutually-limited {@link StackableBuffGroup} this belongs to, if any. */
  group?: string;
  /** Additional enclosing pools; every listed cap applies alongside `group`. */
  groups?: string[];
  /** What turning the lever on costs: CP for a Stratagem, points for an Enhancement. */
  cost?: LeverCost;
  /**
   * DSL fragments the player vouches for when turning the lever on (a unit selection's range and
   * eligibility, a gating roll, the model count a capped bonus needs), in the order they apply.
   */
  requires?: unknown[];
  /** Id of the lever this one needs on (the Stratagem or Enhancement that provides it). */
  requiresLever?: string;
  /** Id of the stance option lever this one needs on (a rule that applies only under that option). */
  requiresOption?: string;
  /** Id of the stance option lever this one needs off (a rule that does not apply under that option). */
  excludesOption?: string;
  /** Turning the lever on raises the cap of the pool `group` by `by` instead of adding buffs. */
  raisesCap?: Omit<CapacityRaise, "ability"> & { group: string };
};

/** A pool of {@link StackableBuff} levers limited to `maxActivations` at once. */
export type StackableBuffGroup = {
  id: string;
  /** Stable owning ability id, independent of its display name. */
  abilityId?: string;
  label: string;
  maxActivations: number;
};

/**
 * A chapter army's own copies of its parent faction's rules, keyed by the parent rule's id. A
 * chapter that prints a rule its parent prints (Blood Angels' Combat Doctrines) carries a record
 * named alike and suffixed with its own faction; a rule naming the parent's copy (a Space Marine
 * detachment's "while the Tactical Doctrine is active") means the copy the chapter army selects.
 */
export function parentRuleCopies(ds: Dataset, factionId: string | undefined): Map<string, string> {
  const copies = new Map<string, string>();
  const parent = factionId ? ds.factions.getAny(factionId)?.raw.parent_faction_id : undefined;
  if (!factionId || !parent) return copies;
  const suffix = `-${factionId}`;
  for (const ability of ds.abilities.all) {
    if (ability.raw.faction_id !== factionId || !ability.id.endsWith(suffix)) continue;
    const parentId = `${ability.id.slice(0, -suffix.length)}-${parent}`;
    const original = ds.abilities.getInFaction(parentId, parent);
    if (original && original.raw.faction_id === parent && original.name === ability.name) copies.set(parentId, ability.id);
  }
  return copies;
}

/**
 * `rules` with each parent rule and its chapter copy standing for the other, so a `rule-active`
 * gate naming either holds when the army declares either.
 */
export function withRuleCopies(rules: EngineContext["activeRules"], copies: ReadonlyMap<string, string>): EngineContext["activeRules"] {
  if (rules === undefined || copies.size === 0) return rules;
  const counterpart = new Map<string, string>();
  for (const [parentId, copyId] of copies) { counterpart.set(parentId, copyId); counterpart.set(copyId, parentId); }
  const key = (rule: NonNullable<EngineContext["activeRules"]>[number]) => JSON.stringify(rule);
  const out = [...rules];
  const seen = new Set(out.map(key));
  for (const rule of rules) {
    const id = typeof rule === "string" ? rule : rule.ability_id;
    const other = counterpart.get(id);
    if (other === undefined) continue;
    const mirrored = typeof rule === "string" ? other : { ...rule, ability_id: other };
    if (!seen.has(key(mirrored))) { seen.add(key(mirrored)); out.push(mirrored); }
  }
  return out;
}

/** {@link Dataset.stackableBuffsFor} for `ds`. */
export function stackableBuffsFor(
  ds: Dataset,
  input: BuffInput & {
    weaponProfiles?: { weaponId: string; profileIndex: number }[];
  },
  context: EngineContext,
): { buffs: StackableBuff[]; groups: StackableBuffGroup[]; needs: AbilityNeed[] } {
  const buffs: StackableBuff[] = [];
  const groups: StackableBuffGroup[] = [];
  const needs: AbilityNeed[] = [];
  const capRaises = new Map<StackableBuff, CapacityRaise>();
  const optionRequirements = new Map<StackableBuff, OptionGate>();
  const take = (levers: AbilityLevers) => {
    buffs.push(...levers.buffs);
    for (const group of levers.groups) if (!groups.some((g) => g.id === group.id)) groups.push(group);
    for (const [lever, raise] of levers.capRaises) capRaises.set(lever, raise);
    for (const [lever, option] of levers.optionRequirements) optionRequirements.set(lever, option);
    for (const need of levers.needs) if (!needs.some((n) => n.key === need.key && n.abilityId === need.abilityId)) needs.push(need);
  };

  const unit = inputUnit(ds, input);
  const factionId = input.factionId ?? unit?.raw.faction_id ?? "";
  const members = (input.attachedUnitIds ?? [])
    .map((id) => ds.units.getInFaction(id, factionId) ?? ds.units.getAny(id))
    .filter((view): view is UnitView => view !== undefined);
  const combined = unit ? [unit, ...members] : members;

  // Surface the attachment fact and the combined unit's keywords to the DSL translator so
  // attachment conditions and keyword filters evaluate against their actual subjects.
  // Clone — never mutate the caller's context. An explicitly-set value wins over the derivation.
  const copies = parentRuleCopies(ds, factionId);
  const ctx: EngineContext = {
    ...context,
    activeRules: withRuleCopies(context.activeRules, copies),
    attackerAttached:
      context.attackerAttached ?? (input.attachedUnitIds?.length ?? 0) > 0,
    attackerKeywords: context.attackerKeywords ?? (combined.length > 0 ? combinedKeywordsLower(combined) : undefined),
    attackerModelKeywords: context.attackerModelKeywords ?? (combined.length > 0 ? sharedKeywordsLower(combined) : undefined),
    attackerUnitId: context.attackerUnitId ?? input.unitId,
    // The input's faction is the army whose rules the resolver walks, so it is the Army Faction.
    armyFaction: context.armyFaction ?? factionId,
    attackerAttachmentRole: context.attackerAttachmentRole ?? (input.unitId === undefined ? undefined : input.attachmentRoles?.[input.unitId]),
    attachmentRoles: context.attachmentRoles ?? input.attachmentRoles,
    attackerToughness: context.attackerToughness ?? combinedToughness(combined, input.attachmentRoles),
  };

  // Intrinsic weapon-profile keywords — always on. Weapon ids are shared
  // across factions with divergent stats, so resolve within the input
  // unit's faction (getAny fallback for a genuinely cross-faction id).
  const weaponFaction = input.factionId ?? unit?.raw.faction_id;
  for (const ref of input.weaponProfiles ?? []) {
    const weapon =
      (weaponFaction
        ? ds.weapons.getInFaction(ref.weaponId, weaponFaction)
        : undefined) ?? ds.weapons.getAny(ref.weaponId);
    if (!weapon) continue;
    const wk = weapon.profileBuffs(ref.profileIndex, ctx);
    if (wk.length === 0) continue;
    buffs.push({
      id: `weapon:${ref.weaponId}:${ref.profileIndex}`,
      label: `${weapon.name} keywords`,
      buffs: wk,
      enabled: true,
      source: wk[0].source,
    });
  }

  const eligible = inputEligibleAbilities(ds, input, ctx.phase);
  // A record the unit already holds is not granted again by another ability.
  const held = new Set(eligible.filter((entry) => entry.source.kind !== "support").map((entry) => entry.ability.id));
  for (const entry of eligible) {
    const stratagem = entry.source.kind === "detachment-stratagem" ? entry.source : undefined;
    take(abilityLevers(ds, {
      ability: entry.ability,
      source: bufferSourceFromEligible(entry),
      rating: entry.rating,
      ctx,
      factionId,
      idBase: `${entry.source.kind}:${entry.ability.id}`,
      label: entry.ability.name,
      // Another unit's ability reaches ds one only where the player places it (range,
      // selection), so its levers are opt-in.
      enabled: entry.source.kind !== "support",
      // Stratagems cost CP — opt-in, not on by default.
      gate: stratagem ? { cost: { cp: stratagem.cpCost } } : undefined,
      held,
    }));
  }
  for (const entry of historicalSnapshotAbilities(ds, input, ctx, "attacker")) {
    if (eligible.some((current) => current.ability.id === entry.ability.id && sameSnapshotValue(bufferSourceFromEligible(current), entry.source))) continue;
    take(abilityLevers(ds, {
      ability: entry.ability, source: entry.source, ctx, factionId,
      idBase: `${entry.source.kind === "ability" ? entry.source.abilityKind : entry.source.kind}:${entry.ability.id}`,
      label: entry.ability.name, enabled: true, held,
    }));
    held.add(entry.ability.id);
  }

  // Enhancements a character in the combined unit could take from the detachment.
  take(enhancementLevers(ds, { detachmentId: input.detachmentId, crunchedUnitId: input.unitId, bearers: combined, ctx, factionId, held }));

  const optionName = (option: StanceOptionRef) =>
    stanceOptionName((ds.abilities.getInFaction(option.ability_id, factionId) ?? ds.abilities.getAny(option.ability_id))?.raw.effect, option.option_id)
      ?? option.option_id;
  // A gate on a parent rule's option binds to the stance the chapter army picks: its own copy.
  const onCopy = (option: StanceOptionRef): StanceOptionRef => ({ ...option, ability_id: copies.get(option.ability_id) ?? option.ability_id });
  for (const [lever, gate] of optionRequirements) {
    optionRequirements.set(lever, {
      ...(gate.requiresOption ? { requiresOption: onCopy(gate.requiresOption) } : {}),
      ...(gate.excludesOption ? { excludesOption: onCopy(gate.excludesOption) } : {}),
    });
  }
  for (const [lever, raise] of capRaises) {
    capRaises.set(lever, {
      ...raise,
      ability: copies.get(raise.ability) ?? raise.ability,
      ...(raise.option ? { option: onCopy(raise.option) } : {}),
      ...(raise.options ? { options: raise.options.map(onCopy) } : {}),
    });
  }
  const resolved = resolveOptionRequirements(resolveCapRaises(buffs, capRaises, groups, optionRequirements), optionRequirements, groups, optionName);
  return { buffs: resolved, groups, needs };
}

/** The input's selected unit, resolved within its faction when one is given. */
function inputUnit(ds: Dataset, input: BuffInput): UnitView | undefined {
  if (input.unitId === undefined) return undefined;
  return (input.factionId ? ds.units.getInFaction(input.unitId, input.factionId) : undefined)
    ?? ds.units.getAny(input.unitId);
}

/** {@link eligibleAbilities} for a buff input; nothing is eligible when no unit is selected. */
export function inputEligibleAbilities(ds: Dataset, input: BuffInput, phase: Phase): EligibleAbility[] {
  return input.unitId === undefined ? [] : ds.eligibleAbilities({ ...input, unitId: input.unitId }, phase);
}

/** The opt-in levers {@link Dataset.defensiveLeversFor} returns, with the pools that limit them. */
export type DefensiveLevers = { buffs: StackableBuff[]; groups: StackableBuffGroup[] };

/**
 * Shared implementation of {@link Dataset.buffsFor} / {@link Dataset.defensiveBuffsFor}. When
 * `needs` is given, every undecided leaf condition of the walked abilities is pushed onto it. When
 * `levers` is given, every activatable of the walked abilities is pushed onto it as an opt-in
 * lever (first id wins), with the pools it names; an activatable that raises a pool's cap or is
 * gated on a stance option is left out, since nothing here resolves those against another lever.
 */
export function collectBuffs(
  ds: Dataset,
  input: BuffInput & {
    weaponProfiles?: { weaponId: string; profileIndex: number }[];
    optedInStratagemIds?: string[];
  },
  context: EngineContext,
  perspective: "attacker" | "target",
  needs?: AbilityNeed[],
  levers?: DefensiveLevers,
): Buff[] {
  const out: Buff[] = [];
  const translate = (ability: AbilityView, source: BuffSource, rating?: string | number, at: EngineContext = ctx) => {
    const translation = ability.describeBuffs(source, at, perspective, rating);
    if (needs) {
      for (const need of abilityNeeds(translation.unsupported, ability.id, ability.name)) {
        if (!needs.some((n) => n.key === need.key && n.abilityId === need.abilityId)) needs.push(need);
      }
    }
    if (levers) {
      for (const act of translation.activatable) {
        if (act.capRaise || act.requiresOption || act.excludesOption) continue;
        if (levers.buffs.some((lever) => lever.id === act.id)) continue;
        levers.buffs.push(leverFromActivatable(act, `${ability.name} — ${act.label}`, source));
        for (const group of [...(act.group ? [act.group] : []), ...(act.groups ?? [])]) {
          if (!levers.groups.some((existing) => existing.id === group.id)) {
            levers.groups.push({ id: group.id, abilityId: ability.id, label: ability.name, maxActivations: group.maxActivations });
          }
        }
      }
    }
    return translation.applied;
  };

  const ctx = buffContext(ds, input, context, perspective);

  // Weapon-profile keywords are attacker-only. Faction-scoped like
  // stackableBuffsFor — first-wins here would crunch the wrong faction's stats.
  if (perspective === "attacker") {
    const weaponFaction =
      input.factionId ?? (input.unitId === undefined ? undefined : ds.units.getAny(input.unitId))?.raw.faction_id;
    for (const ref of input.weaponProfiles ?? []) {
      const weapon =
        (weaponFaction
          ? ds.weapons.getInFaction(ref.weaponId, weaponFaction)
          : undefined) ?? ds.weapons.getAny(ref.weaponId);
      if (!weapon) continue;
      out.push(...weapon.profileBuffs(ref.profileIndex, ctx));
    }
  }

  const optedIn = new Set(input.optedInStratagemIds ?? []);
  const visited: { abilityId: string; source: BuffSource }[] = [];
  for (const entry of inputEligibleAbilities(ds, input, ctx.phase)) {
    if (
      entry.source.kind === "detachment-stratagem" &&
      !optedIn.has(entry.source.stratagemId)
    ) {
      continue;
    }
    const source = bufferSourceFromEligible(entry);
    visited.push({ abilityId: entry.ability.id, source });
    const at = entry.source.kind === "detachment-stratagem" ? stratagemContext(ds, input, entry, ctx) : ctx;
    out.push(...translate(entry.ability, source, entry.rating, at));
  }
  for (const entry of historicalSnapshotAbilities(ds, input, ctx, perspective)) {
    if (visited.some((current) => current.abilityId === entry.ability.id && sameSnapshotValue(current.source, entry.source))) continue;
    out.push(...translate(entry.ability, entry.source));
  }

  return out;
}

/**
 * `ctx` with {@link EngineContext.stratagemTargets} filled in for an opted-in Stratagem: which of
 * its named friendly targets the input unit (with the units attached to it) can be.
 */
function stratagemContext(ds: Dataset, input: BuffInput, entry: EligibleAbility, ctx: EngineContext): EngineContext {
  if (entry.source.kind !== "detachment-stratagem" || ctx.stratagemTargets !== undefined) return ctx;
  const stratagem = ds.stratagems.get(entry.source.stratagemId);
  const unit = inputUnit(ds, input);
  if (!stratagem || !unit) return ctx;
  const factionId = input.factionId ?? unit.raw.faction_id;
  const members = [unit, ...(input.attachedUnitIds ?? []).map((id) => (factionId ? ds.units.getInFaction(id, factionId) : undefined) ?? ds.units.getAny(id))]
    .map((member) => new Set([...(member?.keywords ?? []), ...(member?.factionKeywords ?? [])].map((keyword) => keyword.toLowerCase())));
  const trigger = entry.ability.raw.trigger as { subject?: unknown } | null | undefined;
  const targets = stratagemTargetNames(stratagem, members, trigger?.subject, printedKeyword(ds));
  return Object.keys(targets).length === 0 ? ctx : { ...ctx, stratagemTargets: targets };
}

/**
 * The engine context the buff collectors translate under: `context` with the input unit's
 * attachment, keywords, army faction and Toughness filled in where `context` leaves them unset.
 */
export function buffContext(ds: Dataset, input: BuffInput, context: EngineContext, perspective: "attacker" | "target"): EngineContext {
  const unit = inputUnit(ds, input);
  const factionId = input.factionId ?? unit?.raw.faction_id;
  const combined = unit ? [unit] : [];
  for (const id of input.attachedUnitIds ?? []) {
    const member = (factionId ? ds.units.getInFaction(id, factionId) : undefined) ?? ds.units.getAny(id);
    if (member) combined.push(member);
  }
  // Explicit game-state facts win. Roles come only from actual attachment edges.
  const keywords = combined.length > 0 ? combinedKeywordsLower(combined) : undefined;
  const modelKeywords = combined.length > 0 ? sharedKeywordsLower(combined) : undefined;
  const attached = (input.attachedUnitIds?.length ?? 0) > 0;
  const activeRules = withRuleCopies(context.activeRules, parentRuleCopies(ds, factionId));
  return perspective === "attacker" ? {
    ...context,
    activeRules,
    attackerAttached: context.attackerAttached ?? attached,
    attackerUnitId: context.attackerUnitId ?? input.unitId,
    // The input's faction is the army whose rules the resolver walks, so it is the Army Faction.
    armyFaction: context.armyFaction ?? factionId,
    attackerAttachmentRole: context.attackerAttachmentRole ?? (input.unitId === undefined ? undefined : input.attachmentRoles?.[input.unitId]),
    attackerKeywords: context.attackerKeywords ?? keywords,
    attackerModelKeywords: context.attackerModelKeywords ?? modelKeywords,
    attachmentRoles: context.attachmentRoles ?? input.attachmentRoles,
    attackerToughness: context.attackerToughness ?? combinedToughness(combined, input.attachmentRoles),
  } : {
    ...context,
    activeRules,
    targetAttached: context.targetAttached ?? attached,
    targetUnitId: context.targetUnitId ?? input.unitId,
    // The input's faction is the defending army whose rules the resolver walks.
    targetArmyFaction: context.targetArmyFaction ?? factionId,
    targetAttachmentRole: context.targetAttachmentRole ?? (input.unitId === undefined ? undefined : input.attachmentRoles?.[input.unitId]),
    targetKeywords: context.targetKeywords ?? keywords,
    targetModelKeywords: context.targetModelKeywords ?? modelKeywords,
    attachmentRoles: context.attachmentRoles ?? input.attachmentRoles,
  };
}

/** Map an EligibleAbility back to the BuffSource the translator expects. */
export function bufferSourceFromEligible(entry: EligibleAbility): BuffSource {
  const abilityId = entry.ability.id;
  switch (entry.source.kind) {
    case "army":
      return { kind: "ability", abilityId, abilityKind: "army" };
    case "detachment":
      return { kind: "ability", abilityId, abilityKind: "detachment" };
    case "detachment-stratagem":
      return {
        kind: "ability",
        abilityId,
        abilityKind: "detachment-stratagem",
        ...(entry.source.selectsModel ? { selectsModel: true } : {}),
      };
    case "unit":
      return {
        kind: "ability",
        abilityId,
        abilityKind: "unit",
        ...(entry.source.wargearId ? { wargearId: entry.source.wargearId } : {}),
      };
    case "attached":
      return {
        kind: "ability",
        abilityId,
        abilityKind: "attached",
        sourceUnitId: entry.source.unitId,
        ...(entry.source.wargearId ? { wargearId: entry.source.wargearId } : {}),
      };
    case "support":
      return { kind: "ability", abilityId, abilityKind: "support", sourceUnitId: entry.source.sourceUnitId };
  }
}
