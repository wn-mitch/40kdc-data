import { describe, it, expect } from "vitest";

import { dataset } from "../src/data/index.js";
import {
  optionCap,
  maximalLoadout,
  weaponBounds,
  clampWeaponCount,
  validateLoadout,
} from "../src/data/loadout.js";
import type { WargearOption } from "../src/generated.js";

const GV = { edition: "10th", dataslate: "2025-q3" };
function opt(p: Partial<WargearOption>): WargearOption {
  return { id: "x", unit_id: "u", game_version: GV, ...p } as WargearOption;
}

describe("optionCap", () => {
  it("per_n_models floors model_count / n", () => {
    expect(optionCap(opt({ model_constraint: { per_n_models: 5 } }), 10)).toBe(2);
    expect(optionCap(opt({ model_constraint: { per_n_models: 5 } }), 9)).toBe(1);
  });
  it("any_number → every model", () => {
    expect(optionCap(opt({ model_constraint: { any_number: true } }), 7)).toBe(7);
  });
  it("max_count alone defaults to a 1-model cap", () => {
    expect(optionCap(opt({ model_constraint: { max_count: 1 } }), 10)).toBe(1);
  });
  it("max_count clamps a ratio", () => {
    expect(optionCap(opt({ model_constraint: { per_n_models: 5, max_count: 1 } }), 20)).toBe(1);
  });
});

describe("maximalLoadout — Khorne Berzerkers @ 10 (dogfood target)", () => {
  it("derives 7 bolt pistols, 3 plasma, 8 chainblades, 2 eviscerators, 1 icon", () => {
    const bz = dataset.units.get("khorne-berzerkers")!;
    const options = dataset.wargearOptionsOf(bz.raw);
    expect(options.length).toBe(4); // 3 swaps + 1 add-on
    const lo = maximalLoadout(bz.raw, 10, options);
    expect(Object.fromEntries(lo.counts)).toEqual({
      "bolt-pistol": 7,
      "chainblade": 8,
      "plasma-pistol": 3,
      "khornate-eviscerator": 2,
      "icon-of-khorne": 1,
    });
  });
});

describe("weaponBounds + clampWeaponCount + validateLoadout", () => {
  const bz = dataset.units.get("khorne-berzerkers")!;
  const options = dataset.wargearOptionsOf(bz.raw);

  it("caps a replacement weapon at its max and a base weapon at model_count", () => {
    const bounds = weaponBounds(bz.raw, 10, options);
    // plasma pistol: champion (1) + per-5 (2) = 3 max
    expect(bounds.get("plasma-pistol")).toEqual({ min: 0, max: 3 });
    // bolt pistol: base 10, up to 3 swapped away
    expect(bounds.get("bolt-pistol")).toEqual({ min: 7, max: 10 });
  });

  it("clamps an over-cap request down to the max", () => {
    const bounds = weaponBounds(bz.raw, 10, options);
    expect(clampWeaponCount(bounds, "plasma-pistol", 4)).toBe(3);
    expect(clampWeaponCount(bounds, "plasma-pistol", 2)).toBe(2);
  });

  it("flags an over-cap loadout", () => {
    const violations = validateLoadout(bz.raw, 10, options, new Map([["plasma-pistol", 4]]));
    expect(violations).toEqual([
      { id: "plasma-pistol", code: "exceeds-max", message: "plasma-pistol: 4 exceeds max 3" },
    ]);
  });

  it("accepts the maximal loadout as valid", () => {
    const lo = maximalLoadout(bz.raw, 10, options);
    expect(validateLoadout(bz.raw, 10, options, lo.counts)).toEqual([]);
  });
});

describe("wargearOptionsOf accessor", () => {
  it("returns options for a unit and empty for one without", () => {
    const bz = dataset.units.get("khorne-berzerkers")!;
    expect(dataset.wargearOptionsOf(bz.raw).length).toBeGreaterThan(0);
    expect(bz.wargearOptions.length).toBe(dataset.wargearOptionsOf(bz.raw).length);
  });
});
