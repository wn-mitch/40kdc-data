import type { SemanticFamilyDefinition } from "./contracts.js";
import { enumValue, exactKeys } from "./family-validation.js";

/**
 * Wave-10 counts-as-moved: a status that makes a unit count as having made a move this turn or
 * phase (a status that makes carried units count as having made a move). It is a modifier that folds into
 * the disembark permission before it (compile-counts-as-moved.ts), so it gates nothing and has no
 * subject: the disembarking units are not a subject the DSL can name for a permission.
 */

/** The move kinds a counts-as-moved status can name. Only "normal" is evidenced; widen by a new version. */
export const COUNTS_AS_MOVED_MOVE_TYPES = ["normal"] as const;

/** The only printed period the status takes: "that phase". Absent means the DSL default applies. */
export const COUNTS_AS_MOVED_WINDOWS = ["phase"] as const;

export const COUNTS_AS_MOVED_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "counts-as-moved",
    version: 1,
    role: "CONDITION",
    label: "Counts as having made a move",
    description: "The units a disembark permission before it allows count as having made a move of that kind this turn (or this phase, when window is phase). It qualifies that permission and gates nothing.",
    starter: { move_type: "" },
    parameterSchema: {
      type: "object",
      required: ["move_type"],
      properties: {
        move_type: { enum: COUNTS_AS_MOVED_MOVE_TYPES },
        window: { enum: COUNTS_AS_MOVED_WINDOWS },
      },
      additionalProperties: false,
    },
  },
];

/** Normalizes counts-as-moved parameters; returns null for any other family. */
export function normalizeCountsAsMovedParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "counts-as-moved") return null;
  if (!("move_type" in input)) throw new TypeError("counts-as-moved.move_type is required.");
  exactKeys(input, ["move_type", ...("window" in input ? ["window"] : [])], family);
  const result: Record<string, unknown> = {
    move_type: enumValue(input.move_type, COUNTS_AS_MOVED_MOVE_TYPES, "counts-as-moved.move_type"),
  };
  if ("window" in input) result.window = enumValue(input.window, COUNTS_AS_MOVED_WINDOWS, "counts-as-moved.window");
  return result;
}
