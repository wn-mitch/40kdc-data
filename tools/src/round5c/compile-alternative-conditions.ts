import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Conditions written as alternatives become one any-of condition (`__any-of`), which
 * `condition()` lowers to an `or` of its operands. Two shapes say "or":
 *
 * - Inline: condition leaves of one fragment with only "or" (or "and/or") between them ("that
 *   targets the closest eligible target or a target that is within Engagement Range of that
 *   model's unit").
 * - List: "if any of the following apply" (or "either of", "one or more of", after "if", "while"
 *   or "provided") ends in a colon,
 *   and each following line is one alternative; the conditions on one line all hold together.
 *
 * Everywhere else conditions keep holding together, as stacked leaves always have. Conditions
 * that are not gates of their own (a roll band, a battle-size row, a selection's target check, an
 * aura's or a Stratagem TARGET's) never fold.
 */

const KEEP_APART = new Set(["roll-result", "target-is-selected", "battle-size", "aura-range", "leader-target", "unit-filter"]);
const foldable = (leaf: CompileLeaf | undefined) => leaf !== undefined && leaf.role === "CONDITION" && leaf.fragment !== "TARGET" && !KEEP_APART.has(leaf.family_id);

/** The connectives that join two conditions as one any-of: "or", and "and/or" (one or both). */
const DISJUNCTIVE_GAPS = new Set(["or", "and/or"]);

/** The words between two leaves, without bold markers or spaces. */
function between(bytes: Buffer, left: CompileLeaf, right: CompileLeaf): string | null {
  if (left.end_byte === undefined || right.start_byte < left.end_byte) return null;
  // A parenthesised alternative ("on the battlefield (or any TRANSPORT it is embarked within …)")
  // joins with "(or" as a bare "or" does. "and/or" joins alternatives too: either one, or both.
  const joined = bytes.subarray(left.end_byte, right.start_byte).toString("utf8").replace(/[*\s()]/g, "").toLowerCase();
  return joined === "and/or" ? "or" : joined;
}

/**
 * "against Psychic Attacks and attacks made by DAEMON models": an attack kind and an attacker
 * keyword joined by "and" are alternatives, since each one alone is enough. Only this pairing
 * folds; any other "and" stacks.
 */
function attackKindOrAttacker(bytes: Buffer, left: CompileLeaf, right: CompileLeaf): boolean {
  if (left.family_id !== "attack-filter" || right.family_id !== "unit-keyword" || right.parameters.subject !== "attacker") return false;
  return /^against\b/iu.test(bytes.subarray(left.start_byte, left.start_byte + 8).toString("utf8"));
}

/** Whether `right` joins `left` as one alternative: an "or"/"and/or" gap, or the attack-kind pairing. */
function joinsAsAlternative(bytes: Buffer, left: CompileLeaf, right: CompileLeaf): boolean {
  const gap = between(bytes, left, right);
  // A condition that absorbed a following filter joins only a condition of its own subject. Other
  // subjects are refused below.
  if (gap !== null && DISJUNCTIVE_GAPS.has(gap)) return !absorbsFilter(left, right) || left.parameters.subject === right.parameters.subject;
  return gap === "and" && attackKindOrAttacker(bytes, left, right);
}

/** Whether either leaf of an adjacent pair took a following unit-filter into its wording. */
const absorbsFilter = (left: CompileLeaf, right: CompileLeaf) => left.parameters.following_filter !== undefined || right.parameters.following_filter !== undefined;

/** "or" as a whole word in the raw gap between two adjacent leaves. */
const WORD_OR = /(?:^|[^a-z])or(?:[^a-z]|$)/iu;

/** A conditional list header: "if any of the following apply:". Other "one or more of the following" lists (abilities to gain, options to pick) are not conditions. */
const LIST_HEADER = /\b(?:if|while|provided)\s+(?:any|either|one or more) of the following(?: apply| applies| is true| are true)?/giu;

/** One any-of leaf over alternatives, each a list of conditions that hold together. */
function anyOfLeaf(alternatives: CompileLeaf[][]): CompileLeaf {
  const first = alternatives[0]![0]!;
  const last = alternatives.at(-1)!.at(-1)!;
  return { ...first, family_id: "__any-of", family_version: 1, end_byte: last.end_byte, parameters: { alternatives } };
}

export function foldAlternativeConditions(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined || !list.some(foldable)) return [...list];
  const bytes = Buffer.from(sourceText, "utf8");
  const text = sourceText;
  const consumed = new Set<number>();
  const replacement = new Map<number, CompileLeaf>();

  // List form: the header's colon opens the list; it runs to the end of the leaf's fragment.
  for (const match of text.matchAll(LIST_HEADER)) {
    const headerEnd = Buffer.byteLength(text.slice(0, match.index! + match[0].length), "utf8");
    const colon = bytes.indexOf(":", headerEnd);
    if (colon < 0) continue;
    const items = list.flatMap((leaf, at) => (leaf.start_byte > colon ? [at] : []));
    if (items.length === 0) continue;
    const fragment = list[items[0]!]!.fragment;
    const inList = items.filter((at) => list[at]!.fragment === fragment);
    if (inList.some((at) => !foldable(list[at]))) {
      throw new CompileError("A list of alternative conditions holds a leaf that is not a condition; one any-of cannot say it.");
    }
    // One line, one alternative: lines end at a line break.
    const lineOf = (leaf: CompileLeaf) => bytes.subarray(colon, leaf.start_byte).toString("utf8").split(/\r\n|\r|\n/u).length;
    const lines = new Map<number, CompileLeaf[]>();
    for (const at of inList) {
      const line = lineOf(list[at]!);
      lines.set(line, [...(lines.get(line) ?? []), list[at]!]);
    }
    if (lines.size < 2) throw new CompileError("\"Any of the following\" lists fewer than two alternatives.");
    inList.forEach((at) => consumed.add(at));
    replacement.set(inList[0]!, anyOfLeaf([...lines.values()]));
  }

  // Inline form: a run of conditions joined only by "or".
  for (let index = 0; index < list.length; index += 1) {
    if (consumed.has(index) || !foldable(list[index])) continue;
    const run = [index];
    while (run.at(-1)! + 1 < list.length) {
      const next = run.at(-1)! + 1;
      const left = list[run.at(-1)!]!;
      const right = list[next]!;
      if (consumed.has(next) || !foldable(right) || right.fragment !== left.fragment || !joinsAsAlternative(bytes, left, right)) break;
      run.push(next);
    }
    if (run.length < 2) continue;
    run.forEach((at) => consumed.add(at));
    replacement.set(run[0]!, anyOfLeaf(run.map((at) => [list[at]!])));
    index = run.at(-1)!;
  }

  // An "or" between a condition with an absorbed filter and an adjacent condition that did not join
  // would stack as AND. Refuse rather than write that.
  for (let at = 0; at + 1 < list.length; at += 1) {
    const [left, right] = [list[at]!, list[at + 1]!];
    if (consumed.has(at) || consumed.has(at + 1) || !foldable(left) || !foldable(right) || left.fragment !== right.fragment || !absorbsFilter(left, right)) continue;
    if (left.end_byte === undefined || right.start_byte < left.end_byte) continue;
    const gap = bytes.subarray(left.end_byte, right.start_byte).toString("utf8");
    if (WORD_OR.test(gap) && !joinsAsAlternative(bytes, left, right)) {
      throw new CompileError("An \"or\" joins a condition with an absorbed filter to a condition of another subject; one any-of cannot say it.");
    }
  }

  if (consumed.size === 0) return [...list];
  return list.flatMap((leaf, at) => (replacement.has(at) ? [replacement.get(at)!] : consumed.has(at) ? [] : [leaf]));
}
