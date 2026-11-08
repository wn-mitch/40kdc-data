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

/** "After the attacking unit has finished making its attacks" with nothing else named: a moment of the attacking unit, either side. */
function isAttacksDone(leaf: CompileLeaf): boolean {
  return leaf.family_id === "event" && leaf.parameters.kind === "attacks-resolved"
    && Object.keys(leaf.parameters).every((key) => key === "kind" || key === "owner");
}

/**
 * "Each time an enemy model loses a wound, … roll one D6: on a 4+, one model from your unit is
 * destroyed after the attacking unit has finished making its attacks": the roll is made as the
 * wound is lost, and the effect waits for that attack's unit to finish. An effect followed by an
 * attacks-resolved moment, with only a comma or spaces between them in one fragment, takes
 * `after_attacks`, which lowers to an ability-part on the attacker's attacks-resolved moment. The
 * attacking unit is the attacker of an earlier damage-allocated moment, so the record must have one.
 */
export function foldEffectAfterAttacks(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (sourceText === undefined) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const out: CompileLeaf[] = [];
  for (const leaf of leaves) {
    const before = out.at(-1);
    const folds = before !== undefined && isAttacksDone(leaf) && before.role === "EFFECT" && before.parameters.after_attacks === undefined
      && out.some((earlier) => earlier.family_id === "event" && earlier.parameters.kind === "damage-allocated")
      && before.fragment === leaf.fragment && before.end_byte !== undefined
      && /^[\s,*]*$/u.test(bytes.subarray(before.end_byte, leaf.start_byte).toString("utf8"));
    if (!folds) { out.push(leaf); continue; }
    out[out.length - 1] = { ...before!, end_byte: leaf.end_byte ?? before!.end_byte, parameters: { ...before!.parameters, after_attacks: true } };
  }
  return out;
}
