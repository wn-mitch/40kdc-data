import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Folds each embarked-permission leaf into the persistent designation it qualifies: the nearest
 * persistent-designation-open before it in the same fragment. Leaves between the two (an attack,
 * a reroll) do not stop the search, because the attack is part of the designation's consumer.
 * A leaf with no designation before it in its fragment refuses compilation.
 */
export function foldEmbarkedPermission(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === "embarked-permission")) return [...leaves];
  const result = [...leaves];
  const drop = new Set<number>();
  result.forEach((leaf, at) => {
    if (leaf.family_id !== "embarked-permission") return;
    let head = -1;
    for (let index = at - 1; index >= 0; index--) {
      const other = result[index]!;
      if ((other.fragment ?? null) !== (leaf.fragment ?? null)) break;
      if (other.family_id === "persistent-designation-open") { head = index; break; }
    }
    if (head === -1) throw new CompileError("embarked-permission needs a persistent designation before it in its fragment; the designation is not in the same fragment.");
    const owner = result[head]!;
    result[head] = { ...owner, parameters: { ...owner.parameters, allow_while_embarked: true } };
    drop.add(at);
  });
  return result.filter((_, index) => !drop.has(index));
}
