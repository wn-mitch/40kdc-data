import { currentFamilyVersion } from "./contracts.js";

/**
 * Deterministic readings of a Stratagem's own conventions, applied to a labeller's span before
 * it is validated, and recorded on the proposal so review sees what changed:
 *
 * - a WHEN line that names only a phase ("End of the Fight phase.", "Your opponent's Shooting
 *   phase.") is the Stratagem's use window, never a trigger;
 * - "your unit" / "that unit" is the Stratagem's target (`this-unit`), unless the ability selects
 *   a unit of its own, so a `selected-unit` value becomes `this-unit`.
 */

const PHASES = ["command", "movement", "shooting", "charge", "fight"] as const;
const PURE_PHASE = /^(?:(?:at\s+)?(?:the\s+)?(?:start|end)\s+of\s+)?(?:(?:the|your|your\s+opponent['’]s|either\s+player['’]s|any)\s+)?(command|movement|shooting|charge|fight|any)\s+phase\.?$/iu;
const SELECTING_FAMILIES = new Set(["select-unit", "for-each-unit-select"]);

/** The use window a WHEN line names when it names only a phase; null when it says anything more. */
export function stratagemWhenWindow(text: string): { your_phases: string[]; opponent_phases: string[]; either_phases: string[] } | null {
  const match = PURE_PHASE.exec(text.trim().replace(/\s+/gu, " "));
  if (!match) return null;
  const phase = match[1]!.toLowerCase();
  const phases = phase === "any" ? [...PHASES] : [phase];
  const owner = /\byour\s+opponent['’]s\b/iu.test(text) ? "opponent" : /\byour\b/iu.test(text) ? "your" : "either";
  return {
    your_phases: owner === "your" ? phases : [],
    opponent_phases: owner === "opponent" ? phases : [],
    either_phases: owner === "either" ? phases : [],
  };
}

function replaceSelected(value: unknown): unknown {
  if (value === "selected-unit") return "this-unit";
  if (Array.isArray(value)) return value.map(replaceSelected);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceSelected(item)]));
  return value;
}

/** Apply the Stratagem conventions to one reported span. Non-Stratagem spans pass through. */
export function rewriteStratagemSpan(
  span: Record<string, unknown>, context: { sourceType: string | null; fragment: string; exactText: string; abilitySelects: boolean },
): { span: Record<string, unknown>; rewrites: string[] } {
  if (context.sourceType !== "stratagem") return { span, rewrites: [] };
  const rewrites: string[] = [];
  let result = span;
  const window = context.fragment === "WHEN" ? stratagemWhenWindow(context.exactText) : null;
  if (window && !(span.family_id === "use-window" && span.status === "EXISTING")) {
    const { description: _description, hypothesis: _hypothesis, ...rest } = span;
    result = { ...rest, status: "EXISTING", role: "RESTRICTION", family_id: "use-window", family_version: currentFamilyVersion("use-window"), parameters: window };
    rewrites.push(`WHEN names only a phase: the Stratagem's use window (was ${String(span.family_id ?? span.status)}).`);
  }
  if (!context.abilitySelects && result.parameters && JSON.stringify(result.parameters).includes("\"selected-unit\"")) {
    result = { ...result, parameters: replaceSelected(result.parameters) };
    rewrites.push("\"Your unit\" in a Stratagem is its target: selected-unit became this-unit.");
  }
  return { span: result, rewrites };
}

/** Whether a response's spans for one ability select a unit of their own. */
export function spansSelectAUnit(spans: readonly unknown[]): boolean {
  return spans.some((value) => value !== null && typeof value === "object" && SELECTING_FAMILIES.has(String((value as Record<string, unknown>).family_id)));
}
