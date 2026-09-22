import { describe, expect, it } from "vitest";
import { defectClasses, factDiff, facts, jaccard, contentTokens } from "../src/round-trip-report.js";

const VOCAB = new Set(["orks", "walker", "titanic", "beast snagga", "lone operative", "beasts"]);

describe("round-trip comparator", () => {
  it("does not read the digit of a die expression as an integer", () => {
    const parsed = facts("roll one D6 and add 2", VOCAB);
    expect(parsed.dice).toEqual(["D6"]);
    expect(parsed.integers).toEqual([2]);
  });

  it("ignores numbered list markers, which are layout rather than quantity", () => {
    const source = "resolve the following sequence:\n1. Select up to X models.\n2. Roll one D6.";
    const parsed = facts(source, VOCAB, new Set([1, 2]));
    expect(parsed.integers).toEqual([]);
  });

  it("matches keywords on boundaries so a compound does not match its prefix", () => {
    // "beast" must not match inside "beastsnagga"; the earlier `includes`
    // matcher produced spurious keyword losses across the corpus.
    expect(facts("BEAST SNAGGA unit", VOCAB).keywords).toContain("beast snagga");
    expect(facts("BEAST SNAGGA unit", VOCAB).keywords).not.toContain("beasts");
  });

  it("reports a fact lost from source and a fact invented by the record", () => {
    const source = "roll one D6: on a 4+, that unit suffers D3 mortal wounds within 24\".";
    const rendered = "The target suffers d3 mortal wounds.";
    const diff = factDiff(source, rendered, VOCAB);
    expect(diff.missing_dice).toEqual(["D6"]);
    expect(diff.missing_integers).toEqual([4]);
    expect(diff.missing_distances).toEqual([24]);
    expect(diff.lost).toBeGreaterThan(0);
    expect(diff.invented).toBe(0);
  });

  it("flags a random table flattened into an unconditional effect", () => {
    const source = "roll one D6: on a 2-5, that unit suffers D3 mortal wounds; on a 6, it suffers D3+3.";
    const flattened = {
      ability_type: "unit",
      effect: { type: "mortal-wounds", target: "defender", modifier: { count: "d3" } },
    };
    expect(defectClasses(flattened, source, "The target suffers d3 mortal wounds."))
      .toContain("random-table-flattened");

    // The same rule authored with a stochastic node is correctly not flagged.
    const authored = {
      ability_type: "unit",
      effect: {
        type: "dice-gated",
        dice: "D6",
        on_success: { type: "mortal-wounds", target: "defender", modifier: { count: "d3" } },
      },
    };
    expect(defectClasses(authored, source, "Roll one D6."))
      .not.toContain("random-table-flattened");
  });

  it("flags an un-authored stub and a placeholder rendering", () => {
    const stub = { ability_type: "unit", effect: { type: "stat-modifier", target: "unit", modifier: {} } };
    expect(defectClasses(stub, "This unit has Lone Operative.", "Modify the unit's characteristics."))
      .toEqual(expect.arrayContaining(["empty-modifier-stub", "describer-placeholder"]));
  });

  it("flags a unit-level rule rendered as a weapon ability", () => {
    const record = {
      ability_type: "unit",
      effect: { type: "keyword-grant", target: "self", modifier: { keywords: ["Lone Operative"] } },
    };
    expect(defectClasses(record, "This unit has Lone Operative.", "this model's weapons gain [LONE OPERATIVE]"))
      .toContain("keyword-rendered-as-weapon-ability");
  });

  it("keeps lexical similarity symmetric and bounded", () => {
    expect(jaccard(contentTokens("roll one D6"), contentTokens("roll one D6"))).toBe(1);
    expect(jaccard(contentTokens("roll one D6"), contentTokens("nothing alike here"))).toBeLessThan(0.2);
  });
});
