import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A unit-filter leaf ("friendly **WRAITH CONSTRUCT** unit") folded into the selection or aura it
 * names, before anything else compiles. It belongs to a scope-less select-unit right before it
 * ("select one" + filter) or a side-less aura-range right after it (filter + "within 6\" of this
 * unit"). The folded leaf carries the filter's side as its scope/side and the filter's keywords
 * as `filter`, which selectUnit and wrapAura read. A side-less range right after a selection is
 * that selection's distance; only one after a unit-filter alone is an aura.
 */

const isFilter = (leaf: CompileLeaf | undefined) => leaf?.family_id === "unit-filter";
const openSelect = (leaf: CompileLeaf | undefined) => leaf?.family_id === "select-unit" && leaf.parameters.scope === undefined;
const openAura = (leaf: CompileLeaf | undefined) => leaf?.family_id === "aura-range" && leaf.parameters.side === undefined;

function side(filter: CompileLeaf, what: string): string {
  const value = String(filter.parameters.side);
  if (value === "any") throw new CompileError(`A unit-filter for ${what} must say friendly or enemy.`);
  return value;
}

/** The filter's keyword fields, as the folded leaf carries them. */
function filterOf(filter: CompileLeaf): Record<string, unknown> {
  const { side: _side, visible: _visible, ...rest } = filter.parameters;
  return rest;
}

/**
 * A range right after a selection ("select one visible enemy unit within 6\" of this unit") is
 * the selection's distance, not an aura: fold it into the selection just pushed. Returns whether
 * it did.
 */
function reach(out: CompileLeaf[], range: CompileLeaf | undefined): boolean {
  if (!openAura(range)) return false;
  const selection = out.at(-1)!;
  if (selection.parameters.distance === "within") throw new CompileError("A selection already within a distance cannot take a second range.");
  if (range!.parameters.wholly === true) throw new CompileError("A selection of units wholly within a range has no DSL shape yet.");
  out[out.length - 1] = { ...selection, parameters: { ...selection.parameters, distance: "within", inches: range!.parameters.inches } };
  return true;
}

export function foldUnitFilters(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => isFilter(leaf) || openSelect(leaf) || openAura(leaf))) return [...list];
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const leaf = list[index]!;
    const next = list[index + 1];
    if (openSelect(leaf) && isFilter(next)) {
      out.push({ ...leaf, parameters: {
        ...leaf.parameters, scope: side(next!, "a selection"), filter: filterOf(next!),
        visible: leaf.parameters.visible === true || next!.parameters.visible === true,
      } });
      index += 1;
      reach(out, list[index + 1]) && (index += 1);
    } else if (leaf.family_id === "select-unit" && openAura(next)) {
      out.push(leaf);
      reach(out, next) && (index += 1);
    } else if (isFilter(leaf) && openAura(next)) {
      if (leaf.parameters.visible === true) throw new CompileError("An aura reaches units whether or not they are visible; drop visible from its unit-filter.");
      out.push({ ...next!, parameters: { ...next!.parameters, side: side(leaf, "an aura"), filter: filterOf(leaf) } });
      index += 1;
    } else if (isFilter(leaf)) {
      throw new CompileError("A unit-filter needs a select-unit right before it or an aura-range right after it.");
    } else if (openSelect(leaf)) {
      throw new CompileError("A select-unit without a scope needs a unit-filter right after it.");
    } else if (openAura(leaf)) {
      throw new CompileError("An aura-range without a side needs a unit-filter right before it.");
    } else {
      out.push(leaf);
    }
  }
  return out;
}
