/**
 * Conformance rows for {@link mortalWoundSources}: the mortal wounds an ability inflicts on an enemy
 * unit outside an attack. Fabricated rows pin each container and modifier; dataset rows pin real
 * records, which every port reads from its own embedded dataset by `abilityId` and `factionId`.
 */
import type { EngineContext } from "./cruncher/buffs.js";
import { conditionFactKey } from "./cruncher/condition-facts.js";
import { mortalWoundSources } from "./cruncher/mortal-sources.js";
import type { Dataset } from "./data/dataset.js";

type MortalSourceRow = {
  caseId: string;
  abilityId: string;
  factionId?: string;
  effect?: unknown;
  trigger?: unknown;
  rating?: string | number;
  context: Partial<EngineContext>;
};

const charge = { event: "move-ended", filter: { move_types: ["charge"] } };
const engaged = { type: "matches", parameters: { subject: "selected-unit", filter: { engaged_with: "this-unit" } } };
const selectEnemy = (effect: unknown, eligibility?: unknown) => ({
  type: "select-units",
  selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 }, ...(eligibility ? { eligibility } : {}) },
  effect,
});
const mw = (modifier: Record<string, unknown>, target: unknown = "selected-unit") => ({ type: "mortal-wounds", target, modifier });
const table = {
  type: "dice-table", dice: "D6",
  outcomes: [{ results: [1, 2], effect: { type: "no-effect" } }, { results: [3, 4, 5], effect: mw({ count: 1 }) }, { results: [6], effect: mw({ count: "D3+3" }) }],
};

