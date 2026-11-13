import type { FamilyExtension } from "../family-extension-helpers.js";
import { optional, withProperties } from "../family-extension-helpers.js";
import { enumValue } from "../family-validation.js";

/** The strength thresholds a unit can fall past: Below Half-strength, or below its Starting Strength. */
const STRENGTHS = ["below-half", "below-starting"] as const;

export const EVENT_STRENGTH_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "cause it to become Below Half-strength".
    family: "event",
    version: 39,
    description: "As the previous version, plus strength on a state-changed moment, in place of state: the unit becomes Below Half-strength (below-half) or falls below its Starting Strength (below-starting).",
    schema: (previous) => withProperties(previous, { strength: optional({ enum: STRENGTHS, "x-only-when": { kind: ["state-changed"] } }) }),
    normalize: (input, previous) => {
      if (!("strength" in input)) return previous(input);
      const { strength, ...rest } = input;
      if (rest.kind !== "state-changed") throw new TypeError("event.strength names a state-changed moment's threshold.");
      if (rest.state !== undefined) throw new TypeError("event.strength stands in place of state; give one of them.");
      // The previous version checks the rest of the moment, with a state standing in.
      const { state: _standIn, ...normalized } = previous({ ...rest, state: "engaged" });
      return { ...normalized, strength: enumValue(strength, STRENGTHS, "event.strength") };
    },
  },
];
