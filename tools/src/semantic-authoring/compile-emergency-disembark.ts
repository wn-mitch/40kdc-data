import { exactSpan } from "./contracts.js";
import type { CompileLeaf } from "./compile-fragments.js";

/** "after the units embarked within it (if any) have made their emergency disembark moves". */
const AFTER_EMERGENCY = /^after\b[\s\S]*\bemergency disembark/iu;

/**
 * "Each time a model with this ability is destroyed, after the units embarked within it (if any) have
 * made their emergency disembark moves, …": the disembark is not a moment of its own but when the
 * destruction resolves, so the units that disembarked are on the battlefield for its effects. The
 * disembark moment (move-ended, move_types disembark) folds into the destruction as timing
 * after-emergency-disembark (compile-triggers.ts puts it in the trigger's filter).
 *
 * Folds only a disembark moment that opens with "after" and names an emergency disembark, right after
 * a destruction of this model in its fragment, with only a comma between.
 */
export function foldEmergencyDisembark(list: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (sourceText === undefined) return [...list];
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const destroyed = list[index]!;
    const move = list[index + 1];
    const folds = isDestruction(destroyed) && move !== undefined && isDisembark(move) && move.fragment === destroyed.fragment
      && destroyed.end_byte !== undefined && move.end_byte !== undefined && destroyed.end_byte <= move.start_byte
      && /^[\s*]*,\s*$/u.test(exactSpan(sourceText, destroyed.end_byte, move.start_byte))
      && AFTER_EMERGENCY.test(exactSpan(sourceText, move.start_byte, move.end_byte));
    if (!folds) {
      out.push(destroyed);
      continue;
    }
    out.push({ ...destroyed, end_byte: move.end_byte, parameters: { ...destroyed.parameters, timing: "after-emergency-disembark" } });
    index += 1;
  }
  return out;
}

const isDestruction = (leaf: CompileLeaf) => leaf.family_id === "event" && leaf.parameters.kind === "this-model-destroyed" && leaf.parameters.timing === undefined;

function isDisembark(leaf: CompileLeaf): boolean {
  const p = leaf.parameters;
  return leaf.family_id === "event" && p.kind === "move-ended" && Array.isArray(p.move_types) && p.move_types.length === 1 && p.move_types[0] === "disembark"
    && Object.keys(p).every((key) => key === "kind" || key === "move_types");
}
