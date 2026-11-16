import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// Fabricated wording in the shape of "If it does, this Enhancement is expended, then until the end of the
// phase, each time it makes an attack that targets a unit that can FLY, you can re-roll the Hit roll."
const TEXT = "When the bearer is selected to shoot, it can use this Enhancement. If it does, this Enhancement is expended, then until the end of the phase, each time it makes an attack that targets a GAMMA unit, you can re-roll the Hit roll.";
const items = () => [
  ["the bearer is selected to shoot", "event", { kind: "selected", to: "shoot" }],
  ["it can use this Enhancement", "optional-use", { who: "this-model" }],
  ["this Enhancement is expended", "apply-mark", { subject: "this-model", tag: "enhancement-expended" }],
  ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
  ["each time it makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
  ["that targets a GAMMA unit", "unit-keyword", { keywords: ["GAMMA"], subject: "target", negated: false }],
  ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }],
] as Parameters<typeof placed>[1][];

describe("', then' between two effects", () => {
  it("starts a clause, so the attack's condition gates only the effect after it", () => {
    const result = compileLeaves(placed(TEXT, ...items()), TEXT);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.signature).toContain("EFFECT(apply-mark) | DURATION(duration)");
    const steps = (result.mechanics.effect as { steps: Array<Record<string, unknown>> }).steps;
    expect(steps[0]).toEqual({ type: "designate", target: "this-model", modifier: { tag: "enhancement-expended" } });
    expect(JSON.stringify(steps[1])).toContain('"all_of":["GAMMA"]');
  });
});
