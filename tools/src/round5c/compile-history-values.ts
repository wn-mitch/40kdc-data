import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Checks for the unit-activity history values that read a moment or an effect elsewhere in the
 * record (unit-activity@21 and @22, families/unit-activity.ts). The conditions themselves lower in
 * compile-conditions.ts; these refusals keep them from lowering where nothing gives them a meaning.
 */

/** Moments whose attacks "those attacks" names: attacks resolved, an enemy having shot, or a unit having shot. */
export const ATTACK_RESULT_MOMENTS: ReadonlySet<string> = new Set(["attacks-resolved", "enemy-has-shot", "after-shooting"]);
const MORTAL_ACTIVITIES = ["suffered-mortal-wounds-from-this-ability", "lost-models-to-own-mortal-wounds"] as const;

function activitiesOf(leaf: CompileLeaf): string[] {
  return leaf.family_id === "unit-activity" && Array.isArray(leaf.parameters.activities) ? leaf.parameters.activities as string[] : [];
}

/** Refuses a history value that names a moment or an effect the record does not hold. */
export function refuseHistoryValueWithoutSource(list: readonly CompileLeaf[]): void {
  list.forEach((leaf, index) => {
    const activities = activitiesOf(leaf);
    if (activities.includes("lost-wounds-to-triggering-attacks")
      && !list.some((other) => other.family_id === "event" && ATTACK_RESULT_MOMENTS.has(String(other.parameters.kind)))) {
      throw new CompileError("Lost wounds to those attacks needs a moment whose attacks it names: the attacks resolved, an enemy having shot, or a unit having shot.");
    }
    const mortal = MORTAL_ACTIVITIES.find((activity) => activities.includes(activity));
    if (mortal !== undefined && !list.slice(0, index).some((other) => other.family_id === "mortal-wounds")) {
      throw new CompileError(`${mortal} (as a result of this ability) needs the mortal wounds it names: a mortal-wounds effect before it.`);
    }
  });
}

/** The window a set-up activity names for itself. */
const SET_UP_WINDOWS: Record<string, string> = { "set-up-this-turn": "turn", "set-up-this-phase": "phase" };

/** The window a set-up activity names itself, when the leaf names exactly that one activity. */
export function setUpWindow(leaf: CompileLeaf): string | undefined {
  if (leaf.family_id !== "unit-activity" || !Array.isArray(leaf.parameters.activities)) return undefined;
  const activities = leaf.parameters.activities as string[];
  return activities.length === 1 ? SET_UP_WINDOWS[activities[0]!] : undefined;
}

