import { describe, expect, it } from "vitest";

import { allocateModel } from "../src/cruncher/allocation.js";
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
function simulate(attack: AttackModel, trials: number, seed: number): { damageDealt: number; modelsDestroyed: number } {
  const random = rng(seed);
  const damage: Array<[number, number]> = attack.damage.map(({ value, probability }) => [value, probability]);
  const rapid = attack.rapidFireStat == null ? [[0, 1] as [number, number]] : quantityDistribution(attack.rapidFireStat);
  const sustained = attack.sustainedStat == null ? [[0, 1] as [number, number]] : quantityDistribution(attack.sustainedStat);
  let dealt = 0;
  let destroyed = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    let alive = attack.modelCount;
    let left = attack.wounds;
    let removed = 0;
    const land = (lost: number) => {
      if (alive === 0) return;
      let wounds = 0;
      for (let point = draw(random, damage); point > 0; point -= 1) if (random() < lost) wounds += 1;
      const taken = Math.min(wounds, left);
      removed += taken;
      left -= taken;
      if (left === 0) { alive -= 1; left = attack.wounds; }
    };
    let mortal = 0;
    const woundRoll = () => {
      const roll = random();
      const normal = attack.wound.pass - attack.wound.crit;
      if (roll < attack.wound.crit) {
        if (attack.devastating) mortal += 1;
        else if (random() < attack.unsaved) land(attack.woundLost);
      } else if (roll < attack.wound.crit + normal && random() < attack.unsaved) {
        land(attack.woundLost);
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
          if (attack.lethal) { if (random() < attack.unsaved) land(attack.woundLost); } else woundRoll();
          for (let extra = draw(random, sustained); extra > 0; extra -= 1) woundRoll();
        }
      }
    }
    for (; mortal > 0; mortal -= 1) land(attack.mortalWoundLost);
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

  for (const [name, overrides] of crossChecks) {
    it(`agrees with a seeded simulation: ${name}`, () => {
      const attack = model(overrides);
      const exact = allocateModel(attack);
      const trials = 40_000;
      const simulated = simulate(attack, trials, 0x5eed);
      // Each trial's damage is bounded by the unit's wounds, so 4 bounded standard errors is a safe band.
      const band = (attack.modelCount * attack.wounds) * 4 / Math.sqrt(trials);
      expect(Math.abs(simulated.damageDealt - exact.damageDealt)).toBeLessThan(band);
      expect(Math.abs(simulated.modelsDestroyed - exact.modelsDestroyed)).toBeLessThan(attack.modelCount * 4 / Math.sqrt(trials));
    });
  }
});
