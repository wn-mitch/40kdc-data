import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { moveTriggerBefore } from "./compile-move-end.js";
import { EVENT_SUBJECT } from "./family-extension-helpers.js";

/**
 * A move-through or move permission whose subject is the triggering unit ("that unit can move …")
 * names the moving unit only when the nearest earlier event is a move-ended event. After a selected
 * event the same subject would silently name the selected unit. Refused, not bound.
 */
export function refuseUnmovedEventSubject(leaves: readonly CompileLeaf[]): void {
  leaves.forEach((leaf, index) => {
    if (leaf.family_id !== "move-through" && leaf.family_id !== "eligibility-permission") return;
    if (leaf.parameters.subject !== EVENT_SUBJECT) return;
    if (moveTriggerBefore(leaves, index)?.parameters.kind === "move-ended") return;
    throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} names the triggering unit, but no move-ended event precedes it; the unit it names is not the one that moved.`);
  });
}
