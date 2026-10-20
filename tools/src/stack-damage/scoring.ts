import type { Buff, BuffSource, EngineContext } from "../cruncher/index.js";
import type { Dataset, StackableBuffGroup } from "../data/dataset.js";
import { isLegalLeverSelection } from "../data/lever-selection.js";
import { baseLoadout, optionCap, type LoadoutModel, type LoadoutTier } from "../data/loadout.js";
import { reachesOtherUnits } from "../abilities-resolver/resolver.js";
import type { EligibilityInput, EligibleAbility } from "../abilities-resolver/index.js";
import type { UnitView } from "../data/entities.js";
import type { MatrixConfig } from "./config.js";
import { DamageCellCache } from "./cache.js";
import {
  assessEnhancementAssignment,
  validateCandidateLoadout,
  type CandidateLoadoutLegality,
  type LocalStackMember,
} from "./legality.js";
import { searchLevers, type LeverSpace } from "./lever-search.js";
import { searchLoadout, type LoadoutScaffold, type LoadoutSpace } from "./loadout-search.js";
import type { ProfileDamage } from "./loadout-scoring.js";
import { crunchProfileScorer, unitLoadoutDamage } from "./unit-damage.js";
import type {
  DamageCellState,
  PoolLever,
  StackBuffPool,
  StackMember,
  StackResult,
  StackSpec,
  UnitLoadoutResult,
} from "./model.js";

export interface DamageScoringInvariants {
  loadoutLegality: Map<string, CandidateLoadoutLegality>;
}

interface StackEligibilityInput extends EligibilityInput {
  weaponProfiles: [];
}

function sourceFor(entry: EligibleAbility): BuffSource {
  switch (entry.source.kind) {
    case "army":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "army" };
    case "detachment":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "detachment" };
    case "detachment-stratagem":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "detachment-stratagem" };
    case "unit":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "unit" };
    case "attached":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "attached", sourceUnitId: entry.source.unitId };
    case "support":
      return { kind: "ability", abilityId: entry.ability.id, abilityKind: "support", sourceUnitId: entry.source.sourceUnitId };
  }
}

function buffKey(buffs: readonly Buff[]): string {
  return buffs.map((buff) => JSON.stringify({ source: buff.source, contribution: buff.contribution, when: buff.applicableWhen ?? null })).join("|");
}

function memberKeywords(members: readonly StackMember[]): string[] {
  const keywords = new Set<string>();
  for (const member of members) {
    for (const keyword of [...member.unit.keywords, ...member.unit.factionKeywords]) keywords.add(keyword.toLowerCase());
  }
  return [...keywords].sort();
}

function attachmentRoles(members: readonly StackMember[]): Record<string, "leader" | "bodyguard"> {
  return Object.fromEntries(members.map((member) => [member.unit.id, member.role === "bodyguard" ? "bodyguard" : "leader"]));
}

function enhancementIdentity(leverId: string): { enhancementId: string; bearerId: string } | null {
  if (!leverId.startsWith("enhancement:")) return null;
  const split = leverId.indexOf("@");
  if (split < 0) return null;
  return { enhancementId: leverId.slice("enhancement:".length, split), bearerId: leverId.slice(split + 1) };
}

export class DamageScoringSession {
  readonly supportUnits: UnitView[];
  readonly defensiveBuffs: Buff[];
  readonly defensiveWarnings: StackBuffPool["warnings"];
  readonly scoreCache: DamageCellCache<ProfileDamage | null>;
  readonly loadoutCache: DamageCellCache<UnitLoadoutResult>;
  readonly poolCache: DamageCellCache<StackBuffPool>;
  readonly stackCache: DamageCellCache<StackResult>;
  crunchCount = 0;
  stackEvaluations = 0;
  illegalLoadoutsRejected = 0;
  private readonly scaffoldCache = new Map<string, LoadoutScaffold>();
  private readonly loadoutLegalityCache: Map<string, CandidateLoadoutLegality>;

