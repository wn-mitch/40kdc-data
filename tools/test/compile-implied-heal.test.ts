import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// "If a FOO model in this unit has lost wounds, that model regains all of them": the lost-wounds
// test is what a heal already requires. Wording is fabricated.

const text = "At the end of each phase, if a Fixture Beast model in this unit has lost any wounds but is not destroyed, that model regains all of its lost wounds.";
const leaves = (wounds: Record<string, unknown>) => placed(text,
  ["At the end of each phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
  ["Fixture Beast model in this unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE BEAST"], level: "model", member_of: "this-unit" }],
  ["has lost any wounds but is not destroyed", "wounds-state", wounds],
  ["that model regains all of its lost wounds", "regain-wounds", { subject: "antecedent", amount: "all" }],
);

describe("a lost-wounds test before a heal of the same model", () => {
  it("folds away: the filter names the healed models", () => {
    const result = compileLeaves(leaves({ subject: "model-in-this-unit", kind: "lost", negated: false }), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({ type: "heal", target: { owner: "friendly", all_of: ["FIXTURE BEAST"], level: "model", member_of: "this-unit" }, modifier: { amount: "full" } });
    expect(result.mechanics.trigger).toEqual({ event: "phase-ended" });
  });

  it("does not fold a negated test, or another wounds test, which say more than the heal", () => {
    for (const wounds of [{ subject: "model-in-this-unit", kind: "lost", negated: true }, { subject: "model-in-this-unit", kind: "damaged", negated: false }]) {
      expect(compileLeaves(leaves(wounds), text).ok).toBe(false);
    }
  });
});
