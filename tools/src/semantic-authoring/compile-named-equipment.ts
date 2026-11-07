import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Lowers the named-equipment conditions (families/wargear.ts) to DSL
 * predicates, and refuses the unit-level pairs the DSL cannot tie to one model. Negation is applied
 * by the caller (compile-conditions.ts `polarity`), so these builders return the affirmative node.
 */

type Node = Record<string, unknown>;

/** The affirmative DSL predicate for a named-weapon or unit-wargear leaf. */
export function namedEquipmentPredicate(leaf: CompileLeaf): Node {
  const subject = closed(leaf, "subject");
  if (leaf.family_id === "unit-wargear") {
    if (subject !== "this-unit") throw new CompileError("unit-wargear compiles only for this unit.");
    const models = modelsOf(leaf);
    return { type: "unit-wargear", parameters: { subject, wargear: closed(leaf, "wargear"), ...(models ? { models } : {}) } };
  }
  if (leaf.family_id !== "named-weapon") throw new CompileError(`${leaf.family_id} is not a named-equipment condition.`);
  const models = modelsOf(leaf);
  if (subject === "this-unit" && models === undefined) throw new CompileError("named-weapon this-unit needs a models quantifier: which models carry the weapon.");
  if (subject === "this-model" && models !== undefined) throw new CompileError("named-weapon this-model takes no models quantifier.");
  if (subject !== "this-model" && subject !== "this-unit") throw new CompileError(`named-weapon subject ${String(subject)} is not a model or unit subject.`);
  const name = String(closed(leaf, "name") ?? "").trim();
  if (name.length === 0) throw new CompileError("named-weapon needs the printed weapon name it counts.");
  return {
    type: "named-weapon",
    parameters: { subject, name, count: closed(leaf, "count"), ...(models ? { models } : {}) },
  };
}

function modelsOf(leaf: CompileLeaf): Record<string, unknown> | undefined {
  const models = leaf.parameters.models;
  if (models === undefined) return undefined;
  const { at_least: atLeast, state } = models as Record<string, unknown>;
  return { count: { min: atLeast }, state };
}

/** Whether a leaf is a unit-level equipment condition (a named weapon on this unit, or a wargear item). */
function isUnitEquipment(leaf: CompileLeaf): boolean {
  if (leaf.family_id === "unit-wargear") return true;
  return leaf.family_id === "named-weapon" && leaf.parameters.subject === "this-unit";
}

/**
 * Refuses two unit-level equipment conditions in one ability when either carries a models
 * quantifier. Each condition is true of some models of the unit, so an `and` of the two does not
 * require one model to carry both. Two presence-only unit-wargear conditions are exact under `and`.
 */
export function refuseUnitEquipmentPairs(list: readonly CompileLeaf[]): void {
  const unit = list.filter(isUnitEquipment);
  if (unit.length < 2 || !unit.some((leaf) => leaf.parameters.models !== undefined)) return;
  throw new CompileError("Two unit-level equipment conditions in one ability need one model to carry both; the DSL cannot say that.");
}
