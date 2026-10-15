/**
 * "that targeted a friendly X unit" + "within 3\" of this model": the targeted leaf's unit-filter
 * takes the aura's range as its `within`, measured from the aura's `of` (this-model or this-unit).
 * Without the fold, the side-less aura-range has no unit-filter before it and is refused.
 *
 * The aura's wording is absorbed into the targeted condition, so the leaf list drops the aura.
 * Only a side-less aura right after a targeted filter folds; every other filter takes the aura
 * branch in compile-unit-filters.ts unchanged.
 */

import { CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** Whether the aura right after a folded targeted filter measures that filter's unit (not some other aura). */
export function measuresTargetedFilter(condition: CompileLeaf | undefined, aura: CompileLeaf | undefined, filter: CompileLeaf): boolean {
  return condition?.family_id === "targeted" && aura?.family_id === "aura-range" && aura.fragment === filter.fragment;
}

/**
 * The targeted condition with its following filter (`filterNode`, the filter's DSL unit-filter)
 * and that filter's `within` taken from the aura. Refuses an aura whose wording the filter cannot
 * carry: a different side, keywords or a range cap (a unit-filter's `within` has neither), a
 * visible filter, a model-level filter, or no `of` (the fold does not pick a default).
 */
export function targetedWithin(condition: CompileLeaf, filterNode: Node, filter: CompileLeaf, aura: CompileLeaf, end: number | undefined): CompileLeaf {
  const a = aura.parameters;
  if (a.side !== undefined && a.side !== filter.parameters.side) throw new CompileError("An aura-range's side differs from the unit-filter before it.");
  if (filter.parameters.visible === true) throw new CompileError("An aura reaches units whether or not they are visible; drop visible from its unit-filter.");
  if (filter.parameters.level === "model") throw new CompileError("An aura-range measured from a targeted model filter has no DSL shape yet.");
  if (a.keywords !== undefined) throw new CompileError("A targeted unit-filter already names its keywords; an aura-range keyword cannot be folded into it. Name the keywords on the unit-filter.");
  if (a.range_cap_inches !== undefined) throw new CompileError("A targeted unit-filter's within has no range cap; drop range_cap_inches from its aura-range.");
  if (a.of === undefined) throw new CompileError("An aura-range measured after a targeted unit-filter needs of: this-unit or this-model.");
  const within: Node = { of: a.of, range: { inches: a.inches }, ...(a.wholly === true ? { wholly: true } : {}) };
  return {
    ...condition,
    end_byte: aura.end_byte ?? end,
    parameters: { ...condition.parameters, following_filter: { ...filterNode, within } },
  };
}
