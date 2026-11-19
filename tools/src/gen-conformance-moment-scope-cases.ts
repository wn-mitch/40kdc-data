import { dslExpectation } from "./gen-conformance-cruncher-cases.js";

export const MOMENT_SCOPE_CASE_PREFIX = "canonical/moment-scope/";

/**
 * Fabricated parts gated on a moment the context cannot place ("when this unit ends an Advance
 * move"). The undecided moment is scoped by the part's body: a move or a phase-gated move is out of
 * scope, mortal wounds act outside the attack, and a hit modifier keeps the moment unresolved.
 */
export function canonicalMomentScopeCases() {
  const source = { kind: "ability", abilityId: "fabricated-moment-scope", abilityKind: "unit" } as const;
  const advanced = { event: "move-ended", filter: { move_types: ["advance"] } };
  const part = (effect: unknown) => ({ type: "ability-part", trigger: advanced, effect });
  const disembark = { type: "move", target: { owner: "friendly", embarked_in: "this-unit" }, modifier: { move_type: "disembark", mode: "shock" } };
  const yourMovement = { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "movement" } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] };
  const inputs: Array<{ id: string; effect: unknown }> = [
    { id: "move", effect: part(disembark) },
    { id: "phase-gated-move", effect: part({ type: "conditional", condition: yourMovement, effect: disembark }) },
    { id: "mortal-wounds", effect: part({ type: "mortal-wounds", target: "defender", modifier: { amount: 1 } }) },
    { id: "hit-modifier", effect: part({ type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } }) },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${MOMENT_SCOPE_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source,
    effect: input.effect,
    context: { phase: "shooting", attackerTurn: true },
    perspective: "attacker",
  }));
}
