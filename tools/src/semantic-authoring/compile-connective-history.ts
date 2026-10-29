import { ATTACK_EVENTS } from "./compile-conditions.js";
import { CompileError, type CompileLeaf, type LeafConnective } from "./compile-fragments.js";
import { placements } from "./compile-placement.js";
import { trigger } from "./compile-triggers.js";

/**
 * A reviewed condition-of "if" before a moment (class D): "after it shoots, if a model in this unit
 * was destroyed by those attacks, …". The moment is not when the ability fires; it is a condition on
 * what happened, so it lowers to the DSL `happened` condition with the moment's own event, subject,
 * object and filter, gating what follows it as any condition leaf would.
 *
 * A history condition needs a point at which it is checked and a window it looks back over:
 * - an earlier moment, the only one of its run, is the check: the window is `event` (what happened
 *   during that triggering event), unless a `history-window` leaf names another;
 * - with no earlier moment, an attack after it in its sentence is the check ("if your unit does X,
 *   each time it makes an attack, …"): the window is the duration before it in its sentence, unless
 *   a `history-window` leaf names one.
 * Everything else is refused with the reason: no check point, alternative moments before it, a game
 * clock boundary with no named window, or a moment whose trigger carries what `happened` cannot.
 */

/** A planned history condition: the moment leaf it replaces, and the window planning derived (null: a named window must supply it). */
export type HistoryPlan = { kind: "history"; moment: { fragment: string; start_byte: number; end_byte: number; family_id: string }; window: string | null; why: string };

/** The bare words a history condition opens with ("If", "but if", "and if"). */
const IF_WORD = /^(?:(?:but|and)\s+)?if$/iu;
/** "While" before a moment says how long something lasts ("while resolving those attacks"), not a history. */
const WHILE_WORD = /^while$/iu;
/** Moments that are the game clock: "during the triggering event" says nothing at a boundary. */
const CLOCK_EVENTS = new Set([
  "army-selected", "battle-started", "battle-formations-declared", "deployment-ended", "round-started", "round-ended",
  "turn-started", "turn-ended", "phase-started", "phase-ended", "step-started",
]);
/** Duration endpoints that are also history windows (condition.schema.json history-window). */
const DURATION_WINDOWS: Record<string, string> = { "end-of-phase": "phase", "end-of-turn": "turn", "end-of-battle-round": "battle-round", "end-of-battle": "battle" };
/** The trigger fields a `happened` condition carries as they are. */
const CARRIED = new Set(["event", "subject", "object", "filter", "proximity"]);

const fragmentOf = (leaf: CompileLeaf) => leaf.fragment ?? "RAW_TEXT";
const wording = (connective: LeafConnective) => connective.surface.replace(/[*_]/gu, "").trim();

/** The bare connective that makes a moment leaf a condition on history, if it has one. */
export function historyConnective(leaf: CompileLeaf): LeafConnective | undefined {
  return leaf.connectives?.find((connective) => connective.relation === "condition-of" && !connective.within && !connective.trailing && IF_WORD.test(wording(connective)));
}

/** An attack the leaves check per attack: the `attack` gate, or an attack-made/hit/wound event. */
const isAttackGate = (leaf: CompileLeaf) => leaf.family_id === "attack" || (leaf.family_id === "event" && ATTACK_EVENTS.has(String(leaf.parameters.kind)));

/**
 * Plan the history condition a bare connective before a moment asks for, or throw why it has none.
 * `list` is in source order; `at` is the moment's index; `isMoment` is the plan's own moment test.
 */
