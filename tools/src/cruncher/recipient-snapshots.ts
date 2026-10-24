import type { Trigger, UnitSelector } from "../generated.js";
import type { BuffSource, EngineContext } from "./buffs.js";
import { bindEachRecipient } from "./from-dsl-selection.js";

/** Caller-attested recipients of one source-owned activation, not current board state. */
export interface RecipientSnapshot {
  /** Exact ability source identity, including the source unit when supplied. */
  source: Extract<BuffSource, { kind: "ability" }>;
  /** Unit that owned the source ability when the activation occurred. */
  sourceUnitId: string;
  /** Exact canonical trigger that established this use, including any parent binding. */
  trigger: Trigger;
  /** JSON pointer into the owning ability's effect; the root selection is "". */
  selectionPath: string;
  /** Canonical selector used at activation time, including its filter/count/limit. */
  selector: UnitSelector;
  /** Buff translation perspective for this source. */
  perspective: "attacker" | "target";
  /** Unit receiving the source effect at activation time. */
  recipientUnitId: string;
  /** Whether this recipient was selected by the recorded activation. */
  selected: boolean;
}

export const RECIPIENT_SNAPSHOT_UNAVAILABLE = "trigger-time recipient snapshot is unavailable; current membership cannot establish historical recipients";

/**
 * Snapshot comparison ignores object-key order but preserves array order and
 * every supplied field. Callers provide only live event-time evidence and
 * assert activation/equipment; the resolver has no internal history or clock.
 */

/** Compare nested snapshot values using the ordering semantics documented above. */
export function sameSnapshotValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameSnapshotValue(value, right[index]));
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  return keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length && keys.every((key) => sameSnapshotValue(left[key], right[key]));
}

/** Resolve only event-scoped recipient pools; unrelated effect guards still run normally. */
export function resolveRecipientSnapshots(
  trigger: unknown,
  effect: unknown,
  source: BuffSource,
  isAttackStep: (trigger: unknown) => boolean,
  context: EngineContext,
  perspective: "attacker" | "target",
  gate: (trigger: unknown, effect: unknown) => unknown,
  basePath = "",
): { effect: unknown; resolved: boolean; reason?: string } {
  let resolved = false;
  let reason: string | undefined;
  const sideId = perspective === "attacker" ? context.attackerUnitId : context.targetUnitId;
  const sourceId = source.kind === "ability" ? source.sourceUnitId ?? (source.abilityKind === "unit" ? sideId : undefined) : undefined;
  const visit = (node: unknown, path: string, event: unknown): unknown => {
    if (!record(node)) return node;
    const events = (Array.isArray(event) ? event : [event]).filter(record);
    const historical = events.filter((item) => typeof item.event === "string" && !isAttackStep(item));
    if (node.type === "for-each-unit" && historical.length > 0) {
      const matches = (context.recipientSnapshots ?? []).filter((snapshot) =>
        source.kind === "ability" && sourceId !== undefined && sideId !== undefined &&
        sameSnapshotValue(snapshot.source, source) && snapshot.sourceUnitId === sourceId &&
        snapshot.perspective === perspective && snapshot.recipientUnitId === sideId &&
        snapshot.selectionPath === path && sameSnapshotValue(snapshot.selector, node.selector) &&
        historical.some((item) => sameSnapshotValue(snapshot.trigger, item)));
      if (matches.length === 0) {
        reason = RECIPIENT_SNAPSHOT_UNAVAILABLE;
        return { type: "sequence", steps: [] };
      }
      if (matches.some((snapshot) => snapshot.selected !== matches[0].selected)) {
        reason = "conflicting trigger-time recipient snapshots";
        return { type: "sequence", steps: [] };
      }
      resolved = true;
      if (!matches[0].selected) return { type: "sequence", steps: [] };
      const bound = bindEachRecipient(node, "recipient");
      if (bound === undefined) {
        reason = "recipient snapshot cannot bind mixed or unresolved recipient effects";
        return { type: "sequence", steps: [] };
      }
      return bound;
    }
    if (node.type === "for-each-unit") return gate(event, node);
    if (node.type === "sequence" || node.type === "rules-bundle") {
      return { ...node, steps: Array.isArray(node.steps) ? node.steps.map((step, index) => visit(step, `${path}/steps/${index}`, event)) : node.steps };
    }
    if (node.type === "conditional") return { ...node, effect: visit(node.effect, `${path}/effect`, event) };
    if (node.type === "ability-part") {
      const { trigger: localTrigger, ...part } = node;
      return { ...part, effect: visit(node.effect, `${path}/effect`, localTrigger ?? event) };
    }
    // A menu/choice establishes its own activation. Do not silently lower a
    // historical recipient nested in an unhandled composition as a current filter.
    const containsPool = (value: unknown): boolean => Array.isArray(value) ? value.some(containsPool) :
      record(value) && (value.type === "for-each-unit" || Object.values(value).some(containsPool));
    if (containsPool(node)) {
      reason = "recipient snapshot is nested in an unsupported activation composition";
      return { type: "sequence", steps: [] };
    }
    return gate(event, node);
  };
  const transformed = visit(effect, basePath, trigger);
  return { effect: transformed, resolved, ...(reason ? { reason } : {}) };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
