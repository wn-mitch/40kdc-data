import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// An embarked model's own ability passed to its Transport ("that model's X/Y ability"). Wording is fabricated.

const text = "While a Gamma Boss model is embarked within this unit, this unit has that Gamma Boss model's **Alpha Shout/Beta Howl** ability.";
const leaves = (held: boolean, withCondition = true) => placed(text,
  ...(withCondition ? [
    ["Gamma Boss model", "unit-filter", { side: "friendly", keywords: ["GAMMA BOSS"], level: "model" }],
    ["embarked within this unit", "unit-state", { states: ["embarked"], subject: "antecedent", negated: false, with: "this-unit" }],
  ] as Array<[string, string, Record<string, unknown>]> : []),
  ["this unit has that Gamma Boss model's **Alpha Shout", "ability-record-grant", { subject: "this-unit", ability: "alpha-shout", ...(held ? { held_by_model: true } : {}) }],
  ["Beta Howl** ability", "ability-record-grant", { subject: "this-unit", ability: "beta-howl", ...(held ? { held_by_model: true } : {}) }],
);
const embarkedBoss = (ability?: string) => ({ type: "matches", parameters: {
  subject: { owner: "friendly", all_of: ["GAMMA BOSS"], level: "model", embarked_in: "this-unit", ...(ability ? { has_ability: [ability] } : {}) }, filter: { state: "embarked" } } });
const grant = (ability: string) => ({ type: "ability-grant", target: "this-unit", modifier: { ability } });

describe("a grant of the ability the condition's model has (ability-record-grant held_by_model)", () => {
  it("grants each ability only while an embarked model that has it is there", () => {
    const result = compileLeaves(leaves(true), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "conditional", condition: embarkedBoss("alpha-shout"), effect: grant("alpha-shout") },
      { type: "conditional", condition: embarkedBoss("beta-howl"), effect: grant("beta-howl") },
    ] });
  });

  it("grants both under one condition without held_by_model, as before", () => {
    const result = compileLeaves(leaves(false), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({ type: "conditional", condition: embarkedBoss(), effect: { type: "sequence", steps: [grant("alpha-shout"), grant("beta-howl")] } });
  });

  it("refuses a held grant with no condition about the model", () => {
    const result = compileLeaves(leaves(true, false), text);
    expect(result.ok ? "ok" : result.errors.join("; ")).toMatch(/held_by_model/u);
  });

  it("takes only a plain ability", () => {
    const version = currentFamilyVersion("ability-record-grant");
    const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("ability-record-grant", parameters, version);
    expect(normalize({ subject: "this-unit", ability: "alpha-shout", held_by_model: true })).toEqual({ subject: "this-unit", ability: "alpha-shout", held_by_model: true });
    expect(() => normalize({ subject: "this-unit", ability: "alpha-shout", held_by_model: true, value: 2 })).toThrow(/takes no value/u);
    expect(() => normalize({ subject: "this-unit", ability: "alpha-shout", held_by_model: false })).toThrow(/true or omitted/u);
  });
});
