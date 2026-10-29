import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { FILTERED_UNITS } from "./compile-antecedent.js";
import { dslUnitFilter } from "./compile-unit-filter-dsl.js";
import { sameSentence } from "./compile-named-ability.js";

/**
 * "When a friendly X unit within 12\" of that model is targeted with a Stratagem": a used moment
 * aimed at the units of the unit-filter right before it (object filtered-units). The filter, and a
 * within distance of those units between the filter and the moment, become the trigger's object.
 * The filter and distance leaves are dropped; the moment keeps its own activity and id.
 */
export function foldUsedObjects(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "event" && leaf.parameters.kind === "used" && leaf.parameters.object === FILTERED_UNITS)) return [...list];
  const out: CompileLeaf[] = [];
  for (const leaf of list) {
    if (!(leaf.family_id === "event" && leaf.parameters.kind === "used" && leaf.parameters.object === FILTERED_UNITS)) {
      out.push(leaf);
      continue;
    }
    const distance = out.at(-1)?.family_id === "unit-position" ? out.at(-1)! : undefined;
    const filter = out.at(distance ? -2 : -1);
    if (filter?.family_id !== "unit-filter" || filter.fragment !== leaf.fragment || !sameSentence(sourceText, filter.end_byte, leaf.start_byte)) {
      throw new CompileError("A used moment aimed at a unit-filter's units needs that unit-filter right before it, in its sentence.");
    }
    if (filter.parameters.visible === true) throw new CompileError("A Stratagem's target need not be visible; drop visible from the unit-filter it is aimed at.");
    let within: Record<string, unknown> | undefined;
    if (distance) {
      const p = distance.parameters;
      if (p.kind !== "within" || p.subject !== FILTERED_UNITS || p.negated === true || p.wholly === true || typeof p.inches !== "number" || p.of_keywords !== undefined) {
        throw new CompileError("Between a used moment's unit-filter and the moment, only a plain within distance of the filtered units can narrow its object.");
      }
      within = { of: p.of ?? "this-unit", range: { inches: p.inches } };
    }
    out.splice(out.length - (distance ? 2 : 1));
    const { object: _object, ...rest } = leaf.parameters;
    out.push({ ...leaf, start_byte: filter.start_byte, parameters: { ...rest, object_filter: { ...dslUnitFilter(filter), ...(within ? { within } : {}) } } });
  }
  return out;
}
