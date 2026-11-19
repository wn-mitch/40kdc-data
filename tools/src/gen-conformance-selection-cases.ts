import { dslExpectation } from "./gen-conformance-cruncher-cases.js";

export const SELECTION_BACKREF_CASE_PREFIX = "canonical/selection-backref/";

/**
 * Fabricated enemy selections ("select one enemy unit; it is marked; ranged attacks that target
 * that unit re-roll Hit rolls of 1"). The lever vouches that the defender is the selected unit, so
 * a condition that it is that unit, or carries the tag the selection itself designates, holds; a
 * tag the selection does not designate stays undecided. A selector that binds the selection with
 * `bind_as` is planned the same way: its `{selection_var}` refs name the selected unit, for an
 * enemy selection (the defender) and a friendly one (the buffed unit).
 */
export function canonicalSelectionBackrefCases() {
  const source = { kind: "ability", abilityId: "fabricated-selection-backref", abilityKind: "unit" } as const;
  const reroll = { type: "re-roll", target: "attacker", modifier: { roll: "hit", subset: "ones" } };
  const ranged = { type: "attack-is", parameters: { attack_type: "ranged" } };
  const designated = (tag: string) => ({ type: "matches", parameters: { subject: "defender", filter: { designated: tag } } });
  const binding = "example-selection";
  const bound = { selection_var: binding };
  const selection = (effect: unknown, bindAs?: string) => ({
    type: "select-units",
    selector: {
      filter: { owner: "enemy", within: { range: { inches: 18 }, of: "this-unit" } },
      count: { min: 1, max: 1 },
      ...(bindAs ? { bind_as: bindAs } : {}),
    },
    effect,
  });
  const marked = (tag: string, checked: string, selected: unknown = "selected-unit") => ({
    type: "sequence",
    steps: [
      { type: "designate", target: selected, modifier: { tag } },
      {
        type: "conditional",
        condition: { operator: "and", operands: [designated(checked), ranged] },
        effect: { type: "conditional", condition: { type: "same-unit", parameters: { subject: "defender", as: selected } }, effect: reroll },
      },
    ],
  });
  const friendlyBound = {
    type: "select-units",
    selector: {
      filter: { owner: "friendly", all_of: ["INFANTRY"], within: { range: { inches: 6 }, of: "this-unit" } },
      count: { min: 1, max: 1 },
      bind_as: binding,
    },
    effect: { type: "re-roll", target: bound, modifier: { roll: "wound", subset: "ones" } },
  };
  const inputs: Array<{ id: string; effect: unknown; context?: Record<string, unknown> }> = [
    { id: "own-designation-and-same-unit", effect: selection(marked("example-mark", "example-mark")) },
    { id: "other-designation-stays", effect: selection(marked("example-mark", "other-mark")) },
    { id: "bound-enemy-designation-and-same-unit", effect: selection(marked("example-mark", "example-mark", bound), binding) },
    { id: "bound-friendly-target", effect: friendlyBound, context: { attackerKeywords: ["infantry"] } },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${SELECTION_BACKREF_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source,
    effect: input.effect,
    context: { phase: "shooting", attackerTurn: true, ...input.context },
    perspective: "attacker",
  }));
}
