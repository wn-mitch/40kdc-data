import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { placements } from "./compile-placement.js";

/**
 * Folds each `engagement-exclusive` leaf onto the unit-state that follows it in its clause. The
 * leaf is dropped and the state carries `exclusive: true`; compile-conditions.ts lowers that state
 * as engagement with the filter and no other friendly unit. The state must be the first unit-state
 * after the leaf in its clause, and it must be a plain "engaged with <filter>": one state, not
 * negated, not at an earlier point, with a following filter, and not already qualified.
 */
export function foldEngagementExclusive(leaves: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === "engagement-exclusive")) return [...leaves];
  const places = placements(leaves, sourceText);
  const out = [...leaves];
  const dropped = new Set<number>();
  leaves.forEach((leaf, index) => {
    if (leaf.family_id !== "engagement-exclusive") return;
    const clause = places[index]!.clause;
    const target = leaves.findIndex((other, at) => at > index && places[at]!.clause === clause && other.family_id === "unit-state");
    if (target < 0) throw new CompileError(`engagement-exclusive at byte ${leaf.start_byte} qualifies an engaged state, but no unit-state follows it in its clause.`);
    const state = out[target]!;
    const { states, negated, with: withRef, at } = state.parameters;
    if (JSON.stringify(states) !== JSON.stringify(["engaged"]) || negated === true || withRef !== "following-filter" || at !== undefined) {
      throw new CompileError(`engagement-exclusive at byte ${leaf.start_byte} qualifies the unit-state after it, which must be a plain engaged-with-filter state.`);
    }
    if (state.parameters.exclusive === true) throw new CompileError(`Two engagement-exclusive leaves qualify the unit-state at byte ${state.start_byte}.`);
    out[target] = { ...state, parameters: { ...state.parameters, exclusive: true } };
    dropped.add(index);
  });
  return out.filter((_, index) => !dropped.has(index));
}
