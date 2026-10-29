import type { CompileLeaf } from "./compile-fragments.js";
import { isAnyDestruction, isAnyPhaseEnd } from "./compile-delayed-destruction.js";

/** "If you do" after an offered use: the sentences that follow depend on the use having been made. */
const IF_YOU_DO = /\bif you do\b/iu;

/**
 * The later moments of a compound ability that sit under the use its first moment offers:
 * "Start of your opponent's Movement phase, … you can make a psychic roll. If you do: … When an
 * enemy unit … makes a fall-back move, …". The first moment is a phase's start, the use is
 * offered there, and "if you do" stands between the use and the later moment. Such a moment is
 * not a sibling part: it exists only once the use is made, and only while that phase lasts.
 * Returns the positions (in `partStarts`) of those moments, or none when any of that is not
 * written: a moment without the wording stays a sibling part, as does any when the ability
 * prints its own duration (the period would not be the phase).
 */
export function momentsUnderUse(
  list: readonly CompileLeaf[],
  triggerIndexes: readonly number[],
  partStarts: ReadonlyArray<{ index: number; moments: number[] }>,
  firstEffectIndex: number,
  sourceText: string | undefined,
  printedDurations: number,
): Set<number> {
  const nested = new Set<number>();
  if (sourceText === undefined || printedDurations > 0 || firstEffectIndex === -1) return nested;
  const leading = triggerIndexes.filter((index) => index < firstEffectIndex).map((index) => list[index]!);
  const phaseStarts = leading.length > 0 && leading.every((leaf) => leaf.family_id === "event" && leaf.parameters.kind === "phase-start"
    && typeof leaf.parameters.phase === "string" && leaf.parameters.phase !== "any");
  if (!phaseStarts) return nested;
  const bytes = Buffer.from(sourceText, "utf8");
  const lastLeading = Math.max(...triggerIndexes.filter((index) => index < firstEffectIndex));
  partStarts.forEach((part, position) => {
    const moment = list[part.index]!;
    const use = list.slice(lastLeading + 1, part.index).filter((leaf) => leaf.family_id === "optional-use" && leaf.fragment === moment.fragment).at(-1);
    if (use?.end_byte === undefined || moment.start_byte === undefined || use.end_byte > moment.start_byte) return;
    if (IF_YOU_DO.test(bytes.subarray(use.end_byte, moment.start_byte).toString("utf8"))) nested.add(position);
  });
  return nested;
}

/** "Then, at the end of the phase": the moment follows a sentence-opening "Then" with nothing between. */
const THEN_BEFORE = /\bthen[\s,]*$/iu;

/**
 * The later phase-end moments that follow a destruction moment's effects with "Then" ("The first time this model
 * is destroyed, remove it. Then, at the end of the phase, roll one D6 …"). The phase-end moment is the end of the
 * phase in which the destruction happened: it exists only once the destruction has, so it nests in the destruction's
 * part for that phase and fires once with it, instead of being a sibling moment that fires at the end of every phase.
 * Returns the positions (in `partStarts`) of those moments. The ability prints no duration of its own, its leading
 * moments are all destructions, and the phase end names no particular phase or turn (isAnyPhaseEnd).
 */
export function momentsAfterDestruction(
  list: readonly CompileLeaf[],
  triggerIndexes: readonly number[],
  partStarts: ReadonlyArray<{ index: number; moments: number[] }>,
  firstEffectIndex: number,
  sourceText: string | undefined,
  printedDurations: number,
): Set<number> {
  const nested = new Set<number>();
  if (sourceText === undefined || printedDurations > 0 || firstEffectIndex === -1) return nested;
  const leading = triggerIndexes.filter((index) => index < firstEffectIndex).map((index) => list[index]!);
  if (leading.length === 0 || !leading.every(isAnyDestruction)) return nested;
  // "The first time" with no usage limit would schedule the phase end at every destruction: refused where parts are planned.
  if (/\bfirst time\b/iu.test(sourceText) && !list.some((leaf) => leaf.family_id === "usage-limit")) return nested;
  const bytes = Buffer.from(sourceText, "utf8");
  partStarts.forEach((part, position) => {
    const moments = part.moments.map((at) => list[triggerIndexes[at]!]!);
    const before = list[part.index - 1];
    if (!moments.every(isAnyPhaseEnd) || before?.end_byte === undefined || before.end_byte > moments[0]!.start_byte) return;
    if (THEN_BEFORE.test(bytes.subarray(before.end_byte, moments[0]!.start_byte).toString("utf8"))) nested.add(position);
  });
  return nested;
}

/** "While an objective is snared, when …": the later moment opens under the tag an earlier effect put on objective markers. */
const WHILE_MARKED = /\bwhile an? objective(?: marker)? is ([a-z][a-z-]*)\b/iu;

/**
 * The later moments that react while an objective marker carries a tag the entry's own effect put
 * on it ("If your unit is controlling an objective, that objective is snared. While an objective
 * is snared, when an enemy unit ends a move …"). The reaction exists only once the entry has
 * tagged a marker, and lasts while the tag does, so it nests in the entry part with no duration
 * of its own instead of being a sibling that holds for the whole battle. Returns the positions (in
 * `partStarts`) of those moments: the text between the moment's part and the leaf before it reads
 * "While an objective is <tag>", and a mark-objective before the moment, not clearing, applies that tag.
 */
export function momentsWhileMarked(
  list: readonly CompileLeaf[],
  partStarts: ReadonlyArray<{ index: number; moments: number[] }>,
  firstEffectIndex: number,
  sourceText: string | undefined,
): Set<number> {
  const nested = new Set<number>();
  if (sourceText === undefined || firstEffectIndex === -1) return nested;
  const bytes = Buffer.from(sourceText, "utf8");
  partStarts.forEach((part, position) => {
    const moment = list[part.index]!;
    const before = list[part.index - 1];
    if (before?.end_byte === undefined || moment.start_byte === undefined || before.end_byte > moment.start_byte) return;
    const tag = WHILE_MARKED.exec(bytes.subarray(before.end_byte, moment.start_byte).toString("utf8").replace(/\*/gu, ""))?.[1]?.toLowerCase();
    const marks = list.slice(firstEffectIndex, part.index).some((leaf) => leaf.family_id === "mark-objective" && leaf.parameters.tag === tag && leaf.parameters.clear !== true);
    if (tag !== undefined && marks) nested.add(position);
  });
  return nested;
}
