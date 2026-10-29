import { describe, expect, it } from "vitest";

import { allocate, allocateModel, type DamageZeroing } from "../src/cruncher/allocation.js";
import { crunch, type Buff, type EngineInput } from "../src/cruncher/index.js";
import { Dataset } from "../src/data/dataset.js";
import { quantityDistribution } from "../src/cruncher/damage-roll.js";
import type { AttackModel } from "../src/cruncher/engine.js";

/** An attack model that always hits, wounds and goes unsaved unless overridden. */
function model(overrides: Partial<AttackModel>): AttackModel {
  return {
    modelsFiring: 1, attacksStat: 1, attacksBonus: 0, rapidFireStat: null, torrent: false,
    hit: { pass: 1, crit: 0 }, sustainedStat: null, lethal: false, wound: { pass: 1, crit: 0 },
    devastating: false, unsaved: 1, damage: [{ value: 1, probability: 1 }], woundLost: 1, mortalWoundLost: 1,
    wounds: 1, modelCount: 1, ...overrides,
  };
}

/** Seeded PRNG (mulberry32) so the cross-check is deterministic. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function draw(random: () => number, distribution: Array<[number, number]>): number {
  let roll = random();
  for (const [value, p] of distribution) {
    if ((roll -= p) < 0) return value;
  }
  return distribution[distribution.length - 1]![0];
}

/**
 * An independent simulation of the same attack sequence: every attack rolls in turn, normal damage
 * allocates as it lands, and Devastating Wounds mortal wounds wait until all normal damage is done.
 */
function simulate(attack: AttackModel, trials: number, seed: number, zeroing?: DamageZeroing): { damageDealt: number; modelsDestroyed: number } {
  const random = rng(seed);
  const damage: Array<[number, number]> = attack.damage.map(({ value, probability }) => [value, probability]);
  const criticalDamage: Array<[number, number]> = (attack.criticalWound?.damage ?? attack.damage).map(({ value, probability }) => [value, probability]);
  const rapid = attack.rapidFireStat == null ? [[0, 1] as [number, number]] : quantityDistribution(attack.rapidFireStat);
  const sustained = attack.sustainedStat == null ? [[0, 1] as [number, number]] : quantityDistribution(attack.sustainedStat);
  let dealt = 0;
  let destroyed = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    let alive = attack.modelCount;
    let left = attack.wounds;
    let removed = 0;
    let unused = zeroing?.uses ?? 0;
    const land = (lost: number, zeroable: boolean, roll = damage) => {
      if (alive === 0) return;
      if (zeroable && unused > 0) { unused -= 1; return; }
      let wounds = 0;
      for (let point = draw(random, roll); point > 0; point -= 1) if (random() < lost) wounds += 1;
      const taken = Math.min(wounds, left);
      removed += taken;
      left -= taken;
      if (left === 0) { alive -= 1; left = attack.wounds; if (zeroing?.per === "model") unused = zeroing.uses; }
    };
    let mortal = 0;
    const woundRoll = () => {
      const roll = random();
      const normal = attack.wound.pass - attack.wound.crit;
      if (roll < attack.wound.crit) {
        if (attack.devastating) mortal += 1;
        else if (random() < (attack.criticalWound?.unsaved ?? attack.unsaved)) land(attack.woundLost, true, criticalDamage);
      } else if (roll < attack.wound.crit + normal && random() < attack.unsaved) {
        land(attack.woundLost, true);
      }
    };
    for (let shooter = 0; shooter < attack.modelsFiring; shooter += 1) {
      const attacks = Math.max(0, draw(random, quantityDistribution(attack.attacksStat)) + draw(random, rapid) + attack.attacksBonus);
      for (let index = 0; index < attacks; index += 1) {
        const roll = random();
        const critHit = !attack.torrent && roll < attack.hit.crit;
        const normalHit = attack.torrent || (!critHit && roll < attack.hit.pass);
        if (normalHit) woundRoll();
        if (critHit) {
          if (attack.lethal) { if (random() < attack.unsaved) land(attack.woundLost, true); } else woundRoll();
          for (let extra = draw(random, sustained); extra > 0; extra -= 1) woundRoll();
        }
      }
    }
    for (; mortal > 0; mortal -= 1) land(attack.mortalWoundLost, false, criticalDamage);
    dealt += removed;
    destroyed += attack.modelCount - alive;
  }
  return { damageDealt: dealt / trials, modelsDestroyed: destroyed / trials };
}

