import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "every model in that unit is within 3\" of ..." (family-extensions-16-every-model-position.ts):
 * the DSL's `models: "every"` on a within predicate. A within distance is measured to this unit or
 * to the following filter's unit; an objective-range takes no `of`. Every other distance form is
 * refused here, so no branch of the position compiler can drop `models` without a message.
 */
export function everyModelFlag(leaf: CompileLeaf): { models?: "every" } {
  const models = leaf.parameters.models;
  if (models === undefined) return {};
  if (models !== "every") throw new CompileError(`unit-position.models ${String(models)} is not an every-model reading.`);
  if (leaf.parameters.wholly === true) throw new CompileError("unit-position.models every cannot combine with wholly: every model is within, not wholly within.");
  if (leaf.parameters.negated === true) throw new CompileError("unit-position.models every is not compiled negated.");
  if (leaf.parameters.range_ref !== undefined || leaf.parameters.distance !== undefined || leaf.parameters.weapon_range !== undefined) {
    throw new CompileError("unit-position.models every measures an inches distance, not a named range, a weapon distance or a weapon range.");
  }
  const kind = leaf.parameters.kind;
  if (kind === "within") {
    const of = leaf.parameters.of;
    if (of !== "this-unit" && of !== "following-filter") throw new CompileError(`unit-position.models every measures to this unit or the following filter, not ${String(of)}.`);
  } else if (kind === "objective-range") {
    if (leaf.parameters.of !== undefined) throw new CompileError("unit-position.models every on objective-range takes no of.");
  } else {
    throw new CompileError(`unit-position.models every does not compile for kind ${String(kind)}.`);
  }
  return { models: "every" };
}
