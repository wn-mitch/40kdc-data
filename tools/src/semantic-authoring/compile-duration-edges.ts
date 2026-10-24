import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * DSL scope.duration for each owner-qualified phase edge the family accepts, keyed
 * "endpoint|phase|turn". The DSL value ends at the first such edge after the effect applies; the
 * phase in progress when the effect applies never counts. Combinations not listed here have no
 * DSL value and are refused.
 */
const PHASE_EDGE_SCOPES: Record<string, string> = {
  "end-of-next-phase|fight|your": "until-end-of-your-next-fight-phase",
  "end-of-next-phase|shooting|your": "until-end-of-your-next-shooting-phase",
  "end-of-next-phase|movement|your": "until-end-of-your-next-movement-phase",
  "end-of-next-phase|movement|opponent": "until-end-of-opponent-next-movement-phase",
  "start-of-next-phase|command|opponent": "until-start-of-opponent-next-command-phase",
};

/** The DSL scope.duration of a DURATION leaf with a phase-edge endpoint. */
export function phaseEdgeDuration(leaf: CompileLeaf): string {
  const { endpoint, phase, turn } = leaf.parameters as { endpoint: string; phase?: string; turn?: string };
  const found = PHASE_EDGE_SCOPES[`${endpoint}|${String(phase)}|${String(turn)}`];
  if (!found) throw new CompileError(`Duration ${endpoint} ${String(phase)} ${String(turn)} has no DSL scope yet.`);
  return found;
}
