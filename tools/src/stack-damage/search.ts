import type { Dataset } from "../data/dataset.js";
import type { Detachment, Unit } from "../generated.js";
import type { EngineContext } from "../cruncher/index.js";
import type { ResolvedTarget, ComparePhase } from "../compare.js";
import { assessDetachmentSelection, type LegalityIssue } from "./legality.js";
import type { MatrixConfig, Scenario } from "./config.js";
import { fullModelCount, preferFactionCopies, type FactionContext, unitInFaction } from "./factions.js";
import { DamageScoringSession, type DamageScoringInvariants } from "./scoring.js";
import { isCombatPatrolDetachment } from "../abilities-resolver/resolver.js";
import { buildLedger, unscoreableEntries } from "./ledger.js";
import { baseWargear } from "./weapon-grants.js";
import type { DamageCellState, StackMember, StackResult, StackSpec } from "./model.js";
import { damageCellKey, type DamageCellReport } from "./report.js";
import { winnerReport } from "./winner-report.js";
import { choiceVariants, ownKeywords } from "./keyword-choices.js";

export { addOrderIssuers } from "./winner-report.js";

interface SearchCounts {
  bodyguards: number;
  memberStacks: number;
  broadResults: number;
  deepFinalists: number;
}

export function emptySpec(factionId: string, members: StackMember[], detachmentIds: string[] = []): StackSpec {
  return { factionId, members, detachmentIds, selectedLeverIds: [], detachmentIssues: [] };
}

function unitKeywords(members: readonly StackMember[]): string[] {
  const values = new Set<string>();
  for (const member of members) {
    for (const keyword of ownKeywords(member)) values.add(keyword.toLowerCase());
  }
  return [...values].sort();
}

/** Lower-cased keywords every one of the members carries. */
function sharedKeywords(members: readonly StackMember[]): string[] {
  const [first, ...rest] = members.map((member) => new Set(unitKeywords([member])));
  return first ? [...first].filter((keyword) => rest.every((keywords) => keywords.has(keyword))).sort() : [];
}

/** A unit's per-model Wounds when every model is unhurt, from its first profile. */
function freshWounds(unit: Unit): { remaining: number; starting: number } | undefined {
  const wounds = unit.profiles?.[0]?.W;
  return typeof wounds === "number" ? { remaining: wounds, starting: wounds } : undefined;
}

/** The attacking unit's Toughness: its Bodyguard's when it has one, as for an attack against it, else its highest model's. */
function attackerToughness(spec: StackSpec): { attackerToughness?: number } {
  const bodyguard = spec.members.filter((member) => member.role === "bodyguard");
  const toughness = (bodyguard.length > 0 ? bodyguard : spec.members)
    .flatMap((member) => (member.unit.raw.profiles ?? []).map((profile) => profile.T)).filter((t) => typeof t === "number");
  return toughness.length > 0 ? { attackerToughness: Math.max(...toughness) } : {};
}

/** The battle round a cell assumes when the scenario names none: inside both Kauyon's (3–5) and Mont'ka's (1–3) windows. */
export const DEFAULT_BATTLE_ROUND = 3;

/**
 * The designations the faction's own rules put on enemy units with a `designate` effect (Afflicted
 * from Nurgle's Gift's aura): on enemies an aura reaches, on an enemy filter, or on the defender. A
 * designation a Stratagem or another lever chooses (`designate-target`) is the search's to price,
 * not an assumption.
 */
export function enemyDesignations(dataset: Dataset, lineage: readonly string[]): string[] {
  const tags = new Set<string>();
  const visit = (node: unknown, onEnemies: boolean): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, onEnemies);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const modifier = typeof record.modifier === "object" && record.modifier !== null ? record.modifier as Record<string, unknown> : undefined;
    const eligible = typeof modifier?.eligible === "object" && modifier.eligible !== null ? modifier.eligible as Record<string, unknown> : undefined;
    const enemies = onEnemies || (record.type === "aura" && eligible?.owner === "enemy");
    if (record.type === "designate" && modifier && typeof modifier.tag === "string" && modifier.clear !== true) {
      const target = record.target;
      const enemyTarget = target === "defender" ||
        (typeof target === "object" && target !== null && (target as Record<string, unknown>).owner === "enemy") ||
        (target === "recipient" && enemies);
      if (enemyTarget) tags.add(modifier.tag.toLowerCase());
    }
    for (const value of Object.values(record)) visit(value, enemies);
  };
  for (const factionId of lineage) for (const ability of dataset.abilities.byFaction(factionId)) visit(ability.raw.effect, false);
  return [...tags].sort();
}

