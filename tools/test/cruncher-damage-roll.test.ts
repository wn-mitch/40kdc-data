import { describe, expect, it } from "vitest";

import { damageRoll } from "../src/cruncher/damage-roll.js";

const base = { bonus: 0, modifier: 0, reduction: 0 };

describe("damageRoll", () => {
  it("keeps the printed mean when nothing clamps", () => {
    expect(damageRoll({ ...base, stat: "D6+1" }).expected).toBeCloseTo(4.5, 12);
    expect(damageRoll({ ...base, stat: "2D3" }).expected).toBeCloseTo(4, 12);
    expect(damageRoll({ ...base, stat: 3 }).expected).toBe(3);
  });

  it("floors each roll at 0, not the mean", () => {
    // D3-2 rolls 0, 0, 1; the mean-then-floor shortcut gives 0.
    expect(damageRoll({ ...base, stat: "D3", modifier: -2 }).expected).toBeCloseTo(1 / 3, 12);
  });

  it("applies reduction to each roll with a minimum of 1", () => {
    expect(damageRoll({ ...base, stat: "D6", reduction: 3 }).expected).toBeCloseTo(1.5, 12);
    // A fixed 0 still rises to 1 under active reduction.
    expect(damageRoll({ ...base, stat: 1, modifier: -1, reduction: 1 }).expected).toBe(1);
  });

  it("rerolls only totals whose final damage is below the fresh mean", () => {
    const rolled = damageRoll({ ...base, stat: "D6", reroll: "all-failures" });
    expect(rolled.expected).toBeCloseTo(4.25, 12);
    expect(rolled.rerollUsed).toBe(true);
    expect(rolled.distribution.reduce((sum, { probability }) => sum + probability, 0)).toBeCloseTo(1, 12);
  });

  it("limits a ones reroll to a single die showing 1", () => {
    expect(damageRoll({ ...base, stat: "D6", reroll: "ones" }).expected).toBeCloseTo(3.5 + 2.5 / 6, 12);
    // A 2D6 total can never be 1.
    const pair = damageRoll({ ...base, stat: "2D6", reroll: "ones" });
    expect(pair.expected).toBeCloseTo(7, 12);
    expect(pair.rerollUsed).toBe(false);
  });

  it("never rerolls a fixed characteristic or a roll already at the clamp", () => {
    expect(damageRoll({ ...base, stat: 2, reroll: "all-failures" })).toMatchObject({ expected: 2, rerollUsed: false });
    // D3 under reduction 3 is always 1: rerolling cannot help.
    expect(damageRoll({ ...base, stat: "D3", reduction: 3, reroll: "all-failures" })).toMatchObject({ expected: 1, rerollUsed: false });
  });
});
