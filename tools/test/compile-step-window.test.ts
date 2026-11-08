import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// A step named before the moment it holds. Wording is fabricated.

const move = ["this unit can make a Normal move of up to 6\"", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }] as const;
const trigger = (text: string, ...leaves: Parameters<typeof placed>[1][]) => {
  const result = compileLeaves(placed(text, ...leaves, [...move]), text);
  expectCompiled(result);
  return result.mechanics.trigger;
};

describe("a step that holds the moment after it", () => {
  it("makes the step the moment's window when \", just after\" joins them", () => {
    const text = "In the Reinforcements step of your opponent's Movement phase, just after an enemy unit is set up on the battlefield from Reserves, this unit can make a Normal move of up to 6\".";
    expect(trigger(text,
      ["the Reinforcements step of your opponent's Movement phase", "event", { kind: "step-started", step: "reinforcements", turn: "opponent" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["set up on the battlefield from Reserves", "event", { kind: "move-ended", move_types: ["ingress"] }],
    )).toEqual({
      event: "move-ended", filter: { move_types: ["ingress"] }, subject: { owner: "enemy" },
      condition: { operator: "and", operands: [
        { type: "phase-is", parameters: { phase: "movement", step: "reinforcements" } },
        { type: "player-turn-is", parameters: { turn: "opponent-turn" } },
      ] },
    });
  });

  it("keeps a step joined by \"or\" as its own moment", () => {
    const text = "At the start of the Reinforcements step of your Movement phase or each time an enemy unit ends an Advance move, this unit can make a Normal move of up to 6\".";
    const result = trigger(text,
      ["the Reinforcements step of your Movement phase", "event", { kind: "step-started", step: "reinforcements", turn: "your" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["ends an Advance move", "event", { kind: "move-ended", move_types: ["advance"] }],
    );
    expect(Array.isArray(result)).toBe(true);
    expect((result as Record<string, unknown>[]).map((each) => each.event)).toEqual(["step-started", "move-ended"]);
  });
});
