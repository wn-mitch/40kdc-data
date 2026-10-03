import { activitiesExtension, type FamilyExtension } from "./family-extension-helpers.js";

/**
 * The tenth round of family extensions. As in the earlier rounds, a version checks only its own
 * additions and hands the rest to the previous one.
 */

/**
 * "That arrived from Reserves this turn": set up on the battlefield from Strategic Reserves, which
 * the rules call Reserves. Lowered to `happened` set-up from strategic-reserves in compile-conditions.ts.
 */
export const RESERVES_ARRIVAL_ACTIVITIES = ["set-up-from-reserves-this-phase", "set-up-from-reserves-this-turn"] as const;

export const FAMILY_EXTENSIONS_10: readonly FamilyExtension[] = [
  activitiesExtension(RESERVES_ARRIVAL_ACTIVITIES, "set-up-from-reserves-this-phase/-this-turn: the subject arrived from (Strategic) Reserves this phase or turn"),
];