describe("allocateModel", () => {
  it("loses damage beyond the damaged model and carries a wound over to the next attack", () => {
    // Two D2 attacks into one 3-wound model: 2, then 1 more kills it and 1 is lost.
    const out = allocateModel(model({ attacksStat: 2, damage: [{ value: 2, probability: 1 }], wounds: 3, modelCount: 2 }));
    expect(out.damageDealt).toBeCloseTo(3, 12);
    expect(out.modelsDestroyed).toBeCloseTo(1, 12);
    expect(out.modelsDestroyedDistribution).toEqual([0, 1, 0]);
  });

  it("caps at the unit and matches the expected value when nothing is lost", () => {
    const open = model({ attacksStat: "2D6", hit: { pass: 2 / 3, crit: 1 / 6 }, wound: { pass: 1 / 2, crit: 1 / 6 }, unsaved: 2 / 3, damage: [{ value: 1, probability: 1 }], wounds: 1, modelCount: 40 });
    // E[attacks] * P(hit) * P(wound) * P(unsaved), with no model ever close to running out.
    expect(allocateModel(open).damageDealt).toBeCloseTo(7 * (2 / 3) * (1 / 2) * (2 / 3), 9);
    const capped = allocateModel({ ...open, modelCount: 1 });
    expect(capped.damageDealt).toBeLessThanOrEqual(1);
    expect(capped.modelsDestroyedDistribution.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 12);
  });

  it("inflicts Devastating Wounds after normal damage with their own Feel No Pain", () => {
    // A normal wound always lands before a mortal one, so a 1-model unit dies to the normal wound
    // and the mortal wound is lost; mortal-only Feel No Pain cannot change that.
    const ordered = model({ attacksStat: 2, wound: { pass: 1, crit: 0.5 }, devastating: true, mortalWoundLost: 0.5, wounds: 1, modelCount: 1 });
    const out = allocateModel(ordered);
    // Only both attacks critting leaves the model to two mortal wounds: 1 - 0.25 * (0.5 * 0.5).
    expect(out.modelsDestroyed).toBeCloseTo(1 - 0.25 * 0.25, 12);
  });

  const crossChecks: Array<[string, Partial<AttackModel>]> = [
    ["multi-damage overkill across a squad", { modelsFiring: 3, attacksStat: "D3", hit: { pass: 2 / 3, crit: 1 / 6 }, wound: { pass: 2 / 3, crit: 1 / 6 }, unsaved: 1 / 2, damage: quantityDistribution("D3").map(([value, probability]) => ({ value, probability })), wounds: 2, modelCount: 5 }],
    ["sustained and lethal hits with Feel No Pain", { modelsFiring: 4, attacksStat: 2, hit: { pass: 1 / 2, crit: 1 / 6 }, sustainedStat: "D3", lethal: true, wound: { pass: 1 / 3, crit: 1 / 6 }, unsaved: 2 / 3, damage: [{ value: 2, probability: 1 }], woundLost: 2 / 3, mortalWoundLost: 2 / 3, wounds: 3, modelCount: 4 }],
    ["devastating wounds with mortal-only Feel No Pain", { modelsFiring: 2, attacksStat: 3, rapidFireStat: 1, hit: { pass: 2 / 3, crit: 1 / 6 }, wound: { pass: 1 / 2, crit: 1 / 6 }, devastating: true, unsaved: 1 / 3, damage: [{ value: 1, probability: 1 / 2 }, { value: 3, probability: 1 / 2 }], woundLost: 1, mortalWoundLost: 1 / 2, wounds: 2, modelCount: 6 }],
    ["torrent into a single big model", { modelsFiring: 2, attacksStat: "D6", attacksBonus: 1, torrent: true, wound: { pass: 1 / 3, crit: 1 / 6 }, unsaved: 1 / 2, damage: [{ value: 3, probability: 1 }], wounds: 12, modelCount: 1 }],
  ];

  it("zeroes the first attacks a unit-wide defence can take, then allocates the rest", () => {
    // Three D3 attacks into one 3-wound model with one use: only the last two roll Damage.
    const d3 = quantityDistribution("D3").map(([value, probability]) => ({ value, probability }));
    const attack = model({ attacksStat: 3, damage: d3, wounds: 3, modelCount: 1 });
    const zeroed = allocateModel(attack, { zeroing: { uses: 1, per: "unit" } });
    expect(zeroed).toEqual(allocateModel({ ...attack, attacksStat: 2 }));
    // Two D3 rolls fall short of 3 only as 1 and 1.
    expect(zeroed.modelsDestroyed).toBeCloseTo(8 / 9, 12);
    expect(allocateModel(attack, { zeroing: { uses: 3, per: "unit" } }).damageDealt).toBe(0);
  });

  it("refills a per-model defence for each fresh model but never zeroes mortal wounds", () => {
    // Two D2 attacks per model's worth: 4 attacks into two 2-wound models, each model zeroing one.
    const attack = model({ attacksStat: 4, damage: [{ value: 2, probability: 1 }], wounds: 2, modelCount: 2 });
    const perModel = allocateModel(attack, { zeroing: { uses: 1, per: "model" } });
    expect(perModel.modelsDestroyedDistribution).toEqual([0, 0, 1]);
    const perUnit = allocateModel(attack, { zeroing: { uses: 1, per: "unit" } });
    expect(perUnit.modelsDestroyedDistribution).toEqual([0, 0, 1]);
    const tight = allocateModel({ ...attack, attacksStat: 3 }, { zeroing: { uses: 1, per: "model" } });
    expect(tight.modelsDestroyedDistribution).toEqual([0, 1, 0]);
    expect(allocateModel({ ...attack, attacksStat: 3 }, { zeroing: { uses: 1, per: "unit" } }).modelsDestroyedDistribution).toEqual([0, 0, 1]);
    // Every attack critically wounds a Devastating weapon: mortal wounds ignore the defence.
    const mortal = model({ attacksStat: 2, wound: { pass: 1, crit: 1 }, devastating: true, wounds: 1, modelCount: 2 });
    expect(allocateModel(mortal, { zeroing: { uses: 2, per: "unit" } }).modelsDestroyed).toBe(2);
  });

  it("rejects malformed zeroing and event tables past the exact bound", () => {
    expect(() => allocateModel(model({}), { zeroing: { uses: 1.5, per: "unit" } })).toThrow(/zeroing uses/);
    expect(() => allocateModel(model({}), { zeroing: { uses: 1, per: "army" as "unit" } })).toThrow(/zeroing per/);
    const huge = model({ modelsFiring: 20, attacksStat: 4, hit: { pass: 2 / 3, crit: 1 / 6 }, sustainedStat: 2, wound: { pass: 1 / 2, crit: 1 / 6 }, devastating: true, wounds: 3, modelCount: 20 });
    expect(() => allocateModel(huge)).toThrow(/exact allocation bound/);
    // Without Devastating Wounds the mortal column is empty and the same attacks stay in bounds.
    expect(allocateModel({ ...huge, devastating: false }).modelsDestroyedDistribution).toHaveLength(21);
  });

  it("allocates critical wounds with their own save and Damage only where they differ", () => {
    const base = model({ modelsFiring: 3, attacksStat: 2, hit: { pass: 2 / 3, crit: 1 / 6 }, sustainedStat: 1, wound: { pass: 1 / 2, crit: 1 / 6 }, unsaved: 1 / 2, damage: [{ value: 1, probability: 1 }], wounds: 2, modelCount: 5 });
    const same = allocateModel({ ...base, criticalWound: { unsaved: base.unsaved, damage: base.damage } });
    const plain = allocateModel(base);
    expect(same.damageDealt).toBeCloseTo(plain.damageDealt, 12);
    same.modelsDestroyedDistribution.forEach((p, index) => expect(p).toBeCloseTo(plain.modelsDestroyedDistribution[index]!, 12));
    // With Devastating Wounds, only the mortal wounds' Damage changes.
    const devastating = { ...base, devastating: true };
    expect(allocateModel({ ...devastating, criticalWound: { unsaved: 0, damage: [{ value: 2, probability: 1 }] } }).damageDealt)
      .toBeGreaterThan(allocateModel(devastating).damageDealt);
  });

  const criticalChecks: Array<[string, Partial<AttackModel>]> = [
    ["critical-wound AP", { modelsFiring: 4, attacksStat: 2, hit: { pass: 2 / 3, crit: 1 / 6 }, sustainedStat: 1, wound: { pass: 1 / 2, crit: 1 / 6 }, unsaved: 1 / 3, criticalWound: { unsaved: 2 / 3, damage: [{ value: 1, probability: 1 }] }, wounds: 2, modelCount: 5 }],
    ["critical-wound Damage", { modelsFiring: 3, attacksStat: 3, hit: { pass: 2 / 3, crit: 1 / 6 }, wound: { pass: 2 / 3, crit: 1 / 6 }, unsaved: 1 / 2, criticalWound: { unsaved: 1 / 2, damage: [{ value: 3, probability: 1 }] }, woundLost: 5 / 6, wounds: 3, modelCount: 3 }],
    ["critical-wound Damage as mortal wounds", { modelsFiring: 3, attacksStat: 3, hit: { pass: 2 / 3, crit: 1 / 6 }, wound: { pass: 1 / 2, crit: 1 / 6 }, devastating: true, unsaved: 1 / 2, criticalWound: { unsaved: 0, damage: quantityDistribution("D3").map(([value, probability]) => ({ value, probability })) }, wounds: 2, modelCount: 4 }],
  ];
  for (const [name, overrides] of criticalChecks) {
    it(`agrees with a seeded simulation: ${name}`, () => {
      const attack = model(overrides);
      const exact = allocateModel(attack, { zeroing: { uses: 1, per: "unit" } });
      const trials = 40_000;
      const simulated = simulate(attack, trials, 0xc417, { uses: 1, per: "unit" });
      expect(Math.abs(simulated.damageDealt - exact.damageDealt)).toBeLessThan((attack.modelCount * attack.wounds) * 4 / Math.sqrt(trials));
      expect(Math.abs(simulated.modelsDestroyed - exact.modelsDestroyed)).toBeLessThan(attack.modelCount * 4 / Math.sqrt(trials));
      // The critical branch matters: allocating every wound at the normal values disagrees.
      const flattened = allocateModel({ ...attack, criticalWound: undefined }, { zeroing: { uses: 1, per: "unit" } });
      expect(Math.abs(flattened.damageDealt - exact.damageDealt)).toBeGreaterThan(0.05);
    });
  }

  const zeroings: Array<DamageZeroing | undefined> = [undefined, { uses: 1, per: "model" }, { uses: 2, per: "unit" }];
  for (const [name, overrides] of crossChecks) for (const zeroing of zeroings) {
    it(`agrees with a seeded simulation: ${name}${zeroing ? ` (zeroing ${zeroing.uses} per ${zeroing.per})` : ""}`, () => {
      const attack = model(overrides);
      const exact = allocateModel(attack, zeroing ? { zeroing } : {});
      const trials = 40_000;
      const simulated = simulate(attack, trials, 0x5eed, zeroing);
      // Each trial's damage is bounded by the unit's wounds, so 4 bounded standard errors is a safe band.
      const band = (attack.modelCount * attack.wounds) * 4 / Math.sqrt(trials);
      expect(Math.abs(simulated.damageDealt - exact.damageDealt)).toBeLessThan(band);
      expect(Math.abs(simulated.modelsDestroyed - exact.modelsDestroyed)).toBeLessThan(attack.modelCount * 4 / Math.sqrt(trials));
    });
  }
});

