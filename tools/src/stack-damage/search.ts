import type { Dataset } from "../data/dataset.js";
import { baseLoadout, type LoadoutModel, type LoadoutTier } from "../data/loadout.js";
import type { Detachment, UnitComposition } from "../generated.js";
import type { ResolvedTarget, ComparePhase } from "../compare.js";
import { assessDetachmentSelection, summarizeSupportCosts, type LegalityIssue } from "./legality.js";
import type { MatrixConfig } from "./config.js";
import { preferFactionCopies, type FactionContext, unitInFaction } from "./factions.js";
import { DamageScoringSession, type DamageScoringInvariants } from "./scoring.js";
import { buildLedger } from "./ledger.js";
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

function contextForCell(factionId: string, target: ResolvedTarget, phase: ComparePhase) {
  const targetKeywords = [...(target.unitRaw.keywords ?? []), ...(target.unitRaw.faction_keywords ?? [])].map((keyword) => keyword.toLowerCase());
  return (spec: StackSpec, member?: StackMember) => ({
    phase,
    attackerStationary: phase === "shooting",
    attackerCharged: phase === "fight",
    withinHalfRange: true,
    distanceInches: 1,
    armyFaction: factionId,
    attackerAttached: spec.members.length > 1,
    attackerKeywords: unitKeywords(spec.members),
    attackerUnitId: member?.unit.id,
    attackerAttachmentRole: member ? (member.role === "bodyguard" ? "bodyguard" as const : "leader" as const) : undefined,
    attachmentRoles: Object.fromEntries(spec.members.map((candidate) => [candidate.unit.id, candidate.role === "bodyguard" ? "bodyguard" : "leader"] as const)),
    targetKeywords,
    targetUnitId: target.unitRaw.id,
    targetModelCount: target.modelCount,
    targetAttached: false,
  });
}

function detachmentsForFaction(dataset: Dataset, faction: FactionContext): Detachment[] {
  return preferFactionCopies(faction.lineage.flatMap((id) => dataset.detachments.byFaction(id)), faction.lineage)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function detachmentCombos(detachments: readonly Detachment[], config: MatrixConfig): Detachment[][] {
  const output: Detachment[][] = [[]];
  const walk = (start: number, selected: Detachment[], points: number): void => {
    if (selected.length >= config.maxDetachments) return;
    for (let index = start; index < detachments.length; index++) {
      const nextPoints = points + (detachments[index].detachment_points ?? 0);
      if (nextPoints > config.dpBudget) continue;
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
    const tiers = (composition?.tiers ?? []) as LoadoutTier[];
    let modelCount = unit.raw.model_count?.max ?? unit.raw.model_count?.min ?? 1;
    for (const tier of tiers) modelCount = Math.max(modelCount, tier.models.reduce((sum, model) => sum + (model.max ?? model.min), 0));
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
}): DamageScoringSession {
  const state: DamageCellState = {
    factionId: input.faction.id,
    target: input.target,
    phase: input.phase,
    contextFor: contextForCell(input.faction.id, input.target, input.phase),
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
  const ledger = winner ? buildLedger(session, winner) : [];
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
