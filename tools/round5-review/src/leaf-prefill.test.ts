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
    expect(prefillFromSource(family("unit-position"), "that targets a unit more than 12\" away")).toEqual({ subject: "target", kind: "beyond", inches: 12, of: "this-unit" });
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
    expect(prefillFromSource(family("optional-use"), "the bearer can use this Enhancement")).toEqual({ who: "this-model" });
    expect(prefillFromSource(family("dice-roll"), "roll one D6")).toEqual({ dice: "D6" });
    expect(prefillFromSource(family("roll-result"), "on a 4+")).toEqual({ from: 4, to: 6 });
    expect(prefillFromSource(family("roll-result"), "on a 2-5")).toEqual({ from: 2, to: 5 });
    expect(prefillFromSource(family("roll-result"), "on a 6")).toEqual({ from: 6, to: 6 });
    expect(prefillFromSource(family("mortal-wounds"), "that unit suffers D3+3 mortal wounds")).toEqual({ count: "D3+3", recipient: "that-unit" });
    expect(prefillFromSource(family("fight-on-death"), "that destroyed model can fight after the attacking unit has finished making its attacks")).toEqual({ timing: "after-the-attacking-unit-finishes", act: "fight" });
    expect(prefillFromSource(family("unit-activity"), "if that model has not fought this phase")).toEqual({ activity: "fought-this-phase", negated: true, subject: "this-unit" });
    expect(prefillFromSource(family("event"), "Your opponent's Shooting phase, just after an enemy unit has selected its targets")).toEqual({ kind: "enemy-selected-targets" });
    expect(prefillFromSource(family("event"), "when this unit is selected to fight")).toEqual({ kind: "selected-to-fight" });
    expect(prefillFromSource(family("stratagem-target"), "One **ADEPTUS ASTARTES INFANTRY** or **ADEPTUS ASTARTES MOUNTED** unit from your army (excluding **TITANIC** units) that has not been selected to shoot this phase"))
      .toEqual({ keywords: ["ADEPTUS ASTARTES INFANTRY", "ADEPTUS ASTARTES MOUNTED"], match: "any", selects: "unit", excluded_keywords: ["TITANIC"], count: "one", side: "your-army" });
    expect(prefillFromSource(family("triggering-target"), "That **SPEEDER** unit")).toEqual({ keywords: ["SPEEDER"], match: "all", selects: "unit" });
    expect(prefillFromSource(family("target-binding"), "that was selected as the target of one or more of the attacking unit’s attacks")).toEqual({ bound_to: "attacked-unit" });
    expect(prefillFromSource(family("unit-activity"), "that has not been selected to move this phase")).toMatchObject({ activity: "selected-to-move-this-phase", negated: true });
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
