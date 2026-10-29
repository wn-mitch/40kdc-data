import type { Dataset } from "../data/dataset.js";
import { baseLoadout, type LoadoutModel } from "../data/loadout.js";
import type { Detachment, Unit, UnitComposition } from "../generated.js";
import type { EngineContext } from "../cruncher/index.js";
import type { ResolvedTarget, ComparePhase } from "../compare.js";
import { assessDetachmentSelection, summarizeSupportCosts, type LegalityIssue } from "./legality.js";
import type { MatrixConfig, Scenario } from "./config.js";
import { fullModelCount, preferFactionCopies, type FactionContext, unitInFaction } from "./factions.js";
import { DamageScoringSession, type DamageScoringInvariants } from "./scoring.js";
import { isCombatPatrolDetachment } from "../abilities-resolver/resolver.js";
import { buildLedger, unscoreableEntries } from "./ledger.js";
import { baseWargear } from "./weapon-grants.js";
import type { DamageCellState, StackMember, StackResult, StackSpec } from "./model.js";
import { damageCellKey, type DamageCellReport, type LeverReport, type WinnerReport } from "./report.js";

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
    for (const keyword of [...member.unit.keywords, ...member.unit.factionKeywords]) values.add(keyword.toLowerCase());
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

/**
 * The engine context of one stack member in a cell. The crunch fires every model at a full-strength
 * target in the attacker's own turn, so those facts are stated; the scenario declares the rest.
 */
