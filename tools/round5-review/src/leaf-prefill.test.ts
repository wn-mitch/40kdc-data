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
    expect(prefillFromSource(family("characteristic-modifier"), "improve the Armour Penetration characteristic of melee weapons equipped by models in that unit by 1"))
      .toEqual({ characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "melee", subject: "this-unit" });
    expect(prefillFromSource(family("characteristic-modifier"), "add 1 to the Attacks and Strength characteristics of melee weapons equipped by this model"))
      .toEqual({ characteristics: ["A", "S"], operation: "add", value: 1, weapon_type: "melee", subject: "this-model" });
    expect(prefillFromSource(family("characteristic-modifier"), "worsen the Armour Penetration characteristic of that attack by 1"))
      .toEqual({ characteristics: ["AP"], operation: "worsen", value: 1, weapon_type: "all", subject: "attack" });
    expect(prefillFromSource(family("act-after-move"), "this unit is eligible to shoot and declare a charge in a turn in which it Fell Back"))
      .toEqual({ moves: ["fall-back"], acts: ["shoot", "charge"], subject: "this-unit" });
    expect(prefillFromSource(family("act-after-move"), "it can Advance and charge")).toEqual({ moves: ["advance"], acts: ["charge"] });
    const window = (text: string) => prefillFromSource(family("use-window"), text);
    expect(window("Your opponent’s Shooting phase or the Fight phase")).toEqual({ your_phases: [], opponent_phases: ["shooting"], either_phases: ["fight"] });
    expect(window("Your Movement or your Charge phase")).toEqual({ your_phases: ["movement", "charge"], opponent_phases: [], either_phases: [] });
    expect(window("Your Movement phase or Charge phase")).toEqual({ your_phases: ["movement", "charge"], opponent_phases: [], either_phases: [] });
    expect(window("Fight phase")).toEqual({ your_phases: [], opponent_phases: [], either_phases: ["fight"] });
    expect(window("Any phase").either_phases).toHaveLength(5);
    expect(prefillFromSource(family("usage-limit"), "Once per battle")).toEqual({ frequency: "once-per-battle", per: "any" });
    expect(prefillFromSource(family("bearer-eligibility"), "CANONESS, PALATINE or MINISTORUM PRIEST model only")).toEqual({ keywords: ["CANONESS", "PALATINE", "MINISTORUM PRIEST"], match: "any" });
    expect(prefillFromSource(family("bearer-eligibility"), "ADEPTA SORORITAS model only")).toEqual({ keywords: ["ADEPTA SORORITAS"], match: "all" });
    expect(prefillFromSource(family("optional-use"), "the bearer can use this Enhancement")).toEqual({ who: "bearer" });
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
    expect(splitPieces(words("add one to hits and, if so, add one"), suggestedCuts(words("add one to hits and, if so, add one")))).toEqual(["add one to hits", "if so", "add one"]);
  });
});
