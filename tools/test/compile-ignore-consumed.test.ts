import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { expectCompiled, expectRefused, placed } from "./semantic-authoring-connective-fixture.js";

// A pick that may take an option a once-per-battle selection already used. Wording is fabricated.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));
const activation = (result: ReturnType<typeof compileLeaves>) => {
  expectCompiled(result);
  return (result.mechanics.effect as Record<string, any>).modifier;
};

describe("ignore_consumed on the pick and on the activation", () => {
  it("lowers a choice-open's ignore_consumed onto the activation that names its pick", () => {
    const text = "Select one fixture tactic, even if you have already selected that tactic this battle. Until the end of the turn, that tactic is active for this unit.";
    const result = compileLeaves(placed(text,
      ["Select one fixture tactic, even if you have already selected that tactic this battle", "choice-open", { min_choices: 1, max_choices: 1, ignore_consumed: true }],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ["that tactic is active for this unit", "ability-activate", { subject: "this-unit", ability: "fixture-tactics", chosen: true }],
    ), text);
    expect(activation(result)).toEqual({ ability: "fixture-tactics", select: { by: "player" }, exclusive: true, ignore_consumed: true });
  });

  it("lowers an activation's own ignore_consumed, and leaves a plain pick without it", () => {
    const text = "Select one fixture tactic. That tactic is active for this unit in addition to any other, even if you have already selected it this battle.";
    const leaves = (ignore: boolean) => placed(text,
      ["Select one fixture tactic", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["That tactic is active for this unit in addition to any other, even if you have already selected it this battle", "ability-activate",
        { subject: "this-unit", ability: "fixture-tactics", chosen: true, additive: true, ...(ignore ? { ignore_consumed: true } : {}) }],
    );
    expect(activation(compileLeaves(leaves(true), text))).toEqual({ ability: "fixture-tactics", select: { by: "player" }, ignore_consumed: true });
    expect(activation(compileLeaves(leaves(false), text))).toEqual({ ability: "fixture-tactics", select: { by: "player" } });
  });

  it("refuses ignore_consumed on a random pick, on an activation that names no pick, and on a menu of options", () => {
    expect(() => normalize("choice-open", { min_choices: 1, max_choices: 1, ignore_consumed: true, or_random: { dice: "D3", count: 1 } })).toThrow(/not a random one/u);
    expect(() => normalize("ability-activate", { subject: "this-unit", ability: "fixture-tactics", option: "first", ignore_consumed: true })).toThrow(/goes with chosen/u);
    const text = "Select one of the following, even if you have already selected it this battle:\n■ This unit has the Stealth ability.\n■ This unit has the Scouts 6\" ability.";
    const refused = compileLeaves(placed(text,
      ["Select one of the following, even if you have already selected it this battle", "choice-open", { min_choices: 1, max_choices: 1, ignore_consumed: true }],
      ["This unit has the Stealth ability", "core-ability-grant", { subject: "this-unit", ability: "stealth" }],
      ["This unit has the Scouts 6\" ability", "core-ability-grant", { subject: "this-unit", ability: "scouts", value: 6 }],
    ), text);
    expectRefused(refused);
    expect(refused.errors.join(" ")).toMatch(/a menu of options takes none/u);
  });
});
