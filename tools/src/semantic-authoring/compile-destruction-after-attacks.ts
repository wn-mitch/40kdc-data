import type { CompileLeaf } from "./compile-fragments.js";

const DESTROY_KINDS = new Set(["unit-destroyed", "model-destroyed"]);

/** "after the attacking unit has finished making its attacks": the destroyer's attacks resolved, and nothing else named. */
function isAttackerDone(leaf: CompileLeaf): boolean {
  if (leaf.family_id !== "event" || leaf.parameters.kind !== "attacks-resolved" || leaf.parameters.owner !== "enemy") return false;
  return Object.keys(leaf.parameters).every((key) => key === "kind" || key === "owner");
}

/**
 * "Each time a model in this unit is destroyed, after the attacking unit has finished making its
 * attacks, …": the second moment says when the destruction resolves, not a second moment that
 * fires on its own. A destruction moment followed by an enemy attacks-resolved moment, with only a
 * comma or spaces between them in one fragment, folds into the destruction as `timing:
 * after-attacks`, which the trigger carries as its filter's timing. A destruction already timed
 * (before removal, or this model's own) keeps both leaves, as does any wording between them.
 */
export function foldDestructionAfterAttacks(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const out: CompileLeaf[] = [];
  for (const leaf of leaves) {
    const before = out.at(-1);
    const folds = before !== undefined && isAttackerDone(leaf) && before.family_id === "event" && DESTROY_KINDS.has(String(before.parameters.kind))
      && before.parameters.timing === undefined
      && before.fragment === leaf.fragment && before.end_byte !== undefined
      && /^[\s,*]*$/u.test(bytes.subarray(before.end_byte, leaf.start_byte).toString("utf8"));
    if (!folds) { out.push(leaf); continue; }
    out[out.length - 1] = { ...before!, end_byte: leaf.end_byte ?? before!.end_byte, parameters: { ...before!.parameters, timing: "after-attacks" } };
  }
  return out;
}
