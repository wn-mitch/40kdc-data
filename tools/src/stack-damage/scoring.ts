import type { Buff, EngineContext } from "../cruncher/index.js";
import type { Dataset, StackableBuff, StackableBuffGroup } from "../data/dataset.js";
import { optionCap, type LoadoutModel } from "../data/loadout.js";
import { unitLoadout } from "../data/unit-loadout.js";
import type { MfmComposition } from "../data/mfm-loadout-unit.js";
import { fullModelCount } from "./factions.js";
import { reachesOtherUnits, replacedArmyRuleIds, suppressedAbilities } from "../abilities-resolver/resolver.js";
import type { EligibilityInput } from "../abilities-resolver/index.js";
import type { UnitView } from "../data/entities.js";
import type { MatrixConfig } from "./config.js";
import { DamageCellCache } from "./cache.js";
import { validateCandidateLoadout, type CandidateLoadoutLegality, type LocalStackMember } from "./legality.js";
import { isLegalStackLevers } from "./lever-legality.js";
import { searchLevers, type LeverSpace } from "./lever-search.js";
import { countsKey, mfmLoadouts, searchLoadout, type LoadoutScaffold, type LoadoutSpace } from "./loadout-search.js";
import type { ProfileDamage } from "./loadout-scoring.js";
import { attributeSelectedProfile, crunchProfileScorer, profileApplicableBuffs, unitLoadoutDamage, type DamageAttribution, type UnscoreableProfile } from "./unit-damage.js";
import { translationWarnings } from "./translation-warnings.js";
import { loadoutLeverBuffs, namedLoadoutWargear, surfacedByLoadout, wargearRules, wargearTranslation, type WargearRules } from "./wargear-levers.js";
import { combinedWargear, equippedBuffs, loadoutWargear, unequippedRules, unitWeaponGrants, wargearContext, type WeaponGrants } from "./weapon-grants.js";
import { equippedLevers, othersEquippedBuffs, othersUnequippedKey, settleMemberLoadouts, type MemberLoadouts } from "./member-loadouts.js";
import { activationPossible, filterStackEligibleAbilities, filterStackableStratagems, unitLookup } from "./stratagem-eligibility.js";
import { combinedKeywords, issuesOrders, ordersReach } from "./orders.js";
import type {
  DamageCellState,
  PoolLever,
  StackBuffPool,
  StackMember,
  StackResult,
  SelectedWeaponResult,
  StackSpec,
  UnitLoadoutResult,
} from "./model.js";

/** Buffs that depend on the loadout scored; `key` names what else they depend on, for caching. */
export interface LoadoutBuffs {
  key: string;
  at(counts: ReadonlyMap<string, number>): Buff[];
}

export interface DamageScoringInvariants {
  loadoutLegality: Map<string, CandidateLoadoutLegality>;
}

interface StackEligibilityInput extends EligibilityInput {
  weaponProfiles: [];
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

export class DamageScoringSession {
  readonly supportUnits: UnitView[];
  /** The faction's unit ids, each a possible nearby Officer for an Orders lever. */
  readonly orderIssuerCandidates: readonly string[];
  readonly defensiveBuffs: Buff[];
  readonly defensiveWarnings: StackBuffPool["warnings"];
  readonly scoreCache: DamageCellCache<ProfileDamage | null>;
  readonly loadoutCache: DamageCellCache<UnitLoadoutResult>;
  readonly poolCache: DamageCellCache<StackBuffPool>;
  readonly stackCache: DamageCellCache<StackResult>;
  crunchCount = 0;
  stackEvaluations = 0;
  illegalLoadoutsRejected = 0;
  /** Profiles no candidate of this cell could score (they score nothing), by unit, weapon and profile. */
  readonly unscoreable = new Map<string, UnscoreableProfile & { unitId: string }>();
  private readonly scaffoldCache = new Map<string, LoadoutScaffold>();
  private readonly grantCache = new Map<string, WeaponGrants>();
  private readonly loadoutLegalityCache: Map<string, CandidateLoadoutLegality>;
  private readonly wargearRuleCache = new Map<string, WargearRules>();
  private readonly suppressedCache = new Map<string, ReadonlySet<string>>();
  private readonly loadoutLeverCache = new Map<string, StackableBuff[] | null>();

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
    this.orderIssuerCandidates = factionUnits.map((unit) => unit.id).sort();
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
    // The target's printed rules for wargear it does not carry do not apply.
    const defensive = dataset.defensiveBuffsFor({ unitId: state.target.unitRaw.id, factionId: state.target.unitRaw.faction_id }, targetContext);
    this.defensiveBuffs = targetContext.targetWargear
      ? equippedBuffs(state.target.unitRaw, new Map(Object.entries(targetContext.targetWargear)), defensive)
      : defensive;
    this.defensiveWarnings = this.translationWarnings(
      { unitId: state.target.unitRaw.id, factionId: state.target.unitRaw.faction_id },
      targetContext,
      "target",
    );
  }

