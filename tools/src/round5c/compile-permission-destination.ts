import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { isTargetRef } from "./compile-target-refs.js";

/**
 * The Transport an embark permission places its subject within (`into`, see
 * family-extensions-16-transport-embark-eligibility-followup.ts). The binder has already resolved
 * `antecedent` to a Stratagem target (compile-target-refs.ts settleDestination) or left it for
 * compile-antecedent.ts; a value still `antecedent` here has no unit to name, so it refuses.
 */
export function permissionDestination(leaf: CompileLeaf): unknown {
  const into = leaf.parameters.into;
  if (into === undefined) return undefined;
  if (into === "this-unit") return "this-unit";
  if (isTargetRef(into)) return into;
  if (into === "following-filter") {
    if (leaf.parameters.following_filter === undefined) throw new CompileError(`eligibility-permission at byte ${leaf.start_byte} places the subject within the unit-filter after it, but none follows in its clause.`);
    return structuredClone(leaf.parameters.following_filter);
  }
  // A bound selection pair's inner unit: compile.ts writes the object once the inner selection is named.
  if (typeof into === "object" && into !== null && typeof (into as { selection_var?: unknown }).selection_var === "string") return into;
  if (into === "selection") throw new CompileError(`eligibility-permission at byte ${leaf.start_byte} takes its destination from the inner selection of a bound pair, and no pair binds one.`);
  throw new CompileError(`eligibility-permission at byte ${leaf.start_byte} names no Transport to embark within (into ${JSON.stringify(into)}).`);
}
