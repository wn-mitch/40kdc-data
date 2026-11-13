import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// An attack frame opened after an earlier effect in the same sentence keeps every subjectless roll
// after it, across an "and", under its conditions. Wording is fabricated.

const lead = "Until the end of the phase, add 6\" to the Range characteristic of Arcane weapons equipped by models in your unit, and ";
const frame = "each time a model in your unit makes an attack with an Arcane weapon, you can re-roll the Hit roll and you can re-roll the Wound roll.";

const items = [
  ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
  ["add 6\" to the Range characteristic of Arcane weapons equipped by models in your unit", "characteristic-modifier",
    { subject: "this-unit", characteristics: ["Range"], operation: "add", value: 6, weapon_type: "all", weapon_keyword: "Psychic" }],
  ["each time a model in your unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
  ["with an Arcane weapon", "attack-filter", { attack_type: "psychic" }],
  ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }],
  ["you can re-roll the Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all" }],
] as const;

describe("rolls after an attack frame that follows an earlier effect", () => {
  it("gates both re-rolls on the attack's weapon, not only the first", () => {
    const text = lead + frame;
    const result = compileLeaves(placed(text, ...items), text);
    expectCompiled(result);
    const steps = (result.mechanics.effect as { steps: Array<Record<string, any>> }).steps;
    const rerolls = steps.filter((step) => step.type === "conditional");
    expect(rerolls.map((step) => step.effect.modifier.roll)).toEqual(["hit", "wound"]);
    for (const step of rerolls) expect(step.condition).toEqual({ type: "attack-is", parameters: { attack_type: "psychic" } });
    expect(steps.some((step) => step.type === "re-roll")).toBe(false);
  });

  it("leaves an effect after the attack's rolls that is not a roll out of the attack's clause", () => {
    const text = `${lead}each time a model in your unit makes an attack with an Arcane weapon, you can re-roll the Hit roll and your unit has +1 OC.`;
    const result = compileLeaves(placed(text, ...items.slice(0, 5),
      ["+1 OC", "characteristic-modifier", { subject: "this-unit", characteristics: ["OC"], operation: "improve", value: 1 }]), text);
    expectCompiled(result);
    const steps = (result.mechanics.effect as { steps: Array<Record<string, any>> }).steps;
    expect(steps.at(-1)).toMatchObject({ type: "stat-modifier", modifier: { stat: "OC" } });
  });

  it("still splits the rolls when an \"instead\" composes them, so each roll is its own replacement", () => {
    const text = "Select one enemy unit. Each time a model in your unit makes an attack that targets that enemy unit, re-roll a Hit roll of 1. Each time a model in your unit makes an attack that targets that enemy unit, if that enemy unit is TITANIC, you can re-roll the Hit roll and you can re-roll the Wound roll instead.";
    const result = compileLeaves(placed(text,
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["Each time a model in your unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["that targets that enemy unit", "target-is-selected", {}],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
      ["Each time a model in your unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["that targets that enemy unit", "target-is-selected", {}],
      ["that enemy unit is TITANIC", "unit-keyword", { keywords: ["TITANIC"], subject: "antecedent", negated: false }],
      ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }],
      ["you can re-roll the Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all" }],
      ["instead", "instead", {}]), text, { abilityId: "fabricated-titanic-duel", name: "Titanic Duel" });
    expectCompiled(result);
    expect(JSON.stringify(result.mechanics)).toContain('"roll":"wound","result_scope":"any-result"');
  });
});
