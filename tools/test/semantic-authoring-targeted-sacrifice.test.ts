import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// Fabricated wording with the shape of a rule the targeted unit can answer with a sacrifice.

const text = "Each time an enemy unit is selected to shoot and one or more ALPHA units from your army are selected as a target of those attacks, each of those ALPHA units can make a Sacrifice. If it does, until the end of the phase, each time an attack targets that unit, subtract 1 from the Wound roll. At the end of the phase, that ALPHA unit suffers D3 mortal wounds.";
const leaves = (source = text) => placed(source,
  ["ALPHA units from your army", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
  ["are selected as a target of those attacks", "event", { kind: "targets-selected", action_kind: "attack", owner: "enemy" }],
  ["can make a Sacrifice", "optional-use", { who: "this-unit" }],
  ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
  ["each time an attack targets that unit", "attack", { direction: "targeted", unit: "that-unit", attack_type: "any" }],
  ["subtract 1 from the Wound roll", "roll-modifier", { roll: "wound", operation: "subtract", value: 1 }],
  ["At the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
  ["that ALPHA unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "antecedent", count: "D3" }]);

describe("a unit the other side targets, answering with an offered use", () => {
  it("names the targeted unit as the moment's object and binds the later effects to it", () => {
    const result = compileLeaves(leaves(), text);
    expectCompiled(result);
    const part = result.mechanics.effect as Record<string, unknown>;
    expect(part.trigger).toEqual({ event: "targets-selected", subject: { owner: "enemy" }, filter: { kind: "attack" }, object: { owner: "friendly", all_of: ["ALPHA"] }, optional: true });
    const [modifier, phaseEnd] = (part.effect as { steps: Array<Record<string, unknown>> }).steps;
    // Only attacks on the targeted unit, not every attack the enemy unit makes.
    expect(modifier).toEqual({
      type: "conditional", condition: { type: "same-unit", parameters: { subject: "defender", as: "event-object" } },
      effect: { type: "roll-modifier", target: "attacker", modifier: { roll: "wound", operation: "subtract", value: 1 } },
    });
    // The end of that phase, once, for the unit that made the sacrifice.
    expect(phaseEnd).toEqual({ type: "ability-part", trigger: { event: "phase-ended" }, duration: "phase", effect: { type: "mortal-wounds", target: "event-object", modifier: { count: "D3" } } });
  });

  it("keeps a phase end in a later paragraph as its own part", () => {
    const split = text.replace(" At the end of the phase,", "\rAt the end of the phase,");
    const result = compileLeaves(leaves(split), split);
    expectCompiled(result);
    const steps = (result.mechanics.effect as { steps: Array<Record<string, unknown>> }).steps;
    expect(steps.map((step) => (step.trigger as Record<string, unknown>).event)).toEqual(["targets-selected", "phase-ended"]);
  });
});
