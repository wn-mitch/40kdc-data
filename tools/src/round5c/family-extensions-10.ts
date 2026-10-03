import { activitiesExtension, type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

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
  {
    // "at least one of its models must be touching one of your Cult Ambush markers (that marker is
    // then removed)"; "wholly within 6\" of that Cult Ambush marker" instead of touching it.
    family: "set-up",
    description: "As the previous version, plus via cult-ambush-marker (set up using a Cult Ambush marker: touching it, and the marker is removed), and with it marker_inches and marker_wholly: (wholly) within that many inches of the marker instead.",
    schema: (previous) => withProperties(previous, {
      via: optional({ enum: ["cult-ambush-marker"] }),
      marker_inches: optional({ type: "integer", minimum: 1 }),
      marker_wholly: optional({ const: true }),
    }),
    normalize: (input, previous) => {
      const { via, marker_inches: inches, marker_wholly: wholly, ...rest } = input;
      if (via === undefined && inches === undefined && wholly === undefined) return previous(input);
      if (via !== "cult-ambush-marker") throw new TypeError("set-up.via is cult-ambush-marker or absent; marker_inches and marker_wholly need it.");
      if (inches === undefined && wholly !== undefined) throw new TypeError("set-up.marker_wholly needs marker_inches.");
      if (inches !== undefined && (!Number.isInteger(inches) || (inches as number) < 1)) throw new TypeError("set-up.marker_inches is a whole number of inches, at least 1.");
      if (wholly !== undefined && wholly !== true) throw new TypeError("set-up.marker_wholly is true or absent.");
      return { ...previous(rest), via, ...(inches !== undefined ? { marker_inches: inches } : {}), ...(wholly === true ? { marker_wholly: true } : {}) };
    },
  },
  {
    // "select one of your Cult Ambush markers that … has not been moved this turn and move it".
    family: "battlefield-marker",
    description: "As the previous version, plus not_moved_this_turn: a relocate takes only a marker that has not been moved this turn.",
    schema: (previous) => withProperties(previous, { not_moved_this_turn: optional({ const: true }) }),
    normalize: (input, previous) => {
      if (input.not_moved_this_turn === undefined) return previous(input);
      const { not_moved_this_turn: unmoved, ...rest } = input;
      if (unmoved !== true) throw new TypeError("battlefield-marker.not_moved_this_turn is true or absent.");
      if (rest.operation !== "relocate") throw new TypeError("battlefield-marker.not_moved_this_turn qualifies a relocate.");
      return { ...previous(rest), not_moved_this_turn: true };
    },
  },
];
