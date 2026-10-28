import { describe, expect, it } from "vitest";

import { conditionFactKey, crunch, mortalWoundSources, type EngineContext, type EngineInput } from "../src/cruncher/index.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { Dataset } from "../src/data/dataset.js";

const ds = Dataset.embedded();

function stage(out: ReturnType<typeof crunch>, name: string): number {
  const found = out.stages.find((entry) => entry.name === name);
  if (!found) throw new Error(`no stage ${name}`);
  return found.expected;
}

// bolt-rifle profile 1: A=2, S=5, AP=-1, D=1 against intercessors (T5, Sv3, W2): no Devastating Wounds.
function boltRifle(buffs: EngineInput["buffs"]): EngineInput {
  const weapon = ds.weapons.getAny("bolt-rifle")!;
  const unit = ds.units.getAny("intercessor-squad")!;
  return {
    attacker: { weapon: weapon.raw, profileIndex: 1 },
    target: { unit: unit.raw, profileIndex: 0, modelCount: 10 },
    modelsFiring: 5,
    buffs,
    context: { phase: "shooting", attackerStationary: false, withinHalfRange: false },
  };
}

const manual = { kind: "manual" as const, label: "test" };

describe("mortal wounds on an attack's rolls", () => {
  const baseline = crunch(boltRifle([]), ds);

  it("adds one damage for each wound roll that scores, before Feel No Pain", () => {
    const out = crunch(boltRifle([{ source: manual, contribution: { type: "mortal-wounds-on-roll", roll: "wound", outcome: "success", count: 1 } }]), ds);
    expect(stage(out, "damage") - stage(baseline, "damage")).toBeCloseTo(stage(baseline, "wounds"), 10);
    expect(stage(out, "wounds")).toBeCloseTo(stage(baseline, "wounds"), 10);
  });

  it("counts only critical rolls for a critical outcome, and stacks sources", () => {
    const hits = stage(baseline, "hits");
    const one = { source: manual, contribution: { type: "mortal-wounds-on-roll" as const, roll: "hit" as const, outcome: "critical" as const, count: 2 } };
    const out = crunch(boltRifle([one, one]), ds);
    // Critical hits are 1/6 of attacks; hits are 4/6 of attacks at BS 3+ with no re-roll.
    expect(stage(out, "damage") - stage(baseline, "damage")).toBeCloseTo(2 * 2 * hits / 4, 10);
  });

  it("is reduced by a Feel No Pain against mortal wounds alone", () => {
    const mortal = { source: manual, contribution: { type: "mortal-wounds-on-roll" as const, roll: "wound" as const, outcome: "success" as const, count: 1 } };
    const fnp = { source: manual, contribution: { type: "feel-no-pain" as const, threshold: 5, scope: "mortal" as const } };
    const withFnp = crunch(boltRifle([mortal, fnp]), ds);
    expect(stage(withFnp, "after-fnp") - stage(baseline, "after-fnp")).toBeCloseTo(stage(baseline, "wounds") * (4 / 6), 10);
  });
});

describe("translating mortal wounds on an attack roll", () => {
  const part = (filter: Record<string, unknown>, target = "defender") => ({
    type: "ability-part",
    trigger: { event: "after-roll", filter },
    effect: { type: "mortal-wounds", target, modifier: { count: "D3" } },
  });
  const translate = (effect: unknown) => effectToBuffs(effect, manual, { phase: "fight" }, "attacker");

  it("emits the expected count per scoring wound roll", () => {
    const out = translate(part({ roll: "wound", result: "success" }));
    expect(out.unsupported).toEqual([]);
    expect(out.applied.map((buff) => buff.contribution)).toEqual([{ type: "mortal-wounds-on-roll", roll: "wound", outcome: "success", count: 2 }]);
  });

  it("refuses a roll with no stated outcome rather than counting failed rolls", () => {
    const out = translate(part({ roll: "wound" }));
    expect(out.applied).toEqual([]);
    expect(out.unsupported[0]?.reason).toMatch(/outcome is not stated/);
  });

  it("refuses mortal wounds an attack roll inflicts on another unit", () => {
    expect(translate(part({ roll: "hit", result: "critical" }, "this-unit")).applied).toEqual([]);
  });
});

