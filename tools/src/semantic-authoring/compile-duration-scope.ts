import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { PHASE_EDGE_ENDPOINTS } from "./families/durations-and-designations.js";

/** DSL scope.duration for each endpoint a DURATION leaf names outside the phase edges below. */
const DURATIONS: Record<string, string> = {
  "end-of-phase": "phase", "end-of-turn": "turn", "end-of-battle-round": "battle-round", "end-of-battle": "battle",
  "start-of-next-turn": "until-start-next-turn", "start-of-next-command-phase": "until-next-command-phase",
  "start-of-next-movement-phase": "until-next-movement-phase", "start-of-next-battle-round": "until-next-battle-round",
  // Version 3 (batch 7a).
  "end-of-attack-sequence": "attack-sequence", "end-of-this-use": "resolution", "start-of-next-shooting-phase": "until-next-shooting-phase",
  "end-of-your-next-turn": "until-end-of-your-next-turn", "end-of-opponents-next-turn": "until-end-of-opponent-next-turn",
  "this-unit-has-shot": "until-this-unit-has-shot", "control-lost": "control-lost",
  "after-this-use": "after-resolving",
  // Version 6: the turn after the current one, whoever's.
  "end-of-next-turn": "until-end-of-next-turn",
};

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
function phaseEdgeDuration(leaf: CompileLeaf): string {
  const { endpoint, phase, turn } = leaf.parameters as { endpoint: string; phase?: string; turn?: string };
  const found = PHASE_EDGE_SCOPES[`${endpoint}|${String(phase)}|${String(turn)}`];
  if (!found) throw new CompileError(`Duration ${endpoint} ${String(phase)} ${String(turn)} has no DSL scope yet.`);
  return found;
}

/** A DURATION leaf's DSL scope. */
export function duration(leaf: CompileLeaf): string {
  if (PHASE_EDGE_ENDPOINTS.includes(String(closed(leaf, "endpoint")))) return phaseEdgeDuration(leaf);
  const found = DURATIONS[String(closed(leaf, "endpoint"))];
  if (!found) throw new CompileError(`Duration ${String(leaf.parameters.endpoint)} has no DSL scope yet.`);
  return found;
}