describe("allocate", () => {
  const ds = Dataset.embedded();
  const input = (buffs: Buff[]): EngineInput => ({
    attacker: { weapon: ds.weapons.getAny("multi-melta")!.raw, profileIndex: 0 },
    target: { unit: ds.units.getAny("questoris-knight-magaera")!.raw, profileIndex: 0 },
    modelsFiring: 2,
    buffs,
    context: { phase: "shooting", attackerStationary: true, withinHalfRange: true },
  });
  const source = { kind: "ability", abilityId: "fabricated-plating", abilityKind: "unit" } as const;
  const zeroing = (uses: number, per: "unit" | "model"): Buff => ({ source, contribution: { type: "damage-zeroing", uses, per } });

  it("takes damage zeroing from the defender's buffs, leaving the expected-value stages alone", () => {
    const plain = input([]);
    const plated = input([zeroing(1, "unit")]);
    expect(allocate(plated, ds)).toEqual(allocate(plain, ds, { zeroing: { uses: 1, per: "unit" } }));
    expect(allocate(plated, ds).damageDealt).toBeLessThan(allocate(plain, ds).damageDealt);
    expect(crunch(plated, ds).stages).toEqual(crunch(plain, ds).stages);
    // Uses from separate sources add up; an explicit defence replaces them.
    expect(allocate(input([zeroing(1, "unit"), zeroing(1, "unit")]), ds)).toEqual(allocate(plain, ds, { zeroing: { uses: 2, per: "unit" } }));
    expect(allocate(plated, ds, { zeroing: { uses: 0, per: "unit" } })).toEqual(allocate(plain, ds));
    expect(() => allocate(input([zeroing(1, "unit"), zeroing(1, "model")]), ds)).toThrow(/together are not modelled/);
  });
});