  /**
   * The unit's loadout space at its full model count. Under MFM rules its legal loadouts are listed
   * up front, and a dump default its own rules refuse is replaced by the first legal loadout so the
   * search starts legal; per-five sensitivity reads authored options and applies only without them.
   */
  private scaffold(unit: UnitView): LoadoutScaffold {
    const cached = this.scaffoldCache.get(unit.id);
    if (cached) return cached;
    const composition = this.dataset.unitCompositionOf(unit.raw) as ({ models?: LoadoutModel[] } & Partial<MfmComposition>) | undefined;
    const models = composition?.models ?? [];
    const modelCount = fullModelCount(this.dataset, unit.raw);
    const view = this.dataset.loadoutOf(unit.raw);
    let scaffold: LoadoutScaffold;
    if (view.source === "mfm") {
      const mfm = mfmLoadouts(composition as MfmComposition, modelCount);
      const stock = view.base(modelCount) ?? new Map<string, number>();
      const base = mfm.byKey.has(countsKey(stock)) || mfm.loadouts.length === 0 ? stock : new Map(mfm.loadouts[0].counts);
      const carriable = new Set<string>();
      for (const { counts } of mfm.loadouts) for (const id of counts.keys()) carriable.add(id);
      scaffold = { models, modelCount, options: [], caps: [], base, carriable: [...carriable].sort(), mfm };
    } else {
      const authored = this.dataset.wargearOptionsOf(unit.raw);
      const options = this.config.perFiveSensitivity
        ? authored.map((option) => option.replaces && (option.model_constraint as { any_number?: boolean } | undefined)?.any_number
          ? { ...option, model_constraint: { ...option.model_constraint, any_number: undefined, per_n_models: 5 } }
          : option)
        : authored;
      const base = unitLoadout(unit.raw, composition, options).base(modelCount) ?? new Map<string, number>();
      scaffold = {
        models,
        modelCount,
        options,
        caps: options.map((option) => optionCap(option, modelCount, models)),
        base,
        carriable: [...new Set([...base.keys(), ...options.flatMap((option) => [...(option.replacement ?? []), ...(option.replacement_choice ?? []).flat()])])].sort(),
      };
    }
    this.scaffoldCache.set(unit.id, scaffold);
    return scaffold;
  }

  private loadoutLegality(unit: UnitView, scaffold: LoadoutScaffold, counts: ReadonlyMap<string, number>) {
    const key = `${unit.raw.faction_id}|${unit.id}|per-five:${this.config.perFiveSensitivity}|${countsKey(counts)}`;
    const cached = this.loadoutLegalityCache.get(key);
    if (cached) return cached;
    const listed = scaffold.mfm?.byKey.get(countsKey(counts));
    const legality = listed !== undefined
      ? { legal: true, violations: [], groups: scaffold.mfm!.loadouts[listed].groups }
      : validateCandidateLoadout({
        unit: unit.raw,
        modelCount: scaffold.modelCount,
        counts,
        loadout: scaffold.mfm ? this.dataset.loadoutOf(unit.raw) : unitLoadout(unit.raw, this.dataset.unitCompositionOf(unit.raw), scaffold.options),
      });
    this.loadoutLegalityCache.set(key, legality);
    return legality;
  }

