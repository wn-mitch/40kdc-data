import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// A stance whose last option holds a choice of its own. Wording is fabricated.

const text = "In your Command phase, you can select one fixture stance below for this unit.\n■ **Quick Stance:** Add 2 to the Move characteristic of models in this unit.\n■ **Hard Stance:** When this unit is selected as the target of an attack, select one of the following to apply until the end of the phase:\n■ Models in this unit have a 5+ invulnerable save.\n■ Models in this unit have the Feel No Pain 6+ ability.";
const items = [
  ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
  ["you can", "optional-use", { who: "you" }],
  ["select one fixture stance below for this unit", "stance-select-open", { scope: "unit", mode: "re-selectable", min_choices: 1, max_choices: 1 }],
  ["Quick Stance", "named-option", { label: "Quick Stance", option_id: "quick-stance" }],
  ["Add 2 to the Move characteristic of models in this unit", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }],
  ["Hard Stance", "named-option", { label: "Hard Stance", option_id: "hard-stance" }],
  ["When this unit is selected as the target of an attack", "event", { kind: "targets-selected", owner: "enemy", action_kind: "attack", object: "this-unit" }],
  ["select one of the following to apply", "choice-open", { min_choices: 1, max_choices: 1 }],
  ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
  ["Models in this unit have a 5+ invulnerable save", "invulnerable-save", { subject: "this-unit", threshold: 5 }],
  ["Models in this unit have the Feel No Pain 6+ ability", "feel-no-pain", { subject: "this-unit", threshold: 6, against: "all" }],
] as const;

describe("a choice inside a named stance option", () => {
  it("stays in its option instead of ending the stance", () => {
    const result = compileLeaves(placed(text, ...items), text);
    expectCompiled(result);
    const stance = findStance(result.mechanics.effect);
    expect(stance?.options.map((option: Record<string, unknown>) => option.id)).toEqual(["quick-stance", "hard-stance"]);
    const hard = JSON.stringify(stance!.options[1].effect);
    expect(hard).toContain("\"type\":\"choice\"");
    expect(hard).toContain("invulnerable-save");
    expect(hard).toContain("feel-no-pain");
  });
});

function findStance(node: unknown): Record<string, any> | null {
  if (node === null || typeof node !== "object") return null;
  if ((node as Record<string, unknown>).type === "stance-select") return node as Record<string, any>;
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findStance(value);
    if (found) return found;
  }
  return null;
}
