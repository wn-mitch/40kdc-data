import { dslExpectation } from "./gen-conformance-cruncher-cases.js";

export const SELECTION_BACKREF_CASE_PREFIX = "canonical/selection-backref/";

/**
 * Fabricated enemy selections ("select one enemy unit; it is marked; ranged attacks that target
 * that unit re-roll Hit rolls of 1"). The lever vouches that the defender is the selected unit, so
 * a condition that it is that unit, or carries the tag the selection itself designates, holds; a
 * tag the selection does not designate stays undecided.
 */
export function canonicalSelectionBackrefCases() {
  const source = { kind: "ability", abilityId: "fabricated-selection-backref", abilityKind: "unit" } as const;
  const reroll = { type: "re-roll", target: "attacker", modifier: { roll: "hit", subset: "ones" } };
  const ranged = { type: "attack-is", parameters: { attack_type: "ranged" } };
  const designated = (tag: string) => ({ type: "matches", parameters: { subject: "defender", filter: { designated: tag } } });
  const selection = (effect: unknown) => ({
    type: "select-units",
    selector: { filter: { owner: "enemy", within: { range: { inches: 18 }, of: "this-unit" } }, count: { min: 1, max: 1 } },
    effect,
  });
  const marked = (tag: string, checked: string) => ({
    type: "sequence",
    steps: [
      { type: "designate", target: "selected-unit", modifier: { tag } },
      {
        type: "conditional",
        condition: { operator: "and", operands: [designated(checked), ranged] },
        effect: { type: "conditional", condition: { type: "same-unit", parameters: { subject: "defender", as: "selected-unit" } }, effect: reroll },
      },
    ],
  });
  const inputs: Array<{ id: string; effect: unknown }> = [
    { id: "own-designation-and-same-unit", effect: selection(marked("example-mark", "example-mark")) },
    { id: "other-designation-stays", effect: selection(marked("example-mark", "other-mark")) },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${SELECTION_BACKREF_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source,
    effect: input.effect,
    context: { phase: "shooting", attackerTurn: true },
    perspective: "attacker",
  }));
}
