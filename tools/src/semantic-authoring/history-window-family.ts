import type { SemanticFamilyDefinition } from "./contracts.js";
import { enumValue } from "./family-validation.js";

/**
 * `history-window` (wave 10): the words "this phase", "this turn", "this battle" or "during the
 * battle" that close a history condition. The activity leaf before it cannot span them (a
 * unit-filter sits between), so a leaf accounts for them. compile-history-window.ts folds it into
 * the history condition it follows.
 */
export const HISTORY_WINDOWS = ["phase", "turn", "battle"] as const;

export const HISTORY_WINDOW_FAMILIES: readonly SemanticFamilyDefinition[] = [
  {
    id: "history-window",
    version: 1,
    role: "CONDITION",
    label: "History window",
    description: "The window of the history condition before it: \"this phase\", \"this turn\", \"this battle\", \"during the battle\". Folds into a windowed destruction (destroyed-units-in-window) or a set-up activity; for a set-up activity it must agree with the window the activity already names.",
    starter: { window: "phase" },
    parameterSchema: {
      type: "object",
      required: ["window"],
      properties: { window: { enum: HISTORY_WINDOWS } },
      additionalProperties: false,
    },
  },
];

export function normalizeHistoryWindowParameters(family: string, input: Record<string, unknown>): Record<string, unknown> | null {
  if (family !== "history-window") return null;
  const stray = Object.keys(input).filter((key) => key !== "window");
  if (stray.length) throw new TypeError(`history-window has no parameter ${stray[0]}.`);
  return { window: enumValue(input.window, HISTORY_WINDOWS, "history-window.window") };
}
