import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, expectRefused, placed, type Item } from "./semantic-authoring-connective-fixture.js";

// A later moment that ends what the ability's earlier part began, and an "instead" under a later moment. Wording is fabricated.

const shootText = "Each time this model is selected to shoot, you can use this ability. If you do, until the end of the phase, each time this model makes an attack, add 1 to the Wound roll. After resolving those attacks, roll one D6: on a 2+, this model suffers D3 mortal wounds.";
const shootItems = (after: string): Item[] => [
  ["Each time this model is selected to shoot", "event", { kind: "selected", to: "shoot", subject: "this-model" }],
  ["you can use this ability", "optional-use", { who: "you" }],
  ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
  ["each time this model makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
  ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
  [after, "event", { kind: "attacks-resolved" }],
  ["roll one D6", "dice-roll", { dice: "D6" }],
  ["on a 2+", "roll-result", { from: 2 }],
  ["this model suffers D3 mortal wounds", "mortal-wounds", { recipient: "this-model", count: "D3" }],
];

const stratagemText = "Fight phase, just after an enemy unit has selected its targets.\nOne FIXTURE unit from your army.\nUntil the attacking unit has finished making its attacks, each time an attack targets your unit, worsen the Armour Penetration characteristic of that attack by 1. At the end of the phase, you gain 1 Pain token.";
const stratagemItems: Item[] = [
  ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }, "WHEN"],
  ["just after an enemy unit has selected its targets", "event", { kind: "enemy-selected-targets" }, "WHEN"],
  ["One", "stratagem-target", { count: "one" }, "TARGET"],
  ["FIXTURE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }, "TARGET"],
  ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
  ["Until the attacking unit has finished making its attacks", "duration", { endpoint: "end-of-attack-sequence" }, "EFFECT"],
  ["each time an attack targets your unit", "attack", { direction: "targeted", unit: "that-unit", attack_type: "any" }, "EFFECT"],
  ["worsen the Armour Penetration characteristic of that attack by 1", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "worsen", value: 1, weapon_type: "all" }, "EFFECT"],
  ["At the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }, "EFFECT"],
  ["you gain 1 Pain token", "resource-gain", { pool: "pain-token-pool", amount: 1 }, "EFFECT"],
];

describe("a later moment that ends what the earlier part began", () => {
  it("nests \"after resolving those attacks\" in the shooting the ability was used for", () => {
    const result = compileLeaves(placed(shootText, ...shootItems("After resolving those attacks")), shootText);
    expectCompiled(result);
    const entry = result.mechanics.effect as Record<string, any>;
    expect(entry).toMatchObject({ type: "ability-part", trigger: { event: "selected", filter: { to: "shoot" }, optional: true } });
    // The phase-long Wound change is the part's own, with no inner lifetime of its own.
    expect(entry.effect.steps[0]).toEqual({ type: "roll-modifier", target: "this-model", modifier: { roll: "wound", operation: "add", value: 1 } });
    expect(entry.effect.steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "attacks-resolved" }, duration: "phase", effect: { type: "dice-gated" } });
  });

  it("keeps an attacks-resolved moment that names no earlier attacks as a part of its own", () => {
    const text = shootText.replace("After resolving those attacks", "After resolving its attacks");
    const result = compileLeaves(placed(text, ...shootItems("After resolving its attacks")), text);
    expectCompiled(result);
    const steps = (result.mechanics.effect as Record<string, any>).steps as Array<Record<string, any>>;
    expect(steps.map((step) => step.trigger?.event)).toEqual(["selected", "attacks-resolved"]);
  });

  it("keeps a part whose other moment ends nothing the earlier part began as a part of its own", () => {
    const text = shootText.replace("After resolving those attacks,", "After resolving those attacks, or when this model ends a move,");
    const items = shootItems("After resolving those attacks").flatMap((item): Item[] => item[0] === "After resolving those attacks"
      ? [item, ["when this model ends a move", "event", { kind: "move-ended", subject: "this-model" }]] : [item]);
    const result = compileLeaves(placed(text, ...items), text);
    expectCompiled(result);
    const steps = (result.mechanics.effect as Record<string, any>).steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    expect(steps[1]!.trigger).toHaveLength(2);
  });

  it("leaves \"those attacks\" a part of its own when no moment before it began them", () => {
    const text = "until the end of the phase, each time this model makes an attack, add 1 to the Wound roll. After resolving those attacks, roll one D6: on a 2+, this model suffers D3 mortal wounds.";
    const result = compileLeaves(placed(text, ...shootItems("After resolving those attacks").slice(2)), text);
    expectCompiled(result);
    const steps = (result.mechanics.effect as Record<string, any>).steps as Array<Record<string, any>>;
    expect(steps.map((step) => step.type)).toEqual(["roll-modifier", "ability-part"]);
  });

  it("nests a Stratagem's \"at the end of the phase\" in its use, with a shorter duration bounding the earlier effects alone", () => {
    const result = compileLeaves(placed(stratagemText, ...stratagemItems), stratagemText);
    expectCompiled(result);
    expect(result.mechanics.scope).toEqual({ duration: "phase" });
    const entry = result.mechanics.effect as Record<string, any>;
    expect(entry).toMatchObject({ type: "ability-part", trigger: { event: "targets-selected", subject: { owner: "enemy" } } });
    expect(entry.effect.steps).toEqual([
      { type: "ability-part", duration: "attack-sequence", effect: expect.objectContaining({ type: "stat-modifier", modifier: expect.objectContaining({ stat: "AP" }) }) },
      { type: "ability-part", trigger: { event: "phase-ended" }, duration: "phase", effect: { type: "resource-gain", target: "this-model", modifier: { pool: "pain-token-pool", amount: 1 } } },
    ]);
  });
});

describe("an \"instead\" under a later moment", () => {
  it("refuses replacing a standing effect for a later part's lifetime", () => {
    const text = "Add 1 to the Attacks characteristic of this model's melee weapons. Each time this unit is selected to fight, until the end of the phase, add 2 to the Attacks characteristic of this model's melee weapons instead.";
    const refused = compileLeaves(placed(text,
      ["Add 1 to the Attacks characteristic of this model's melee weapons", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 1, weapon_type: "melee" }],
      ["Each time this unit is selected to fight", "event", { kind: "selected", to: "fight" }],
      ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["add 2 to the Attacks characteristic of this model's melee weapons", "characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 2, weapon_type: "melee" }],
      ["instead", "instead", {}],
    ), text);
    expectRefused(refused);
    expect(refused.errors.join(" ")).toMatch(/under a later moment replaces a standing effect/u);
  });
});