/**
 * The board and game state a cell assumes where the scenario is silent: battle round
 * {@link DEFAULT_BATTLE_ROUND}, the target in its own deployment zone and territory, and the target
 * carrying exactly the designations the faction's own rules apply ({@link enemyDesignations}), when
 * they apply any. Each declared list is complete, so a rule wanting another region or designation
 * does not apply.
 */
export function defaultScenario(dataset: Dataset, lineage: readonly string[]): Scenario {
  const designations = enemyDesignations(dataset, lineage);
  return {
    battleRound: DEFAULT_BATTLE_ROUND,
    targetRegions: [{ territory: "target", deploymentZone: "target" }],
    // A faction whose rules apply none leaves designations undecided, so its designation-gated
    // rules stay listed as unsupported rather than read as absent.
    ...(designations.length > 0 ? { targetDesignations: designations } : {}),
  };
}

/** The scenario a cell runs under: the matrix's declared facts over {@link defaultScenario}. */
export function cellScenario(dataset: Dataset, faction: FactionContext, config: MatrixConfig): Scenario {
  return { ...defaultScenario(dataset, faction.lineage), ...config.scenario };
}

/**
 * The engine context of one stack member in a cell. The crunch fires every model at a full-strength
 * target it can see, in the attacker's own turn, so those facts are stated (Indirect Fire's
 * penalties for an unseen target are never applied); the scenario declares the rest.
 */
function contextForCell(dataset: Dataset, factionId: string, target: ResolvedTarget, phase: ComparePhase, scenario: Scenario, targetWargear: Record<string, number>, modelCounts: ReadonlyMap<string, number> = new Map()) {
  const targetKeywords = [...(target.unitRaw.keywords ?? []), ...(target.unitRaw.faction_keywords ?? [])].map((keyword) => keyword.toLowerCase());
  const targetWounds = freshWounds(target.unitRaw);
  return (spec: StackSpec, member?: StackMember): EngineContext => ({
    attackerTurn: true,
    targetVisible: true,
    attackerStrength: "full",
    targetStrength: "full",
    ...(targetWounds ? { targetWounds } : {}),
    ...(member && freshWounds(member.unit.raw) ? { attackerWounds: freshWounds(member.unit.raw) } : {}),
    ...attackerToughness(spec),
    ...scenario,
    phase,
    attackerStationary: phase === "shooting",
    attackerCharged: phase === "fight",
    withinHalfRange: true,
    distanceInches: 1,
    armyFaction: factionId,
    attackerAttached: spec.members.length > 1,
    // Every member at full strength, as the crunch fires them.
    ...(spec.members.length > 0 ? { attackerModelCount: spec.members.reduce((sum, candidate) => sum + (modelCounts.get(candidate.unit.id) ?? fullModelCount(dataset, candidate.unit.raw)), 0) } : {}),
    attackerKeywords: unitKeywords(spec.members),
    // The member's own models make its attacks; without a member, only keywords every member shares.
    attackerModelKeywords: member ? unitKeywords([member]) : sharedKeywords(spec.members),
    // A member's models carry only its own keywords, not the other members' (core rule 19.01).
    ...(member ? { attackerMemberKeywords: unitKeywords([member]) } : {}),
    attackerUnitId: member?.unit.id,
    attackerAttachmentRole: member ? (member.role === "bodyguard" ? "bodyguard" as const : "leader" as const) : undefined,
    attackerMembers: spec.members.map((candidate) => ({ unitId: candidate.unit.id, role: candidate.role, keywords: unitKeywords([candidate]) })),
    attachmentRoles: Object.fromEntries(spec.members.map((candidate) => [candidate.unit.id, candidate.role === "bodyguard" ? "bodyguard" : "leader"] as const)),
    targetKeywords,
    targetModelKeywords: targetKeywords,
    targetUnitId: target.unitRaw.id,
    targetModelCount: target.modelCount,
    targetWargear,
    targetAttached: false,
  });
}

