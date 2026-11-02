import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { isAnyDestruction, isAnyPhaseEnd } from "./compile-delayed-destruction.js";
import { selectedUnitMoments } from "./compile-selection-moment.js";

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

/**
 * "At the start of your opponent's Movement phase, you can use this ability. If you do, when an enemy unit ends a
 * Normal move, …": a later moment under the use an earlier moment offers, with no effect between the use and it. Both
 * moments come before the first effect, so the compiler would join them as alternatives and the effect would fire at
 * the opening moment too, with or without the use. momentsUnderUse nests only a moment after an effect, so this is
 * refused.
 */
export function refuseMomentUnderBareUse(list: readonly CompileLeaf[], sourceText: string | undefined): void {
  if (sourceText === undefined) return;
  const bytes = Buffer.from(sourceText, "utf8");
  const sorted = [...list].sort((a, b) => a.start_byte - b.start_byte);
  const nestedInSelection = selectedUnitMoments(sorted);
  sorted.forEach((use, at) => {
    if (use.family_id !== "optional-use" || use.end_byte === undefined) return;
    if (!sorted.slice(0, at).some((leaf) => leaf.family_id === "event")) return;
    const after = sorted.slice(at + 1);
    const firstEffect = after.findIndex((leaf) => leaf.role === "EFFECT");
    const moment = (firstEffect === -1 ? after : after.slice(0, firstEffect)).find((leaf) => leaf.family_id === "event");
    // A moment the use's selection holds ("you can select one friendly unit. If you do, when that unit is selected to …",
    // "… select one enemy unit. Until the end of the turn, when this unit …") nests in the selection
    // (compile-selection-moment.ts selectedUnitMoments).
    if (moment === undefined || nestedInSelection.has(sorted.indexOf(moment)) || !IF_YOU_DO.test(bytes.subarray(use.end_byte, moment.start_byte).toString("utf8"))) return;
    throw new CompileError(`A moment at byte ${moment.start_byte} waits on the use an earlier moment offers (byte ${use.start_byte}), with no effect between them; it has no reading yet.`);
  });
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

/** "If it does" (or "if you do") between an offered use and what follows it. */
const IF_USE_MADE = /\bif (?:you|it|they) (?:do|does)\b/iu;

/**
 * The phase-end moments that follow an offered use in its own paragraph: "…, each of those units can make a
 * Sacrifice. If it does, until the end of the phase, …. At the end of the phase, that unit suffers D3 mortal
 * wounds." The phase end is the end of the phase in which the use was made: it exists only once the use is, so it
 * nests in the part that offered the use, for that phase, instead of being a sibling that fires at the end of every
 * phase. Returns the positions (in `partStarts`) of those moments: the phase end names no particular phase or turn
 * (isAnyPhaseEnd), an optional use comes after an earlier moment and before it, "if it does" stands between the use
 * and it, and no line break does.
 */
export function momentsAfterOwnUse(
  list: readonly CompileLeaf[],
  triggerIndexes: readonly number[],
  partStarts: ReadonlyArray<{ index: number; moments: number[] }>,
  sourceText: string | undefined,
): Set<number> {
  const nested = new Set<number>();
  if (sourceText === undefined) return nested;
  const bytes = Buffer.from(sourceText, "utf8");
  partStarts.forEach((part, position) => {
    const moments = part.moments.map((at) => list[triggerIndexes[at]!]!);
    if (moments.length === 0 || !moments.every(isAnyPhaseEnd)) return;
    const use = list.slice(0, part.index).filter((leaf) => leaf.family_id === "optional-use" && leaf.fragment === moments[0]!.fragment).at(-1);
    if (use?.end_byte === undefined || moments[0]!.start_byte === undefined || use.end_byte > moments[0]!.start_byte) return;
    const useAt = list.indexOf(use);
    const offering = triggerIndexes.filter((index) => index < useAt).map((index) => list[index]!).at(-1);
    if (offering === undefined || isAnyPhaseEnd(offering)) return;
    const between = bytes.subarray(use.end_byte, moments[0]!.start_byte).toString("utf8");
    if (IF_USE_MADE.test(between) && !/[\r\n]/u.test(between)) nested.add(position);
  });
  return nested;
}

/**
 * The later parts whose moments are a use of the record's own ability and then the end of the phase: "… it can use
 * this ability. … Each time this unit uses this ability, at the end of the phase, roll one D6 …". The phase end is
 * the end of the phase in which that use was made, once for each use, so the part nests in the part that offers the
 * use, for that phase, and its use moment is dropped: that is the offering part's own moment. Returns, by position
 * in `partStarts`, the moment position (in `triggerIndexes`) of the use to drop. The use names the record's own id
 * (event id) and is this unit's, with no other qualifier; it comes first, only a comma stands between it and the
 * phase end (isAnyPhaseEnd), and an optional use before the part offers it. A record with no id (a printed grant's
 * body) has none.
 */
export function momentsAfterThisUse(
  list: readonly CompileLeaf[],
  triggerIndexes: readonly number[],
  partStarts: ReadonlyArray<{ index: number; moments: number[] }>,
  sourceText: string | undefined,
  abilityId: string | undefined,
): Map<number, number> {
  const nested = new Map<number, number>();
  if (sourceText === undefined || abilityId === undefined) return nested;
  const bytes = Buffer.from(sourceText, "utf8");
  partStarts.forEach((part, position) => {
    if (part.moments.length !== 2) return;
    const [use, end] = part.moments.map((at) => list[triggerIndexes[at]!]!) as [CompileLeaf, CompileLeaf];
    if (!isOwnUse(use, abilityId) || !isAnyPhaseEnd(end)) return;
    if (use.end_byte === undefined || use.end_byte > end.start_byte) return;
    if (!/^[\s,]*$/u.test(bytes.subarray(use.end_byte, end.start_byte).toString("utf8"))) return;
    if (!list.slice(0, part.index).some((leaf) => leaf.family_id === "optional-use")) return;
    nested.set(position, part.moments[0]!);
  });
  return nested;
}

/** A use of the record's own ability by this unit ("this unit uses this ability"), with nothing else qualifying it. */
function isOwnUse(leaf: CompileLeaf, abilityId: string): boolean {
  const p = leaf.parameters;
  if (leaf.family_id !== "event" || p.kind !== "used" || p.activity !== "ability" || p.id !== abilityId) return false;
  if (p.subject !== undefined && p.subject !== "this-unit") return false;
  return Object.keys(p).every((key) => ["kind", "activity", "id", "subject"].includes(key));
}
