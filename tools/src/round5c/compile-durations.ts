import { duration } from "./compile-conditions.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import type { Placement } from "./compile-placement.js";
import { exactSpan } from "./contracts.js";

/**
 * Several printed durations in one ability: each planned effect takes the duration its own clause
 * prints, or else the one its sentence prints. The DSL carries that per sub-effect as
 * `ability-part.duration`, so a bound effect is wrapped in one, and a moment with a window
 * (a duration printed before it in its sentence) is the lifetime of a window part.
 */

type Node = Record<string, unknown>;

export const CONFLICTING_DURATIONS = "Conflicting durations.";

/** An add-6 to Move right after a no-advance-roll that does not fold into it (another unit, or gated). */
export const NO_ROLL_PLUS_SIX = "An add-6 to Move after a no-advance-roll folds only for the same unit and without a gate.";

/** A no-advance-roll whose moment is an Advance that already happened (a move-ended or past-tense condition). */
export const NO_ROLL_AFTER_ADVANCE = "A no-advance-roll cannot follow an Advance that already happened; the moment is the move start.";

/** Lifetime order of the durations a window part can carry (earlier ends first). */
const LIFETIME = ["phase", "turn", "until-start-next-turn"];

export type DurationBinding = {
  /** Each planned effect's bound duration, keyed by its leaf index. An effect with none is bare. */
  effects: Map<number, string>;
  /** The duration printed before each moment in its own sentence (its window), keyed by the moment's leaf index. */
  windows: Map<number, string>;
  /** Null when binding succeeds; otherwise the refusal. */
  error: string | null;
};

/**
 * Whether a clause opens with a parenthesis in the source ("…, it can move through models (when doing so, such a
 * model can …)"): the parenthetical goes on the clause before it, so it has the duration that clause has.
 */
function opensParenthetical(list: readonly CompileLeaf[], places: readonly Placement[], clause: number, sourceText: string | undefined): boolean {
  if (sourceText === undefined) return false;
  const first = list.findIndex((_, at) => places[at]!.clause === clause);
  const previous = list[first - 1];
  if (first < 1 || previous?.end_byte === undefined || previous.end_byte > list[first]!.start_byte || places[first - 1]!.sentence !== places[first]!.sentence) return false;
  const gap = exactSpan(sourceText, previous.end_byte, list[first]!.start_byte);
  return gap.includes("(") && !gap.includes(")") && !/[.;:]/u.test(gap);
}

/**
 * Binds each effect to the one DURATION leaf of its clause (B1), else of its sentence (B2).
 * Two in one clause, or two in a sentence with the clause having none, refuse: the leaves do not
 * say which duration the effect has. A duration in another sentence is not applied (B3).
 */
export function bindDurations(list: readonly CompileLeaf[], places: readonly Placement[], durationAt: readonly number[], effectAt: readonly number[], momentAt: readonly number[], sourceText?: string): DurationBinding {
  const effects = new Map<number, string>();
  const windows = new Map<number, string>();
  const fail = (): DurationBinding => ({ effects, windows, error: CONFLICTING_DURATIONS });
  for (const at of effectAt) {
    const { clause, sentence } = places[at]!;
    let inClause = durationAt.filter((item) => places[item]!.clause === clause);
    // A parenthetical with no duration of its own has the duration of the clause it belongs to.
    for (let before = clause; inClause.length === 0 && before > 0 && opensParenthetical(list, places, before, sourceText); ) {
      before -= 1;
      inClause = durationAt.filter((item) => places[item]!.clause === before);
    }
    if (inClause.length > 1) return fail();
    const pick = inClause.length === 1 ? inClause : durationAt.filter((item) => places[item]!.sentence === sentence);
    if (pick.length > 1) return fail();
    if (pick.length === 1) effects.set(at, duration(list[pick[0]!]!));
  }
  // W1: the duration printed before a moment in its sentence is that moment's window.
  for (const at of momentAt) {
    const before = durationAt.filter((item) => item < at && places[item]!.sentence === places[at]!.sentence);
    if (before.length > 1) return fail();
    if (before.length === 1) windows.set(at, duration(list[before[0]!]!));
  }
  return { effects, windows, error: null };
}

/** Position of a duration in the lifetime order; an endpoint outside it cannot be compared with a window. */
export function lifetimeRank(name: string): number {
  const rank = LIFETIME.indexOf(name);
  if (rank === -1) throw new CompileError(`A duration ${name} cannot be ordered against a window.`);
  return rank;
}

/**
 * How an effect bound to `bound` sits in a window of `window` (W2): `same` needs no wrap of its own,
 * `inside` is a nested part, `outside` is a sibling part. A bare effect has no reading beside a window.
 */
export function placeInWindow(bound: string | undefined, window: string): "same" | "inside" | "outside" {
  if (bound === undefined) throw new CompileError(CONFLICTING_DURATIONS);
  if (bound === window) return "same";
  return lifetimeRank(bound) < lifetimeRank(window) ? "inside" : "outside";
}

/** An effect in its own duration: `ability-part {duration, effect}`. */
export function durationPart(bound: string, effect: Node): Node {
  return { type: "ability-part", duration: bound, effect };
}

const TESTABLE_SUBJECTS = new Set(["selected-unit", "antecedent"]);

/** Every designated test (a tag tested on a subject) and every mark applied (a tag set on a target) under a node. */
function collect(node: unknown, found: { tests: string[]; marks: string[] }): void {
  if (Array.isArray(node)) { node.forEach((item) => collect(item, found)); return; }
  if (node === null || typeof node !== "object") return;
  const record = node as Node;
  const parameters = record.parameters as Node | undefined;
  const subject = parameters?.subject;
  if (record.type === "designated" && parameters?.tag !== undefined && typeof subject === "string" && TESTABLE_SUBJECTS.has(subject)) {
    found.tests.push(`${subject}|${String(parameters.tag)}`);
  }
  const modifier = record.modifier as Node | undefined;
  if (record.type === "designate" && modifier?.tag !== undefined && typeof record.target === "string" && TESTABLE_SUBJECTS.has(record.target)) {
    found.marks.push(`${record.target}|${String(modifier.tag)}`);
  }
  Object.values(record).forEach((value) => collect(value, found));
}

/**
 * A tag tested after it is applied to the same subject in one part, with no moment between, refuses:
 * the compiler does not order the test before the mark (4194's pin order). A test whose subject is
 * not named (a gate on this ability's own mark) is not checked.
 */
export function refuseTestAfterMark(items: ReadonlyArray<{ index: number; node: Node; gate: Node[] }>, partOf: (index: number) => number): string | null {
  let part = -1;
  const applied = new Set<string>();
  for (const item of [...items].sort((left, right) => left.index - right.index)) {
    if (partOf(item.index) !== part) { part = partOf(item.index); applied.clear(); }
    const gate = { tests: [] as string[], marks: [] as string[] };
    collect(item.gate, gate);
    if (gate.tests.some((test) => applied.has(test))) return "A tag tested after it is applied in the same part; the compiler does not order them.";
    const own = { tests: [] as string[], marks: [] as string[] };
    collect(item.node, own);
    own.marks.forEach((mark) => applied.add(mark));
  }
  return null;
}
