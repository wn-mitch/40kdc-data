import type { CompileLeaf } from "../src/semantic-authoring/compile.js";
import { normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

/**
 * The leaf contract every compiled test leaf is held to (test/setup/leaf-contract-guard.ts): a reviewer can store
 * only parameters its family normalizes, in the form normalization returns, so a test compiles nothing else.
 */

/** Leaf arrays a test compiles on purpose outside the contract (outsideContract). */
const marked = new WeakSet<readonly CompileLeaf[]>();
let synthetic = false;

/** Why a leaf breaks the contract, or undefined when a reviewer could store it as it is. */
export function contractProblem(leaf: CompileLeaf): string | undefined {
  let normalized: Record<string, unknown>;
  try {
    normalized = normalizeFingerprintParameters(leaf.family_id, leaf.parameters, leaf.family_version);
  } catch (error) {
    return `the contract rejects it: ${(error as Error).message}`;
  }
  return canonical(normalized) === canonical(leaf.parameters) ? undefined
    : `it is not in stored form: normalization gives ${JSON.stringify(normalized)}`;
}

/**
 * Marks leaves a test compiles on purpose although the contract rejects one of them: a compile-level refusal sits
 * behind the contract check, and the test asserts the contract refusal too. Throws when every leaf meets the
 * contract, so a stale mark does not hide a leaf that has since become valid.
 */
export function outsideContract<T extends readonly CompileLeaf[]>(leaves: T): T {
  if (leaves.every((leaf) => contractProblem(leaf) === undefined)) throw new Error("outsideContract: every leaf meets the contract.");
  marked.add(leaves);
  return leaves;
}

/** For a test file whose leaves are synthetic by design (it sweeps every family's compile arm): skips the guard. */
export function allowSyntheticLeaves(): void {
  synthetic = true;
}

/** Whether the guard skips these leaves. */
export function exempt(leaves: readonly CompileLeaf[]): boolean {
  return synthetic || marked.has(leaves);
}

/** JSON with object keys sorted: stored form compares without key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => inner !== null && typeof inner === "object" && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : inner);
}
