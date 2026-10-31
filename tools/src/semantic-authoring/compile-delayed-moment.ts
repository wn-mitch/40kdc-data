import { exactSpan } from "./contracts.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { trigger } from "./compile-triggers.js";

type Node = Record<string, unknown>;

/** The event variable the leading moment binds for the enemy unit a delayed moment names again. */
const DELAYED_SUBJECT = "moment-subject";

/** Moments whose actor is an enemy unit (compile-triggers.ts names it as the subject). */
const ENEMY_ACTING = new Set(["enemy-selected-targets", "enemy-ended-move", "enemy-has-shot", "enemy-declared-charge"]);

const enemyActing = (leaf: CompileLeaf) => leaf.family_id === "event"
  && (ENEMY_ACTING.has(String(leaf.parameters.kind)) || (leaf.parameters.kind === "targets-selected" && leaf.parameters.owner === "enemy"));

/**
 * "… that enemy unit suffers 1 mortal wound after that enemy unit has shot": a moment printed right
 * after an effect, ending its sentence, delays that effect: each time the effect would apply, it waits
 * for the moment. The moment leaves the list, and the effect leaf carries its trigger (`delayed_trigger`),
 * which compile-part-plan.ts wraps around the effect as a part for the rest of the phase.
 *
 * "That enemy unit" in the moment is the unit the record's leading moment names as the acting enemy:
 * that moment binds it (`binds_event_variable`) and the delayed trigger's subject is that binding.
 * Folds only a moment that opens with "after", says "that", and acts as an enemy unit, after an
 * effect with only spaces between, and with nothing but the end of its sentence after it, in a record
 * with exactly one leading enemy-acting moment. Any other moment is left for the part planner.
 */
export function foldDelayedMoments(list: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (sourceText === undefined) return [...list];
  const firstEffect = list.findIndex((leaf) => leaf.role === "EFFECT");
  if (firstEffect === -1) return [...list];
  const text = (from: number, to: number) => exactSpan(sourceText, from, to);
  const delayed = list.flatMap((leaf, index) => {
    const effect = list[index - 1];
    if (index <= firstEffect || !enemyActing(leaf) || effect?.role !== "EFFECT" || effect.end_byte === undefined || leaf.end_byte === undefined) return [];
    if (effect.fragment !== leaf.fragment || effect.end_byte > leaf.start_byte || !/^[\s*]*$/u.test(text(effect.end_byte, leaf.start_byte))) return [];
    if (!/^after\b.*\bthat\b/iu.test(text(leaf.start_byte, leaf.end_byte))) return [];
    const next = list[index + 1];
    const rest = text(leaf.end_byte, next?.fragment === leaf.fragment ? next.start_byte : Buffer.byteLength(sourceText, "utf8"));
    return rest.trim() === "" || /^[\s*]*[.;]/u.test(rest) ? [index] : [];
  });
  if (delayed.length === 0) return [...list];
  const leading = list.slice(0, firstEffect).flatMap((leaf, index) => enemyActing(leaf) ? [index] : []);
  if (leading.length !== 1) throw new CompileError("A delayed moment names \"that\" enemy unit, but no one earlier moment names an acting enemy unit.");
  const binds = list[leading[0]!]!.parameters.binds_event_variable;
  if (binds !== undefined && binds !== DELAYED_SUBJECT) throw new CompileError(`The leading moment is bound as both ${String(binds)} and ${DELAYED_SUBJECT}.`);
  const out = [...list];
  out[leading[0]!] = { ...out[leading[0]!]!, parameters: { ...out[leading[0]!]!.parameters, binds_event_variable: DELAYED_SUBJECT } };
  for (const index of delayed) {
    const effect = out[index - 1]!;
    const node: Node = { ...trigger(out[index]!), subject: { event_var: DELAYED_SUBJECT } };
    out[index - 1] = { ...effect, parameters: { ...effect.parameters, delayed_trigger: node } };
  }
  return out.filter((_leaf, index) => !delayed.includes(index));
}

/** An effect a delayed moment holds: a part on that moment for the rest of the phase, once per time the effect applies. */
export function wrapDelayed(leaf: CompileLeaf, node: Node): Node {
  const held = leaf.parameters.delayed_trigger;
  return held === undefined ? node : { type: "ability-part", trigger: held, duration: "phase", effect: node };
}