  constructor(
    readonly dataset: Dataset,
    readonly state: DamageCellState,
    readonly config: MatrixConfig,
    factionUnits: readonly UnitView[],
    invariants: DamageScoringInvariants = { loadoutLegality: new Map() },
  ) {
    this.loadoutLegalityCache = invariants.loadoutLegality;
    this.scoreCache = new DamageCellCache(state.factionId, state.target.profileId, state.phase);
    this.loadoutCache = new DamageCellCache(state.factionId, state.target.profileId, state.phase);
    this.poolCache = new DamageCellCache(state.factionId, state.target.profileId, state.phase);
    this.stackCache = new DamageCellCache(state.factionId, state.target.profileId, state.phase);
    this.supportUnits = factionUnits.filter((unit) => unit.abilities.some((ability) =>
      (ability.phases.length === 0 || ability.phases.includes(state.phase)) && reachesOtherUnits(ability.raw.effect),
    ));
    const targetContext = state.contextFor({
      factionId: state.factionId,
      members: [],
      detachmentIds: [],
      selectedLeverIds: [],
      detachmentIssues: [],
    });
    this.defensiveBuffs = dataset.defensiveBuffsFor(
      { unitId: state.target.unitRaw.id, factionId: state.target.unitRaw.faction_id },
      targetContext,
    );
    this.defensiveWarnings = this.translationWarnings(
      { unitId: state.target.unitRaw.id, factionId: state.target.unitRaw.faction_id },
      targetContext,
      "target",
    );
  }

  private scaffold(unit: UnitView): LoadoutScaffold {
    const cached = this.scaffoldCache.get(unit.id);
    if (cached) return cached;
    const composition = this.dataset.unitCompositionOf(unit.raw) as { models?: LoadoutModel[]; tiers?: LoadoutTier[] } | undefined;
    const models = composition?.models ?? [];
    let modelCount = unit.raw.model_count?.max ?? unit.raw.model_count?.min ?? 1;
    for (const tier of composition?.tiers ?? []) {
      const count = tier.models.reduce((sum, model) => sum + (model.max ?? model.min), 0);
      modelCount = Math.max(modelCount, count);
    }
    const authored = this.dataset.wargearOptionsOf(unit.raw);
    const options = this.config.perFiveSensitivity
      ? authored.map((option) => option.replaces && (option.model_constraint as { any_number?: boolean } | undefined)?.any_number
        ? { ...option, model_constraint: { ...option.model_constraint, any_number: undefined, per_n_models: 5 } }
        : option)
      : authored;
    const scaffold = {
      models,
      modelCount,
      options,
      caps: options.map((option) => optionCap(option, modelCount, models)),
      base: baseLoadout(unit.raw, modelCount, options, models).counts,
    };
    this.scaffoldCache.set(unit.id, scaffold);
    return scaffold;
  }

  private loadoutLegality(unit: UnitView, scaffold: LoadoutScaffold, counts: ReadonlyMap<string, number>) {
    const key = `${unit.raw.faction_id}|${unit.id}|per-five:${this.config.perFiveSensitivity}|${[...counts].sort(([left], [right]) => left.localeCompare(right)).map(([id, count]) => `${id}:${count}`).join(",")}`;
    const cached = this.loadoutLegalityCache.get(key);
    if (cached) return cached;
    const legality = validateCandidateLoadout({
      unit: unit.raw,
      modelCount: scaffold.modelCount,
      options: scaffold.options,
      counts,
      models: scaffold.models,
    });
    this.loadoutLegalityCache.set(key, legality);
    return legality;
  }

