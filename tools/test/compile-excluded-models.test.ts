import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// "models (excluding CHARACTERS) in your unit", and an "Or:" choice after a colon lead-in.
// Wording is fabricated.

const NOT_CHARACTERS = { level: "model", member_of: "this-unit", none_of: ["CHARACTER"] };

describe("excluded model keywords", () => {
  it("lowers a characteristic change on the unit's non-CHARACTER models to the filter's none_of", () => {
    const text = "Until the end of the phase, improve the Attacks characteristic of melee weapons equipped by models (excluding **CHARACTERS**) in your unit by 1.";
    const result = compileLeaves(placed(text,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["improve the Attacks characteristic of melee weapons equipped by models (excluding **CHARACTERS**) in your unit by 1", "characteristic-modifier",
        { subject: "this-unit", characteristics: ["A"], operation: "improve", value: 1, weapon_type: "melee", excluded_model_keywords: ["CHARACTER"] }]), text);
    expectCompiled(result);
    expect(result.mechanics.effect).toMatchObject({ type: "stat-modifier", target: NOT_CHARACTERS, modifier: { stat: "A", operation: "improve", value: 1 } });
  });

  it("lowers a characteristic set on the unit's non-CHARACTER models the same way", () => {
    const text = "This unit's melee attacks (excluding Character models' attacks) have 3 A.";
    const result = compileLeaves(placed(text,
      ["This unit's melee attacks (excluding Character models' attacks) have 3 A", "characteristic-set",
        { subject: "this-unit", characteristic: "A", value: 3, weapon_type: "melee", excluded_model_keywords: ["CHARACTER"] }]), text);
    expectCompiled(result);
    expect(result.mechanics.effect).toMatchObject({ type: "stat-modifier", target: NOT_CHARACTERS, modifier: { stat: "A", operation: "set", value: 3 } });
  });

  it("refuses an exclusion on this model, which has no models to pick from", () => {
    expect(() => normalizeFingerprintParameters("characteristic-modifier",
      { subject: "this-model", characteristics: ["A"], operation: "improve", value: 1, weapon_type: "melee", excluded_model_keywords: ["CHARACTER"] }, 20)).toThrow(/picks models of a unit/u);
  });
});

describe("an \"Or:\" choice after a colon lead-in", () => {
  const text = "In the Fight phase, when this unit is selected to fight, you can spend 1 Gloom token to Empower this unit. If you do:This unit's melee attacks have 3 A.Or: This unit's melee attacks have 4 A.";
  const items = [
    ["when this unit is selected to fight", "event", { kind: "selected", to: "fight" }],
    ["you can", "optional-use", { who: "you" }],
    ["spend 1 Gloom token", "resource-spend", { pool: "pain-token-pool", amount: 1, label: "Gloom token" }],
    ["Empower this unit", "apply-mark", { subject: "this-unit", tag: "empowered" }],
    ["This unit's melee attacks have 3 A", "characteristic-set", { subject: "this-unit", characteristic: "A", value: 3, weapon_type: "melee" }],
    ["Or:", "instead", { choice: true }],
    ["This unit's melee attacks have 4 A", "characteristic-set", { subject: "this-unit", characteristic: "A", value: 4, weapon_type: "melee" }],
  ] as const;

  it("applies the lead-in before the choice, whichever option is picked", () => {
    const result = compileLeaves(placed(text, ...items), text);
    expectCompiled(result);
    const steps = (result.mechanics.effect as { steps: Array<Record<string, any>> }).steps;
    expect(steps.map((step) => step.type)).toEqual(["resource-spend", "designate", "choice"]);
    expect(steps[2]!.options.map((option: any) => option.modifier.value)).toEqual([3, 4]);
  });
});
