import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, expectRefused, placed, type Item } from "./semantic-authoring-connective-fixture.js";

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

// A later moment of the bearer's own that a duration printed after the selection opens. Wording is fabricated.
const heldText = "In your Shooting phase, after this unit has shot, you can use this ability. If you do, select one enemy unit hit by those attacks. Until the end of the turn, when this unit declares a charge: this unit can re-roll that charge roll.";
/** The leaves, with the duration printed after the selection, before it, or not at all. */
const heldItems = (duration: "after" | "before" | "none"): Item[] => {
  const turn: Item = [duration === "after" ? "Until the end of the turn" : "until the end of the turn", "duration", { endpoint: "end-of-turn" }];
  return [
    ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["after this unit has shot", "event", { kind: "after-shooting" }],
    ...(duration === "before" ? [turn] : []),
    ["you can use this ability", "optional-use", { who: "you" }],
    ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["hit by those attacks", "hit-by-attacks", { subject: "selected-unit" }],
    ...(duration === "after" ? [turn] : []),
    ["this unit declares a charge", "event", { kind: "targets-selected", action_kind: "charge" }],
    ["this unit can re-roll that charge roll", "reroll", { roll: "charge", subset: "all", weapon_type: "all" }],
  ];
};

describe("a later moment a duration opens after the selection", () => {
  it("nests under the selection, with the gates printed before the selection on the opening moment", () => {
    const result = compileLeaves(placed(heldText, ...heldItems("after")), heldText);
    expectCompiled(result);
    expect(Array.isArray(result.mechanics.trigger)).toBe(false);
    expect(result.mechanics.trigger).toMatchObject({ event: "attacks-resolved", optional: true });
    const gate = result.mechanics.effect as Record<string, any>;
    expect(gate).toMatchObject({ type: "conditional", condition: { operands: [{ type: "phase-is", parameters: { phase: "shooting" } }, { type: "player-turn-is" }] } });
    expect(gate.effect.type).toBe("select-units");
    expect(gate.effect.effect).toMatchObject({
      type: "ability-part",
      trigger: { event: "targets-selected", filter: { kind: "charge" } },
      effect: { type: "re-roll", modifier: { roll: "charge" } },
    });
  });

  it("still refuses the moment when no duration opens it after the selection", () => {
    const text = heldText.replace("Until the end of the turn, when", "When");
    const refused = compileLeaves(placed(text, ...heldItems("none")), text);
    expectRefused(refused);
    expect(refused.errors.join(" ")).toMatch(/waits on the use an earlier moment offers/u);
  });

  it("still refuses the moment when the only duration is printed before the selection", () => {
    const text = "In your Shooting phase, after this unit has shot, until the end of the turn, you can use this ability. If you do, select one enemy unit hit by those attacks. When this unit declares a charge: this unit can re-roll that charge roll.";
    const refused = compileLeaves(placed(text, ...heldItems("before")), text);
    expectRefused(refused);
    expect(refused.errors.join(" ")).toMatch(/waits on the use an earlier moment offers/u);
  });
});
