import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { moveTriggerBefore } from "./compile-move-end.js";
import { EVENT_SUBJECT } from "./family-extension-helpers.js";

/**
 * A move-through or move permission whose subject is the triggering unit ("that unit can move …")
 * names the moving unit only when the nearest earlier event is a move-ended event, or a unit's selection
 * to move (the selected unit is the one that moves). After any other selected event the same subject
 * would silently name a unit that did not move. Refused, not bound.
 */
export function refuseUnmovedEventSubject(leaves: readonly CompileLeaf[]): void {
  leaves.forEach((leaf, index) => {
    if (leaf.family_id !== "move-through" && leaf.family_id !== "eligibility-permission") return;
    if (leaf.parameters.subject !== EVENT_SUBJECT) return;
    const moment = moveTriggerBefore(leaves, index);
    if (moment?.parameters.kind === "move-ended") return;
    // "When a unit is selected to make an Advance move, that move does not prevent this unit …": the selected unit is the one moving.
    if (moment?.parameters.kind === "selected" && moment.parameters.to === "move") return;
    throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} names the triggering unit, but no move-ended event precedes it; the unit it names is not the one that moved.`);
  });
}
