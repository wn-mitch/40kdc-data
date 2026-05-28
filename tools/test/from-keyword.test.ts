import { describe, expect, it } from "vitest";
import { buffsFromKeyword } from "../src/cruncher/from-keyword.js";
import { Dataset } from "../src/data/dataset.js";

const ds = Dataset.embedded();
const ctx = {
  phase: "shooting" as const,
  attackerStationary: false,
  withinHalfRange: false,
};

describe("buffsFromKeyword: DSL-walked keywords", () => {
  it("twin-linked translates to a reroll-failed-wounds buff", () => {
    const twin = ds.weaponKeywords.get("twin-linked")!;
    const buffs = buffsFromKeyword({
      keywordId: "twin-linked",
      weaponId: "test-weapon",
      effect: twin.raw.effect,
      context: ctx,
    });
    expect(buffs).toHaveLength(1);
    expect(buffs[0].contribution).toEqual({
      type: "reroll",
      roll: "wound",
      subset: "all-failures",
    });
    expect(buffs[0].source).toEqual({
      kind: "weapon-keyword",
      weaponId: "test-weapon",
      keywordId: "twin-linked",
    });
  });

  it("heavy drops when attacker moved", () => {
    const heavy = ds.weaponKeywords.get("heavy")!;
    const buffs = buffsFromKeyword({
      keywordId: "heavy",
      weaponId: "test-weapon",
      effect: heavy.raw.effect,
      context: { ...ctx, attackerStationary: false },
    });
    expect(buffs).toEqual([]);
  });

  it("heavy fires +1 to hit when attacker stationary", () => {
    const heavy = ds.weaponKeywords.get("heavy")!;
    const buffs = buffsFromKeyword({
      keywordId: "heavy",
      weaponId: "test-weapon",
      effect: heavy.raw.effect,
      context: { ...ctx, attackerStationary: true },
    });
    expect(buffs).toHaveLength(1);
    expect(buffs[0].contribution).toEqual({ type: "hit-mod", value: 1 });
  });
});

describe("buffsFromKeyword: engine-dispatch keywords", () => {
  for (const id of [
    "lethal-hits",
    "sustained-hits",
    "devastating-wounds",
    "anti",
    "melta",
    "rapid-fire",
    "torrent",
    "ignores-cover",
  ]) {
    it(`${id} surfaces an extra-keyword buff with reference-site params`, () => {
      const entry = ds.weaponKeywords.get(id)!;
      const params =
        id === "sustained-hits" || id === "rapid-fire" || id === "melta"
          ? { value: 1 }
          : id === "anti"
            ? { target_keyword: "INFANTRY", threshold: 4 }
            : undefined;
      const buffs = buffsFromKeyword({
        keywordId: id,
        weaponId: "test-weapon",
        effect: entry.raw.effect, // typically null
        parameters: params,
        context: ctx,
      });
      expect(buffs).toHaveLength(1);
      const c = buffs[0].contribution;
      expect(c.type).toBe("extra-keyword");
      if (c.type === "extra-keyword") {
        expect(c.keywordRef.keyword_id).toBe(id);
        if (params) expect(c.keywordRef.parameters).toEqual(params);
        else expect(c.keywordRef.parameters).toBeUndefined();
      }
    });
  }
});

describe("buffsFromKeyword: unsupported / non-dispatch keywords drop silently", () => {
  it("a keyword whose effect is null and which isn't in the dispatch set yields no buffs", () => {
    // `pistol` ships with effect: null and isn't in the dispatch set today.
    const buffs = buffsFromKeyword({
      keywordId: "pistol",
      weaponId: "test-weapon",
      effect: null,
      context: ctx,
    });
    expect(buffs).toEqual([]);
  });

  it("an unrecognised DSL node drops silently", () => {
    const buffs = buffsFromKeyword({
      keywordId: "custom",
      weaponId: "test-weapon",
      effect: { type: "ward", target: "self", modifier: { threshold: 4 } },
      context: ctx,
    });
    expect(buffs).toEqual([]);
  });
});
