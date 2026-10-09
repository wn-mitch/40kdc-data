import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

const EMBARK_WITHIN = "embark-within";
/** `this-unit` is the candidate being checked; `ability-unit` is the unit that carries the ability (the Transport in "this Transport"). */
const TRANSPORT_VALUES = ["this-unit", "ability-unit"] as const;

/**
 * Wave-10 transport eligibility: "one friendly TRANSPORT that it is able to embark within". The
 * subject (a unit, possibly an earlier leaf's unit) is eligible to embark within the named
 * Transport, by the datasheet keyword check. Room in that Transport is a separate condition and
 * is not part of this one (compile-transport-embark.ts refuses the embark that would need it).
 */
export const FAMILY_EXTENSIONS_16_TRANSPORT_EMBARK: readonly FamilyExtension[] = [
  {
    family: "eligible",
    description: `As the previous version, plus to ${EMBARK_WITHIN}: the subject is able to embark within the Transport named by transport (this-unit, the candidate being checked, or ability-unit, the unit with the ability). The subject is a unit, not a model.`,
    schema: (previous) => withProperties(previous, {
      to: widenedEnum(previous, "to", [EMBARK_WITHIN]),
      transport: optional({ enum: [...TRANSPORT_VALUES], "x-only-when": { to: [EMBARK_WITHIN] } }),
    }),
    normalize: (input, previous) => {
      if (input.to !== EMBARK_WITHIN) {
        if ("transport" in input) throw new TypeError("eligible.transport applies only to to: embark-within.");
        return previous(input);
      }
      if (!("transport" in input)) throw new TypeError("eligible to embark-within names the Transport in transport.");
      const { transport, ...rest } = input;
      if (rest.subject === "this-model" || rest.subject === "model-in-this-unit") throw new TypeError("eligible embark-within names units, not models.");
      if ("at" in rest || "source_ability_id" in rest || "source_ability_owner" in rest) throw new TypeError("eligible embark-within takes no at, source_ability_id or source_ability_owner.");
      // The previous version knows no embark-within; it checks the rest with a value it knows.
      const normalized = standIn(rest, "to", "shoot", previous);
      return { ...normalized, to: EMBARK_WITHIN, transport: enumValue(transport, [...TRANSPORT_VALUES], "eligible.transport") };
    },
  },
];
