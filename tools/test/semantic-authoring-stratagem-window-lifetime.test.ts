import { describe, expect, it } from "vitest";
import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, placed, type Item } from "./semantic-authoring-connective-fixture.js";

// Fabricated wording only. A Stratagem used at a phase's end whose lasting effect sits in a later
// moment of the same use lasts until the end of that phase (core rule 01.02.02).

const TEXT = "WHEN: End of your opponent's Fight phase.\nTARGET: One FIXTURE unit from your army.\nEFFECT: Your unit can declare a charge. Before making the charge roll, add 1 to it.";
const WHEN: Item = ["End of your opponent's Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "opponent" }, "WHEN"];
const TARGET: Item = ["One FIXTURE unit from your army", "stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["FIXTURE"], match: "all", excluded_keywords: [] }, "TARGET"];
const BODY: Item[] = [
  ["Your unit can declare a charge", "make-move", { subject: "this-unit", move_type: "charge" }, "EFFECT"],
  ["Before making the charge roll", "event", { kind: "before-roll", roll: "charge" }, "EFFECT"],
  ["add 1 to it", "roll-modifier", { roll: "charge", operation: "add", value: 1 }, "EFFECT"],
];

describe("Semantic authoring Stratagem window lifetime", () => {
  it("bounds a later moment's lasting effect by the phase a Stratagem's WHEN ends", () => {
    const result = compileLeaves(placed(TEXT, WHEN, TARGET, ...BODY), TEXT);
    expectCompiled(result);
    expect(result.mechanics.scope?.duration).toBe("phase");
    expect(JSON.stringify(result.mechanics.effect)).toContain("\"before-roll\"");
  });

  it("leaves the same moments outside a Stratagem unbounded", () => {
    const text = "At the end of your opponent's Fight phase, this unit can declare a charge. Before making the charge roll, add 1 to it.";
    const result = compileLeaves(placed(text,
      ["At the end of your opponent's Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "opponent" }],
      ["this unit can declare a charge", "make-move", { subject: "this-unit", move_type: "charge" }],
      ["Before making the charge roll", "event", { kind: "before-roll", roll: "charge" }],
      ["add 1 to it", "roll-modifier", { roll: "charge", operation: "add", value: 1 }]), text);
    expectCompiled(result);
    expect(result.mechanics.scope?.duration).toBe("permanent");
  });
});
