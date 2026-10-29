import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { ALTERNATIVELY, OR_CONNECTIVE, ONE_OR_MORE, uncoveredText } from "./compile-target-modes.js";
import { awaitsFollowingFilter, MATCHED_UNITS } from "./families/shared.js";
import { alternativeFilter } from "./compile-filter-alternatives.js";
import { type FilterAlternative, normalizeAlternatives } from "./unit-filter-alternatives.js";
import { claimedByEmbarkedState } from "./compile-embarked-exclusion.js";
import { foldDesignationBeforeFilter, foldListNarrowing } from "./compile-filter-lists.js";
import { assertOneFilterState, HELD_STATES } from "./compile-unit-filter-dsl.js";
import { isFilter } from "./compile-unit-filter-predicates.js";

type FilterParameters = {
  among?: string; side?: string; keywords?: string[]; any_keywords?: string[]; excluded_keywords?: string[]; states?: string[]; visible?: boolean; other?: boolean; level?: string;
  held_in?: string; abilities?: string[]; excluded_abilities?: string[]; excluded_all_keywords?: string[]; alternatives?: FilterAlternative[]; datasheets?: string[]; designated?: string; designated_by?: string; embarked_in?: string;
  attachment_role?: string; member_of?: string; not_designated?: string; unit_ids?: string[];
};

const union = (left: string[] | undefined, right: string[] | undefined) => [...new Set([...(left ?? []), ...(right ?? [])])].sort();

/**
 * One unit-filter from two that name the same units in a row ("friendly **HERETIC ASTARTES**
 * unit" + "(excluding **DAMNED** units)"), or null when they cannot be one: different sides,
 * models against units, or two any-of lists (one unit-filter holds a single any-of).
 */
