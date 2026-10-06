import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * What a model set back up (or a unit split apart) comes back with: "with 3 wounds remaining",
 * "its unit has a Starting Strength of 1", "That model is not part of an attached unit". Each
 * qualifier is its own leaf and folds into the nearest effect before it in its source fragment,
 * which must be one of the effects it can qualify. It gates nothing.
 */

/** Each qualifier family: the effects it can qualify and the effect parameter it sets. */
const QUALIFIERS: Record<string, { owners: readonly string[]; key: string }> = {
  "wounds-remaining": { owners: ["set-up", "return-models"], key: "wounds_remaining" },
  "starting-strength": { owners: ["set-up", "split-unit"], key: "starting_strength" },
  "leaves-attached-unit": { owners: ["set-up"], key: "detach" },
  // "contains 1 model" (and "for each model in this unit", compile-count-scale.ts): the added unit's size.
  "unit-size": { owners: ["add-unit"], key: "model_count" },
};

const isQualifier = (leaf: CompileLeaf) => leaf.role === "CONDITION" && leaf.family_id in QUALIFIERS;

/** The value a qualifier sets on its effect; a return-models leaf keeps its wounds as count strings. */
function valueFor(qualifier: CompileLeaf, owner: CompileLeaf): unknown {
  if (qualifier.family_id === "leaves-attached-unit") return true;
  if (qualifier.family_id === "unit-size") return qualifier.parameters.count ?? qualifier.parameters.models;
  const value = qualifier.parameters.value;
  if (value === undefined) throw new CompileError(`A ${qualifier.family_id} qualifier needs a reviewed value.`);
  return owner.family_id === "return-models" && typeof value === "number" ? String(value) : value;
}

/** Fold every wounds-remaining, starting-strength, leaves-attached-unit and unit-size leaf into its effect. */
export function foldModelState(leaves: readonly CompileLeaf[]): readonly CompileLeaf[] {
  if (!leaves.some(isQualifier)) return leaves;
  const result = [...leaves];
  const drop = new Set<number>();
  result.forEach((leaf, at) => {
    if (!isQualifier(leaf)) return;
    const { owners, key } = QUALIFIERS[leaf.family_id]!;
    let ownerAt = -1;
    for (let index = at - 1; index >= 0; index--) {
      const other = result[index]!;
      if ((other.fragment ?? null) !== (leaf.fragment ?? null)) break;
      // A new moment between them starts another rule; the qualifier cannot reach back past it.
      if (other.role === "EVENT") break;
      // "Add a new X unit … set it up … It contains 1 model": the size is the added unit's, past its own set-up.
      if (leaf.family_id === "unit-size" && other.family_id === "set-up") continue;
      if (other.role === "EFFECT") { ownerAt = index; break; }
    }
    if (ownerAt === -1) throw new CompileError(`A ${leaf.family_id} qualifier needs a ${owners.join(" or ")} effect before it in its fragment.`);
    const owner = result[ownerAt]!;
    if (!owners.includes(owner.family_id)) {
      throw new CompileError(`A ${leaf.family_id} qualifier qualifies only ${owners.join(" or ")}; the effect before it is ${owner.family_id}.`);
    }
    const value = valueFor(leaf, owner);
    const existing = owner.parameters[key];
    if (existing !== undefined && existing !== value) {
      throw new CompileError(`The ${owner.family_id} before a ${leaf.family_id} qualifier already has ${key} ${JSON.stringify(existing)}; the qualifier says ${JSON.stringify(value)}.`);
    }
    result[ownerAt] = { ...owner, parameters: { ...owner.parameters, [key]: value } };
    drop.add(at);
  });
  return result.filter((_, index) => !drop.has(index));
}