  /**
   * The equipment counts of the attached unit `spec` forms: `counts` for `member`, each other
   * member's `chosen` loadout, else its out-of-the-box one. An attached unit is one unit for all
   * rules purposes (core rule 19.01), so its `unit-wargear` conditions read these.
   */
  private stackCounts(spec: StackSpec, chosen?: MemberLoadouts, member?: StackMember, counts?: ReadonlyMap<string, number>): Map<string, number> {
    const sum = new Map<string, number>();
    for (const candidate of spec.members) {
      const own = candidate === member && counts ? counts : chosen?.get(candidate.unit.id) ?? this.scaffold(candidate.unit).base;
      for (const [id, count] of own) sum.set(id, (sum.get(id) ?? 0) + count);
    }
    return sum;
  }

  /** What any member can carry, at the stack's model count: the loadouts a stack's `unit-wargear` conditions range over. */
  private stackScaffold(spec: StackSpec): Pick<LoadoutScaffold, "carriable" | "modelCount"> {
    const scaffolds = spec.members.map((member) => this.scaffold(member.unit));
    return {
      carriable: [...new Set(scaffolds.flatMap((scaffold) => scaffold.carriable))].sort(),
      modelCount: scaffolds.reduce((sum, scaffold) => sum + scaffold.modelCount, 0),
    };
  }

  /**
   * `context` with the wargear of the attached unit `spec` forms, its members' `chosen` loadouts
   * (else their out-of-the-box ones): what its `unit-wargear` conditions read (core rule 19.01).
   * The weapons a member's wargear grants its bearers read that member's loadout; see {@link weaponGrants}.
   */
  stackContext(spec: StackSpec, context: EngineContext, chosen?: MemberLoadouts): EngineContext {
    return {
      ...context,
      attackerWargear: combinedWargear(spec.members.map((member) =>
        loadoutWargear(this.dataset, member.unit.raw, chosen?.get(member.unit.id) ?? this.scaffold(member.unit).base))),
    };
  }

  /** `context` with the wargear `counts` carry: one member's own loadout, which its weapon grants read. */
  loadoutContext(unit: UnitView, counts: ReadonlyMap<string, number>, context: EngineContext): EngineContext {
    return wargearContext(this.dataset, unit.raw, counts, context);
  }

  /** The weapons the wargear in `counts` equips, under `context` with that loadout. */
  weaponGrants(unit: UnitView, counts: ReadonlyMap<string, number>, context: EngineContext): WeaponGrants {
    const loadout = this.loadoutContext(unit, counts, context);
    const key = `${unit.id}|${JSON.stringify(loadout)}`;
    const cached = this.grantCache.get(key);
    if (cached) return cached;
    const grants = unitWeaponGrants(this.dataset, unit.raw, this.state.factionId, loadout);
    this.grantCache.set(key, grants);
    return grants;
  }

  /**
   * Scores one loadout. Its wargear decides which granted weapons it fires and drops the unit's
   * printed rules for items it leaves out; the profiles crunch under `context`, as the buffs were
   * translated without a loadout.
   */
  private scoreCounts(unit: UnitView, counts: ReadonlyMap<string, number>, allBuffs: Buff[], context: EngineContext): UnitLoadoutResult {
    const buffs = equippedBuffs(unit.raw, counts, allBuffs);
    const scaffold = this.scaffold(unit);
    const target = { unit: this.state.target.unitRaw, modelCount: this.state.target.modelCount };
    const scoreProfileForBuffs = (profileBuffs: readonly Buff[]) => {
      const crunchProfile = crunchProfileScorer(
        this.dataset,
        target,
        profileBuffs,
        (profile) => this.unscoreable.set(`${unit.id}|${profile.weapon.id}|${profile.profileIndex}`, { ...profile, unitId: unit.id }),
      );
      return (request: Parameters<typeof crunchProfile>[0]) => {
        const key = `${unit.id}|${request.weapon.id}|${request.profileIndex}|${request.modelsFiring}|${buffKey(profileBuffs)}|${request.hitModifier ?? 0}|${JSON.stringify(request.context)}`;
        const cached = this.scoreCache.get(key);
        if (cached !== undefined) return cached;
        this.crunchCount += 1;
        const value = crunchProfile(request);
        this.scoreCache.set(key, value);
        return value;
      };
    };
    const scored = unitLoadoutDamage({
      dataset: this.dataset,
      unit: unit.raw,
      modelCount: scaffold.modelCount,
      counts,
      target,
      buffs,
      context,
      groups: this.loadoutLegality(unit, scaffold, counts).groups,
      grants: this.weaponGrants(unit, counts, context).grants,
      scoreProfile: scoreProfileForBuffs(buffs),
      scoreProfileForBuffs,
    });
    return {
      counts: new Map(counts),
      modelCount: scaffold.modelCount,
      total: scored.total,
      selectedWeapons: scored.selected,
      pistolChoice: scored.pistolChoice,
      legalityErrors: scored.modelScopedWargearUnresolved?.map(
        (wargearId) => `cannot score model-scoped rule from ${wargearId} without per-model loadout groups`,
      ) ?? [],
    };
  }