export function mergedFilter(first: CompileLeaf, second: CompileLeaf): CompileLeaf | null {
  const a = first.parameters as FilterParameters;
  const b = second.parameters as FilterParameters;
  // A matched set is its own filter: merging would drop its among and pool silently.
  if (a.among === MATCHED_UNITS || b.among === MATCHED_UNITS) return null;
  const sides = new Set([a.side, b.side].filter((value) => value !== "any"));
  if (sides.size > 1) return null;
  if ((a.level ?? "unit") !== (b.level ?? "unit")) return null;
  if (a.any_keywords?.length && b.any_keywords?.length) return null;
  if (a.held_in !== undefined && b.held_in !== undefined && a.held_in !== b.held_in) return null;
  // One filter holds one set of alternatives (or one any-of), and one all-of exclusion.
  if ([a.any_keywords, b.any_keywords, a.alternatives, b.alternatives].filter((list) => list?.length).length > 1) return null;
  if (a.excluded_all_keywords !== undefined && b.excluded_all_keywords !== undefined && JSON.stringify(a.excluded_all_keywords) !== JSON.stringify(b.excluded_all_keywords)) return null;
  if (a.datasheets !== undefined && b.datasheets !== undefined) return null;
  // Units embarked within different Transports are different sets; one filter names one Transport.
  if (a.embarked_in !== undefined && b.embarked_in !== undefined && a.embarked_in !== b.embarked_in) return null;
  if (a.attachment_role !== undefined && b.attachment_role !== undefined && a.attachment_role !== b.attachment_role) return null;
  if (a.member_of !== undefined && b.member_of !== undefined && a.member_of !== b.member_of) return null;
  const parameters: Record<string, unknown> = { side: [...sides][0] ?? "any" };
  const unitIds = a.unit_ids && b.unit_ids
    ? a.unit_ids.filter((id) => b.unit_ids!.includes(id))
    : a.unit_ids ?? b.unit_ids;
  if (a.unit_ids && b.unit_ids && unitIds!.length === 0) {
    throw new CompileError("Stacked unit-filters name disjoint unit identities.");
  }
  if (unitIds?.length) parameters.unit_ids = unitIds;
  const keywords = union(a.keywords, b.keywords);
  const excluded = union(a.excluded_keywords, b.excluded_keywords);
  if (keywords.some((keyword) => excluded.includes(keyword))) throw new CompileError("A unit-filter cannot both require and exclude the same keyword.");
  if (keywords.length) parameters.keywords = keywords;
  const anyOf = a.any_keywords?.length ? a.any_keywords : b.any_keywords;
  if (anyOf?.length) parameters.any_keywords = anyOf;
  if (excluded.length) parameters.excluded_keywords = excluded;
  const states = union(a.states, b.states);
  if (states.length) parameters.states = states;
  if (a.visible === true || b.visible === true) parameters.visible = true;
  if (a.other === true || b.other === true) parameters.other = true;
  if (a.level === "model") parameters.level = "model";
  if (a.attachment_role !== undefined || b.attachment_role !== undefined) parameters.attachment_role = a.attachment_role ?? b.attachment_role;
  if (a.member_of !== undefined || b.member_of !== undefined) parameters.member_of = a.member_of ?? b.member_of;
  // Fields only the DSL unit-filter keeps carry over rather than being dropped by the merge.
  const held = a.held_in ?? b.held_in;
  if (held !== undefined) parameters.held_in = held;
  const abilities = union(a.excluded_abilities, b.excluded_abilities);
  if (abilities.length) parameters.excluded_abilities = abilities;
  const required = union(a.abilities, b.abilities);
  if (required.some((ability) => abilities.includes(ability))) throw new CompileError("A unit-filter cannot both require and exclude the same ability.");
  if (required.length) parameters.abilities = required;
  const allOf = a.excluded_all_keywords ?? b.excluded_all_keywords;
  if (allOf !== undefined) parameters.excluded_all_keywords = allOf;
  const datasheets = a.datasheets ?? b.datasheets;
  if (datasheets !== undefined) parameters.datasheets = datasheets;
  // "that INQUISITOR Leader unit": the attached-Leader membership holds for the merged filter.
  const attached = (a as Record<string, unknown>).attached_to ?? (b as Record<string, unknown>).attached_to;
  if (attached !== undefined) parameters.attached_to = attached;
  // "model in this unit" + "(excluding K models)": the unit the models belong to survives the merge.
  const memberA = (a as { member_of?: string }).member_of;
  const memberB = (b as { member_of?: string }).member_of;
  if (memberA !== undefined && memberB !== undefined && memberA !== memberB) return null;
  if ((memberA ?? memberB) !== undefined) parameters.member_of = memberA ?? memberB;
  const embarkedIn = a.embarked_in ?? b.embarked_in;
  if (embarkedIn !== undefined) parameters.embarked_in = embarkedIn;
  // Designation inclusion/exclusion survives stacked filters as a candidate predicate.
  if (a.designated !== undefined && b.designated !== undefined && a.designated !== b.designated) return null;
  if (a.not_designated !== undefined && b.not_designated !== undefined && a.not_designated !== b.not_designated) return null;
  if (a.designated_by !== undefined && b.designated_by !== undefined && a.designated_by !== b.designated_by) return null;
  const designated = a.designated ?? b.designated;
  if (designated !== undefined) parameters.designated = designated;
  const notDesignated = a.not_designated ?? b.not_designated;
  if (notDesignated !== undefined) parameters.not_designated = notDesignated;
  const designatedBy = a.designated_by ?? b.designated_by;
  if (designatedBy !== undefined) parameters.designated_by = designatedBy;
  // "A or B C unit" + "(excluding D units)": the narrowing holds for every alternative.
  const alternatives = a.alternatives ?? b.alternatives;
  if (alternatives !== undefined) {
    try {
      parameters.alternatives = normalizeAlternatives(alternatives, "alternatives", { keywords, excluded_keywords: excluded, states });
    } catch (error) {
      throw new CompileError(`A unit-filter narrowing alternatives contradicts or repeats one of them (${(error as Error).message}).`);
    }
  }
  // Two stacked filters that hold two states (or a state and a held unit) are one filter the DSL cannot say.
  assertOneFilterState(states, held === undefined ? undefined : HELD_STATES[held] ?? held);
  return { ...first, parameters };
}

/**
 * Stacked unit-filters of one fragment become one, so a selection, aura, target or attack sees a
 * single filter. A "from your army" of the same side between them stays, after the merged filter,
 * where it sits after a single filter.
 */
