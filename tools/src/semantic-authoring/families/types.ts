import type { SemanticFamilyDefinition } from "../contracts.js";

/**
 * One family's current definition: its schema as a literal, and one `normalize` that checks and
 * canonicalises a leaf's parameters directly, without delegating to an earlier version.
 */
export type FlatFamily = SemanticFamilyDefinition & {
  /** Check `input` (a JSON object) and return its canonical parameters, or throw a TypeError. */
  normalize: (input: Record<string, unknown>) => Record<string, unknown>;
};
