import type { Dataset, StackableBuff } from "../data/dataset.js";
import { summarizeSupportCosts } from "./legality.js";
import type { Scenario } from "./config.js";
import { fullModelCount, type FactionContext, unitInFaction } from "./factions.js";
import type { DamageScoringSession } from "./scoring.js";
import { assumedEligibility, stratagemCost, unitLookup } from "./stratagem-eligibility.js";
import { combinedKeywords, issuesOrders, orderIssuingUnits } from "./orders.js";
import type { StackResult } from "./model.js";
import type { LeverReport, WinnerReport } from "./report.js";

/** The assumptions a cell's scenario adds to its report. */
function scenarioAssumptions(scenario: Scenario): string[] {
  const lines: string[] = [];
  if (scenario.battleRound !== undefined) lines.push(`Battle round ${scenario.battleRound}.`);
  if (scenario.targetRegions !== undefined) lines.push(`Target regions: ${JSON.stringify(scenario.targetRegions)}; no others.`);
  if (scenario.targetDesignations !== undefined) {
    lines.push(scenario.targetDesignations.length > 0
      ? `Target designations assumed (applied by the army's own rules): ${scenario.targetDesignations.join(", ")}; no others.`
      : "Target carries no designations.");
  }
  return lines;
}

function parseEnhancementLever(id: string): { id: string; bearerUnitId: string } | null {
  if (!id.startsWith("enhancement:")) return null;
  const at = id.indexOf("@");
  return at < 0 ? null : { id: id.slice("enhancement:".length, at), bearerUnitId: id.slice(at + 1) };
}

/**
 * Records, for each selected Orders lever no stack member can issue, the supporting Officer that
 * issues it: one already supporting the stack if it can, else the first by id. The Officer is
 * costed like any other supporting unit.
 */
export function addOrderIssuers(
  dataset: Dataset,
  faction: FactionContext,
  session: DamageScoringSession,
  result: StackResult,
  selected: readonly StackableBuff[],
  supportAbilityIds: Map<string, Set<string>>,
): void {
  const memberIds = result.spec.members.map((member) => member.unit.id);
  const units = unitLookup(dataset, faction.id);
  const passes = result.spec.detachmentIds.length > 0 ? result.spec.detachmentIds : [undefined];
  const receiver = new Set(passes.flatMap((detachmentId) => [...combinedKeywords(memberIds, units, detachmentId)]));
  for (const ruleId of new Set(selected.flatMap((lever) =>
    lever.source.kind === "ability" && lever.source.abilityKind === "army" && issuesOrders(dataset, lever.source.abilityId) ? [lever.source.abilityId] : []))) {
    if (orderIssuingUnits(dataset, ruleId, memberIds, receiver).length > 0) continue;
    const candidates = session.orderIssuerCandidates.filter((id) => !memberIds.includes(id));
    const issuers = orderIssuingUnits(dataset, ruleId, candidates, receiver);
    const issuer = issuers.find((id) => supportAbilityIds.has(id)) ?? issuers[0];
    if (!issuer) continue;
    const abilities = supportAbilityIds.get(issuer) ?? new Set<string>();
    abilities.add(ruleId);
    supportAbilityIds.set(issuer, abilities);
  }
}

export function winnerReport(dataset: Dataset, faction: FactionContext, session: DamageScoringSession, result: StackResult, targetModelCount: number, scenario: Scenario): WinnerReport {
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
  addOrderIssuers(dataset, faction, session, result, selected, supportAbilityIds);
  const supportMembers = [...supportAbilityIds].flatMap(([unitId]) => {
    const unit = unitInFaction(faction, unitId);
    if (!unit) return [];
    const modelCount = fullModelCount(dataset, unit.raw);
    return [{ unit: unit.raw, modelCount, loadout: dataset.loadoutOf(unit.raw).base(modelCount) ?? new Map<string, number>() }];
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
  const cost = stratagem ? stratagemCost(dataset, stratagem, result.spec.members.map((member) => member.unit.raw)) : undefined;
  // Each profile's kills are capped at the unit's size on their own; the stack's total is capped once more.
  const kills = result.members.reduce((sum, { loadout }) => sum + loadout.selectedWeapons.reduce((total, weapon) =>
    total + (weapon.stages.find((stage) => stage.name === "models-killed")?.expected ?? 0) * weapon.count, 0), 0);
  return {
    expectedDamage: result.total,
    expectedModelsKilled: Math.min(targetModelCount, kills),
    members: result.members.map(({ member, loadout }) => ({
      unitId: member.unit.id,
      unitName: member.unit.name,
      role: member.role,
      ...(member.chosen && member.chosen.length > 0 ? { chosen: [...member.chosen] } : {}),
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
    stratagem: stratagem && cost ? { id: stratagem.id, cp: cost.cp, ...(cost.cp !== stratagem.cp_cost ? { printedCp: stratagem.cp_cost, modifiedBy: cost.modifiedBy } : {}) } : null,
    selectedLevers: leverReports,
    supportingUnits: [...supportAbilityIds].map(([unitId, abilityIds]) => ({
      unitId,
      points: costByUnit.get(unitId) ?? null,
      selectedAbilityIds: [...abilityIds].sort(),
    })),
    assumptions: [
      "Favourable state: 1 inch, within half range, stationary when shooting, charged when fighting.",
      ...scenarioAssumptions(scenario),
      "Each selected support ability is assumed in range and otherwise activatable; support units are costed but are not an army roster.",
      "At most one Stratagem is selected; CP across a full game is not simulated.",
      "Loadouts and levers use coordinate ascent; outer bodyguard, attachment, finalist and detachment pools are exhaustive when their limits are Infinity.",
      ...(result.spec.members.some((member) => member.role === "support")
        ? ["Support-attached characters count as leading their unit for rules that apply while a model is leading."] : []),
      ...(stratagem ? assumedEligibility(dataset, stratagem.id).map((condition) => `Stratagem ${stratagem.id} target condition assumed met: ${condition}.`) : []),
      ...(cost?.unapplied ?? []).map((abilityId) => `Conditional Stratagem cost rule not applied: ${abilityId}.`),
      ...result.spec.detachmentIssues.map((issue) => `Unproven local-stack detachment condition: ${issue.code} (${issue.id}).`),
      ...selected.flatMap((lever) => (lever.requires ?? []).map(() => `Selected lever ${lever.id} requires caller-attested activation context recorded in selectedLevers.requires.`)),
      ...(supportCosts.status === "incomplete" ? supportCosts.issues.map((issue) => `Support cost incomplete: ${issue.code} (${issue.id}).`) : []),
    ],
  };
}