describe("mortal wound sources outside an attack", () => {
  // The phase never gates a source; every context names one only because the type requires it.
  const sourcesOf = (id: string, effect: unknown, trigger: unknown, context: Partial<EngineContext>) =>
    mortalWoundSources(id, effect, trigger, { phase: "shooting", ...context });
  const charge = { event: "move-ended", filter: { move_types: ["charge"] } };
  const selectEnemy = (effect: unknown, eligibility?: unknown) => ({
    type: "select-units",
    selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 }, ...(eligibility ? { eligibility } : {}) },
    effect,
  });
  const mw = (modifier: Record<string, unknown>, target = "selected-unit") => ({ type: "mortal-wounds", target, modifier });

  it("weights a dice-gated count by its chance and names the moment", () => {
    const effect = selectEnemy({ type: "dice-gated", dice: "D6", threshold: 4, comparison: "gte", on_success: mw({ count: "D3" }), on_fail: null });
    const out = sourcesOf("x", effect, charge, { phase: "shooting" });
    expect(out.sources).toEqual([{ id: "x", moment: "move-ended:charge", expected: 1, needs: [] }]);
  });

  it("caps per-success dice at their maximum exactly", () => {
    const out = sourcesOf("x", selectEnemy(mw({ count: 1, per: "success", max: 2, roll: { dice: 6, threshold: 4 } })), charge, {});
    // E[min(Binomial(6, 1/2), 2)] = 2 - 2·P(0) - P(1) = 2 - 2/64 - 6/64.
    expect(out.sources[0]!.expected).toBeCloseTo(2 - 8 / 64, 12);
  });

  it("rolls per-model dice for every model of the unit, and refuses without a model count", () => {
    const effect = selectEnemy(mw({ count: 1, per: "success", roll: { dice: 1, threshold: 4, per_model: "this-unit" } }));
    expect(sourcesOf("x", effect, charge, { attackerModelCount: 5 }).sources[0]!.expected).toBeCloseTo(2.5, 12);
    const unknown = sourcesOf("x", effect, charge, {});
    expect(unknown.sources).toEqual([]);
    expect(unknown.unsupported[0]?.reason).toMatch(/number of models/);
  });

  it("sums a dice table's outcomes and keeps choice options apart", () => {
    const table = { type: "dice-table", dice: "D6", outcomes: [{ results: [1, 2], effect: { type: "no-effect" } }, { results: [3, 4, 5], effect: mw({ count: 1 }) }, { results: [6], effect: mw({ count: 3 }) }] };
    const out = sourcesOf("x", { type: "choice", options: [selectEnemy(table), selectEnemy(mw({ count: 2 }))] }, null, {});
    expect(out.sources.map((source) => [source.id, source.moment, source.expected])).toEqual([["x?0", null, 1], ["x?1", null, 2]]);
  });

  it("skips mortal wounds the ability's own unit suffers", () => {
    expect(sourcesOf("x", mw({ count: "D3" }, "this-unit"), charge, {})).toEqual({ sources: [], unsupported: [] });
  });

  it("never lets the attack's phase gate a source", () => {
    const effect = { type: "conditional", condition: { type: "phase-is", parameters: { phase: "movement" } }, effect: selectEnemy(mw({ count: 1 })) };
    expect(sourcesOf("x", effect, charge, { phase: "shooting" }).sources[0]!.expected).toBe(1);
  });

  it("reports an undecided eligibility as a need, and drops the source when it is answered false", () => {
    const engaged = { type: "matches", parameters: { subject: "selected-unit", filter: { engaged_with: "this-unit" } } };
    const effect = selectEnemy(mw({ count: 1 }), engaged);
    const open = sourcesOf("x", effect, charge, {});
    expect(open.sources[0]!.needs.map((need) => need.key)).toEqual([conditionFactKey(engaged, "attacker")]);
    expect(sourcesOf("x", effect, charge, { conditionFacts: { [open.sources[0]!.needs[0]!.key]: false } }).sources).toEqual([]);
    expect(sourcesOf("x", effect, charge, { conditionFacts: { [open.sources[0]!.needs[0]!.key]: true } }).sources[0]!.needs).toEqual([]);
  });
});

describe("Dataset.mortalWoundSourcesFor", () => {
  it("returns a unit's charge mortal wounds whatever phase the context names", () => {
    const ability = ds.abilities.all.find((entry) => entry.id === "crimson-harvest-necrons")!;
    const unit = ds.units.all.find((entry) => entry.raw.ability_ids?.some((ref) => (typeof ref === "string" ? ref : ref.id) === ability.id))!;
    expect(unit).toBeDefined();
    const { sources } = ds.mortalWoundSourcesFor({ unitId: unit.id, factionId: unit.raw.faction_id }, { phase: "shooting" });
    const source = sources.find((entry) => entry.abilityId === ability.id);
    expect(source?.moment).toBe("move-ended:charge");
    expect(source?.label).toBe(ability.name);
    expect(source!.expected).toBeGreaterThan(0);
  });
});