  private scoreCounts(unit: UnitView, counts: ReadonlyMap<string, number>, buffs: Buff[], context: EngineContext): UnitLoadoutResult {
    const scaffold = this.scaffold(unit);
    const target = { unit: this.state.target.unitRaw, modelCount: this.state.target.modelCount };
    const crunchProfile = crunchProfileScorer(this.dataset, target, buffs);
    const scored = unitLoadoutDamage({
      dataset: this.dataset,
      unit: unit.raw,
      modelCount: scaffold.modelCount,
      counts,
      target,
      buffs,
      context,
      groups: this.loadoutLegality(unit, scaffold, counts).groups,
      scoreProfile: (request) => {
        const key = `${unit.id}|${request.weapon.id}|${request.profileIndex}|${buffKey(buffs)}|${request.hitModifier ?? 0}|${JSON.stringify(request.context)}`;
        const cached = this.scoreCache.get(key);
        if (cached !== undefined) return cached;
        this.crunchCount += 1;
        const value = crunchProfile(request);
        this.scoreCache.set(key, value);
        return value;
      },
    });
    return {
      counts: new Map(counts),
      modelCount: scaffold.modelCount,
      total: scored.total,
      selectedWeapons: scored.selected,
      pistolChoice: scored.pistolChoice,
      legalityErrors: [],
    };
  }

  /** The unit's wargear choices under `buffs`, for {@link searchLoadout} and the exhaustive oracle. */
  loadoutSpace(unit: UnitView, buffs: Buff[], context: EngineContext): LoadoutSpace<UnitLoadoutResult> {
    const scaffold = this.scaffold(unit);
    return {
      scaffold,
      legal: (counts) => this.loadoutLegality(unit, scaffold, counts).legal,
      score: (counts) => this.scoreCounts(unit, counts, buffs, context),
    };
  }

  bestLoadout(unit: UnitView, buffs: Buff[], context: EngineContext): UnitLoadoutResult {
    const cacheKey = `${unit.id}|${buffKey(buffs)}|${JSON.stringify(context)}`;
    const cached = this.loadoutCache.get(cacheKey);
    if (cached) return cached;
    const scaffold = this.scaffold(unit);
    const baseLegality = this.loadoutLegality(unit, scaffold, scaffold.base);
    if (!baseLegality.legal) {
      this.illegalLoadoutsRejected += 1;
      const invalid = { counts: scaffold.base, modelCount: scaffold.modelCount, total: 0, selectedWeapons: [], pistolChoice: "none" as const, legalityErrors: baseLegality.violations.map((violation) => violation.code) };
      this.loadoutCache.set(cacheKey, invalid);
      return invalid;
    }
    const best = searchLoadout(this.loadoutSpace(unit, buffs, context), () => { this.illegalLoadoutsRejected += 1; });
    this.loadoutCache.set(cacheKey, best);
    return best;
  }

  eligibilityInput(spec: StackSpec, member: StackMember, detachmentId?: string): StackEligibilityInput {
    return {
      unitId: member.unit.id,
      factionId: spec.factionId,
      detachmentId,
      attachedUnitIds: spec.members.filter((candidate) => candidate !== member).map((candidate) => candidate.unit.id),
      attachmentRoles: attachmentRoles(spec.members),
      supportingUnitIds: this.supportUnits.filter((support) => !spec.members.some((candidate) => candidate.unit.id === support.id)).map((support) => support.id),
      weaponProfiles: [],
    };
  }

  private translationWarnings(
    input: EligibilityInput,
    context: EngineContext,
    perspective: "attacker" | "target",
  ): StackBuffPool["warnings"] {
    const warnings: StackBuffPool["warnings"] = [];
    for (const entry of this.dataset.eligibleAbilities(input, context.phase)) {
      if (this.config.droppedArmyRules.includes(entry.ability.id)) continue;
      const translated = entry.ability.describeBuffs(sourceFor(entry), context, perspective, entry.rating);
      for (const fragment of translated.unsupported) {
        warnings.push({
          sourceAbilityId: entry.ability.id,
          ...(entry.source.kind === "support" ? { sourceUnitId: entry.source.sourceUnitId } : {}),
          perspective,
          sourceKind: entry.source.kind,
          reason: fragment.reason ?? "unsupported DSL fragment",
        });
      }
      if (perspective === "target" && translated.activatable.length > 0) {
        warnings.push({
          sourceAbilityId: entry.ability.id,
          perspective,
          sourceKind: entry.source.kind,
          reason: "defensive activatable choice is not selected by the attacker benchmark",
        });
      }
    }
    return warnings;
  }

