import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

/*
 * Fabricated wording. A rule with a moment of its own, then a bold heading over a block that is a
 * rule of its own: an option-gated bonus that shortens enemy moves, or an optional selection.
 */

type Piece = [phrase: string, family: string, parameters: Record<string, unknown>];

function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, family_id, parameters]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at));
    const family_version = currentFamilyVersion(family_id);
    return {
      role: familyRole(family_id, family_version), family_id, family_version,
      parameters: normalizeFingerprintParameters(family_id, parameters, family_version),
      start_byte, end_byte: start_byte + Buffer.byteLength(phrase), fragment: "RAW_TEXT",
    };
  });
}

type Node = Record<string, unknown>;
function compiled(text: string, pieces: Piece[]): Node {
  const result = compileLeaves(leavesIn(text, pieces), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Node;
}

const GATE: Piece = ["Drill One", "rule-active", { rule: { ability_id: "fabricated-drills", option_id: "drill-one" } }];

describe("A shortened move of the enemy units an earlier filter names", () => {
  const text = "Friendly ALPHA units can re-roll charge rolls.\r**Drill One**\r**Additional Effect:** When an enemy unit engaged with your unit makes a pile-in move, -2\" from that pile-in move.";
  const pieces: Piece[] = [
    ["Friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["can re-roll charge rolls", "reroll", { roll: "charge", subset: "all", weapon_type: "all" }],
    GATE,
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["engaged with your unit", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "this-unit" }],
    ["makes a pile-in move, -2\" from that pile-in move", "move-distance", { subject: "antecedent", move_types: ["pile-in"], bonus: -2 }],
  ];

  it("subtracts from those units' moves, each while it is engaged with this unit", () => {
    const shortened = JSON.stringify(compiled(text, pieces));
    expect(shortened).toContain("\"type\":\"move-modifier\",\"target\":{\"owner\":\"enemy\"}");
    expect(shortened).toContain("\"distance_bonus\":-2");
    expect(shortened).toContain("\"engaged_with\":\"this-unit\"");
  });

  it("refuses a bonus of zero", () => {
    expect(() => normalizeFingerprintParameters("move-distance", { subject: "this-unit", move_types: ["pile-in"], bonus: 0 }, 3)).toThrow(/1 to 24/u);
  });
});

describe("A bold heading after a rule with its own moment", () => {
  const head = "When a friendly ALPHA unit is selected to fight, that unit's attacks can:\rRe-roll hit rolls of 1.\rRe-roll wound rolls of 1.";
  const block = "**Additional Effect:** You can select one enemy unit and roll one D6:\rOn a 1-3, that enemy unit suffers 1 mortal wound.\rOn a 4-6, that enemy unit suffers D3 mortal wounds.";
  const lead: Piece[] = [
    ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["selected to fight", "event", { kind: "selected", to: "fight" }],
    ["Re-roll hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
    ["Re-roll wound rolls of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
  ];
  const rest: Piece[] = [
    ["You can", "optional-use", { who: "you" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["enemy unit", "unit-filter", { side: "enemy" }],
    ["roll one D6", "dice-roll", { dice: "D6" }],
    ["On a 1-3", "roll-result", { from: 1, to: 3 }],
    ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
    ["On a 4-6", "roll-result", { from: 4, to: 6 }],
    ["that enemy unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
  ];

  it("starts a block that neither fires at that moment nor loses its own \"you can\"", () => {
    const text = [head, "**Favoured Drill**", "**Drill One**", block].join("\r");
    const [first, second] = (compiled(text, [...lead, GATE, ...rest]).effect as Node).steps as Node[];
    expect((first!.trigger as Node).event).toBe("selected");
    expect(second!.type).toBe("ability-part");
    expect(second!.trigger).toBeUndefined();
    expect(second!.optional).toBe(true);
  });

  it("keeps the whole record at that moment without a heading", () => {
    const text = [head, block].join("\r");
    const mechanics = compiled(text, [...lead, ...rest]);
    expect((mechanics.trigger as Node).event).toBe("selected");
    expect((mechanics.effect as Node).type).toBe("select-units");
  });
});
