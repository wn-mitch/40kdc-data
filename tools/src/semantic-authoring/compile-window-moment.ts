import { exactSpan } from "./contracts.js";
import type { CompileLeaf } from "./compile-fragments.js";
import type { Compiled } from "./compile.js";
import { shapeSignature } from "./compile-placement.js";
import { foldRollFaces } from "./compile-roll-faces.js";
import { trigger } from "./compile-triggers.js";

type Node = Record<string, unknown>;

/** Only a comma or spaces between two leaves. */
const JOINED = /^[\s,]*$/u;

/**
 * "When an enemy unit targets this unit, until that enemy unit has shot, when this unit makes a save
 * roll: …": a second moment printed after the first moment's duration, before any effect, is a moment
 * within that window, not an alternative to the first. The record compiles without it (its first moment,
 * duration and effects), and its effect becomes a part on the second moment, armed for that duration.
 *
 * Applies only to one moment, then a duration, then one event moment, joined by commas and before the first
 * effect, with no other leaf between the duration and the second moment. Returns null for any other record,
 * which keeps its other readings.
 */
export function compileWindowMoment(list: readonly CompileLeaf[], sourceText: string | undefined, compile: (leaves: readonly CompileLeaf[]) => Compiled): Compiled | null {
  if (sourceText === undefined) return null;
  const firstEffect = list.findIndex((leaf) => leaf.role === "EFFECT");
  if (firstEffect === -1) return null;
  const durationAt = list.slice(0, firstEffect).findIndex((leaf) => leaf.family_id === "duration");
  if (durationAt === -1) return null;
  const leading = list.slice(0, durationAt).filter((leaf) => leaf.role === "EVENT");
  const inner = list[durationAt + 1];
  if (leading.length !== 1 || inner?.family_id !== "event" || durationAt + 1 >= firstEffect) return null;
  if (list.slice(durationAt + 2, firstEffect).some((leaf) => leaf.role === "EVENT")) return null;
  const duration = list[durationAt]!;
  const gap = (from: CompileLeaf, to: CompileLeaf) => from.end_byte !== undefined && from.end_byte <= to.start_byte && from.fragment === to.fragment
    && JOINED.test(exactSpan(sourceText, from.end_byte, to.start_byte));
  if (!gap(list[durationAt - 1]!, duration) || !gap(duration, inner)) return null;
  // The band that narrows the second moment ("on an unmodified 6") folds into it before it leaves the list.
  const folded = foldRollFaces(list);
  const moment = folded[durationAt + 1]!;
  const signature = shapeSignature(list, sourceText);
  const outer = compile(folded.filter((leaf) => leaf !== moment));
  if (!outer.ok) return { ok: false, signature, errors: outer.errors };
  const mechanics = outer.mechanics;
  const leadingTrigger = (mechanics as unknown as Node).trigger;
  if (leadingTrigger === undefined || Array.isArray(leadingTrigger)) {
    return { ok: false, signature, errors: ["A moment within an earlier moment's window needs that earlier moment as the ability's one trigger."] };
  }
  return { ...outer, signature, mechanics: { ...mechanics, effect: { type: "ability-part", trigger: trigger(moment), effect: mechanics.effect } } };
}
