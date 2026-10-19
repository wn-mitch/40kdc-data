import { isContainerOpener } from "./compile-containers.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A keyword-less weapon-ability-grant frame followed by a menu whose options are printed keyword runs,
 * each run with its own target qualifier ("[Lethal Hits: Monster/Vehicle]. Or: [Sustained Hits 1:
 * non-Monster/Vehicle]. Or: If A, [Lethal Hits: Monster/Vehicle] and [Sustained Hits 1: non-Monster/Vehicle]").
 * A menu option is a group of one or more keyword runs joined by "and", with an optional condition that
 * opens the group. The fold folds the frame into one grant carrying `option_groups`; the keyword leaves,
 * their qualifiers, the group conditions and the "Or:" markers are removed from the list.
 *
 * Only a menu with at least two options, one of which holds two or more runs, is folded here. Other
 * keyword menus keep the path in compile-weapon-keywords.ts. Qualifiers must be all or none across the
 * menu's runs: a run without its qualifier beside qualified runs is refused.
 */

const KEYWORD = "weapon-ability-keyword";
const isFrame = (leaf: CompileLeaf) => leaf.family_id === "weapon-ability-grant" && leaf.parameters.keyword === undefined && leaf.parameters.keywords === undefined;
const ALL_JOINER = /\band\b/iu;
/** A gap that starts a new option: a sentence break, a line break, or an "Or" word. */
const OPTION_BREAK = /[.\r\n]|\bor\b/iu;

/** One option of the menu: its keyword runs, the qualifier of each run (or null), and the condition opening it. */
export type KeywordOption = { keywords: string[]; qualifiers: Array<CompileLeaf | null>; gate?: CompileLeaf };

type Item = { keyword: string; qualifier: CompileLeaf | null };

function gapText(source: Buffer | undefined, left: CompileLeaf, right: CompileLeaf): string {
  if (source === undefined || left.end_byte === undefined) return "";
  return source.subarray(left.end_byte, right.start_byte).toString("utf8");
}

/**
 * Folds every keyword-less frame whose menu has a two-run option. Returns the list unchanged when no
 * frame has that shape, so the existing keyword fold keeps every other case.
 */
export function foldQualifiedKeywordMenus(input: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  const source = sourceText === undefined ? undefined : Buffer.from(sourceText, "utf8");
  let list = [...input];
  for (let frame = 0; frame < list.length; frame += 1) {
    if (!isFrame(list[frame]!)) continue;
    const folded = foldOneMenu(list, frame, source);
    if (folded) list = folded;
  }
  return list;
}

/**
 * The qualifier printed right after a keyword ("[Lethal Hits: MONSTER/VEHICLE]", "[Sustained Hits 1: non-MONSTER]"):
 * a target unit-keyword leaf, or a side-any unit-filter naming keywords (as qualifierOf takes it). The gap
 * between them must be a colon.
 */
function qualifierAt(list: readonly CompileLeaf[], source: Buffer | undefined, keyword: number, fragment: string | undefined): CompileLeaf | null {
  const leaf = list[keyword + 1];
  if (!leaf || leaf.fragment !== fragment || source === undefined || list[keyword]!.end_byte === undefined) return null;
  const isTarget = leaf.family_id === "unit-keyword" && leaf.parameters.subject === "target";
  // A unit-filter qualifier is the one qualifierOf accepts: any side, one keyword list.
  const isFilter = leaf.family_id === "unit-filter" && leaf.parameters.side === "any"
    && Object.keys(leaf.parameters).filter((key) => key !== "side").length === 1
    && (Array.isArray(leaf.parameters.any_keywords) || Array.isArray(leaf.parameters.excluded_keywords));
  if (!isTarget && !isFilter) return null;
  const gap = source.subarray(list[keyword]!.end_byte!, leaf.start_byte).toString("utf8");
  if (!/^[\s*]*:[\s*]*$/u.test(gap)) return null;
  return isFilter ? { ...leaf, family_id: "unit-filter-target" } : leaf;
}

function foldOneMenu(list: CompileLeaf[], frame: number, source: Buffer | undefined): CompileLeaf[] | undefined {
  const leaf = list[frame]!;
  const fragment = leaf.fragment;
  const items: Item[] = [];
  const gates = new Map<number, CompileLeaf>();
  const groupStart = new Set<number>();
  // Every leaf the menu takes, by index. Only leaves up to the last keyword run are taken.
  const taken = new Set<number>();
  let lastRun = frame;
  let previous: CompileLeaf = leaf;
  let pending: CompileLeaf | undefined;
  let at = frame + 1;
  while (at < list.length && list[at]!.fragment === fragment && !isContainerOpener(list[at]!.family_id)) {
    const other = list[at]!;
    const gap = gapText(source, previous, other);
    if (other.family_id === KEYWORD) {
      const breakGap = OPTION_BREAK.test(gap);
      const joined = ALL_JOINER.test(gap) && !breakGap;
      if (items.length > 0 && !joined && !breakGap && pending === undefined) return undefined;
      if (pending !== undefined && joined) return undefined;
      const opens = items.length === 0 || !joined;
      if (opens) {
        groupStart.add(items.length);
        if (pending !== undefined) gates.set(items.length, pending);
      }
      pending = undefined;
      const qualifier = qualifierAt(list, source, at, fragment);
      items.push({ keyword: String(other.parameters.keyword), qualifier });
      taken.add(at);
      if (qualifier) taken.add(at + 1);
      lastRun = qualifier ? at + 1 : at;
      previous = qualifier ?? other;
      at = lastRun + 1;
      continue;
    }
    if (other.role === "COMBINATOR") {
      taken.add(at);
      previous = other;
      at += 1;
      continue;
    }
    if (other.role === "CONDITION" && pending === undefined) {
      pending = other;
      taken.add(at);
      previous = other;
      at += 1;
      continue;
    }
    break;
  }
  if (items.length === 0 || pending !== undefined) return undefined;
  for (const index of [...taken]) if (index > lastRun) taken.delete(index);
  // An option is a group from one boundary to the next. Its gate is the condition that opened it.
  const starts = [...groupStart].sort((a, b) => a - b);
  const options: KeywordOption[] = starts.map((start, group) => {
    const own = items.slice(start, starts[group + 1] ?? items.length);
    const gate = gates.get(start);
    return { keywords: own.map((item) => item.keyword), qualifiers: own.map((item) => item.qualifier), ...(gate ? { gate } : {}) };
  });
  const qualified = items.filter((item) => item.qualifier !== null).length;
  if (options.length < 2 || !options.some((option) => option.keywords.length > 1) || qualified === 0) return undefined;
  if (qualified !== items.length) {
    throw new CompileError("A keyword menu with some runs qualified and some not is not compiled; each run needs its own qualifier or none.");
  }
  const keywords = [...new Set(items.map((item) => item.keyword))];
  return list.flatMap((other, index) => {
    if (index === frame) return [{ ...other, parameters: { ...other.parameters, keywords, keyword_choice: true, option_groups: options } }];
    return taken.has(index) ? [] : [other];
  });
}
