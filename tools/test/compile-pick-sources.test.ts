import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { expectCompiled, expectRefused, placed } from "./semantic-authoring-connective-fixture.js";

// Where an activation's option comes from: another ability's use, a pick that bars the army's
// option, and one pick shared by several Stratagem targets. Wording is fabricated.

const modifierOf = (result: ReturnType<typeof compileLeaves>) => {
  expectCompiled(result);
  return (result.mechanics.effect as Record<string, any>).modifier;
};

describe("ability-activate from_event: the option the triggering use selected", () => {
  const text = "When a friendly **FIXTURE** unit uses its Fixture Acumen ability, you can use this ability. If you do, the selected fixture tactic is active for this unit until the start of your next Command phase.";
  const leaves = (activation: Record<string, unknown>) => placed(text,
    ["friendly **FIXTURE** unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }],
    ["uses its Fixture Acumen ability", "event", { kind: "used", activity: "ability", id: "fixture-acumen" }],
    ["you can use this ability", "optional-use", { who: "you" }],
    ["the selected fixture tactic is active for this unit", "ability-activate", activation],
    ["until the start of your next Command phase", "duration", { endpoint: "start-of-next-command-phase" }],
  );

  it("activates the option that use picked, in place of the unit's active one", () => {
    const modifier = modifierOf(compileLeaves(leaves({ subject: "this-unit", ability: "fixture-tactics", from_event: true }), text));
    expect(modifier).toEqual({ ability: "fixture-tactics", select: { by: "event" }, exclusive: true });
  });

  it("refuses from_event beside another option form", () => {
    const version = currentFamilyVersion("ability-activate");
    expect(() => normalizeFingerprintParameters("ability-activate", { subject: "this-unit", ability: "fixture-tactics", from_event: true, chosen: true }, version)).toThrow(/takes no chosen/u);
    expect(() => normalizeFingerprintParameters("ability-activate", { subject: "this-unit", ability: "fixture-tactics", from_event: true, option: "first" }, version)).toThrow(/takes no option/u);
  });
});

describe("pick-exclusion: the pick cannot take the option active for your army", () => {
  const text = "Select one fixture tactic. Until the end of the turn, that tactic is active for this unit. You cannot select the tactic that is active for your army.";
  const pick: Array<readonly [string, string, Record<string, unknown>]> = [
    ["Select one fixture tactic", "choice-open", { min_choices: 1, max_choices: 1 }],
    ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
    ["that tactic is active for this unit", "ability-activate", { subject: "this-unit", ability: "fixture-tactics", chosen: true }],
  ];
  const exclusion = ["You cannot select the tactic that is active for your army", "pick-exclusion", { excluding: "army-active" }] as const;

  it("bars the army's option from the player's pick", () => {
    expect(modifierOf(compileLeaves(placed(text, ...pick, exclusion), text)).select).toEqual({ by: "player", excluding: "army-active" });
  });

  it("refuses an exclusion with no player pick to bar it from", () => {
    const fixed = [pick[1]!, ["that tactic is active for this unit", "ability-activate", { subject: "this-unit", ability: "fixture-tactics", option: "first" }] as const];
    const refused = compileLeaves(placed(text, ...fixed, exclusion), text);
    expectRefused(refused);
    expect(refused.errors.join(" ")).toMatch(/one player pick/u);
  });
});

describe("one pick shared by several Stratagem targets", () => {
  const text = "Your Command phase.\nUp to two **FIXTURE** units from your army, or one **ALTERNATE** unit.\nSelect one fixture tactic. Until the start of your next Command phase, that tactic is active for those selected units in addition to any other.";
  const at = (wording: string, family: string, parameters: Record<string, unknown>, fragment: string): CompileLeaf => {
    const start = Buffer.from(text, "utf8").indexOf(Buffer.from(wording, "utf8"));
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: start + Buffer.byteLength(wording, "utf8"), fragment,
    };
  };

  it("binds the pick once, so every target gets the same option", () => {
    const leaves = [
      at("Your Command phase", "use-window", { your_phases: ["command"], opponent_phases: [], either_phases: [] }, "WHEN"),
      at("Up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"),
      at("**FIXTURE** units", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }, "TARGET"),
      at("from your army", "unit-owner", { owner: "friendly" }, "TARGET"),
      at("one", "stratagem-target", { count: "one" }, "TARGET"),
      at("**ALTERNATE** unit", "unit-filter", { side: "friendly", keywords: ["ALTERNATE"] }, "TARGET"),
      at("Select one fixture tactic", "choice-open", { min_choices: 1, max_choices: 1 }, "EFFECT"),
      at("Until the start of your next Command phase", "duration", { endpoint: "start-of-next-command-phase" }, "EFFECT"),
      at("that tactic is active for those selected units in addition to any other", "ability-activate", { subject: "antecedent", ability: "fixture-tactics", chosen: true, additive: true }, "EFFECT"),
      at("those selected units", "unit-filter", { side: "friendly", among: "stratagem-targets", targets: "every" }, "EFFECT"),
    ];
    const result = compileLeaves(leaves, text);
    expectCompiled(result);
    const steps = (result.mechanics.effect as Record<string, any>).steps;
    expect(steps.map((step: Record<string, any>) => step.target)).toEqual([{ stratagem_target: "first" }, { stratagem_target: "second" }]);
    expect(steps.map((step: Record<string, any>) => step.modifier.select)).toEqual([{ by: "player", option_var: "picked-option" }, { by: "player", option_var: "picked-option" }]);
  });
});
