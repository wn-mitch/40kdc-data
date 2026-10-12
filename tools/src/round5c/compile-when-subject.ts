import { ATTACK_EVENTS } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { STRATAGEM_HEADER } from "./compile-segments.js";

/** WHEN moments that name an enemy unit as the one acting (compile-triggers.ts: the subject owner is the enemy). */
const ENEMY_ACTING_MOMENTS = new Set(["enemy-selected-targets", "enemy-ended-move", "enemy-has-shot", "enemy-declared-charge"]);

/** The event variable a Stratagem's WHEN moment binds for the enemy unit acting in it. */
const WHEN_SUBJECT = "when-subject";

/**
 * "Fight phase, when an enemy unit targets a friendly X unit. … When an X model is destroyed, … that enemy unit
 * suffers 1 mortal wound": a later moment sits between the Stratagem's WHEN moment and the mortal wounds, so the
 * later trigger's own event-subject is not the enemy unit the WHEN moment named. The WHEN trigger binds that unit
 * (`binds_event_variable`) and the mortal wounds name it by `event_var` (compile-fragments.ts reads `recipient_var`).
 *
 * Binds only a mortal-wounds recipient `that-unit` whose own wording says "enemy", in a Stratagem with no selection
 * of its own and exactly one enemy-acting WHEN moment, and only past a moment that nests under the WHEN moment
 * (nestedWhenMoments). Without one the leaf is left for the selection rule (compile.ts), whose refusal stands.
 */
export function bindWhenSubject(leaves: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (sourceText === undefined || !leaves.some((leaf) => STRATAGEM_HEADER.has(leaf.family_id))) return [...leaves];
  if (leaves.some((leaf) => leaf.family_id === "select-unit" || leaf.family_id === "for-each-unit-select")) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const whens = leaves.flatMap((leaf, index) => leaf.family_id === "event" && leaf.fragment === "WHEN" && ENEMY_ACTING_MOMENTS.has(String(leaf.parameters.kind)) ? [index] : []);
  if (whens.length !== 1) return [...leaves];
  const when = whens[0]!;
  const nested = nestedWhenMoments(leaves);
  const binds = (leaf: CompileLeaf, index: number): boolean => {
    if (leaf.family_id !== "mortal-wounds" || leaf.parameters.recipient !== "that-unit" || leaf.end_byte === undefined || index < when) return false;
    if (!/\benemy\b/iu.test(bytes.subarray(leaf.start_byte, leaf.end_byte).toString("utf8"))) return false;
    return [...nested].some((at) => at > when && at < index);
  };
  if (!leaves.some(binds)) return [...leaves];
  const existing = leaves[when]!.parameters.binds_event_variable;
  if (existing !== undefined && existing !== WHEN_SUBJECT) throw new CompileError(`The WHEN moment is bound as both ${String(existing)} and ${WHEN_SUBJECT}.`);
  return leaves.map((leaf, index) => index === when ? { ...leaf, parameters: { ...leaf.parameters, binds_event_variable: WHEN_SUBJECT } }
    : binds(leaf, index) ? { ...leaf, parameters: { ...leaf.parameters, recipient_var: WHEN_SUBJECT } } : leaf);
}

/** Leaves only a Stratagem has: its phase window, its TARGET and its cost. */
const STRATAGEM_LEAVES = new Set([...STRATAGEM_HEADER, "triggering-target", "target-binding"]);

/**
 * The moments of a Stratagem's effect text that sit under the moment its WHEN clause names: "Fight phase, when an
 * enemy unit targets a friendly X unit. … Each time an X model is destroyed, …". The WHEN moment is when the
 * Stratagem is used; the moment printed with the effects is when the effect then happens, so it is a part nested under
 * the WHEN trigger, never an alternative trigger beside it (a trigger list fires on any one of its moments).
 *
 * Returns the positions in `list` of those moments: the non-WHEN moments printed before the first effect, in a
 * Stratagem that has a WHEN moment before them and no moment after its first effect. A record whose later moments
 * start parts of their own keeps the old reading for every moment. A moment that restates a WHEN moment ("when a
 * unit is selected to Fall Back" in both) or is the Stratagem's own use ("each time you use this Stratagem") is
 * the WHEN moment again and stays beside it.
 */
export function nestedWhenMoments(list: readonly CompileLeaf[]): Set<number> {
  const nested = new Set<number>();
  if (!list.some((leaf) => STRATAGEM_LEAVES.has(leaf.family_id))) return nested;
  const first = list.findIndex((leaf) => leaf.role === "EFFECT");
  const moment = (leaf: CompileLeaf) => leaf.role === "EVENT" && leaf.family_id === "event" && !ATTACK_EVENTS.has(String(leaf.parameters.kind));
  const opening = list.findIndex((leaf) => moment(leaf) && leaf.fragment === "WHEN");
  if (first === -1 || opening === -1) return nested;
  // The same moment printed again in the effect text, or a use of the Stratagem itself, is the WHEN moment, not a later one.
  const key = (leaf: CompileLeaf) => JSON.stringify([leaf.parameters.kind, leaf.parameters.to, leaf.parameters.activity, leaf.parameters.move_types, leaf.parameters.action_kind]);
  const restated = (leaf: CompileLeaf) => (leaf.parameters.kind === "used" && leaf.parameters.activity === "stratagem")
    || list.some((other) => moment(other) && other.fragment === "WHEN" && key(other) === key(leaf));
  const own = list.flatMap((leaf, index) => moment(leaf) && leaf.fragment !== "WHEN" && index > opening && !restated(leaf) ? [index] : []);
  if (own.some((index) => index > first)) return nested;
  // A set-up moment beside another moment has its own decided refusal and pinned readings (compile.ts, compile-durations tests).
  if (own.some((index) => list[index]!.parameters.kind === "set-up")) return nested;
  for (const index of own) nested.add(index);
  return nested;
}