  /**
   * The unit's wargear choices under `buffs`, for {@link searchLoadout} and the exhaustive oracle.
   * With `perLoadout`, each loadout is scored with the buffs it gives instead.
   */
  loadoutSpace(unit: UnitView, buffs: Buff[], context: EngineContext, perLoadout?: LoadoutBuffs): LoadoutSpace<UnitLoadoutResult> {
    const scaffold = this.scaffold(unit);
    return {
      scaffold,
      legal: (counts) => this.loadoutLegality(unit, scaffold, counts).legal,
      score: (counts) => this.scoreCounts(unit, counts, perLoadout ? perLoadout.at(counts) : buffs, context),
    };
  }

  bestLoadout(unit: UnitView, buffs: Buff[], context: EngineContext, perLoadout?: LoadoutBuffs): UnitLoadoutResult {
    const cacheKey = `${unit.id}|${buffKey(buffs)}|${JSON.stringify(context)}|${perLoadout?.key ?? ""}`;
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
    const best = searchLoadout(this.loadoutSpace(unit, buffs, context, perLoadout), () => { this.illegalLoadoutsRejected += 1; });
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
    scoredGrants: ReadonlySet<string> = new Set(),
    replaced: ReadonlySet<string> = new Set(),
  ): StackBuffPool["warnings"] {
    return translationWarnings(this.dataset, this.config, input, context, perspective, scoredGrants, replaced);
  }

  /**
   * The army rules the spec's Combat Patrol detachments replace. Each detachment is resolved on
   * its own, so a rule one detachment's patrol rule replaces is dropped from every detachment's pass.
   */
  replacedArmyRules(spec: StackSpec): Set<string> {
    return replacedArmyRuleIds(this.dataset, spec.factionId, spec.detachmentIds);
  }

  private poolKey(spec: StackSpec): string {
    return `${spec.members.map((member) => `${member.unit.id}:${member.role}`).join("+")}|${spec.detachmentIds.join("+")}`;
  }

  /** Each detachment resolves on its own; a spec without one resolves once. */
  private detachmentPasses(spec: StackSpec): (string | undefined)[] {
    return spec.detachmentIds.length > 0 ? spec.detachmentIds : [undefined];
  }

  /** The package's broad resolver result narrowed by stack damage's known target identities. */
  private stackableBuffsFor(input: StackEligibilityInput, context: EngineContext) {
    const broad = this.dataset.eligibleAbilities(input, context.phase);
    const eligible = filterStackEligibleAbilities(this.dataset, input, broad);
    const selection = this.dataset.stackableBuffsFor(input, context);
    const ids = [input.unitId, ...(input.attachedUnitIds ?? [])];
    const units = unitLookup(this.dataset, input.factionId);
    const present = new Set([...ids, ...this.orderIssuerCandidates]);
    const receiver = combinedKeywords(ids, units, input.detachmentId);
    const possible = selection.buffs.filter((lever) => activationPossible(lever.requires, ids, units) && this.ordersReachable(lever, present, receiver));
    return { ...selection, ...filterStackableStratagems(possible, selection.groups, broad, eligible) };
  }

  /**
   * Whether an army rule that issues Orders reaches this unit: an Officer among the stack's
   * members or the faction's units (assumed nearby, as support units are) whose Orders may
   * target it (`ordersReach`). Other levers pass.
   */
  private ordersReachable(lever: StackableBuff, present: ReadonlySet<string>, receiver: ReadonlySet<string>): boolean {
    if (lever.source.kind !== "ability" || lever.source.abilityKind !== "army") return true;
    if (!issuesOrders(this.dataset, lever.source.abilityId)) return true;
    return ordersReach(this.dataset, lever.source.abilityId, present, receiver);
  }

