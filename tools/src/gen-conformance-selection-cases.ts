import { dslExpectation } from "./gen-conformance-cruncher-cases.js";
import { crunch, type EngineContext } from "./cruncher/index.js";
import { effectToBuffs } from "./cruncher/from-dsl.js";
import type { Dataset } from "./data/dataset.js";

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
 *
 * An enemy selection is gated by its whole unit filter, less `within`, `visible` and `excluding`,
 * on the other side of the attack. The gate is decided when the attack resolves, so planning offers
 * the lever for any filter: several required keywords, `any_of`, `not_all_of`, `none_of` on the
 * attacker, a state, or a `unit_ids` identity the context does not carry. A selector with no
 * friendly or enemy `owner` is not planned as a selection, even when it names `unit_ids`.
 */
export function canonicalSelectionBackrefCases() {
  const source = { kind: "ability", abilityId: "fabricated-selection-backref", abilityKind: "unit" } as const;
  const reroll = { type: "re-roll", target: "attacker", modifier: { roll: "hit", subset: "ones" } };
  const ranged = { type: "attack-is", parameters: { attack_type: "ranged" } };
  const designated = (tag: string) => ({ type: "matches", parameters: { subject: "defender", filter: { designated: tag } } });
  const binding = "example-selection";
  const bound = { selection_var: binding };
  const selection = (effect: unknown, bindAs?: string, filter: Record<string, unknown> = {}) => ({
    type: "select-units",
    selector: {
      filter: { owner: "enemy", within: { range: { inches: 18 }, of: "this-unit" }, ...filter },
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
  const worsenSave = { type: "stat-modifier", target: "selected-unit", modifier: { stat: "Sv", operation: "worsen", value: 1 } };
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
  const enemy = (filter: Record<string, unknown>) => selection(worsenSave, undefined, filter);
  const enemyDebuff = (filter: Record<string, unknown>) => selection(
    { type: "roll-modifier", target: "selected-unit", modifier: { roll: "hit", operation: "subtract", value: 1 } }, undefined, filter,
  );
  const unowned = (owner: Record<string, unknown>) => ({
    type: "select-units",
    selector: { filter: { ...owner, level: "unit", unit_ids: ["example-unit"] }, count: { min: 1, max: 1 } },
    effect: { type: "re-roll", target: "selected-unit", modifier: { roll: "wound", subset: "ones" } },
  });
  const supported = { kind: "ability", abilityId: source.abilityId, abilityKind: "support" } as const;
  const infantry = { attackerKeywords: ["infantry"] };
  const inputs: Array<{
    id: string; effect: unknown; context?: Record<string, unknown>; source?: typeof source | typeof supported;
    perspective?: "attacker" | "target";
  }> = [
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
    { id: "enemy-filter-two-required-keywords", effect: enemy({ all_of: ["INFANTRY", "CHARACTER"] }) },
    { id: "enemy-filter-any-of", effect: enemy({ any_of: ["INFANTRY", "MONSTER"] }) },
    { id: "enemy-filter-not-all-of", effect: enemy({ not_all_of: ["INFANTRY", "CHARACTER"] }) },
    { id: "enemy-filter-state", effect: enemy({ state: "battle-shocked" }) },
    { id: "enemy-filter-unit-ids-identity-unknown", effect: enemy({ level: "unit", unit_ids: ["example-unit"] }) },
    { id: "enemy-filter-unit-ids-other-unit", effect: enemy({ level: "unit", unit_ids: ["example-unit"] }), context: { targetUnitId: "other-unit" } },
    { id: "enemy-filter-attacker-none-of", effect: enemyDebuff({ none_of: ["VEHICLE"] }), context: { attackerTurn: false }, perspective: "target" },
    { id: "unowned-unit-ids-not-a-selection", effect: unowned({}), context: { attackerUnitId: "example-unit" } },
    { id: "any-owner-unit-ids-not-a-selection", effect: unowned({ owner: "any" }), context: { attackerUnitId: "example-unit" } },
  ];
  return inputs.map((input) => dslExpectation({
    caseId: `${SELECTION_BACKREF_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source: input.source ?? source,
    effect: input.effect,
    context: { phase: "shooting", attackerTurn: true, ...input.context },
    perspective: input.perspective ?? "attacker",
  }));
}

/**
 * Pin an enemy selection's filter gate in the damage path, where the from-dsl projection cannot see
 * it: the lever's buff applies only when the defender meets the selector's whole filter, and a
 * predicate the context cannot decide drops it.
 */
export function canonicalSelectedEnemyCruncherCases(ds: Dataset) {
  const source = { kind: "ability", abilityId: "fabricated-selected-enemy", abilityKind: "unit" } as const;
  const enemy = (filter: Record<string, unknown>) => ({
    type: "select-units",
    selector: { filter: { owner: "enemy", within: { range: { inches: 18 }, of: "this-unit" }, ...filter }, count: { min: 1, max: 1 } },
    effect: { type: "stat-modifier", target: "selected-unit", modifier: { stat: "Sv", operation: "worsen", value: 1 } },
  });
  const inputs: { id: string; filter: Record<string, unknown>; unitId: string; context?: Partial<EngineContext> }[] = [
    { id: "any-of-matches", filter: { any_of: ["INFANTRY", "MONSTER"] }, unitId: "intercessor-squad" },
    { id: "any-of-fails", filter: { any_of: ["INFANTRY", "MONSTER"] }, unitId: "outrider-squad" },
    { id: "state-holds", filter: { state: "battle-shocked" }, unitId: "intercessor-squad", context: { targetStates: ["battle-shocked"] } },
    { id: "state-unknown", filter: { state: "battle-shocked" }, unitId: "intercessor-squad" },
  ];
  const weapon = ds.weapons.getAny("bolt-rifle");
  if (!weapon) throw new Error("canonical selected-enemy corpus requires bolt-rifle");
  return inputs.map((row) => {
    const unit = ds.units.getAny(row.unitId);
    if (!unit) throw new Error(`canonical selected enemy ${row.id}: target is missing`);
    const context: EngineContext = { phase: "shooting", withinHalfRange: false, attackerStationary: false, ...row.context };
    const translated = effectToBuffs(enemy(row.filter), source, context);
    if (translated.applied.length || translated.unsupported.length || translated.activatable.length !== 1) {
      throw new Error(`canonical selected enemy ${row.id}: expected one lever`);
    }
    const buffs = translated.activatable[0].buffs;
    const result = crunch({ attacker: { weapon: weapon.raw, profileIndex: 0 }, target: { unit: unit.raw, profileIndex: 0 }, modelsFiring: 5, context, buffs }, ds);
    return { filename: `canonical-selected-enemy-${row.id}.json`, value: {
      name: `Canonical selected enemy: ${row.id}`,
      attacker: { weaponId: weapon.id, profileIndex: 0 }, target: { unitId: unit.id, profileIndex: 0 },
      modelsFiring: 5, context, buffs,
      expected: { stages: Object.fromEntries(result.stages.map((stage) => [stage.name, Math.round(stage.expected * 1e4) / 1e4])) },
    } };
  });
}
