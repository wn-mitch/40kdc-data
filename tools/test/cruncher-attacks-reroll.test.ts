import { describe, expect, it } from "vitest";

import { allocate, crunch, type EngineInput } from "../src/cruncher/index.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { Dataset } from "../src/data/dataset.js";

const ds = Dataset.embedded();
const manual = { kind: "manual" as const, label: "test" };

function attacks(out: ReturnType<typeof crunch>): number {
  return out.stages.find((stage) => stage.name === "attacks")!.expected;
}

// Pavane of Slaanesh, Witchfire: A D6, S9, AP-1, D D3, [DEVASTATING WOUNDS]. The Gargantuan
// Squiggoth (one model, W30) cannot die to one model's attacks, so allocation deals every wound.
function witchfire(buffs: EngineInput["buffs"], modelsFiring = 1): EngineInput {
  return {
    attacker: { weapon: ds.weapons.getAny("pavane-of-slaanesh")!.raw, profileIndex: 0 },
    target: { unit: ds.units.getAny("gargantuan-squiggoth")!.raw, profileIndex: 0, modelCount: 1 },
    modelsFiring,
    buffs,
    context: { phase: "shooting", attackerStationary: false, withinHalfRange: false },
  };
}

const reroll = (subset: "ones" | "all-failures") => ({ source: manual, contribution: { type: "reroll" as const, roll: "attacks" as const, subset } });

describe("re-rolling a random Attacks characteristic", () => {
  it("keeps a D6 of 4+ and re-rolls the rest: 4.25 attacks per model", () => {
    // Keep 4, 5, 6 (mean 5) half the time; re-roll to a fresh 3.5 otherwise.
    expect(attacks(crunch(witchfire([reroll("all-failures")], 3), ds))).toBeCloseTo(3 * 4.25, 12);
    expect(attacks(crunch(witchfire([], 3), ds))).toBeCloseTo(3 * 3.5, 12);
  });

  it("re-rolls only a 1 for the ones subset", () => {
    // A 1 becomes a fresh 3.5: 3.5 + (3.5 - 1) / 6.
    expect(attacks(crunch(witchfire([reroll("ones")]), ds))).toBeCloseTo(3.5 + 2.5 / 6, 12);
  });

  it("feeds the re-rolled count into allocation, not the printed D6", () => {
    const plain = allocate(witchfire([]), ds);
    const rerolled = allocate(witchfire([reroll("all-failures")]), ds);
    const damage = crunch(witchfire([reroll("all-failures")]), ds).stages.find((stage) => stage.name === "after-fnp")!.expected;
    expect(rerolled.damageDealt).toBeCloseTo(damage, 10);
    expect(rerolled.damageDealt / plain.damageDealt).toBeCloseTo(4.25 / 3.5, 10);
  });

  it("translates an Attacks re-roll leaf into the attacker's buff, and nothing for the target", () => {
    const leaf = { type: "re-roll", target: "this-unit", modifier: { roll: "attacks", result_scope: "any-result" } };
    const source = { kind: "ability" as const, abilityId: "fabricated-attacks-reroll", abilityKind: "unit" as const };
    const attacker = effectToBuffs(leaf, source, { phase: "shooting" });
    expect(attacker.applied.map((buff) => buff.contribution)).toEqual([{ type: "reroll", roll: "attacks", subset: "all-failures" }]);
    expect(attacker.unsupported).toEqual([]);
    const target = effectToBuffs(leaf, source, { phase: "shooting" }, "target");
    expect(target.applied).toEqual([]);
    expect(target.unsupported).toEqual([]);
  });
});
