import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { expectCompiled, placed, type Item } from "./semantic-authoring-connective-fixture.js";

// An attack allocated to a model in the unit a selection picked. Wording is fabricated.

const text = "In your Command phase, select one friendly FIXTURE unit within 6\" of this model. Until the start of your next Command phase, each time an attack is allocated to a model in that unit, subtract 1 from the Damage characteristic of that attack.";
const items = (object: string | undefined): Item[] => [
  ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
  ["select one", "select-unit", { distance: "any", visible: false }],
  ["friendly FIXTURE unit", "unit-filter", { side: "friendly", keywords: ["FIXTURE"] }],
  ["within 6\" of this model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "selected-unit", negated: false }],
  ["Until the start of your next Command phase", "duration", { endpoint: "start-of-next-command-phase" }],
  ["each time an attack is allocated to a model in that unit", "event", { kind: "damage-allocated", ...(object === undefined ? {} : { object }) }],
  ["subtract 1 from the Damage characteristic of that attack", "characteristic-modifier", { subject: "attack", characteristics: ["D"], operation: "subtract", value: 1, weapon_type: "all" }],
];

describe("an attack allocated to the selected unit", () => {
  it("waits inside the selection for attacks allocated to that unit and reduces that unit's damage", () => {
    const result = compileLeaves(placed(text, ...items("selected-unit")), text);
    expectCompiled(result);
    const selection = (result.mechanics.effect as Record<string, any>).effect;
    expect(selection.type).toBe("select-units");
    expect(selection.effect).toEqual({
      type: "ability-part",
      trigger: { event: "damage-allocated", object: "selected-unit" },
      effect: { type: "damage-reduction", target: "selected-unit", modifier: { reduction: 1 } },
    });
  });

  it("keeps an allocation with no object on this unit", () => {
    const result = compileLeaves(placed(text, ...items(undefined)), text);
    expectCompiled(result);
    const part = (result.mechanics.effect as Record<string, any>).effect.effect;
    expect(part).toMatchObject({ trigger: { event: "damage-allocated" }, effect: { type: "damage-reduction", target: "this-unit" } });
    expect(part.trigger.object).toBeUndefined();
  });

  it("names the selected unit as an object on a damage-allocated moment only, from version 38", () => {
    expect(normalizeFingerprintParameters("event", { kind: "damage-allocated", object: "selected-unit" }, 38)).toEqual({ kind: "damage-allocated", object: "selected-unit" });
    expect(() => normalizeFingerprintParameters("event", { kind: "damage-allocated", object: "selected-unit" }, 37)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "model-destroyed", object: "selected-unit" }, 38)).toThrow(/damage-allocated/u);
  });
});