export function planHistory(list: readonly CompileLeaf[], at: number, connective: LeafConnective, sourceText: string | undefined, isMoment: (leaf: CompileLeaf) => boolean): HistoryPlan {
  const leaf = list[at]!;
  const word = wording(connective);
  const kind = String(leaf.parameters.kind ?? leaf.family_id);
  if (WHILE_WORD.test(word)) {
    throw new CompileError(`"${word}" before the ${kind} moment says how long the effects after it last, not a condition on what happened; review it as a duration.`);
  }
  if (!IF_WORD.test(word)) throw new CompileError(`"${word}" before the ${kind} moment is neither "if" nor "while"; a condition on what happened has no lowering for it.`);
  if (kind === "resource-spent") {
    throw new CompileError(`"${word}" before a resource spend is a cost the player chooses to pay, not a condition on what happened, and a history condition cannot carry the amount; review the spend as an optional cost.`);
  }
  const moment = { fragment: fragmentOf(leaf), start_byte: leaf.start_byte, end_byte: leaf.end_byte ?? leaf.start_byte, family_id: leaf.family_id };
  // The nearest earlier moment, and the run of moments it belongs to (no effect between them).
  let nearest = -1;
  for (let back = at - 1; back >= 0; back--) if (isMoment(list[back]!) && !historyConnective(list[back]!)) { nearest = back; break; }
  if (nearest !== -1) {
    let run = 1;
    for (let back = nearest - 1; back >= 0 && list[back]!.role !== "EFFECT"; back--) if (isMoment(list[back]!) && !historyConnective(list[back]!)) run += 1;
    if (run > 1) throw new CompileError(`"${word}" before the ${kind} moment follows ${run} moments with no effect between them; which triggering event its history looks back over has no decided reading.`);
    let event: unknown;
    try { event = trigger(list[nearest]!).event; } catch { event = undefined; }
    const clock = typeof event === "string" && CLOCK_EVENTS.has(event);
    return { kind: "history", moment, window: clock ? null : "event", why: `"${word}" before the ${kind} moment looks back from the ${String(event ?? list[nearest]!.family_id)} boundary, where "during the triggering event" says nothing; a history-window leaf must name its window.` };
  }
  // No earlier moment: an attack after it in its sentence checks it, over the duration before it in its sentence.
  const places = placements(list, sourceText);
  const sentence = places[at]!.sentence;
  const inSentence = (index: number) => places[index]!.sentence === sentence && fragmentOf(list[index]!) === fragmentOf(leaf);
  const attack = list.findIndex((other, index) => index > at && inSentence(index) && isAttackGate(other));
  if (attack === -1) {
    // "If that unit destroys an enemy unit, until the end of the battle, …": from the moment it happens to the duration's
    // end is exactly "it has happened" over that window, so the duration after it in its sentence names the window.
    const after = list.findIndex((other, index) => index > at && inSentence(index) && other.role === "DURATION" && other.family_id === "duration");
    const named = after === -1 ? undefined : DURATION_WINDOWS[String(list[after]!.parameters.endpoint)];
    if (named !== undefined) return { kind: "history", moment, window: named, why: "" };
    throw new CompileError(`"${word}" before the ${kind} moment has nothing that checks what happened: no earlier moment, and no attack after it in its sentence. An event with nothing before it to look back from is when the ability fires; review the connective if it is.`);
  }
  let window: string | null = null;
  for (let back = at - 1; back >= 0 && inSentence(back); back--) {
    const other = list[back]!;
    if (other.role === "DURATION" && other.family_id === "duration") { window = DURATION_WINDOWS[String(other.parameters.endpoint)] ?? null; break; }
  }
  return { kind: "history", moment, window, why: `"${word}" before the ${kind} moment is checked at each attack after it, but no duration before it in its sentence and no history-window leaf says how far back it looks.` };
}

/** A phase-window leaf naming one phase, written right after a history moment in its fragment ("… in the Fight phase"). */
function phaseOfMoment(moment: CompileLeaf, next: CompileLeaf): boolean {
  if (next.family_id !== "phase-window" || fragmentOf(next) !== fragmentOf(moment)) return false;
  const keys = Object.keys(next.parameters);
  const gap = next.start_byte - (moment.end_byte ?? moment.start_byte);
  return keys.length === 1 && typeof next.parameters.phase === "string" && gap >= 0 && gap <= 1;
}

/**
 * Replace each planned moment (after folds) by a CONDITION leaf that lowers to its `happened` condition (`__happened`,
 * compile-conditions.ts). A `history_window` the history-window fold stored on the leaf names the
 * window over the planned one.
 */
export function lowerHistoryMoments(list: readonly CompileLeaf[], plans: readonly HistoryPlan[]): CompileLeaf[] {
  if (plans.length === 0) return [...list];
  const out = [...list];
  for (const plan of plans) {
    // Folds may widen the moment over what they absorb (a filter before it, a history-window after it), never narrow it.
    const index = out.findIndex((leaf) => fragmentOf(leaf) === plan.moment.fragment && leaf.family_id === plan.moment.family_id
      && leaf.start_byte <= plan.moment.start_byte && (leaf.end_byte ?? leaf.start_byte) >= plan.moment.end_byte);
    if (index === -1) throw new CompileError(`The ${plan.moment.family_id} moment a reviewed "if" makes a condition was folded into another leaf; its history has no leaf of its own to lower.`);
    const leaf = out[index]!;
    const { history_window: named, ...parameters } = leaf.parameters;
    const window = typeof named === "string" ? named : plan.window;
    if (window === null) throw new CompileError(plan.why);
    const node = trigger({ ...leaf, parameters });
    const extra = Object.keys(node).filter((key) => !CARRIED.has(key));
    if (extra.length > 0) throw new CompileError(`The ${String(leaf.parameters.kind ?? leaf.family_id)} moment a reviewed "if" makes a condition lowers with ${extra.join(", ")}, which a happened condition does not carry.`);
    const happened: Record<string, unknown> = { event: node.event };
    for (const key of ["subject", "object", "filter", "proximity"] as const) if (node[key] !== undefined) happened[key] = node[key];
    happened.window = window;
    out[index] = { ...leaf, role: "CONDITION", family_id: "__happened", family_version: 1, parameters: { happened } };
    // "destroys one or more enemy units in the Fight phase": a phase right after the moment says when it happened.
    // Over the triggering event the phase is the current one, a clock condition the phase-window leaf already is.
    const next = out[index + 1];
    if (window !== "event" && next !== undefined && phaseOfMoment(leaf, next)) {
      happened.filter = { ...(happened.filter as Record<string, unknown> | undefined), phase: next.parameters.phase };
      out.splice(index + 1, 1);
    }
  }
  return out;
}
