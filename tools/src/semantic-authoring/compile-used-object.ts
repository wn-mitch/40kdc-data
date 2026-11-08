import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { FILTERED_UNITS } from "./compile-antecedent.js";
import { dslUnitFilter } from "./compile-unit-filter-dsl.js";
import { sameSentence } from "./compile-named-ability.js";

/**
 * "When a friendly X unit within 12\" of that model is targeted with a Stratagem": a used moment
 * aimed at the units of a unit-filter (object filtered-units). The filter, and a within distance of
 * those units, become the trigger's object. They sit right before the moment (filter, then distance),
 * or right after it in its sentence ("When you use the X Stratagem, if you target a friendly Y unit
 * within 12\" of this model"). The filter and distance leaves are dropped; the moment keeps its own
 * activity and id.
 */
export function foldUsedObjects(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  const aimed = (leaf: CompileLeaf | undefined) => leaf?.family_id === "event" && leaf.parameters.kind === "used" && leaf.parameters.object === FILTERED_UNITS;
  if (!list.some(aimed)) return [...list];
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const leaf = list[index]!;
    if (!aimed(leaf)) {
      out.push(leaf);
      continue;
    }
    const inSentence = (filter: CompileLeaf | undefined, from: number | undefined, to: number) =>
      filter?.family_id === "unit-filter" && filter.fragment === leaf.fragment && sameSentence(sourceText, from, to);
    const distanceBefore = out.at(-1)?.family_id === "unit-position" ? out.at(-1)! : undefined;
    const before = out.at(distanceBefore ? -2 : -1);
    let filter: CompileLeaf;
    let distance: CompileLeaf | undefined;
    let start = leaf.start_byte;
    if (inSentence(before, before?.end_byte, leaf.start_byte)) {
      filter = before!;
      distance = distanceBefore;
      start = filter.start_byte;
      out.splice(out.length - (distance ? 2 : 1));
    } else if (inSentence(list[index + 1], leaf.end_byte, list[index + 1]?.start_byte ?? leaf.start_byte)) {
      filter = list[index + 1]!;
      const next = list[index + 2];
      distance = next?.family_id === "unit-position" && next.parameters.subject === FILTERED_UNITS && sameSentence(sourceText, filter.end_byte, next.start_byte) ? next : undefined;
      index += distance ? 2 : 1;
    } else {
      throw new CompileError("A used moment aimed at a unit-filter's units needs that unit-filter right before or after it, in its sentence.");
    }
    if (filter.parameters.visible === true) throw new CompileError("A Stratagem's target need not be visible; drop visible from the unit-filter it is aimed at.");
    let within: Record<string, unknown> | undefined;
    if (distance) {
      const p = distance.parameters;
      if (p.kind !== "within" || p.subject !== FILTERED_UNITS || p.negated === true || p.wholly === true || typeof p.inches !== "number" || p.of_keywords !== undefined) {
        throw new CompileError("Next to a used moment's unit-filter, only a plain within distance of the filtered units can narrow its object.");
      }
      within = { of: p.of ?? "this-unit", range: { inches: p.inches } };
    }
    const { object: _object, ...rest } = leaf.parameters;
    out.push({ ...leaf, start_byte: start, parameters: { ...rest, object_filter: { ...dslUnitFilter(filter), ...(within ? { within } : {}) } } });
  }
  return out;
}
