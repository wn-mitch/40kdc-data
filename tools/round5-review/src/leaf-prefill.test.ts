import { describe, expect, it } from "vitest";

import { currentFamilyVersion, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../../src/round5c/contracts";
import { prefillFromSource } from "./leaf-prefill";
import type { Family } from "./LeafForm";
import { splitPieces, suggestedCuts } from "./SplitEditor";

// Fabricated wording only.
const family = (id: string) => REVIEWED_FAMILY_REGISTRY.find((item) => item.id === id && item.version === currentFamilyVersion(id)) as unknown as Family;

describe("Leaf prefill", () => {
  it("fills in only what the wording states, and the result is a valid leaf once complete", () => {
    expect(prefillFromSource(family("attack"), "Each time this model makes a melee attack")).toEqual({ direction: "makes", attack_type: "melee", unit: "this-model" });
    expect(prefillFromSource(family("attack"), "Each time a ranged attack targets this unit")).toEqual({ direction: "targeted", attack_type: "ranged", unit: "this-unit" });
    expect(prefillFromSource(family("attack"), "Each time a model in that unit makes an attack")).toEqual({ direction: "makes", attack_type: "any", unit: "that-unit" });
    const keyword = prefillFromSource(family("unit-keyword"), "that targets a **MONSTER** or **VEHICLE** unit");
    expect(keyword).toEqual({ subject: "target", keywords: ["MONSTER", "VEHICLE"] });
    expect(normalizeFingerprintParameters("unit-keyword", { ...keyword, negated: false }, 1)).toMatchObject({ keywords: ["MONSTER", "VEHICLE"] });
    expect(prefillFromSource(family("unit-keyword"), "that targets a unit that cannot fly")).toEqual({ subject: "target", negated: true, keywords: ["FLY"] });
    expect(prefillFromSource(family("unit-state"), "that targets a unit that is not below half-strength")).toEqual({ subject: "target", negated: true, states: ["below-half-strength"] });
    expect(prefillFromSource(family("unit-position"), "that targets a unit more than 12\" away")).toEqual({ subject: "target", kind: "beyond", inches: 12 });
    expect(prefillFromSource(family("select-unit"), "select one visible enemy unit within 18\"")).toEqual({ scope: "enemy", distance: "within", inches: 18, visible: true });
    // Nothing stated, nothing chosen.
    expect(prefillFromSource(family("unit-state"), "if so")).toEqual({});
  });
});

describe("Splitting composed wording", () => {
  const words = (text: string) => text.split(/\s+/u);
  it("suggests cuts at conditions, targets, instead and joining words", () => {
    const text = "each time this model makes an attack that targets a hero, add one to hits if the foe is thinned, and add one to wounds as well if the foe is halved";
    expect(splitPieces(words(text), suggestedCuts(words(text)))).toEqual([
      "each time this model makes an attack", "that targets a hero", "add one to hits", "if the foe is thinned", "add one to wounds", "if the foe is halved",
    ]);
    const instead = "re-roll the hit instead";
    expect(splitPieces(words(instead), suggestedCuts(words(instead)))).toEqual(["re-roll the hit", "instead"]);
  });

  it("follows the reviewer's cuts and drops pieces that are only joining words", () => {
    const text = "that targets a hero, add one to hits";
    expect(splitPieces(words(text), new Set([4]))).toEqual(["that targets a hero", "add one to hits"]);
    expect(splitPieces(words("a and b"), new Set([1, 2]))).toEqual(["a", "b"]);
  });
});
