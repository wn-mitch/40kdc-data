import type { SemanticFamilyDefinition } from "./contracts.js";
import { ROLL_KINDS } from "./dice-families.js";
import { enumValue, exactKeys } from "./family-validation.js";

/**
 * Roll prohibition. "Do not roll <roll> …" forbids the named roll; the "Instead" sentence after it says
 * what happens in its place (compile.ts, the instead loop). The leaf names no subject: the roll is not
 * made at all, so there is no recipient. Its DSL form is the replacement alone (no roll-prohibition output).
 */
export const ROLL_PROHIBITION_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "roll-prohibition",
    version: 1,
    role: "EFFECT",
    label: "Do not roll",
    description: "\"Do not roll <roll> …\": the named roll is not made. The \"Instead\" after it, with its own effect, says what happens in its place. Takes only the roll it forbids.",
    starter: { roll: "" },
    parameterSchema: {
      type: "object",
      required: ["roll"],
      properties: { roll: { enum: ROLL_KINDS } },
      additionalProperties: false,
    },
  },
];

/** roll-prohibition@1 parameters: the roll it forbids, from the shared roll vocabulary. */
export function normalizeRollProhibitionParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "roll-prohibition") return null;
  exactKeys(input, ["roll"], family);
  return { roll: enumValue(input.roll, ROLL_KINDS, "roll-prohibition.roll") };
}
