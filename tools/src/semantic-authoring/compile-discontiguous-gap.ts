import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * The source wording between two leaves, with the wording of the duration leaves in `skipped`
 * removed. A binder checks this text against the punctuation its shape allows between the leaves.
 */
export function wordingBetween(source: Buffer, from: CompileLeaf, to: CompileLeaf, skipped: readonly CompileLeaf[]): string {
  if (from.end_byte === undefined || to.start_byte === undefined) {
    throw new CompileError("A discontiguous leaf needs source span ends to verify its clause.");
  }
  let cursor = from.end_byte;
  let text = "";
  for (const leaf of skipped) {
    if (leaf.end_byte === undefined || leaf.start_byte < cursor) throw new CompileError("A discontiguous leaf needs ordered source spans to verify its clause.");
    text += source.subarray(cursor, leaf.start_byte).toString("utf8");
    cursor = leaf.end_byte;
  }
  return text + source.subarray(cursor, to.start_byte).toString("utf8");
}
