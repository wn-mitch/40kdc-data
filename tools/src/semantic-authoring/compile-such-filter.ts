import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/** "such an" (with bold marks or spaces between) right before a leaf's span. */
const SUCH_BEFORE = /\bsuch\s+an?\s*\**\s*$/iu;

/**
 * "if such an enemy unit is below its Starting Strength": the words after "such" restate a unit an earlier
 * leaf introduced (an aura's recipient, a selected unit). A unit-filter over them would name every unit
 * that matches instead, so the record is refused; the anaphor's own leaf covers the phrase with
 * subject antecedent ("such an enemy unit is below …"), as it does for "that enemy unit".
 */
export function refuseSuchFilters(leaves: readonly CompileLeaf[], sourceText: string | undefined): void {
  if (sourceText === undefined) return;
  const bytes = Buffer.from(sourceText, "utf8");
  for (const leaf of leaves) {
    if (leaf.family_id !== "unit-filter" || leaf.start_byte <= 0) continue;
    const before = bytes.subarray(Math.max(0, leaf.start_byte - 16), leaf.start_byte).toString("utf8");
    if (SUCH_BEFORE.test(before)) {
      throw new CompileError(`unit-filter at byte ${leaf.start_byte} follows "such", which points back to an earlier unit; cover the phrase with the anaphor's own leaf (subject antecedent) instead of a unit-filter.`);
    }
  }
}
