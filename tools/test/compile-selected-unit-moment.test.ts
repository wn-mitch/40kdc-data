import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, expectRefused, placed } from "./semantic-authoring-connective-fixture.js";

// A selection whose effects wait for the selected unit's own later moment. Wording is fabricated.

const text = "At the start of your Movement phase, you can select one friendly **FIXTURE** unit within 12\" of this model. If you do, when that unit is selected to make an Advance move this turn: that unit is eligible to shoot.";
const items = (moveSubject: string) => [
  ["At the start of your Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "your" }],
  ["you can", "optional-use", { who: "you" }],
  ["select one", "select-unit", { distance: "any", visible: false }],
  ["friendly **FIXTURE** unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }],
  ["within 12\" of this model", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "antecedent", negated: false }],
  ["when that unit is selected to make an Advance move", "event", { kind: "selected", to: "move", move_types: ["advance"], subject: moveSubject }],
  ["this turn", "duration", { endpoint: "end-of-turn" }],
  ["that unit is eligible to shoot", "eligibility-permission", { subject: "antecedent", activity: "shoot", allow: true }],
] as const;

describe("a selected unit's own later moment", () => {
  it("nests under the selection as a part, not beside the opening moment", () => {
    const result = compileLeaves(placed(text, ...items("antecedent")), text);
    expectCompiled(result);
    expect(result.mechanics.trigger).toMatchObject({ event: "phase-started" });
    expect(Array.isArray(result.mechanics.trigger)).toBe(false);
    const selection = result.mechanics.effect as Record<string, any>;
    expect(selection.type).toBe("select-units");
    expect(selection.effect).toMatchObject({
      type: "ability-part",
      trigger: { event: "selected", subject: "selected-unit", filter: { to: "move", move_types: ["advance"] } },
      effect: { type: "permission", target: "selected-unit", modifier: { activity: "shoot", allow: true } },
    });
  });

  it("still refuses an effect on the selected unit past a moment that is not that unit's own", () => {
    const refused = compileLeaves(placed(text, ...items("this-unit")), text);
    expectRefused(refused);
    expect(refused.errors.join(" ")).toMatch(/the selection cannot carry its effect to that moment/u);
  });
});