  /**
   * `levers` without dropped army rules, those another detachment's Combat Patrol rule replaces,
   * and those a standing rule in any detachment pass suppresses (`suppressed`).
   */
  private keptLevers(levers: readonly StackableBuff[], replaced: ReadonlySet<string>, suppressed: ReadonlySet<string>): StackableBuff[] {
    return levers.filter((lever) => lever.source.kind !== "ability" || (!this.config.droppedArmyRules.includes(lever.source.abilityId) &&
      !(lever.source.abilityKind === "army" && replaced.has(lever.source.abilityId)) && !suppressed.has(lever.source.abilityId)));
  }

  /** The abilities any detachment pass's standing rules suppress for `member`. */
  private suppressedFor(spec: StackSpec, member: StackMember, phase: EngineContext["phase"]): Set<string> {
    const out = new Set<string>();
    for (const detachmentId of this.detachmentPasses(spec)) {
      const input = this.eligibilityInput(spec, member, detachmentId);
      const key = `${phase}|${JSON.stringify(input)}`;
      let ids = this.suppressedCache.get(key);
      if (!ids) this.suppressedCache.set(key, (ids = suppressedAbilities(this.dataset, input, phase)));
      for (const id of ids) out.add(id);
    }
    return out;
  }

  pool(spec: StackSpec): StackBuffPool {
    const key = this.poolKey(spec);
    const cached = this.poolCache.get(key);
    if (cached) return cached;
    const levers = new Map<string, PoolLever>();
    const groups = new Map<string, StackableBuffGroup>();
    const warnings: StackBuffPool["warnings"] = [];
    const replaced = this.replacedArmyRules(spec);
    for (const member of spec.members) {
      const context = this.state.contextFor(spec, member);
      const suppressed = this.suppressedFor(spec, member, context.phase);
      for (const detachmentId of this.detachmentPasses(spec)) {
        const input = this.eligibilityInput(spec, member, detachmentId);
        const selection = this.stackableBuffsFor(input, context);
        for (const group of selection.groups) if (!groups.has(group.id)) groups.set(group.id, group);
        for (const lever of this.keptLevers(selection.buffs, replaced, suppressed)) {
          const current = levers.get(lever.id) ?? { ...lever, perMember: new Map<string, Buff[]>() };
          current.perMember.set(member.unit.id, lever.buffs);
          levers.set(lever.id, current);
        }
        warnings.push(...this.translationWarnings(input, context, "attacker", undefined, replaced));
      }
    }
    const uniqueWarnings = [...new Map(warnings.map((warning) => [JSON.stringify(warning), warning])).values()];
    const value = { levers: [...levers.values()], groups: [...groups.values()], warnings: uniqueWarnings };
    this.poolCache.set(key, value);
    return value;
  }

  /** A member's eligible rules that read `unit-wargear`, and whether its levers depend on the stack's loadouts. */
  private wargearRulesOf(spec: StackSpec, member: StackMember): WargearRules {
    const key = `${this.poolKey(spec)}|${member.unit.id}`;
    let rules = this.wargearRuleCache.get(key);
    if (!rules) {
      const context = this.state.contextFor(spec, member);
      const eligible = this.detachmentPasses(spec).flatMap((detachmentId) => {
        const input = this.eligibilityInput(spec, member, detachmentId);
        return filterStackEligibleAbilities(this.dataset, input, this.dataset.eligibleAbilities(input, context.phase));
      });
      rules = wargearRules(eligible, context, this.stackScaffold(spec));
      this.wargearRuleCache.set(key, rules);
    }
    return rules;
  }

