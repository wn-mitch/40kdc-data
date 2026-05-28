import { describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { crunch, type EngineInput } from "../src/cruncher/index.js";

const ds = Dataset.embedded();

describe("Dataset.defensiveBuffsFor", () => {
  it("returns a list (possibly empty) without throwing for any unit", () => {
    const sample = ds.units.all.slice(0, 10);
    for (const u of sample) {
      expect(() => ds.defensiveBuffsFor({ unitId: u.id }, { phase: "shooting" })).not.toThrow();
    }
  });

  it("symmetric: same unit produces distinct buff stacks under each perspective", () => {
    // For a unit whose army rule is purely attacker-flavoured (Oath of Moment
    // — re-roll-hits + re-roll-wounds), the attacker walk yields reroll
    // buffs while the defensive walk drops them.
    const intercessor = ds.units.find("Intercessor Squad")!;
    const atk = ds.buffsFor(
      { unitId: intercessor.id, factionId: "adeptus-astartes" },
      { phase: "shooting" },
    );
    const def = ds.defensiveBuffsFor(
      { unitId: intercessor.id, factionId: "adeptus-astartes" },
      { phase: "shooting" },
    );
    const atkRerolls = atk.filter((b) => b.contribution.type === "reroll");
    const defRerolls = def.filter((b) => b.contribution.type === "reroll");
    expect(atkRerolls.length).toBeGreaterThan(0);
    expect(defRerolls.length).toBe(0);
  });

  it("weaponProfiles are ignored under target perspective", () => {
    // bolt-rifle's Heavy keyword would inject a hit-mod under attacker, but
    // defensiveBuffsFor's signature doesn't accept weaponProfiles — even if
    // a caller passes them inadvertently, the implementation omits them.
    const def = ds.defensiveBuffsFor(
      // The cast exercises the path: if a caller wedges weaponProfiles in,
      // the implementation should still ignore them under target perspective.
      {
        unitId: "intercessor-squad",
        factionId: "adeptus-astartes",
        ...({ weaponProfiles: [{ weaponId: "bolt-rifle", profileIndex: 0 }] } as object),
      },
      { phase: "shooting", attackerStationary: true },
    );
    const keywordBuffs = def.filter((b) => b.source.kind === "weapon-keyword");
    expect(keywordBuffs).toEqual([]);
  });
});

describe("end-to-end: defensive FNP buff plumbed through crunch", () => {
  it("FNP buff added manually to the engine input reduces damage", () => {
    const bolt = ds.weapons.get("bolt-rifle")!;
    const target = ds.units.find("Cultist Mob")!;
    const base: EngineInput = {
      attacker: { weapon: bolt.raw, profileIndex: 0 },
      target: { unit: target.raw, profileIndex: 0 },
      modelsFiring: 5,
      buffs: [],
      context: { phase: "shooting" },
    };
    const baseline = crunch(base);
    const withFnp = crunch({
      ...base,
      // Defensive buff stack the SPA would compose via defensiveBuffsFor.
      buffs: [
        {
          source: { kind: "ability", abilityId: "fnp-test", abilityKind: "unit" },
          contribution: { type: "feel-no-pain", threshold: 5 },
        },
      ],
    });
    const baseAfterFnp = baseline.stages.find((s) => s.name === "after-fnp")!.expected;
    const fnpAfterFnp = withFnp.stages.find((s) => s.name === "after-fnp")!.expected;
    // FNP 5+: 1/3 chance of success → 2/3 damage remains.
    expect(fnpAfterFnp / baseAfterFnp).toBeCloseTo(4 / 6, 4);
  });

  it("toughness-mod buff hardens the target (wound threshold shifts)", () => {
    const bolt = ds.weapons.get("bolt-rifle")!;
    const target = ds.units.find("Cultist Mob")!; // T3
    const base: EngineInput = {
      attacker: { weapon: bolt.raw, profileIndex: 0 },
      target: { unit: target.raw, profileIndex: 0 },
      modelsFiring: 5,
      buffs: [],
      context: { phase: "shooting" },
    };
    const baseline = crunch(base);
    const tougher = crunch({
      ...base,
      buffs: [
        {
          source: { kind: "ability", abilityId: "t-buff", abilityKind: "unit" },
          contribution: { type: "toughness-mod", value: 1 }, // T3 → T4
        },
      ],
    });
    const baseWounds = baseline.stages.find((s) => s.name === "wounds")!.expected;
    const toughWounds = tougher.stages.find((s) => s.name === "wounds")!.expected;
    // S4 vs T3 = 3+; S4 vs T4 = 4+. So P drops from 4/6 → 3/6 = ratio 3/4.
    expect(toughWounds / baseWounds).toBeCloseTo(3 / 4, 4);
  });
});
