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

/** Leaves of a Stratagem's EFFECT window lead-in that only say whose moment it is. */
const WINDOW_SUBJECT = new Set(["unit-filter"]);
/** An "or" between two alternative moments of the window. */
const OR_BETWEEN = /^[\s,]*(?:or|and\/or)\b/iu;

/**
 * "WHEN: Start of your opponent's Movement phase. … EFFECT: Until the end of the phase, each time an enemy unit is set
 * up or ends a Normal, Advance or Fall Back move within 6\" of your unit, roll one D6 …": the WHEN moment is when the
 * Stratagem is used, and the EFFECT opens a window with later moments of its own. Those moments are alternatives to
 * each other, not to the WHEN moment: the record compiles without them (its WHEN moment, duration and effects), and
 * its effect becomes a part on them, armed for that duration.
 *
 * Applies only to one WHEN moment, an EFFECT that opens with a duration, then one or more event moments joined by
 * "or" before the first effect, with at most one side-only unit-filter before them (its side is each moment's owner).
 * Returns null for any other record, which keeps its other readings.
 */
export function compileStratagemWindowMoments(list: readonly CompileLeaf[], sourceText: string | undefined, compile: (leaves: readonly CompileLeaf[]) => Compiled): Compiled | null {
  if (sourceText === undefined) return null;
  const when = list.filter((leaf) => leaf.fragment === "WHEN" && leaf.role === "EVENT");
  if (when.length !== 1 || when[0]!.family_id !== "event") return null;
  const effectAt = list.findIndex((leaf) => leaf.fragment === "EFFECT");
  if (effectAt === -1 || list[effectAt]!.family_id !== "duration") return null;
  let at = effectAt + 1;
  const subject = list[at] !== undefined && WINDOW_SUBJECT.has(list[at]!.family_id) && list[at]!.fragment === "EFFECT" ? list[at++]! : null;
  if (subject && Object.keys(subject.parameters).some((key) => key !== "side")) return null;
  const moments: CompileLeaf[] = [];
  while (list[at]?.fragment === "EFFECT" && list[at]!.family_id === "event") moments.push(list[at++]!);
  if (moments.length === 0) return null;
  const firstEffect = list.findIndex((leaf, index) => index > effectAt && leaf.role === "EFFECT");
  if (firstEffect !== -1 && firstEffect < at) return null;
  for (let index = 1; index < moments.length; index += 1) {
    const before = moments[index - 1]!;
    if (before.end_byte === undefined || !OR_BETWEEN.test(exactSpan(sourceText, before.end_byte, moments[index]!.start_byte))) return null;
  }
  const side = subject ? String(subject.parameters.side) : null;
  const owned = moments.map((moment) => side !== null && moment.parameters.owner === undefined && moment.parameters.subject === undefined
    ? { ...moment, parameters: { ...moment.parameters, owner: side } } : moment);
  const signature = shapeSignature(list, sourceText);
  const outer = compile(list.filter((leaf) => leaf !== subject && !moments.includes(leaf)));
  if (!outer.ok) return { ok: false, signature, errors: outer.errors };
  const mechanics = outer.mechanics;
  const leadingTrigger = (mechanics as unknown as Node).trigger;
  if (leadingTrigger === undefined || leadingTrigger === null || Array.isArray(leadingTrigger)) {
    return { ok: false, signature, errors: ["A moment within a Stratagem's window needs its WHEN moment as the ability's one trigger."] };
  }
  const inner = owned.map((moment) => trigger(moment));
  return { ...outer, signature, mechanics: { ...mechanics, effect: { type: "ability-part", trigger: inner.length === 1 ? inner[0]! : inner, effect: mechanics.effect } } };
}
