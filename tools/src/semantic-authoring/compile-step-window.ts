import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "The Reinforcements step of your opponent's Movement phase, just after an enemy unit is set up
 * …", "Battle-shock step of your Command phase, just before you make a Battle-shock roll": a
 * step-started leaf followed in its clause by the moment that happens in that step. The step is
 * the moment's window, not a second moment, so the fold removes the step leaf and stores the step
 * and whose turn on the moment (`step_window`), which `trigger()` lowers to its phase-is and
 * player-turn-is condition. "In the Reinforcements step of your Movement phase, when you set up a
 * unit …" opens its moment with ", when" the same way. The moment's "or" alternatives in the same
 * sentence share the step. A step followed by anything else (an "or", or a moment in another clause)
 * stays its own moment.
 */

/** The phase each step belongs to. */
export const STEP_PHASES: Readonly<Record<string, string>> = { "battle-shock": "command", reinforcements: "movement" };

/** Leaves between the step and its moment that only describe the moment's unit. */
const BETWEEN = new Set(["unit-filter", "unit-owner"]);
/** Moments that are themselves clock boundaries, which a step cannot narrow. */
const CLOCK = new Set(["phase-start", "phase-end", "step-started", "turn-ended", "round-ended", "battle-started", "deployment-ended"]);
/** The words after a step that open its moment: a comma, then "just after", "just before" or "when" (inside the moment leaf or before it). */
const JOIN = /^\s*,\s*(?:just\s+(?:after|before)|when)\b/iu;
/** The words between the step and the moment's first leaf: none but the comma and that opening. */
const BETWEEN_WORDS = /^\s*,\s*(?:(?:just\s+(?:after|before)|when)\b[^.;:]*)?$/iu;

export function foldStepWindow(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined || !list.some(isStep)) return [...list];
  const bytes = Buffer.from(sourceText, "utf8");
  const out = [...list];
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const step = out[index]!;
    if (!isStep(step)) continue;
    let at = index + 1;
    while (at < out.length && out[at]!.fragment === step.fragment && BETWEEN.has(out[at]!.family_id)) at += 1;
    const moment = out[at];
    if (moment === undefined || moment.fragment !== step.fragment || moment.family_id !== "event" || CLOCK.has(String(moment.parameters.kind))) continue;
    const first = out[index + 1]!;
    if (step.end_byte === undefined || first.start_byte === undefined) continue;
    if (!BETWEEN_WORDS.test(bytes.subarray(step.end_byte, first.start_byte).toString("utf8"))) continue;
    if (!JOIN.test(bytes.subarray(step.end_byte, moment.end_byte ?? first.start_byte).toString("utf8"))) continue;
    if (moment.parameters.step_window !== undefined) throw new CompileError(`A moment at byte ${moment.start_byte} is already in a step; a second step leaf names it.`);
    const stepName = String(step.parameters.step);
    if (STEP_PHASES[stepName] === undefined) throw new CompileError(`step-started at byte ${step.start_byte} names step ${JSON.stringify(stepName)}, which belongs to no known phase.`);
    const turn = step.parameters.turn;
    const window = { step: stepName, ...(turn !== undefined && turn !== "either" ? { turn } : {}) };
    out[at] = { ...moment, parameters: { ...moment.parameters, step_window: window } };
    // "…, just after an enemy unit is set up … or just after an enemy unit ends a Normal move": each alternative
    // printed after the moment, before any effect and in the same sentence, happens in the same step.
    let previous = out[at]!;
    for (let next = at + 1; next < out.length && out[next]!.fragment === step.fragment && out[next]!.role !== "EFFECT"; next += 1) {
      const leaf = out[next]!;
      if (previous.end_byte === undefined || leaf.start_byte === undefined) break;
      const gap = bytes.subarray(previous.end_byte, leaf.start_byte).toString("utf8");
      if (/[.;:]/u.test(gap)) break;
      if (leaf.family_id === "event" && !CLOCK.has(String(leaf.parameters.kind)) && /\bor\b/iu.test(gap)) {
        if (leaf.parameters.step_window !== undefined) throw new CompileError(`A moment at byte ${leaf.start_byte} is already in a step; a second step leaf names it.`);
        out[next] = { ...leaf, parameters: { ...leaf.parameters, step_window: window } };
      }
      previous = out[next]!;
    }
    out.splice(index, 1);
  }
  return out;
}

function isStep(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" && leaf.parameters.kind === "step-started";
}