  /**
   * A member's levers translated under the stack's wargear with its loadout `counts` (and the
   * others' `chosen` ones), or null when that wargear changes nothing its wargear-reading rules
   * give. A later detachment's copy of a lever wins, as in {@link pool}.
   */
  private loadoutLevers(spec: StackSpec, member: StackMember, counts: ReadonlyMap<string, number>, chosen?: MemberLoadouts): StackableBuff[] | null {
    const rules = this.wargearRulesOf(spec, member);
    if (!rules.loadoutDependent) return null;
    const wargear = namedLoadoutWargear(this.stackCounts(spec, chosen, member, counts), rules.wargearIds);
    const key = `${this.poolKey(spec)}|${member.unit.id}|${JSON.stringify(wargear)}`;
    const cached = this.loadoutLeverCache.get(key);
    if (cached !== undefined) return cached;
    const context = { ...this.state.contextFor(spec, member), attackerWargear: wargear };
    let value: StackableBuff[] | null = null;
    if (wargearTranslation(rules.entries, context) !== rules.unloaded) {
      const replaced = this.replacedArmyRules(spec);
      const suppressed = this.suppressedFor(spec, member, context.phase);
      const levers = new Map<string, StackableBuff>();
      for (const detachmentId of this.detachmentPasses(spec)) {
        for (const lever of this.keptLevers(this.stackableBuffsFor(this.eligibilityInput(spec, member, detachmentId), context).buffs, replaced, suppressed)) levers.set(lever.id, lever);
      }
      value = [...levers.values()];
    }
    this.loadoutLeverCache.set(key, value);
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
    return isLegalStackLevers(this.dataset, spec, this.pool(spec), selectedIds, (byBearer) => this.localMembersForLegality(spec, byBearer));
  }

  scoreStack(spec: StackSpec): StackResult {
    const key = `${spec.members.map((member) => member.unit.id).join("+")}|${spec.detachmentIds.join("+")}|${[...spec.selectedLeverIds].sort().join("+")}`;
    const cached = this.stackCache.get(key);
    if (cached) return cached;
    this.stackEvaluations += 1;
    const members = settleMemberLoadouts(spec.members, (member, chosen) =>
      this.bestLoadout(member.unit, this.memberBuffs(spec, member, undefined, chosen), this.state.contextFor(spec, member), this.perLoadoutBuffs(spec, member, chosen)));
    const result = { spec, total: members.reduce((sum, member) => sum + member.loadout.total, 0), members };
    this.stackCache.set(key, result);
    return result;
  }

  /** How a member's buffs follow its loadout, when its rules read `unit-wargear`; `chosen` as in {@link memberBuffs}. */
  perLoadoutBuffs(spec: StackSpec, member: StackMember, chosen?: MemberLoadouts): LoadoutBuffs | undefined {
    const rules = this.wargearRulesOf(spec, member);
    if (!rules.loadoutDependent) return undefined;
    // The others' share of the stack's wargear, which the member's rules read with its own.
    const others = namedLoadoutWargear(this.stackCounts(spec, chosen, member, new Map()), rules.wargearIds);
    const key = `${this.poolKey(spec)}|${[...spec.selectedLeverIds].sort().join("+")}${othersUnequippedKey(spec, member, chosen)}|${JSON.stringify(others)}`;
    return { key, at: (counts) => this.memberBuffs(spec, member, counts, chosen) };
  }

  /**
   * The buffs a member attacks with under the spec's selected levers, with the target's defensive
   * buffs. Its loadout drops its printed rules for items it leaves out (the others' `chosen` ones
   * theirs) and, with the others' `chosen` loadouts, translates the levers of a member whose rules
   * read `unit-wargear`.
   */
  memberBuffs(spec: StackSpec, member: StackMember, counts?: ReadonlyMap<string, number>, chosen?: MemberLoadouts): Buff[] {
    const selected = new Set(spec.selectedLeverIds);
    const pool = this.pool(spec);
    const translated = counts ? this.loadoutLevers(spec, member, counts, chosen) : null;
    const levers = translated
      ? loadoutLeverBuffs(translated, new Set(pool.levers.map((lever) => lever.id)), selected)
      : pool.levers.filter((lever) => selected.has(lever.id)).flatMap((lever) => lever.perMember.get(member.unit.id) ?? []);
    const buffs = othersEquippedBuffs(spec, member, chosen, [...levers, ...this.defensiveBuffs]);
    return counts ? equippedBuffs(member.unit.raw, counts, buffs) : buffs;
  }

