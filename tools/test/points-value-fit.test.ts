import { describe, expect, it } from "vitest";

import { fitModel, predict, random } from "../src/points-value/fit.js";

describe("points-value fit", () => {
  it("recovers known prices, holds value features non-negative and shrugs off an outlier", () => {
    // points = 40 + 3·offense + 2·durability − 0·M, plus a "role" dummy worth 15; M is noise the fit
    // would like to price negative, so it must come back at exactly zero.
    const names = ["shoot-infantry", "dur-heavy", "M", "role:leader"];
    const next = random(7);
    const rows: number[][] = [];
    const points: number[] = [];
    for (let i = 0; i < 300; i++) {
      const offense = next() * 40;
      const durability = next() * 30;
      const leader = i % 3 === 0 ? 1 : 0;
      const move = 6 + next() * 6;
      rows.push([offense, durability, move, leader]);
      points.push(40 + 3 * offense + 2 * durability + 15 * leader - 1.5 * (move - 9) + (next() - 0.5) * 4);
    }
    rows.push([10, 10, 8, 0]);
    points.push(5000);
    const model = fitModel(names, rows, points, { ridge: 0.01, factionRidge: 0.01, huber: 10 });
    const [offense, durability, move, leader] = model.coefficients;
    expect(offense).toBeCloseTo(3, 0);
    expect(durability).toBeCloseTo(2, 0);
    expect(move).toBe(0);
    expect(leader).toBeGreaterThan(12);
    expect(leader).toBeLessThan(18);
    expect(predict(model, [20, 10, 9, 0])).toBeGreaterThan(110);
    expect(predict(model, [20, 10, 9, 0])).toBeLessThan(130);
  });
});
