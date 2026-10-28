import type { Dataset } from "../data/dataset.js";
import { isLegalLeverSelection } from "../data/lever-selection.js";
import { assessEnhancementAssignment, type LocalStackMember } from "./legality.js";
import type { StackBuffPool, StackSpec } from "./model.js";

function enhancementIdentity(leverId: string): { enhancementId: string; bearerId: string } | null {
  if (!leverId.startsWith("enhancement:")) return null;
  const split = leverId.indexOf("@");
  if (split < 0) return null;
  return { enhancementId: leverId.slice("enhancement:".length, split), bearerId: leverId.slice(split + 1) };
}

/**
 * Whether `selectedIds` is a legal lever set for the stack: the pool's exclusive groups and caps,
 * at most one Stratagem, each enhancement once and one per bearer, and each bearer eligible for
 * its enhancement. `localMembers` builds the stack's members with a bearer→enhancement map.
 */
export function isLegalStackLevers(
  dataset: Dataset,
  spec: StackSpec,
  pool: StackBuffPool,
  selectedIds: readonly string[],
  localMembers: (enhancementByBearer: Map<string, string>) => LocalStackMember[],
): boolean {
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
  const members = localMembers(enhancementByBearer);
  for (const [bearerId, enhancementId] of enhancementByBearer) {
    const enhancement = dataset.enhancements.get(enhancementId);
    const bearerIndex = spec.members.findIndex((member) => member.unit.id === bearerId);
    if (!enhancement || bearerIndex < 0) return false;
    const assessed = assessEnhancementAssignment({
      dataset,
      factionId: spec.factionId,
      detachmentIds: spec.detachmentIds,
      members,
      bearerIndex,
      enhancement,
    });
    if (assessed.status === "illegal") return false;
  }
  return true;
}
