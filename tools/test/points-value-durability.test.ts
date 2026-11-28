import { describe, expect, it } from "vitest";

import { Dataset } from "../src/data/index.js";
import { durabilityOf } from "../src/points-value/features.js";

describe("points-value durability", () => {
  const ds = Dataset.embedded();

  it("leaves out the rules of wargear the unit does not carry out of the box", () => {
    // Pathfinders (W1, T3, Sv4+) carry no Shield Drone by default, so its +1 Wounds does not apply.
    // Plasma (S7 AP-2 D2, hitting on 3+): hits 2/3, wounds on 2+ (5/6), saves on 6+ (unsaved 5/6),
    // and each unsaved attack deals 1 to a 1-wound model, so ten wounds take 10 / (2/3·5/6·5/6).
    const pathfinders = ds.units.getAny("pathfinder-team")!.raw;
    expect(durabilityOf(ds, pathfinders, 10, false).plasma).toBeCloseTo(10 / ((2 / 3) * (5 / 6) * (5 / 6)), 6);
  });

  it("keeps a bearer's own wargear rule off the squad when not every model carries it", () => {
    // One Breacher in ten carries the endurant shield, whose 4+ invulnerable save is its own, so
    // the squad (W1, T3, Sv4+) saves plasma on 6+ as the Pathfinders do, not on 4+.
    const breachers = ds.units.getAny("imperial-navy-breachers")!.raw;
    expect(durabilityOf(ds, breachers, 10, false).plasma).toBeCloseTo(10 / ((2 / 3) * (5 / 6) * (5 / 6)), 6);
  });
});
