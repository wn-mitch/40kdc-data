import { dslExpectation } from "./gen-conformance-cruncher-cases.js";

export const SELECTION_BACKREF_CASE_PREFIX = "canonical/selection-backref/";

/**
 * Fabricated enemy selections ("select one enemy unit; it is marked; ranged attacks that target
 * that unit re-roll Hit rolls of 1"). The lever vouches that the defender is the selected unit, so
 * a condition that it is that unit, or carries the tag the selection itself designates, holds; a
 * tag the selection does not designate stays undecided. A selector that binds the selection with
 * `bind_as` is planned the same way: its `{selection_var}` refs name the selected unit, for an
 * enemy selection (the defender) and a friendly one (the buffed unit).
 *
 * Friendly selections reach the buffed unit only when it can be picked: a `count.max` of 0 picks
 * nothing, a `filter.excluding` of the ability's own unit keeps a unit from picking itself (another
 * unit providing the ability still can), and the whole unit filter, not just its keywords, must
 * hold for the buffed unit; a predicate the context cannot decide leaves the selection unsupported.
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
  const friendly = (filter: Record<string, unknown>, count = { min: 1, max: 1 }) => ({
    type: "select-units",
    selector: {
      filter: { owner: "friendly", within: { range: { inches: 6 }, of: "this-unit" }, ...filter },
      count,
    },
    effect: { type: "re-roll", target: "selected-unit", modifier: { roll: "wound", subset: "ones" } },
  });
  const supported = { kind: "ability", abilityId: source.abilityId, abilityKind: "support" } as const;
  const infantry = { attackerKeywords: ["infantry"] };
  const inputs: Array<{ id: string; effect: unknown; context?: Record<string, unknown>; source?: typeof source | typeof supported }> = [
    { id: "own-designation-and-same-unit", effect: selection(marked("example-mark", "example-mark")) },
    { id: "other-designation-stays", effect: selection(marked("example-mark", "other-mark")) },
    { id: "bound-enemy-designation-and-same-unit", effect: selection(marked("example-mark", "example-mark", bound), binding) },
    { id: "bound-friendly-target", effect: friendlyBound, context: infantry },
    { id: "friendly-count-max-zero-skips", effect: friendly({ all_of: ["INFANTRY"] }, { min: 0, max: 0 }), context: infantry },
    { id: "friendly-excluding-this-unit-skips", effect: friendly({ all_of: ["INFANTRY"], excluding: "this-unit" }), context: infantry },
    { id: "friendly-excluding-ability-unit-skips", effect: friendly({ all_of: ["INFANTRY"], excluding: "ability-unit" }), context: infantry },
    { id: "friendly-excluding-ability-unit-provided", effect: friendly({ all_of: ["INFANTRY"], excluding: "ability-unit" }), context: infantry, source: supported },
    { id: "friendly-filter-state-fails-skips", effect: friendly({ all_of: ["INFANTRY"], state: "benefit-of-cover" }), context: { ...infantry, attackerInCover: false } },
    { id: "friendly-filter-state-holds", effect: friendly({ state: "battle-shocked" }), context: { attackerStates: ["battle-shocked"] } },
    { id: "friendly-filter-state-unknown", effect: friendly({ state: "battle-shocked" }), context: infantry },
    { id: "friendly-keywords-unknown", effect: friendly({ all_of: ["INFANTRY"] }) },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${SELECTION_BACKREF_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source: input.source ?? source,
    effect: input.effect,
    context: { phase: "shooting", attackerTurn: true, ...input.context },
    perspective: "attacker",
  }));
}
