import { describe, expect, it } from "vitest";

import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { abilityIdsOf, printedWargearIds, withRating } from "../src/data/ability-refs.js";
import { ratingValue } from "../src/mfm/mirror/units.js";
import { ratingFromTail } from "../src/mfm/mirror/identity.js";
import { describeAbility } from "../src/translate/effect.js";

// One _core record per rated rule reads the rating the unit prints ({rating: true}).
const fnp = { type: "feel-no-pain", target: "this-unit", modifier: { threshold: { rating: true } } };
const scouts = { type: "ability-grant", target: "this-unit", modifier: { ability: "scouts", value: { rating: true } } };
const demise = { type: "mortal-wounds", target: { owner: "enemy" }, modifier: { count: { rating: true } } };
const source = { kind: "ability", abilityId: "feel-no-pain", abilityKind: "unit" } as const;

describe("rated core rules", () => {
  it("substitutes the unit's rating everywhere {rating: true} stands, and nothing else", () => {
    expect(withRating(fnp, 5)).toEqual({ ...fnp, modifier: { threshold: 5 } });
    expect(withRating(demise, "D3")).toEqual({ ...demise, modifier: { count: "D3" } });
    expect(withRating(fnp, undefined)).toBe(fnp);
    const untouched = { type: "x", modifier: { rating: true, other: 1 } };
    expect(withRating(untouched, 4)).toBe(untouched);
  });

  it("describes the rating as X without a unit, and the printed value with one", () => {
    expect(describeAbility({ effect: fnp as never })).toContain("Feel No Pain X+ ability, X being its rating");
    expect(describeAbility({ effect: withRating(fnp, 5) as never })).toContain("Feel No Pain 5+ ability");
    expect(describeAbility({ effect: scouts as never })).toContain('Scouts X" ability, X being its rating');
    expect(describeAbility({ effect: demise as never })).toContain("equal to its rating");
    expect(describeAbility({ effect: withRating(demise, "D3") as never })).toContain("D3 mortal wounds");
  });

  it("gives the cruncher the unit's Feel No Pain threshold", () => {
    const rated = effectToBuffs(withRating(fnp, 5), source, { phase: "shooting" }, "target");
    expect(rated.applied.map((b) => b.contribution)).toEqual([{ type: "feel-no-pain", threshold: 5 }]);
    // Without a unit there is no threshold to apply: surfaced, not guessed.
    const bare = effectToBuffs(fnp, source, { phase: "shooting" }, "target");
    expect(bare.applied).toEqual([]);
    expect(bare.unsupported.map((u) => u.reason)).toContain("feel-no-pain: threshold not numeric");
  });

  it("stores ratings as the unit schema reads them", () => {
    expect(ratingValue("5+")).toBe(5);
    expect(ratingValue('9"')).toBe(9);
    expect(ratingValue("12")).toBe(12);
    expect(ratingValue("D6+2")).toBe("D6+2");
    expect(ratingFromTail("5-plus")).toBe(5);
    expect(ratingFromTail("d6-plus-2")).toBe("D6+2");
    expect(ratingFromTail("d6-3")).toBe("D6+3");
    expect(ratingFromTail("2d6")).toBe("2D6");
    expect(ratingFromTail("d6-3-szarekh-model-only")).toBeNull();
  });

  it("reads both forms of a unit's ability_ids entry", () => {
    const refs = ["a", { id: "feel-no-pain", value: 5 }, { id: "serpent-shield-aeldari", wargear: "serpent-shield" }, 7, null];
    expect(abilityIdsOf(refs)).toEqual(["a", "feel-no-pain", "serpent-shield-aeldari"]);
    expect(printedWargearIds(refs)).toEqual(["serpent-shield"]);
  });
});
