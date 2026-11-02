import type { CompileLeaf } from "./compile-fragments.js";

/** A leaf combination the compiler cannot lower to the DSL; the message says why. */
export class CompileError extends Error {}

/** The leaf holds no parameter outside `allowed`; `label` names what consumes it, so a refusal says which fold could not. */
export function checkedKeys(leaf: CompileLeaf, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(leaf.parameters).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new CompileError(`${label} cannot consume ${leaf.family_id}.${unexpected.join(", ")}.`);
}
