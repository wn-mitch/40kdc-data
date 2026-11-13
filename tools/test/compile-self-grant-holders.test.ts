import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// "X units from your army have the following ability: …" where the ability is the record itself.
// Wording is fabricated.

const TEXT = "**GLOOM WARDENS** units from your army have the following ability:\n**Shade Rush**: Each time this unit ends a Charge move, until the end of the turn, each time a model in this unit makes an attack, you can re-roll the Hit roll.";
const leaves = (ability: string, filter: Record<string, unknown> = { side: "friendly", keywords: ["GLOOM WARDENS"] }) => placed(TEXT,
  ["GLOOM WARDENS** units", "unit-filter", filter],
  ["from your army", "unit-owner", { owner: "friendly" }],
  ["the following ability", "ability-record-grant", { subject: "antecedent", ability }],
  ["Each time this unit ends a Charge move", "event", { kind: "move-ended", move_types: ["charge"] }],
  ["until the end of the turn", "duration", { endpoint: "end-of-turn" }],
  ["each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
  ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }],
);

describe("a record that grants itself to a keyword filter", () => {
  it("holds only for the units it is granted to", () => {
    const result = compileLeaves(leaves("shade-rush-fixture"), TEXT, { abilityId: "shade-rush-fixture" });
    expectCompiled(result);
    expect(result.mechanics.applies_to).toEqual({ all_of: ["GLOOM WARDENS"] });
  });

  it("names no holders when the grant is of another record", () => {
    const result = compileLeaves(leaves("other-record"), TEXT, { abilityId: "shade-rush-fixture" });
    expectCompiled(result);
    expect(result.mechanics.applies_to).toBeUndefined();
  });
});
