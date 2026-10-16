import { CompileError } from "./compile-error.js";
import type { CompileLeaf } from "./compile-fragments.js";

/**
 * Consumes the quoted once-per-battle qualifiers in the used-event window and effect.
 * They describe the ability being refreshed, not the rule granting the refresh; the
 * latter's owned usage-limit restriction remains and governs the granting rule.
 */
export function foldAbilityUseRefresh(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  const refreshes = leaves.filter((leaf) => {
    if (leaf.family_id !== "ability-modifier" || leaf.parameters.aspect !== "uses") return false;
    const ability = leaf.parameters.ability;
    return ability !== null && typeof ability === "object" && !Array.isArray(ability) && (ability as Record<string, unknown>).event === "used";
  });
  if (refreshes.length === 0) return [...leaves];
  const qualifiedEvent = leaves.some((leaf) => leaf.family_id === "event"
    && leaf.parameters.kind === "used"
    && leaf.parameters.activity === "ability"
    && leaf.parameters.bind_as === "used-ability"
    && Array.isArray(leaf.parameters.source)
    && leaf.parameters.source.length > 0
    && leaf.parameters.usage !== undefined
    && typeof leaf.parameters.usage === "object"
    && leaf.parameters.usage !== null
    && !Array.isArray(leaf.parameters.usage)
    && (leaf.parameters.usage as Record<string, unknown>).frequency === "n-per-battle"
    && (leaf.parameters.usage as Record<string, unknown>).count === 1);
  if (!qualifiedEvent) throw new CompileError("A used-ability refresh needs its exact once-per-battle used event binding.");
  const quoted = leaves.filter((leaf) => leaf.family_id === "usage-limit"
    && (leaf.fragment === "EFFECT" || (leaf.fragment === "WHEN" && leaf.parameters.per === undefined)));
  for (const leaf of quoted) {
    const frequency = leaf.parameters.frequency;
    const count = leaf.parameters.count;
    if (frequency !== "once-per-battle" && frequency !== "n-per-battle") {
      throw new CompileError("A used-ability refresh must qualify the refreshed ability with once per battle.");
    }
    if (frequency === "n-per-battle" && count !== 1) throw new CompileError("A used-ability refresh must qualify the refreshed ability with exactly one use per battle.");
    if (leaf.parameters.per !== undefined) throw new CompileError("A quoted refreshed-ability usage cannot add a model, unit or army allowance.");
  }
  return leaves.filter((leaf) => !quoted.includes(leaf));
}