export function mergeStackedFilters(input: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  const list = foldListNarrowing(foldDesignationBeforeFilter(input), mergedFilter, alternativeFilter, sourceText);
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const leaf = list[index]!;
    if (!isFilter(leaf)) { out.push(leaf); continue; }
    // Alternatives ("**A** or **B** unit") are groups; filters with nothing between them, or only
    // an exclusion's parentheses, narrow the group they follow.
    const groups: Array<{ filter: CompileLeaf; at: number }> = [{ filter: leaf, at: index + 1 }];
    const owners: CompileLeaf[] = [];
    let last = leaf;
    let sawOr = false;
    for (;;) {
      const group = groups.at(-1)!;
      let next = group.at;
      const between: CompileLeaf[] = [];
      while (list[next]?.family_id === "unit-owner" && list[next]!.fragment === leaf.fragment) between.push(list[next++]!);
      const candidate = list[next];
      if (!isFilter(candidate) || candidate!.fragment !== leaf.fragment) break;
      // "If your army includes a X unit, friendly Y units …": a condition that awaits its following filter
      // takes the first filter alone; a positive filter after it is the effect's own, not a narrowing of X
      // (an exclusion-only filter, "(excluding Z)", still narrows X).
      const awaiting = out.at(-1);
      const exclusionOnly = Object.entries(candidate!.parameters).every(([key, value]) => value === undefined || key === "side" || key === "level" || key.startsWith("excluded_"));
      if (last === leaf && !exclusionOnly && awaiting !== undefined && awaiting.fragment === leaf.fragment && awaitsFollowingFilter(awaiting.parameters)) break;
      const joiner = between.length === 0 ? joinerBetween(sourceText, last, candidate!) : null;
      if (joiner !== null && ALTERNATIVE_JOINERS.has(joiner)) {
        // A bulleted list of filters ("to: ■ X units ■ Y units") names alternatives, as "or" does.
        sawOr ||= joiner.includes("or") || joiner === "■";
        groups.push({ filter: candidate!, at: next + 1 });
        last = candidate!;
        continue;
      }
      const side = (group.filter.parameters as FilterParameters).side;
      if (between.some((owner) => owner.parameters.owner !== side)) break;
      // Two target filters with an "or" (or "Alternatively") between them and no stratagem-target leaf
      // name a second mode the compiler cannot place; joined by no connective they would merge into one target.
      if (sourceText !== undefined && leaf.fragment === "TARGET") refuseUnnamedMode(sourceText, group.filter, candidate!, list);
      // "Transport unit" + "BATTLELINE unit" + "embarked within it": the second filter is the unit the state is about, not the Transport's own.
      if (claimedByEmbarkedState(list, next, leaf.fragment)) break;
      const combined = mergedFilter(group.filter, candidate!);
      if (combined === null) break;
      // The merged filter's wording runs to the last filter it took in ("(excluding X)" included).
      group.filter = { ...combined, end_byte: candidate!.end_byte };
      group.at = next + 1;
      owners.push(...between);
      last = candidate!;
    }
    let merged: CompileLeaf;
    let at: number;
    if (groups.length > 1 && sawOr) {
      merged = alternativeFilter(groups.map((group) => group.filter));
      at = groups.at(-1)!.at;
    } else {
      // A comma list with no "or" ("**A**, **B** unit") still narrows, as stacked filters do.
      merged = groups[0]!.filter;
      at = groups[0]!.at;
      for (const group of groups.slice(1)) {
        const combined = mergedFilter(merged, group.filter);
        if (combined === null) break;
        merged = combined;
        at = group.at;
      }
    }
    out.push(merged, ...owners);
    index = at - 1;
  }
  return out;
}

/**
 * Refuses the AND-merge of two target filters whose gap reads as a second mode ("or" or
 * "Alternatively", not "one or more"). The gap is the wording the leaves between them do not cover.
 */
function refuseUnnamedMode(sourceText: string, first: CompileLeaf, second: CompileLeaf, list: readonly CompileLeaf[]): void {
  const from = first.end_byte ?? first.start_byte;
  const inside = list.filter((leaf) => leaf.start_byte >= from && (leaf.end_byte ?? leaf.start_byte) <= second.start_byte);
  const gap = uncoveredText(Buffer.from(sourceText, "utf8"), from, second.start_byte, inside);
  if (OR_CONNECTIVE.test(gap.replace(ONE_OR_MORE, " ")) || ALTERNATIVELY.test(gap)) {
    throw new CompileError("A target after \"or\" or \"Alternatively\" has no stratagem-target leaf; name the mode's count.");
  }
}

/** Joiners that make the next filter an alternative to the one before it, read without bold or spaces; "■" is a bullet. */
const ALTERNATIVE_JOINERS = new Set(["or", ",", ",or", "■"]);

/** The source between two leaves, without bold markers, spaces or an exclusion's parentheses. */
export function joinerBetween(sourceText: string | undefined, left: CompileLeaf, right: CompileLeaf): string | null {
  if (sourceText === undefined || left.end_byte === undefined || right.start_byte < left.end_byte) return null;
  return Buffer.from(sourceText, "utf8").subarray(left.end_byte, right.start_byte).toString("utf8").replace(/[*\s()]/g, "").toLowerCase();
}
