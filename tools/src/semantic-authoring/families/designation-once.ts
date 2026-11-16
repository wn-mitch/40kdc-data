import type { SemanticFamilyDefinition } from "../contracts.js";

/**
 * "Each enemy unit can only be marked as a Spotted unit once per phase": a unit that already carries
 * the designation cannot be selected to carry it again, so the selection before the leaf takes only
 * units without it (compile-designation-once.ts). The designation's own duration ends with the window
 * the rule prints, so "once per phase" is the designation not yet applied.
 */
export const DESIGNATION_ONCE_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "designation-once",
    version: 1,
    role: "RESTRICTION",
    label: "Designation applied once",
    description: "\"Each enemy unit can only be marked as a Spotted unit once per phase\": the selection before the leaf takes only units that do not already carry the tag. tag is the designation (a registered designation id). The tag the record applies must last no longer than the window the rule prints.",
    starter: { tag: "" },
    parameterSchema: {
      type: "object",
      required: ["tag"],
      properties: { tag: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
];

/** designation-once takes only its tag. */
export function normalizeDesignationOnceParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "designation-once") return null;
  const stray = Object.keys(input).filter((key) => key !== "tag");
  if (stray.length) throw new TypeError(`designation-once has no parameter ${stray[0]}.`);
  if (typeof input.tag !== "string" || input.tag.trim() === "") throw new TypeError("designation-once.tag names a designation.");
  return { tag: input.tag.trim() };
}
