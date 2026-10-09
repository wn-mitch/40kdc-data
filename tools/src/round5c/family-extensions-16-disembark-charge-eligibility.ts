import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";

/**
 * Wave-10 disembark moments: which Transport a unit disembarked from ("disembarks from this
 * model", "from this TRANSPORT", "from the bearer"). A version checks only its own additions and
 * hands the rest to the previous one.
 */

/** The Transport a disembarked moment leaves: the unit's own Transport, the only value the wording names. */
export const DISEMBARK_TRANSPORTS = ["this-unit"] as const;

export const FAMILY_EXTENSIONS_16_DISEMBARK_CHARGE_ELIGIBILITY: readonly FamilyExtension[] = [
  {
    // "Each time a unit disembarks from this model": the Transport the moment leaves.
    family: "event",
    description: "As the previous version, plus transport on a disembarked moment: the Transport the unit disembarked from (this-unit, \"disembarks from this model\" or \"from this TRANSPORT\"). Never with subject or owner.",
    schema: (previous) => withProperties(previous, {
      transport: optional({ enum: [...DISEMBARK_TRANSPORTS], "x-only-when": { kind: ["disembarked"] } }),
    }),
    normalize: (input, previous) => {
      if (!("transport" in input)) return previous(input);
      const { transport, ...rest } = input;
      if (rest.kind !== "disembarked") throw new TypeError("event.transport names the Transport a disembarked moment leaves; kind must be disembarked.");
      if (!(DISEMBARK_TRANSPORTS as readonly unknown[]).includes(transport)) throw new TypeError(`event.transport is one of ${DISEMBARK_TRANSPORTS.join(", ")}.`);
      return { ...previous(rest), transport };
    },
  },
];