/** Every mortal-sources row with its expectation. */
export function canonicalMortalSourceCases(ds: Dataset): (MortalSourceRow & { expected: unknown })[] {
  const rows: MortalSourceRow[] = [
    { caseId: "fixed-count-on-charge", abilityId: "a", trigger: charge, effect: selectEnemy(mw({ count: "D3" })), context: { phase: "shooting" } },
    { caseId: "dice-gated", abilityId: "a", trigger: charge, effect: selectEnemy({ type: "dice-gated", dice: "D6", threshold: 4, comparison: "gte", on_success: mw({ count: "D3" }), on_fail: mw({ count: 1 }) }), context: {} },
    { caseId: "dice-gated-lte-2d6", abilityId: "a", effect: selectEnemy({ type: "dice-gated", dice: "2D6", threshold: 5, comparison: "lte", on_success: mw({ count: 3 }), on_fail: null }), context: {} },
    { caseId: "dice-table-two-dice", abilityId: "a", effect: selectEnemy({ ...table, count: 2 }), context: {} },
    { caseId: "per-success-capped", abilityId: "a", trigger: charge, effect: selectEnemy(mw({ count: 1, per: "success", max: 2, roll: { dice: 6, threshold: 4 } })), context: {} },
    { caseId: "per-success-dice-count", abilityId: "a", effect: selectEnemy(mw({ count: "D3", per: "success", max: 6, roll: { dice: "D3", threshold: 5 } })), context: {} },
    { caseId: "per-model-own-unit", abilityId: "a", effect: selectEnemy(mw({ count: 1, per: "success", roll: { dice: 1, threshold: 4, per_model: "this-unit" } })), context: { attackerModelCount: 5 } },
    { caseId: "per-model-own-unit-unknown", abilityId: "a", effect: selectEnemy(mw({ count: 1, per: "success", roll: { dice: 1, threshold: 4, per_model: "this-unit" } })), context: {} },
    { caseId: "per-model-target", abilityId: "a", effect: selectEnemy(mw({ count: 1, per: "success", roll: { dice: 1, threshold: 6, per_model: "selected-unit" } })), context: { targetModelCount: 10 } },
    { caseId: "for-each-own-model-eligibility", abilityId: "a", trigger: charge, effect: selectEnemy(mw({ count: 1, per: "success", roll: { dice: 1, threshold: 2, for_each: { filter: { owner: "friendly", level: "model", member_of: "this-unit" }, eligibility: { type: "matches", parameters: { filter: { engaged_with: "selected-unit" } } } } } })), context: { attackerModelCount: 4 } },
    { caseId: "for-each-subset-of-models", abilityId: "a", effect: selectEnemy(mw({ count: 1, per: "success", roll: { dice: 1, threshold: 4, for_each: { filter: { owner: "friendly", level: "model", member_of: "this-unit", all_of: ["TROOPS"] } } } })), context: { attackerModelCount: 4 } },
    { caseId: "choice-options", abilityId: "a", effect: { type: "choice", options: [selectEnemy(table), selectEnemy(mw({ count: 2 }))] }, context: {} },
    { caseId: "self-damage-skipped", abilityId: "a", trigger: charge, effect: { type: "sequence", steps: [mw({ count: "D3" }, "this-unit"), mw({ count: 1 }, "this-model")] }, context: {} },
    { caseId: "phase-never-gates", abilityId: "a", trigger: charge, effect: { type: "conditional", condition: { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "movement" } }, { operator: "not", operands: [{ type: "phase-is", parameters: { phase: "shooting" } }] }] }, effect: selectEnemy(mw({ count: 1 })) }, context: { phase: "shooting" } },
    { caseId: "phase-inside-not", abilityId: "a", trigger: charge, effect: { type: "conditional", condition: { operator: "not", operands: [{ operator: "and", operands: [{ type: "phase-is", parameters: { phase: "fight" } }, engaged] }] }, effect: selectEnemy(mw({ count: 1 })) }, context: { conditionFacts: { [conditionFactKey(engaged, "attacker")]: true } } },
    { caseId: "eligibility-need", abilityId: "a", trigger: charge, effect: selectEnemy(mw({ count: 1 }), engaged), context: {} },
    { caseId: "eligibility-answered-false", abilityId: "a", trigger: charge, effect: selectEnemy(mw({ count: 1 }), engaged), context: { conditionFacts: { [conditionFactKey(engaged, "attacker")]: false } } },
    { caseId: "eligibility-answered-true", abilityId: "a", trigger: charge, effect: selectEnemy(mw({ count: 1 }), engaged), context: { conditionFacts: { [conditionFactKey(engaged, "attacker")]: true } } },
    { caseId: "trigger-condition-and-alternatives", abilityId: "a", trigger: [charge, { event: "phase-started", filter: { phase: "fight" }, subject: { owner: "enemy" } }], effect: mw({ count: 1 }, "event-subject"), context: {} },
    { caseId: "trigger-subject-enemy", abilityId: "a", trigger: { event: "move-ended", subject: { owner: "enemy" }, condition: engaged }, effect: { type: "ability-part", trigger: { event: "after-roll", filter: { roll: "charge" } }, effect: mw({ count: 2 }, "event-subject") }, context: {} },
    { caseId: "enemy-units-in-range", abilityId: "a", trigger: { event: "phase-ended" }, effect: { type: "for-each-unit", selector: { filter: { owner: "enemy", within: { range: { inches: 6 }, of: "this-model" } } }, effect: { type: "dice-gated", dice: "D6", threshold: 4, comparison: "gte", on_success: mw({ count: "D3" }, "recipient"), on_fail: null } }, context: {} },
    { caseId: "enemy-target-filter", abilityId: "a", effect: mw({ count: 1 }, { owner: "enemy", within: { range: { inches: 9 } } }), context: {} },
    { caseId: "rating-count", abilityId: "a", effect: selectEnemy(mw({ count: { rating: true } })), rating: "D3+1", context: {} },
    { caseId: "unclear-target", abilityId: "a", effect: mw({ count: 1 }, "stratagem-target"), context: {} },
    { caseId: "unmodelled-container", abilityId: "a", effect: { type: "aura", effect: mw({ count: 1 }, "enemy-within-aura") }, context: {} },
    { caseId: "count-from-roll", abilityId: "a", effect: selectEnemy({ type: "roll", dice: "D6", roll_var: "r", effect: mw({ count: { roll_var: "r" } }) }), context: {} },
  ];
  const dataset: MortalSourceRow[] = [
    { caseId: "dataset-thunderhawk-cluster-bombs", abilityId: "thunderhawk-cluster-bombs-adeptus-astartes", factionId: "adeptus-astartes", context: { phase: "shooting" } },
    { caseId: "dataset-crimson-harvest", abilityId: "crimson-harvest-necrons", factionId: "necrons", context: { phase: "fight" } },
    { caseId: "dataset-krushin-impetus", abilityId: "krushin-impetus-orks", factionId: "orks", context: { attackerModelCount: 10 } },
    { caseId: "dataset-hypertoxic-miasma", abilityId: "hypertoxic-miasma-tyranids", factionId: "tyranids", context: {} },
    { caseId: "dataset-neutronium-cascade-mine", abilityId: "neutronium-cascade-mine-adeptus-custodes", factionId: "adeptus-custodes", context: {} },
  ];
  return [...rows, ...dataset].map((row) => {
    const record = row.factionId === undefined ? undefined : ds.abilities.getInFaction(row.abilityId, row.factionId);
    if (row.factionId !== undefined && !record) throw new Error(`mortal-sources conformance references unknown ability ${row.abilityId}`);
    // The phase never gates a source; rows that leave it out pin that.
    const context = row.context as EngineContext;
    const result = record
      ? mortalWoundSources(record.id, record.raw.effect, record.raw.trigger, context, row.rating)
      : mortalWoundSources(row.abilityId, row.effect, row.trigger, context, row.rating);
    return {
      ...row,
      expected: {
        sources: result.sources.map((source) => ({ id: source.id, moment: source.moment, expected: source.expected, needKeys: source.needs.map((need) => need.key) })),
        unsupportedReasons: result.unsupported.map((fragment) => fragment.reason),
      },
    };
  });
}
