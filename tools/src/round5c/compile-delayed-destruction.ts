/**
 * A destruction moment and the delayed end of a phase that follow it ("the first time this model
 * is destroyed, at the end of the phase"). The two moments are one moment, "at the end of each
 * phase in which this model was destroyed": a phase-ended trigger with a `happened` condition on
 * the destruction in that phase. A trigger list would fire on the destruction itself, and a
 * destruction moment that is not lowered this way has no DSL form (compile.ts applies it).
 */

import { exactSpan } from "./contracts.js";
import type { CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** The lowered moment: the phase-ended trigger, and the condition that the destruction happened this phase. */
export type DelayedDestruction = { trigger: Node; condition: Node };

/** The refusal for a nested moment that cannot be lowered (compile.ts pushes it verbatim). */
export const NESTED_MOMENT_ERROR = "A moment nested in another (\"each time …, at the end of the phase\") has no DSL trigger; a trigger list fires on any one of its moments.";

/** The event leaf that a model's own destruction is ("this model is destroyed"). */
export function isThisModelDestroyed(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" && leaf.parameters.kind === "this-model-destroyed";
}

/** The end of any phase, in either player's turn: the only delayed moment this module lowers. */
export function isAnyPhaseEnd(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" && leaf.parameters.kind === "phase-end"
    && (leaf.parameters.phase === undefined || leaf.parameters.phase === "any")
    && (leaf.parameters.turn === undefined || leaf.parameters.turn === "either");
}

/**
 * The source between a destruction moment and a phase-end moment, in either order. Leaves that
 * overlap or lack offsets have no gap between them.
 */
export function momentGap(sourceText: string, first: CompileLeaf, second: CompileLeaf): string {
  const from = first.end_byte ?? first.start_byte;
  const to = second.start_byte;
  return from < to ? exactSpan(sourceText, from, to) : "";
}

/**
 * Lowers a destruction moment and a phase-end moment that are nested in one another.
 *
 * - `null`: the pair is joined by "or", a genuine alternative. The caller keeps the trigger list.
 * - `{ error }`: the pair is nested but cannot be lowered: it is joined by "and", or the ability
 *   says "first time" with no usage limit, which would lose the once-only property, or the
 *   ability says "each time", which the phase-end condition cannot count.
 * - `{ trigger, condition }`: the trigger is phase-ended, and the condition is the destruction of
 *   this model in that phase. The caller sets `condition` on the trigger.
 *
 * `between` is the source text between the two moments (momentGap).
 */
export function lowerDelayedDestruction(
  history: CompileLeaf,
  delayed: CompileLeaf,
  between: string,
  sourceText: string,
  hasUsage: boolean,
): DelayedDestruction | { error: string } | null {
  if (!isThisModelDestroyed(history) || !isAnyPhaseEnd(delayed)) return null;
  if (/\bor\b/iu.test(between)) return null;
  if (/\band\b/iu.test(between)) return { error: NESTED_MOMENT_ERROR };
  if (/\bfirst time\b/iu.test(sourceText) && !hasUsage) return { error: NESTED_MOMENT_ERROR };
  // "each time" repeats the destruction within a phase; the happened condition collapses those into one phase-end.
  if (/\beach time\b/iu.test(sourceText)) return { error: NESTED_MOMENT_ERROR };
  return {
    trigger: { event: "phase-ended" },
    condition: {
      type: "happened",
      parameters: { event: "model-destroyed", object: "this-model", window: "phase", count_min: 1 },
    },
  };
}

/** The moments a compile plans: lowered destruction moments by position, and positions to drop from the entry. */
export type DelayedPlan = { errors: string[]; lowered: Map<number, DelayedDestruction>; dropped: Set<number> };

/** A part of a compound ability: the leaf index of its first moment, and the moment positions it starts with. */
type PartStart = { index: number; moments: number[] };

/** Words that make a moment's gap a sequence or a choice, not a plain "destroyed, at the end of the phase". */
const SEQUENCE_WORD = /\b(?:then|or|and)\b/iu;

/**
 * Finds the destruction moments in one ability that the phase-end lowering covers, and mutates
 * `partStarts` for the one-part form. Two shapes:
 *
 * - A leading pair (both moments before the first effect), in either order: the destruction moment
 *   takes the lowered trigger and the phase-end moment is dropped.
 * - One leading destruction and one later part that is only a phase-end, with no "then", "or" or
 *   "and" in the gap: the part is removed, so the effects after the destruction run as one body.
 *
 * A nested pair with more moments than those shapes, or one that cannot be lowered, is refused.
 * Anything else keeps today's parts and triggers.
 */
export function planDelayedDestruction(
  list: readonly CompileLeaf[],
  triggerIndexes: readonly number[],
  partStarts: PartStart[],
  sourceText: string | undefined,
): DelayedPlan {
  const plan: DelayedPlan = { errors: [], lowered: new Map(), dropped: new Set() };
  if (sourceText === undefined) return plan;
  const hasUsage = list.some((leaf) => leaf.family_id === "usage-limit");
  const leafAt = (position: number) => list[triggerIndexes[position]!]!;
  const inPart = new Set(partStarts.flatMap((part) => part.moments));
  const leading = triggerIndexes.map((_, position) => position).filter((position) => !inPart.has(position));
  const destroyed = leading.filter((position) => isThisModelDestroyed(leafAt(position)));
  const delayed = leading.filter((position) => isAnyPhaseEnd(leafAt(position)));
  if (destroyed.length > 0 && delayed.length > 0) {
    if (leading.length !== 2 || destroyed.length !== 1 || delayed.length !== 1) {
      plan.errors.push(NESTED_MOMENT_ERROR);
      return plan;
    }
    const [first, second] = [leafAt(destroyed[0]!), leafAt(delayed[0]!)].sort((a, b) => a.start_byte - b.start_byte);
    const result = lowerDelayedDestruction(leafAt(destroyed[0]!), leafAt(delayed[0]!), momentGap(sourceText, first!, second!), sourceText, hasUsage);
    if (result === null) return plan;
    if ("error" in result) { plan.errors.push(result.error); return plan; }
    plan.lowered.set(destroyed[0]!, result);
    plan.dropped.add(delayed[0]!);
    return plan;
  }
  if (leading.length !== 1 || destroyed.length !== 1 || partStarts.length !== 1 || partStarts[0]!.moments.length !== 1) return plan;
  const partPosition = partStarts[0]!.moments[0]!;
  const phaseEnd = leafAt(partPosition);
  if (!isAnyPhaseEnd(phaseEnd)) return plan;
  const history = leafAt(destroyed[0]!);
  const [first, second] = history.start_byte < phaseEnd.start_byte ? [history, phaseEnd] : [phaseEnd, history];
  const gap = momentGap(sourceText, first, second);
  if (SEQUENCE_WORD.test(gap)) return plan;
  const result = lowerDelayedDestruction(history, phaseEnd, gap, sourceText, hasUsage);
  if (result === null) return plan;
  if ("error" in result) { plan.errors.push(result.error); return plan; }
  plan.lowered.set(destroyed[0]!, result);
  plan.dropped.add(partPosition);
  partStarts.splice(0);
  return plan;
}
