import { dslExpectation, type DslInput } from "./gen-conformance-cruncher-cases.js";

export const LASTING_SETUP_CASE_PREFIX = "canonical/lasting-setup/";

/**
 * Fabricated phase-gated parts whose duration outlasts the phase ("In your Command phase, select
 * one … until the start of your next Command phase"). Around a selection the phase only times the
 * pick, so its options apply in a later phase; around a direct effect the gate holds in its own
 * phase and is the activation lever in a later one. A `phase` or `permanent` duration keeps the
 * gate as printed.
 */
export function canonicalLastingSetupCases() {
  const source = { kind: "ability", abilityId: "fabricated-lasting-setup", abilityKind: "detachment" } as const;
  const yourCommand = { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "command" } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] };
  const hit = { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } };
  const wound = { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } };
  const choice = { type: "choice", options: [hit, wound], choice_label: "Fabricated ability", min_choices: 1, max_choices: 1 };
  const selection = { type: "select-units", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 } }, effect: hit };
  const part = (duration: string, condition: unknown, effect: unknown) => ({ type: "ability-part", duration, effect: { type: "conditional", condition, effect } });
  const shootingGate = { type: "phase-is", parameters: { phase: "shooting" } };
  const inputs: Array<{ id: string; phase: DslInput["context"]["phase"]; effect: unknown }> = [
    { id: "choice-in-later-phase", phase: "fight", effect: part("until-next-command-phase", yourCommand, choice) },
    { id: "choice-in-own-phase", phase: "command", effect: part("until-next-command-phase", yourCommand, choice) },
    { id: "selection-in-later-phase", phase: "shooting", effect: part("until-next-command-phase", yourCommand, selection) },
    { id: "direct-in-later-phase", phase: "fight", effect: part("turn", shootingGate, wound) },
    { id: "direct-in-own-phase", phase: "shooting", effect: part("turn", shootingGate, wound) },
    { id: "phase-duration-keeps-gate", phase: "fight", effect: part("phase", shootingGate, wound) },
    { id: "permanent-keeps-gate", phase: "fight", effect: part("permanent", shootingGate, wound) },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${LASTING_SETUP_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source,
    effect: input.effect,
    context: { phase: input.phase },
    perspective: "attacker",
  }));
}
