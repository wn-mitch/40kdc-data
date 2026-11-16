import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * Fold each designation-once leaf ("Each enemy unit can only be marked as a Spotted unit once per phase")
 * into the select-unit before it: the selection takes only units without the tag (`not_designated`).
 * Refuses a leaf with no earlier selection, or one whose selection never applies the tag.
 */
export function foldDesignationOnce(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === "designation-once")) return [...leaves];
  const out: CompileLeaf[] = [];
  for (const leaf of leaves) {
    if (leaf.family_id !== "designation-once") { out.push(leaf); continue; }
    const tag = String(leaf.parameters.tag);
    const at = out.map((other) => other.family_id === "select-unit").lastIndexOf(true);
    if (at < 0) throw new CompileError("\"Can only be marked once\" (designation-once) needs a select-unit before it.");
    if (!out.slice(at).some((other) => other.family_id === "apply-mark" && other.parameters.tag === tag)) {
      throw new CompileError(`designation-once names ${tag}, but the selection before it applies no ${tag} mark.`);
    }
    const selection = out[at]!;
    const filter = (selection.parameters.filter ?? {}) as Record<string, unknown>;
    if (filter.not_designated !== undefined && filter.not_designated !== tag) throw new CompileError("A selection takes one designation it excludes.");
    out[at] = { ...selection, parameters: { ...selection.parameters, filter: { ...filter, not_designated: tag } } };
  }
  return out;
}