  pool(spec: StackSpec): StackBuffPool {
    const key = `${spec.members.map((member) => `${member.unit.id}:${member.role}`).join("+")}|${spec.detachmentIds.join("+")}`;
    const cached = this.poolCache.get(key);
    if (cached) return cached;
    const levers = new Map<string, PoolLever>();
    const groups = new Map<string, StackableBuffGroup>();
    const warnings: StackBuffPool["warnings"] = [];
    for (const member of spec.members) {
      const context = this.state.contextFor(spec, member);
      for (const detachmentId of spec.detachmentIds.length > 0 ? spec.detachmentIds : [undefined]) {
        const input = this.eligibilityInput(spec, member, detachmentId);
        const selection = this.dataset.stackableBuffsFor(input, context);
        for (const group of selection.groups) if (!groups.has(group.id)) groups.set(group.id, group);
        for (const lever of selection.buffs) {
          if (lever.source.kind === "ability" && this.config.droppedArmyRules.includes(lever.source.abilityId)) continue;
          const current = levers.get(lever.id) ?? { ...lever, perMember: new Map<string, Buff[]>() };
          current.perMember.set(member.unit.id, lever.buffs);
          levers.set(lever.id, current);
        }
        warnings.push(...this.translationWarnings(input, context, "attacker"));
      }
    }
    const uniqueWarnings = [...new Map(warnings.map((warning) => [JSON.stringify(warning), warning])).values()];
    const value = { levers: [...levers.values()], groups: [...groups.values()], warnings: uniqueWarnings };
    this.poolCache.set(key, value);
    return value;
  }

  localMembersForLegality(spec: StackSpec, enhancementByBearer = new Map<string, string>()): LocalStackMember[] {
    const bodyguardId = spec.members.find((member) => member.role === "bodyguard")?.unit.id;
    return spec.members.map((member) => {
      const scaffold = this.scaffold(member.unit);
      return {
        unit: member.unit.raw,
        modelCount: scaffold.modelCount,
        loadout: scaffold.base,
        enhancementId: enhancementByBearer.get(member.unit.id),
        leaderBodyguardId: member.role === "bodyguard" ? null : bodyguardId,
      };
    });
  }

  legalLeverSelection(spec: StackSpec, selectedIds: readonly string[]): boolean {
    const pool = this.pool(spec);
    const selected = new Set(selectedIds);
    if (!isLegalLeverSelection(pool.levers, pool.groups, selected)) return false;
    if (pool.levers.filter((lever) => selected.has(lever.id) && lever.cost?.cp !== undefined).length > 1) return false;
    const enhancementByBearer = new Map<string, string>();
    const usedEnhancements = new Set<string>();
    for (const lever of pool.levers) {
      if (!selected.has(lever.id) || lever.cost?.points === undefined) continue;
      const identity = enhancementIdentity(lever.id);
      if (!identity) continue;
      if (usedEnhancements.has(identity.enhancementId) || enhancementByBearer.has(identity.bearerId)) return false;
      usedEnhancements.add(identity.enhancementId);
      enhancementByBearer.set(identity.bearerId, identity.enhancementId);
    }
    const localMembers = this.localMembersForLegality(spec, enhancementByBearer);
    for (const [bearerId, enhancementId] of enhancementByBearer) {
      const enhancement = this.dataset.enhancements.get(enhancementId);
      const bearerIndex = spec.members.findIndex((member) => member.unit.id === bearerId);
      if (!enhancement || bearerIndex < 0) return false;
      const assessed = assessEnhancementAssignment({
        dataset: this.dataset,
        factionId: spec.factionId,
        detachmentIds: spec.detachmentIds,
        members: localMembers,
        bearerIndex,
        enhancement,
      });
      if (assessed.status === "illegal") return false;
    }
    return true;
  }