function contextForCell(dataset: Dataset, factionId: string, target: ResolvedTarget, phase: ComparePhase, scenario: Scenario, targetWargear: Record<string, number>) {
  const targetKeywords = [...(target.unitRaw.keywords ?? []), ...(target.unitRaw.faction_keywords ?? [])].map((keyword) => keyword.toLowerCase());
  const targetWounds = freshWounds(target.unitRaw);
  return (spec: StackSpec, member?: StackMember): EngineContext => ({
    attackerTurn: true,
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
    ...(spec.members.length > 0 ? { attackerModelCount: spec.members.reduce((sum, candidate) => sum + fullModelCount(dataset, candidate.unit.raw), 0) } : {}),
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

function deepOptimise(
  session: DamageScoringSession,
  factionId: string,
  members: StackMember[],
  combinations: readonly Detachment[][],
): StackResult {
  let best = session.optimiseLevers(emptySpec(factionId, members));
  let bestPoints = 0;
  for (const combination of combinations) {
    if (combination.length === 0) continue;
    const spec = legalDetachmentSpec(session, factionId, members, combination);
    if (!spec) continue;
    const result = session.optimiseLevers(spec);
    const points = combination.reduce((sum, detachment) => sum + (detachment.detachment_points ?? 0), 0);
    if (result.total > best.total + 1e-9 || (Math.abs(result.total - best.total) <= 1e-9 && points < bestPoints)) {
      best = result;
      bestPoints = points;
    }
  }
  return best;
}

function parseEnhancementLever(id: string): { id: string; bearerUnitId: string } | null {
  if (!id.startsWith("enhancement:")) return null;
  const at = id.indexOf("@");
  return at < 0 ? null : { id: id.slice("enhancement:".length, at), bearerUnitId: id.slice(at + 1) };
}

function winnerReport(dataset: Dataset, faction: FactionContext, session: DamageScoringSession, result: StackResult): WinnerReport {
  const selected = session.selectedPoolLevers(result);
  const enhancements = selected.flatMap((lever) => {
    if (lever.cost?.points === undefined) return [];
    const identity = parseEnhancementLever(lever.id);
    const enhancement = identity ? dataset.enhancements.get(identity.id) : undefined;
    return identity && enhancement ? [{ ...identity, points: enhancement.cost }] : [];
  });
  const cpLever = selected.find((lever) => lever.cost?.cp !== undefined);
  const cpAbilityId = cpLever?.source.kind === "ability" ? cpLever.source.abilityId : undefined;
  const stratagem = cpAbilityId ? dataset.stratagems.all.find((candidate) => candidate.ability_id === cpAbilityId) : undefined;
  const supportAbilityIds = new Map<string, Set<string>>();
  for (const lever of selected) {
    if (lever.source.kind !== "ability" || lever.source.abilityKind !== "support" || !lever.source.sourceUnitId) continue;
    const abilities = supportAbilityIds.get(lever.source.sourceUnitId) ?? new Set<string>();
    abilities.add(lever.source.abilityId);
    supportAbilityIds.set(lever.source.sourceUnitId, abilities);
  }
  const supportMembers = [...supportAbilityIds].flatMap(([unitId]) => {
    const unit = unitInFaction(faction, unitId);
    if (!unit) return [];
    const composition = dataset.unitCompositionOf(unit.raw) as UnitComposition | undefined;
    const models = (composition?.models ?? []) as LoadoutModel[];
    const modelCount = fullModelCount(dataset, unit.raw);
    const options = dataset.wargearOptionsOf(unit.raw);
    return [{ unit: unit.raw, modelCount, loadout: baseLoadout(unit.raw, modelCount, options, models).counts }];
  });
  const supportCosts = summarizeSupportCosts({
    members: supportMembers,
    hostFaction: dataset.factions.get(faction.id)?.raw,
    detachmentIds: result.spec.detachmentIds,
  });
  const costByUnit = new Map(supportCosts.entries.map((entry) => [entry.unitId, entry.totalPoints]));
  const leverReports: LeverReport[] = selected.map((lever) => ({
    id: lever.id,
    label: lever.label,
    source: lever.source,
    ...(lever.cost ? { cost: lever.cost } : {}),
    requires: lever.requires ?? [],
    ...(lever.source.kind === "ability" && lever.source.abilityKind === "support" && lever.source.sourceUnitId
      ? { supportUnitId: lever.source.sourceUnitId }
      : {}),
  }));
  const chosen = new Map(result.members.map(({ member, loadout }) => [member.unit.id, loadout.counts]));
  return {
    expectedDamage: result.total,
    members: result.members.map(({ member, loadout }) => ({
      unitId: member.unit.id,
      unitName: member.unit.name,
      role: member.role,
      modelCount: loadout.modelCount,
      expectedDamage: loadout.total,
      loadout: [...loadout.counts].map(([weaponId, count]) => ({ weaponId, count })).sort((left, right) => left.weaponId.localeCompare(right.weaponId)),
      weapons: loadout.selectedWeapons.map((weapon) => {
        const raw = dataset.weapons.getInFaction(weapon.weaponId, member.unit.raw.faction_id)?.raw ?? dataset.weapons.getAny(weapon.weaponId)?.raw;
        return {
          id: weapon.weaponId,
          name: raw?.name ?? weapon.weaponId,
          profileIndex: weapon.profileIndex,
          profileName: weapon.profileName,
          count: weapon.count,
          stages: Object.fromEntries(weapon.stages.map((stage) => [stage.name, stage.expected * weapon.count])),
          attribution: session.attributeWeapon(result.spec, member, weapon, loadout.counts, chosen),
        };
      }),
      pistolChoice: loadout.pistolChoice,
      legalityErrors: loadout.legalityErrors,
    })),
    detachments: result.spec.detachmentIds.map((id) => {
      const detachment = dataset.detachments.getInFaction(id, faction.id) ?? dataset.detachments.getAny(id);
      return { id, detachmentPoints: detachment?.detachment_points ?? 0 };
    }),
    enhancements,
    stratagem: stratagem ? { id: stratagem.id, cp: stratagem.cp_cost } : null,
    selectedLevers: leverReports,
    supportingUnits: [...supportAbilityIds].map(([unitId, abilityIds]) => ({
      unitId,
      points: costByUnit.get(unitId) ?? null,
      selectedAbilityIds: [...abilityIds].sort(),
    })),
    assumptions: [
      "Favourable state: 1 inch, within half range, stationary when shooting, charged when fighting.",
      "Each selected support ability is assumed in range and otherwise activatable; support units are costed but are not an army roster.",
      "At most one Stratagem is selected; CP across a full game is not simulated.",
      "Loadouts and levers use coordinate ascent; outer bodyguard, attachment, finalist and detachment pools are exhaustive when their limits are Infinity.",
      ...result.spec.detachmentIssues.map((issue) => `Unproven local-stack detachment condition: ${issue.code} (${issue.id}).`),
      ...selected.flatMap((lever) => (lever.requires ?? []).map(() => `Selected lever ${lever.id} requires caller-attested activation context recorded in selectedLevers.requires.`)),
      ...(supportCosts.status === "incomplete" ? supportCosts.issues.map((issue) => `Support cost incomplete: ${issue.code} (${issue.id}).`) : []),
    ],
  };
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
}): DamageScoringSession {
  const state: DamageCellState = {
    factionId: input.faction.id,
    target: input.target,
    phase: input.phase,
    contextFor: contextForCell(input.dataset, input.faction.id, input.target, input.phase, input.config.scenario,
      input.targetWargear ?? baseWargear(input.dataset, input.target.unitRaw, input.target.modelCount)),
  };
  return new DamageScoringSession(input.dataset, state, input.config, input.faction.units, input.invariants);
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
  const bodyguards = input.faction.units.filter((unit) => unit.weapons.length > 0).slice(0, input.config.bodyguardLimit);
  const counts: SearchCounts = { bodyguards: bodyguards.length, memberStacks: 0, broadResults: 0, deepFinalists: 0 };
  const broad: StackResult[] = [];
  for (const bodyguard of bodyguards) {
    const choices = memberChoices(input.dataset, input.faction, bodyguard, session, input.config);
    counts.memberStacks += choices.length;
    for (const members of choices) broad.push(session.optimiseLevers(emptySpec(input.faction.id, members)));
  }
  counts.broadResults = broad.length;
  broad.sort((left, right) => right.total - left.total || left.spec.members.map((member) => member.unit.id).join("+").localeCompare(right.spec.members.map((member) => member.unit.id).join("+")));
  const finalists = broad.slice(0, input.config.finalistLimit);
  counts.deepFinalists = finalists.length;
  const combinations = detachmentCombos(detachmentsForFaction(input.dataset, input.faction), input.config);
  const deep = finalists.map((result) => deepOptimise(session, input.faction.id, result.spec.members, combinations));
  deep.sort((left, right) => right.total - left.total || left.spec.members.map((member) => member.unit.id).join("+").localeCompare(right.spec.members.map((member) => member.unit.id).join("+")));
  const winner = deep[0] ?? broad[0] ?? null;
  const offensiveWarnings = winner ? session.relevantWarnings(winner) : [];
  const unsupported = offensiveWarnings.map(({ sourceKind: _sourceKind, ...warning }) => warning);
  const defensiveWarnings = session.defensiveWarnings.map(({ sourceKind: _sourceKind, ...warning }) => warning);
  const result = winner ? winnerReport(input.dataset, input.faction, session, winner) : null;
  const ledger = [...(winner ? buildLedger(session, winner) : []), ...unscoreableEntries(session)];
  const incomplete = ledger.some((entry) => entry.relevant) || (winner?.spec.detachmentIssues.length ?? 0) > 0 || result?.members.some((member) => member.legalityErrors.length > 0);
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
    status: incomplete ? "incomplete" : "complete",
    winner: result,
    ledger,
    unsupported,
    defensiveWarnings,
    candidateCounts: { ...counts, illegalLoadoutsRejected: session.illegalLoadoutsRejected },
    evaluations: { stack: session.stackEvaluations, crunch: session.crunchCount },
    runtimeMs: Date.now() - started,
  };
}
