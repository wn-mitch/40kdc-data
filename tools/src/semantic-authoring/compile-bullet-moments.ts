/**
 * "You gain Pain tokens as follows: ■ 1 Pain token at the start of your Command phase. ■ 1 Pain
 * token each time an enemy unit is destroyed.": each bullet prints its effect before the moment
 * that fires it. A part starts at a moment and holds the effects after it (compile-part-bindings.ts),
 * so such a bullet would hand its effect to the bullet before. This fold moves the moment (and the
 * unit-filters that lead into it) ahead of the effect, so the bullet reads moment-first. An effect
 * that ends at a colon and is followed by bullets of moments alone ("you gain 1 Miracle dice: ■ At the
 * start of each battle round. ■ Each time …") takes those moments, as alternatives, the same way.
 */

import type { CompileLeaf } from "./compile-fragments.js";

/** A moment that fires an effect: an event or the start of a turn or battle round (not a selection or a roll). */
function isMoment(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" || leaf.family_id === "turn-start";
}

/** Effects that open a container (a choice, a selection): their bullets are options, never moments. */
const CONTAINER_OPENERS = /-open$/u;

/** The bullet line each leaf starts on, or null when the line does not open with a bullet. */
function bulletLines(list: readonly CompileLeaf[], sourceText: string): Array<number | null> {
  const bytes = Buffer.from(sourceText, "utf8");
  return list.map((leaf) => {
    const lineStart = bytes.lastIndexOf(0x0a, leaf.start_byte - 1) + 1;
    const lead = bytes.subarray(lineStart, leaf.start_byte).toString("utf8");
    return /^\s*■/u.test(lead) ? lineStart : null;
  });
}

/**
 * On a bullet line whose leaves are exactly one effect, then unit-filters, then one moment that ends
 * the line's leaves, the moment and its filters move before the effect. Any other line is untouched.
 */
export function foldBulletTrailingMoments(list: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (sourceText === undefined || !sourceText.includes("■")) return [...list];
  const lines = bulletLines(list, sourceText);
  const out: CompileLeaf[] = [];
  const bytes = Buffer.from(sourceText, "utf8");
  for (let index = 0; index < list.length;) {
    // "you gain 1 Miracle dice:\n■ At the start of each battle round.\n■ Each time …": an effect that ends at a colon,
    // then bullet lines that hold only moments (and the unit-filters leading into them): each moment fires the effect.
    const head = list[index]!;
    if (head.role === "EFFECT" && lines[index] === null && head.end_byte !== undefined
      && /^\s*:\s*$/u.test(bytes.subarray(head.end_byte, list[index + 1]?.start_byte ?? head.end_byte).toString("utf8").replace(/\n.*$/su, ""))) {
      let end = index;
      while (end + 1 < list.length && lines[end + 1] !== null && list[end + 1]!.fragment === head.fragment
        && (isMoment(list[end + 1]!) || list[end + 1]!.family_id === "unit-filter")) end += 1;
      const moments = list.slice(index + 1, end + 1);
      // Every bullet line taken must hold only moments and their filters, each line ending at its moment.
      const wholeLines = end + 1 >= list.length || lines[end + 1] !== lines[end];
      const lineEnds = moments.every((leaf, at) => isMoment(leaf) || (moments[at + 1] !== undefined && lines[index + 1 + at + 1] === lines[index + 1 + at]));
      if (moments.length > 0 && isMoment(moments.at(-1)!) && wholeLines && lineEnds) {
        out.push(...moments, head);
        index = end + 1;
        continue;
      }
    }
    const line = lines[index];
    let end = index;
    while (line !== null && end + 1 < list.length && lines[end + 1] === line && list[end + 1]!.fragment === list[index]!.fragment) end += 1;
    const run = list.slice(index, end + 1);
    const [effect, ...rest] = run;
    const moment = rest.at(-1);
    const fits = line !== null && effect!.role === "EFFECT" && !CONTAINER_OPENERS.test(effect!.family_id) && moment !== undefined && isMoment(moment)
      && rest.slice(0, -1).every((leaf) => leaf.family_id === "unit-filter");
    if (fits) out.push(...rest, effect!);
    else out.push(...run);
    index = end + 1;
  }
  return out;
}
