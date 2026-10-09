import { type FamilyExtension, optional, properties, type Schema, withProperties } from "./family-extension-helpers.js";

/**
 * The seventeenth round of family extensions: a characteristic change can leave its amount out.
 * A recipient filter can sit between the change and its amount ("Improve the Objective Control
 * characteristic of K models from your army by 2"), so the amount is a separate leaf that
 * `compile-characteristic-amount.ts` binds back onto the change before lowering.
 */

/** Operations that add an amount to a characteristic. Halve takes no amount; multiply keeps its factor (family-extensions-8). */
const AMOUNT_OPERATIONS = ["add", "subtract", "improve", "worsen"] as const;

export const FAMILY_EXTENSIONS_17_OPTIONAL_VALUE: readonly FamilyExtension[] = [
  {
    family: "characteristic-modifier",
    description: "As the previous version, and the amount (value) is optional for add, subtract, improve and worsen: a change without one takes its amount from a characteristic-amount leaf after its recipient. Halve and multiply are as before.",
    schema: (previous) => {
      const required = ((previous.required ?? []) as string[]).filter((key) => key !== "value");
      return { ...withProperties(previous, { value: optional(properties(previous).value!) }), required } as Schema;
    },
    normalize: (input, previous) => {
      if (input.value !== undefined || !(AMOUNT_OPERATIONS as readonly string[]).includes(input.operation as string)) return previous(input);
      // The previous version checks an amount, so the value is checked as 1 and then removed.
      const { value: _value, ...normalized } = previous({ ...input, value: 1 });
      return normalized;
    },
  },
];
