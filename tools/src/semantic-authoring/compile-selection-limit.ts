import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A per-model usage limit on a model selection ("each model can only be selected for this ability
 * once per turn"): the cap is on each selected model, so it lowers to the selector's
 * selection_limit, not to the ability's usage. Only frequencies with a selection period lower;
 * the rest keep their refusal.
 */

type Limit = { count: number; period: string };

/** The period a usage frequency names for each selected model; once-per-battle caps one selection. */
const PERIODS: Record<string, Limit | "command-phase"> = {
  "once-per-turn": { count: 1, period: "turn" },
  "once-per-phase": { count: 1, period: "phase" },
  "once-per-command-phase": "command-phase",
  "once-per-battle-round": { count: 1, period: "battle-round" },
  "once-per-battle": { count: 1, period: "battle" },
};

/**
 * selection_limit for one per-model usage-limit. "once per Command phase" lowers to the phase
 * period only when the ability's own phase-window is that Command phase; any other window, or
 * none, leaves the phase unnamed and refuses.
 */
export function selectionLimitFor(usage: CompileLeaf, list: readonly CompileLeaf[]): Limit {
  const frequency = String(usage.parameters.frequency);
  const mapped = PERIODS[frequency];
  if (mapped === undefined) throw new CompileError(`A per-model usage of ${frequency} has no selection period yet.`);
  if (mapped !== "command-phase") return mapped;
  const windows = list.filter((leaf) => leaf.family_id === "phase-window");
  if (windows.length !== 1 || windows[0]!.parameters.phase !== "command") {
    throw new CompileError("A per-model once-per-Command-phase usage needs the ability's phase window to be that Command phase.");
  }
  return { count: 1, period: "phase" };
}
