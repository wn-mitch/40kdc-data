import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording only.

type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEXT = "In your Shooting phase, select one enemy unit within 18\" of and visible to this model (excluding units with the Lone Operative ability that are not part of an Attached unit and are not within 12\" of this model) and roll one D6: on a 4+, that enemy unit suffers D3 mortal wounds.";
const PROTECTION: Item = ["excluding units with the Lone Operative ability that are not part of an Attached unit and are not within 12\" of this model", "unit-filter", { side: "enemy", lone_operative_protection: { inches: 12, of: "this-model" } }];
const items = (protection: Item): Item[] => [
  ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
  ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
  ["within 18\" of", "unit-position", { kind: "within", inches: 18, of: "this-model", subject: "antecedent", negated: false }],
  ["visible to this model", "visible", { subject: "antecedent", to: "this-model" }],
  protection,
  ["roll one D6", "dice-roll", { dice: "D6" }],
  ["on a 4+", "roll-result", { from: 4 }],
  ["that enemy unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }],
];

describe("Semantic authoring Lone Operative protection on a selection", () => {
  // Hunts: the clause had no leaf, and a fold that dropped any one of the three escapes (no Lone Operative,
  // attached, within range) would make Lone Operative units either always or never selectable.
  it("lets the selection take a unit without Lone Operative, an attached unit, or one within range", () => {
    const result = compileLeaves(placed(TEXT, ...items(PROTECTION)), TEXT);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const selector = ((result.mechanics.effect as Record<string, any>).effect).selector;
    expect(selector.eligibility.operands[1]).toEqual({
      operator: "or",
      operands: [
        { operator: "not", operands: [{ type: "matches", parameters: { subject: "selected-unit", filter: { has_ability: ["lone-operative"] } } }] },
        { type: "attachment", parameters: { subject: "selected-unit", role: "attached" } },
        { type: "matches", parameters: { subject: "selected-unit", filter: { within: { range: { inches: 12 }, of: "this-model" } } } },
      ],
    });
    expect(describeAbility(result.mechanics as never)).toContain("does not have the Lone Operative ability or the selected unit is an attached unit or the selected unit is within 12\" of this model");
  });

  it("refuses an exclusion for the other side", () => {
    const result = compileLeaves(placed(TEXT, ...items([PROTECTION[0], "unit-filter", { side: "friendly", lone_operative_protection: { inches: 12, of: "this-model" } }])), TEXT);
    expect(result.ok ? [] : result.errors).toContainEqual(expect.stringMatching(/different side/u));
  });

  it("refuses a protection on a model-level filter", () => {
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "enemy", level: "model", lone_operative_protection: { inches: 12, of: "this-model" } }, currentFamilyVersion("unit-filter"))).toThrow(/excludes units, not models/u);
  });
});
