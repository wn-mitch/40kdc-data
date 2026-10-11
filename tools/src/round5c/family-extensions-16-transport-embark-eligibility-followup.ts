import { type FamilyExtension, optional, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";

/**
 * Where an embark permission puts the subject: "antecedent" (an earlier target or unit the
 * binder resolves), "following-filter" (the unit-filter right after the permission), "selection"
 * (the inner unit of a bound selection pair) or "this-unit" (the ability's own Transport).
 */
export const PERMISSION_INTO = ["antecedent", "following-filter", "selection", "this-unit"] as const;

/**
 * Wave-10 follow-up: "that unit can embark within that TRANSPORT". The permission names the
 * Transport it embarks the subject within. Only an embark permission has a destination; the
 * binder (compile-target-refs.ts) and the lowering (compile-fragments.ts) resolve the value.
 */
export const FAMILY_EXTENSIONS_16_TRANSPORT_EMBARK_FOLLOWUP: readonly FamilyExtension[] = [
  {
    family: "eligibility-permission",
    description: `As the previous version, plus into: the Transport an embark permission places the subject within (${PERMISSION_INTO.join(", ")}). Only with activity embark.`,
    schema: (previous) => withProperties(previous, {
      into: optional({ enum: [...PERMISSION_INTO], "x-only-when": { activity: ["embark"] } }),
    }),
    normalize: (input, previous) => {
      if (!("into" in input)) return previous(input);
      const { into, ...rest } = input;
      if (rest.activity !== "embark") throw new TypeError("eligibility-permission.into applies only to activity: embark.");
      // The previous version checks the rest of the leaf; `into` is checked here, against its own values.
      const normalized = previous(rest);
      return { ...normalized, into: enumValue(into, [...PERMISSION_INTO], "eligibility-permission.into") };
    },
  },
];
