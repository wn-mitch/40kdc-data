import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, expectRefused, placed, type Item } from "./semantic-authoring-connective-fixture.js";

// A selection limited to a unit this unit targeted, a test that unit takes, and attacks against it whose later
// "as well" change depends on the test. Wording is fabricated.

const text = "When this unit has selected its targets, select one enemy unit that was selected as the target of one or more of this unit's attacks. That enemy unit must take a Battle-shock test. Until the end of the phase, each time a model in this unit makes an attack that targets that enemy unit, add 1 to the Hit roll. If that test was failed, add 1 to the Wound roll as well.";
const items = (wound: string): Item[] => [
  ["has selected its targets", "event", { kind: "targets-selected" }],
  ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
  ["that was selected as the target of one or more of this unit's attacks", "target-is-selected", { by: "this-unit", target: "selected-unit" }],
  ["That enemy unit must take a Battle-shock test", "test", { target: "selected-unit", test: "battle-shock" }],
  ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
  ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
  ["that targets that enemy unit", "target-is-selected", {}],
  ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
  ["If that test was failed", "roll-outcome", { roll: "battle-shock", result: "failure" }],
  [wound, "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
];

describe("a designation with a direct effect and an as-well change", () => {
  it("takes the past targeting as the selection's eligibility and keeps the test out of the attacks", () => {
    const result = compileLeaves(placed(text, ...items("add 1 to the Wound roll")), text, { abilityId: "fabricated-surprise", name: "Surprise Assault" });
    expectCompiled(result);
    const designation = result.mechanics.effect as Record<string, any>;
    expect(designation).toMatchObject({ type: "designate-target", designation: "surprise-assault-target", duration: "phase" });
    expect(designation.select.selector.eligibility).toEqual({ type: "happened", parameters: { event: "targets-selected", object: "selected-unit", window: "event" } });
    expect(designation.applies).toEqual([
      { to: "target", effect: { type: "test", target: "selected-unit", modifier: { test: "battle-shock" } } },
      {
        to: "attackers-of-target",
        effect: {
          type: "sequence",
          steps: [
            { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } },
            {
              type: "conditional",
              condition: { type: "roll-result", parameters: { roll: "battle-shock", result: "failure" } },
              effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } },
            },
          ],
        },
      },
    ]);
  });

  it("takes a past targeting by the selected unit as its eligibility too", () => {
    const by = text.replace("that was selected as the target of one or more of this unit's attacks", "that selected this unit as the target of one or more of its attacks");
    const leaves = items("add 1 to the Wound roll").map((item): Item => item[0].startsWith("that was selected")
      ? ["that selected this unit as the target of one or more of its attacks", "target-is-selected", { by: "selected-unit", target: "this-unit" }] : item);
    const result = compileLeaves(placed(by, ...leaves), by, { abilityId: "fabricated-surprise", name: "Surprise Assault" });
    expectCompiled(result);
    expect((result.mechanics.effect as Record<string, any>).select.selector.eligibility)
      .toEqual({ type: "happened", parameters: { event: "targets-selected", subject: "selected-unit", object: "this-unit", window: "event" } });
  });

  it("does not take a past targeting that names neither side as the selected unit", () => {
    const other = text.replace("that was selected as the target of one or more of this unit's attacks", "that was selected as the target of one or more attacks this phase");
    const leaves = items("add 1 to the Wound roll").map((item): Item => item[0].startsWith("that was selected")
      ? ["that was selected as the target of one or more attacks this phase", "target-is-selected", { by: "event-subject", target: "this-unit" }] : item);
    const result = compileLeaves(placed(other, ...leaves), other, { abilityId: "fabricated-surprise", name: "Surprise Assault" });
    const eligibility = result.ok ? (result.mechanics.effect as Record<string, any>).select?.selector?.eligibility : undefined;
    expect(eligibility).toBeUndefined();
  });

  it("still refuses a later change that does not say it adds to the earlier attacks", () => {
    const plain = text.replace(" as well.", ".");
    const refused = compileLeaves(placed(plain, ...items("add 1 to the Wound roll")), plain, { abilityId: "fabricated-surprise", name: "Surprise Assault" });
    expectRefused(refused);
    expect(refused.errors.join(" ")).toMatch(/not every effect is limited to attacks against it/u);
  });
});