  scoreStack(spec: StackSpec): StackResult {
    const key = `${spec.members.map((member) => member.unit.id).join("+")}|${spec.detachmentIds.join("+")}|${[...spec.selectedLeverIds].sort().join("+")}`;
    const cached = this.stackCache.get(key);
    if (cached) return cached;
    this.stackEvaluations += 1;
    const pool = this.pool(spec);
    const selected = new Set(spec.selectedLeverIds);
    const members = spec.members.map((member) => {
      const buffs = [
        ...pool.levers.filter((lever) => selected.has(lever.id)).flatMap((lever) => lever.perMember.get(member.unit.id) ?? []),
        ...this.defensiveBuffs,
      ];
      return { member, loadout: this.bestLoadout(member.unit, buffs, this.state.contextFor(spec, member)) };
    });
    const result = { spec, total: members.reduce((sum, member) => sum + member.loadout.total, 0), members };
    this.stackCache.set(key, result);
    return result;
  }

  /** The stack's lever choices, for {@link searchLevers} and the exhaustive oracle. */
  leverSpace(spec: StackSpec): LeverSpace<StackResult> {
    const legality = new Map<string, boolean>();
    return {
      levers: this.pool(spec).levers,
      legal: (selected) => {
        const key = [...selected].sort().join("+");
        let legal = legality.get(key);
        if (legal === undefined) legality.set(key, legal = this.legalLeverSelection(spec, selected));
        return legal;
      },
      score: (selected) => this.scoreStack({ ...spec, selectedLeverIds: [...selected] }),
    };
  }

  /** The best lever set for the spec's members and detachments; its own selection is ignored. */
  optimiseLevers(spec: StackSpec): StackResult {
    return searchLevers(this.leverSpace(spec));
  }

  relevantWarnings(result: StackResult): StackBuffPool["warnings"] {
    const pool = this.pool(result.spec);
    const selectedLevers = pool.levers.filter((lever) => result.spec.selectedLeverIds.includes(lever.id));
    const selectedAbilityIds = new Set(
      selectedLevers.flatMap((lever) => lever.source.kind === "ability" ? [lever.source.abilityId] : []),
    );
    const warnings = pool.warnings.filter((warning) => warning.sourceKind !== "support" || selectedAbilityIds.has(warning.sourceAbilityId));
    for (const lever of selectedLevers) {
      if (lever.source.kind !== "ability") continue;
      const ability = this.dataset.abilities.getInFaction(lever.source.abilityId, result.spec.factionId)
        ?? this.dataset.abilities.getAny(lever.source.abilityId);
      if (!ability) continue;
      for (const member of result.spec.members) {
        const translation = ability.describeBuffs(lever.source, this.state.contextFor(result.spec, member), "attacker");
        for (const fragment of translation.unsupported) {
          warnings.push({
            sourceAbilityId: ability.id,
            ...(lever.source.sourceUnitId ? { sourceUnitId: lever.source.sourceUnitId } : {}),
            perspective: "attacker",
            sourceKind: lever.source.abilityKind,
            reason: fragment.reason ?? "unsupported DSL fragment",
          });
        }
      }
    }
    return [...new Map(warnings.map((warning) => [JSON.stringify(warning), warning])).values()];
  }

  selectedPoolLevers(result: StackResult): PoolLever[] {
    return this.pool(result.spec).levers.filter((lever) => result.spec.selectedLeverIds.includes(lever.id));
  }

  keywordsFor(spec: StackSpec): string[] {
    return memberKeywords(spec.members);
  }
}
