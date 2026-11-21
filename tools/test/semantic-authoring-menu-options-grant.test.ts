import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { annotated, expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// Fabricated wording in the shape of a menu whose options one unit also gets all at once:
// "In your Command phase, select one of the following abilities. Until the start of your next Command phase, each
// ALPHA INFANTRY unit from your army has that ability. At the start of each phase, if such a unit is visible to a
// friendly BETA model, until the end of the phase, it has both of the following abilities. ■ Keen: … ■ Swift: …".
const TEXT = "In your Command phase, select one of the following abilities. Until the start of your next Command phase, each ALPHA INFANTRY unit from your army has that ability. At the start of each phase, if such a unit is visible to a friendly BETA model, until the end of the phase, it has both of the following abilities.\n■ Keen: Each time a model in this unit makes an attack, add 1 to the Hit roll.\n■ Swift: This unit is eligible to shoot and declare a charge in a turn in which it Fell Back.";

function compile() {
  const leaves = placed(TEXT,
    ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
    ["select one of the following abilities", "choice-open", { min_choices: 1, max_choices: 1 }],
    ["Until the start of your next Command phase", "duration", { endpoint: "start-of-next-command-phase" }],
    ["each ALPHA INFANTRY unit", "unit-filter", { side: "friendly", keywords: ["ALPHA", "INFANTRY"] }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["has that ability", "chosen-option-grant", { holder: "antecedent" }],
    ["At the start of each phase", "event", { kind: "phase-start", phase: "any", turn: "either" }],
    ["such a unit", "for-each-unit-select", { units: "antecedent" }],
    ["is visible to a", "visible", { subject: "antecedent", to: "following-filter", negated: false }],
    ["friendly BETA model", "unit-filter", { side: "friendly", keywords: ["BETA"], level: "model" }],
    ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["it has both of the following abilities", "menu-options-grant", { holder: "antecedent" }],
    ["Keen", "named-option", { label: "Keen", option_id: "keen" }],
    ["Each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ["Swift", "named-option", { label: "Swift", option_id: "swift" }],
    ["This unit is eligible to shoot and declare a charge in a turn in which it Fell Back", "act-after-move", { subject: "this-unit", moves: ["fall-back"], acts: ["shoot", "charge"] }],
  );
  return compileLeaves(annotated(TEXT, leaves, [{ surface: "if", after: "At the start of each phase" }]), TEXT);
}

describe("'it has both of the following abilities' after a menu", () => {
  it("gives each looped unit every option of the menu, in its own later part", () => {
    const result = compile();
    expectCompiled(result);
    const [first, later] = (result.mechanics.effect as { steps: Array<Record<string, any>> }).steps;
    // The Command phase window and the chosen option's duration head the menu only.
    expect(first!.type).toBe("conditional");
    expect(JSON.stringify(first!.condition)).toContain('"phase":"command"');
    expect(first!.effect).toMatchObject({ type: "ability-part", duration: "until-next-command-phase", effect: { type: "choice" } });
    expect(JSON.stringify(first!.effect.effect.options)).toContain('"all_of":["ALPHA","INFANTRY"]');
    // The later part fires in every phase, loops over the menu's units, and is not inside the Command phase window.
    expect(later).toMatchObject({ type: "ability-part", trigger: { event: "phase-started" } });
    expect(JSON.stringify(later)).not.toContain('"phase":"command"');
    const loop = later!.effect;
    expect(loop).toMatchObject({ type: "for-each-unit", selector: { filter: { owner: "friendly", all_of: ["ALPHA", "INFANTRY"] } } });
    expect(loop.effect.condition.parameters.subject).toBe("recipient");
    const both = JSON.stringify(loop.effect.effect);
    expect(loop.effect.effect.duration).toBe("phase");
    expect(both).toContain('"roll":"hit"');
    expect(both).toContain('"activity":"declare-charge"');
    expect(both).not.toContain('"this-unit"');
  });

  it("refuses a menu-options-grant with no menu before it", () => {
    const text = "This unit has both of the following abilities.";
    const result = compileLeaves(placed(text, ["This unit has both of the following abilities", "menu-options-grant", { holder: "this-unit" }]), text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/no menu opens before it/u);
  });
});