  /** Leave-one-out attribution of one of a member's selected profiles in a scored stack with `counts` and the members' `chosen` loadouts. */
  attributeWeapon(spec: StackSpec, member: StackMember, weapon: SelectedWeaponResult, counts: ReadonlyMap<string, number>, chosen?: MemberLoadouts): DamageAttribution | null {
    // The loadout spends re-roll-one permissions on one row; the others score without them.
    const buffs = profileApplicableBuffs(
      this.memberBuffs(spec, member, counts, chosen),
      weapon,
    ).filter((buff) => buff.contribution.type !== "reroll-one" || weapon.rerollOne === true);
    return attributeSelectedProfile({
      dataset: this.dataset,
      unit: member.unit.raw,
      selected: weapon,
      target: { unit: this.state.target.unitRaw, modelCount: this.state.target.modelCount },
      buffs,
      context: this.state.contextFor(spec, member),
    });
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

  /**
   * The winning stack's unsupported fragments, translated against the stack's wargear under the
   * members' chosen loadouts. Weapon grants a member's loadout scored, and rules printed by wargear
   * it leaves out, are left out.
   */
  relevantWarnings(result: StackResult): StackBuffPool["warnings"] {
    const pool = this.pool(result.spec);
    const selectedLevers = pool.levers.filter((lever) => result.spec.selectedLeverIds.includes(lever.id));
    const selectedAbilityIds = new Set(
      selectedLevers.flatMap((lever) => lever.source.kind === "ability" ? [lever.source.abilityId] : []),
    );
    const contexts = new Map<string, EngineContext>();
    const translated: StackBuffPool["warnings"] = [];
    const chosen: MemberLoadouts = new Map(result.members.map(({ member, loadout }) => [member.unit.id, loadout.counts]));
    for (const { member, loadout } of result.members) {
      const base = this.state.contextFor(result.spec, member);
      const context = this.stackContext(result.spec, base, chosen);
      contexts.set(member.unit.id, context);
      const grants = this.weaponGrants(member.unit, loadout.counts, base);
      const scored = new Set([...grants.grants, ...grants.duplicates].map((grant) => `${grant.abilityId}|${grant.weaponId}`));
      // A rule printed by wargear the loadout leaves out does not apply.
      const unequipped = unequippedRules(member.unit.raw, loadout.counts);
      for (const detachmentId of result.spec.detachmentIds.length > 0 ? result.spec.detachmentIds : [undefined]) {
        translated.push(...this.translationWarnings(this.eligibilityInput(result.spec, member, detachmentId), context, "attacker", scored, this.replacedArmyRules(result.spec))
          .filter((warning) => warning.sourceKind !== "unit" || !unequipped.has(warning.sourceAbilityId)));
      }
    }
    const warnings = translated.filter((warning) => warning.sourceKind !== "support" || selectedAbilityIds.has(warning.sourceAbilityId));
    for (const lever of selectedLevers) {
      if (lever.source.kind !== "ability") continue;
      const ability = this.dataset.abilities.getInFaction(lever.source.abilityId, result.spec.factionId)
        ?? this.dataset.abilities.getAny(lever.source.abilityId);
      if (!ability) continue;
      for (const member of result.spec.members) {
        const translation = ability.describeBuffs(lever.source, contexts.get(member.unit.id) ?? this.state.contextFor(result.spec, member), "attacker");
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

  /** The selected levers, with the levers each member's winning loadout alone surfaces, less those its loadouts leave inert. */
  selectedPoolLevers(result: StackResult): PoolLever[] {
    const pool = this.pool(result.spec);
    const levers = pool.levers.filter((lever) => result.spec.selectedLeverIds.includes(lever.id));
    const poolIds = new Set(pool.levers.map((lever) => lever.id));
    const chosen: MemberLoadouts = new Map(result.members.map(({ member, loadout }) => [member.unit.id, loadout.counts]));
    for (const { member, loadout } of result.members) {
      for (const lever of (this.loadoutLevers(result.spec, member, loadout.counts, chosen) ?? []).filter((candidate) => surfacedByLoadout(candidate, poolIds))) {
        const current = levers.find((candidate) => candidate.id === lever.id) ?? levers[levers.push({ ...lever, perMember: new Map() }) - 1];
        current.perMember.set(member.unit.id, lever.buffs);
      }
    }
    return equippedLevers(levers, result.spec, chosen);
  }

  keywordsFor(spec: StackSpec): string[] {
    return memberKeywords(spec.members);
  }
}
