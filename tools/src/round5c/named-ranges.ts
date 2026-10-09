import { CompileError } from "./compile-fragments.js";

/**
 * Named distances an army rule defines ("within Synapse Range"). A name maps to the id of the
 * ability whose current aura range it is, so the DSL carries it as `{aura_of: <ability-id>}`
 * (common.schema.json range-ref). The ability's own `within` holds the anchor and its extensions;
 * a leaf says only whose units are measured to.
 */
export const NAMED_RANGES = {
  contagion: { label: "Contagion Range", aura_of: "nurgles-gift-death-guard" },
  synapse: { label: "Synapse Range", aura_of: "synapse-tyranids" },
} as const;

/** The named range a leaf names, or a CompileError when the name is not registered. */
export function namedRange(name: unknown): { label: string; aura_of: string } {
  if (typeof name !== "string" || !Object.hasOwn(NAMED_RANGES, name)) throw new CompileError(`Unknown named range ${String(name)}.`);
  return NAMED_RANGES[name as keyof typeof NAMED_RANGES];
}
