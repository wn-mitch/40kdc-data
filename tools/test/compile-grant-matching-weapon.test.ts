import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// Printed abilities granted by the weapon the unit carries, for a printed duration. Wording is fabricated.

const text = "When this unit has shot, select one enemy unit. That enemy unit has the ability below that matches that weapon's name until the start of your next turn:\n**Fixture Gun:** That unit has -1 Ld.\n**Other Gun:** That unit has -2\" M.";
const leaves = (matching: boolean) => placed(text,
  ["When this unit has shot", "event", { kind: "after-shooting" }],
  ["select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ["That enemy unit has the ability below that matches that weapon's name", "ability-record-grant",
    { subject: "antecedent", printed: "several", ...(matching ? { matching_weapon: true } : {}) }],
  ["until the start of your next turn", "duration", { endpoint: "start-of-next-turn" }],
  ["Fixture Gun", "granted-ability-name", { label: "Fixture Gun" }],
  ["That unit has -1 Ld", "characteristic-modifier", { subject: "this-unit", characteristics: ["Ld"], operation: "subtract", value: 1, weapon_type: "all" }],
  ["Other Gun", "granted-ability-name", { label: "Other Gun" }],
  ["That unit has -2\" M", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "subtract", value: 2, weapon_type: "all" }],
);
const carries = (name: string) => ({ type: "named-weapon", parameters: { subject: "this-unit", name, count: 1, models: { count: { min: 1 }, state: "carry" } } });

describe("a printed grant matching the carried weapon's name", () => {
  it("grants each printed ability only while this unit carries the weapon of that name, for the printed duration", () => {
    const result = compileLeaves(leaves(true), text);
    expectCompiled(result);
    expect(result.mechanics.scope).toEqual({ duration: "until-start-next-turn" });
    const steps = (result.mechanics.effect as Record<string, any>).effect.steps;
    expect(steps.map((step: Record<string, any>) => step.condition)).toEqual([carries("Fixture Gun"), carries("Other Gun")]);
    expect(steps[0].effect).toMatchObject({ type: "ability-grant", target: "selected-unit", modifier: { definition: { name: "Fixture Gun" } } });
  });

  it("grants every printed ability unconditionally without matching_weapon", () => {
    const result = compileLeaves(leaves(false), text);
    expectCompiled(result);
    const steps = (result.mechanics.effect as Record<string, any>).effect.steps;
    expect(steps.map((step: Record<string, any>) => step.type)).toEqual(["ability-grant", "ability-grant"]);
  });

  it("refuses matching_weapon on a grant that prints one ability or names a record", () => {
    const version = currentFamilyVersion("ability-record-grant");
    expect(() => normalizeFingerprintParameters("ability-record-grant", { subject: "this-unit", printed: "one", matching_weapon: true }, version)).toThrow(/among several/u);
    expect(() => normalizeFingerprintParameters("ability-record-grant", { subject: "this-unit", ability: "fixture-rule", matching_weapon: true }, version)).toThrow();
  });
});