function detachmentsForFaction(dataset: Dataset, faction: FactionContext): Detachment[] {
  return preferFactionCopies(faction.lineage.flatMap((id) => dataset.detachments.byFaction(id)), faction.lineage)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** The game modes a detachment is legal in; an absent `game_modes` means matched play only. */
function gameModes(detachment: Detachment): readonly string[] {
  return detachment.game_modes ?? ["matched-play"];
}

/**
 * True when `next` can join `selected` in one army: every detachment shares a game mode, and a
 * Combat Patrol detachment is the army's only detachment (an army is one patrol).
 */
export function combinableDetachments(selected: readonly Detachment[], next: Detachment): boolean {
  if (selected.length === 0) return true;
  if (isCombatPatrolDetachment(next) || selected.some(isCombatPatrolDetachment)) return false;
  return gameModes(next).some((mode) => selected.every((detachment) => gameModes(detachment).includes(mode)));
}

export function detachmentCombos(detachments: readonly Detachment[], config: Pick<MatrixConfig, "maxDetachments" | "dpBudget">): Detachment[][] {
  const output: Detachment[][] = [[]];
  const walk = (start: number, selected: Detachment[], points: number): void => {
    if (selected.length >= config.maxDetachments) return;
    for (let index = start; index < detachments.length; index++) {
      const nextPoints = points + (detachments[index].detachment_points ?? 0);
      if (nextPoints > config.dpBudget) continue;
      if (!combinableDetachments(selected, detachments[index])) continue;
      selected.push(detachments[index]);
      output.push([...selected]);
      walk(index + 1, selected, nextPoints);
      selected.pop();
    }
  };
  walk(0, [], 0);
  return output;
}

function attachableMembers(dataset: Dataset, faction: FactionContext, bodyguard: StackMember["unit"]): { leaders: StackMember["unit"][]; supports: StackMember["unit"][] } {
  const candidates = dataset.leadersAttachableTo(bodyguard.id)
    .flatMap((candidate) => {
      const resolved = unitInFaction(faction, candidate.id);
      return resolved && resolved.id !== bodyguard.id ? [resolved] : [];
    });
  return {
    leaders: candidates.filter((candidate) => candidate.raw.attachment_role === "leader"),
    supports: candidates.filter((candidate) => candidate.raw.attachment_role === "support"),
  };
}

function memberChoices(
  dataset: Dataset,
  faction: FactionContext,
  bodyguard: StackMember["unit"],
  session: DamageScoringSession,
  config: MatrixConfig,
): StackMember[][] {
  const attached = attachableMembers(dataset, faction, bodyguard);
  const host: StackMember = { unit: bodyguard, role: "bodyguard" };
  const choose = (units: StackMember["unit"][], role: "leader" | "support") => {
    if (!Number.isFinite(config.attachmentLimit)) return units;
    const baseline = session.optimiseLevers(emptySpec(faction.id, [host])).total;
    return units.map((unit) => ({
      unit,
      gain: session.optimiseLevers(emptySpec(faction.id, [host, { unit, role }])).total - baseline,
    })).sort((left, right) => right.gain - left.gain || left.unit.id.localeCompare(right.unit.id))
      .slice(0, config.attachmentLimit)
      .map((entry) => entry.unit);
  };
  const leaders = [null, ...choose(attached.leaders, "leader")];
  const supports = [null, ...choose(attached.supports, "support")];
  const output: StackMember[][] = [];
  for (const leader of leaders) {
    for (const support of supports) {
      if (leader && support && leader.id === support.id) continue;
      const members: StackMember[] = [host];
      if (leader) members.push({ unit: leader, role: "leader" });
      if (support) members.push({ unit: support, role: "support" });
      output.push(members);
    }
  }
  return output;
}

export function legalDetachmentSpec(
  session: DamageScoringSession,
  factionId: string,
  members: StackMember[],
  detachments: readonly Detachment[],
): StackSpec | null {
  const spec = emptySpec(factionId, members, detachments.map((detachment) => detachment.id));
  const issues: LegalityIssue[] = [];
  for (const detachment of detachments) {
    const assessment = assessDetachmentSelection({
      dataset: session.dataset,
      factionId,
      detachment,
      selectedDetachmentIds: spec.detachmentIds,
      members: session.localMembersForLegality(spec),
    });
    if (assessment.status === "illegal") return null;
    if (assessment.status === "unsupported") issues.push(...assessment.issues);
  }
  return { ...spec, detachmentIssues: issues };
}

/**
 * The members' best result over `combinations`; ties keep the fewer detachment points, then the
 * earlier combination. A detachment that is legal alone and scores no higher alone than no
 * detachment is idle: combinations with it are skipped, as it adds nothing to them but points.
 */
export function deepOptimise(
  session: DamageScoringSession,
  factionId: string,
  members: StackMember[],
  combinations: readonly Detachment[][],
): StackResult {
  // Each way the members can take their keyword-choice options (a Mark of Chaos) in the spec's
  // detachments is priced, and the best kept; ties keep the earlier variant.
  const optimise = (spec: StackSpec): StackResult => {
    let top: StackResult | undefined;
    for (const variant of choiceVariants(session.dataset, spec.members, spec.detachmentIds)) {
      const result = session.optimiseLevers({ ...spec, members: variant });
      if (!top || result.total > top.total + 1e-9) top = result;
    }
    return top!;
  };
  let best = optimise(emptySpec(factionId, members));
  let bestPoints = 0;
  const single = new Map<string, StackResult | null>();
  for (const combination of combinations) {
    if (combination.length !== 1) continue;
    const spec = legalDetachmentSpec(session, factionId, members, combination);
    single.set(combination[0].id, spec ? optimise(spec) : null);
  }
  const idle = new Set([...single].flatMap(([id, result]) => result && result.total <= best.total + 1e-9 ? [id] : []));
  for (const combination of combinations) {
    if (combination.length === 0) continue;
    let result: StackResult | null | undefined;
    if (combination.length === 1) result = single.get(combination[0].id);
    else if (combination.some((detachment) => idle.has(detachment.id))) continue;
    else {
      const spec = legalDetachmentSpec(session, factionId, members, combination);
      result = spec ? optimise(spec) : null;
    }
    if (!result) continue;
    const points = combination.reduce((sum, detachment) => sum + (detachment.detachment_points ?? 0), 0);
    if (result.total > best.total + 1e-9 || (Math.abs(result.total - best.total) <= 1e-9 && points < bestPoints)) {
      best = result;
      bestPoints = points;
    }
  }
  return best;
}

/** The scoring session one damage cell searches with. */
export function damageScoringSession(input: {
  dataset: Dataset;
  config: MatrixConfig;
  faction: FactionContext;
  target: ResolvedTarget;
  phase: ComparePhase;
  invariants?: DamageScoringInvariants;
  /** The target's wargear; its out-of-the-box loadout's when omitted. */
  targetWargear?: Record<string, number>;
  /** Model counts to score units at, by unit id; others score at their full strength. */
  modelCounts?: ReadonlyMap<string, number>;
}): DamageScoringSession {
  const state: DamageCellState = {
    factionId: input.faction.id,
    target: input.target,
    phase: input.phase,
    contextFor: contextForCell(input.dataset, input.faction.id, input.target, input.phase, cellScenario(input.dataset, input.faction, input.config),
      input.targetWargear ?? baseWargear(input.dataset, input.target.unitRaw, input.target.modelCount), input.modelCounts),
  };
  return new DamageScoringSession(input.dataset, state, input.config, input.faction.units, input.invariants, input.modelCounts);
}

/** Orders results best first; ties go to the members' ids in order. */
function byTotal(left: StackResult, right: StackResult): number {
  return right.total - left.total || memberIds(left).localeCompare(memberIds(right));
}

function memberIds(result: StackResult): string {
  return result.spec.members.map((member) => member.unit.id).join("+");
}

export function runDamageCell(input: {
  dataset: Dataset;
  config: MatrixConfig;
  faction: FactionContext;
  target: ResolvedTarget;
  phase: ComparePhase;
  invariants?: DamageScoringInvariants;
}): DamageCellReport {
  const started = Date.now();
  const session = damageScoringSession(input);
  const scenario = cellScenario(input.dataset, input.faction, input.config);
  const bodyguards = input.faction.units.filter((unit) => unit.weapons.length > 0).slice(0, input.config.bodyguardLimit);
  const counts: SearchCounts = { bodyguards: bodyguards.length, memberStacks: 0, broadResults: 0, deepFinalists: 0 };
  const broad: StackResult[] = [];
  for (const bodyguard of bodyguards) {
    const choices = memberChoices(input.dataset, input.faction, bodyguard, session, input.config);
    counts.memberStacks += choices.length;
    for (const members of choices) broad.push(session.optimiseLevers(emptySpec(input.faction.id, members)));
  }
  counts.broadResults = broad.length;
  broad.sort(byTotal);
  const finalists = broad.slice(0, input.config.finalistLimit);
  counts.deepFinalists = finalists.length;
  const combinations = detachmentCombos(detachmentsForFaction(input.dataset, input.faction), input.config);
  // Deep results by member stack, so per-unit mode reuses the overall finalists' searches.
  const deepened = new Map<StackResult, StackResult>();
  const deepen = (result: StackResult): StackResult => {
    let deepResult = deepened.get(result);
    if (!deepResult) {
      deepResult = deepOptimise(session, input.faction.id, result.spec.members, combinations);
      deepened.set(result, deepResult);
    }
    return deepResult;
  };
  const deep = finalists.map(deepen);
  deep.sort(byTotal);
  const winner = deep[0] ?? broad[0] ?? null;
  const outcome = (stack: StackResult) => {
    const report = winnerReport(input.dataset, input.faction, session, stack, input.target.modelCount, scenario);
    const ledger = [...buildLedger(session, stack), ...unscoreableEntries(session)];
    const incomplete = ledger.some((entry) => entry.relevant) || stack.spec.detachmentIssues.length > 0 || report.members.some((member) => member.legalityErrors.length > 0);
    const unsupported = session.relevantWarnings(stack).map(({ sourceKind: _sourceKind, ...warning }) => warning);
    return { report, ledger, unsupported, status: incomplete ? "incomplete" as const : "complete" as const };
  };
  const cell = winner ? outcome(winner) : null;
  const unscoreable = unscoreableEntries(session);
  const defensiveWarnings = session.defensiveWarnings.map(({ sourceKind: _sourceKind, ...warning }) => warning);
  const units = input.config.perUnitFinalists === null ? undefined
    : bestPerUnit(broad, input.config.perUnitFinalists, deepen).map(({ stack, deepFinalists }) => {
      const unitOutcome = outcome(stack);
      const host = stack.spec.members[0].unit;
      return {
        unitId: host.id,
        unitName: host.name,
        status: unitOutcome.status,
        deepFinalists,
        winner: unitOutcome.report,
        ledger: unitOutcome.ledger,
        unsupported: unitOutcome.unsupported,
      };
    });
  return {
    key: damageCellKey(input.faction.id, input.target.profileId, input.phase),
    factionId: input.faction.id,
    target: {
      profileId: input.target.profileId,
      profileName: input.target.profileName,
      factionId: input.target.unitRaw.faction_id,
      unitId: input.target.unitRaw.id,
      modelCount: input.target.modelCount,
    },
    phase: input.phase,
    status: cell?.status ?? (unscoreable.some((entry) => entry.relevant) ? "incomplete" : "complete"),
    winner: cell?.report ?? null,
    ledger: cell?.ledger ?? unscoreable,
    unsupported: cell?.unsupported ?? [],
    defensiveWarnings,
    candidateCounts: { ...counts, illegalLoadoutsRejected: session.illegalLoadoutsRejected },
    evaluations: { stack: session.stackEvaluations, crunch: session.crunchCount },
    runtimeMs: Date.now() - started,
    ...(units ? { units } : {}),
  };
}

/**
 * Each bodyguard unit's best stack: its `limit` best broad results (sorted best first, the
 * bodyguard as each result's first member) are deep-optimised and the best kept. Units come back
 * best first.
 */
export function bestPerUnit(
  broad: readonly StackResult[],
  limit: number,
  deepen: (result: StackResult) => StackResult,
): { stack: StackResult; deepFinalists: number }[] {
  const byUnit = new Map<string, StackResult[]>();
  for (const result of broad) {
    const hostId = result.spec.members[0].unit.id;
    const list = byUnit.get(hostId) ?? [];
    if (list.length < limit) list.push(result);
    byUnit.set(hostId, list);
  }
  return [...byUnit.values()]
    .map((results) => ({ stack: results.map(deepen).sort(byTotal)[0], deepFinalists: results.length }))
    .sort((left, right) => byTotal(left.stack, right.stack));
}
