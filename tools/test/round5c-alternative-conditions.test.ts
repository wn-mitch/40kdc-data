import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { foldAlternativeConditions } from "../src/round5c/compile-alternative-conditions.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

/** Leaves placed on their own wording in `text`, in order, so the words between them are real source. */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const onObjective = (subject: string) => ({ kind: "objective-range", controlled_by: "any", subject, negated: false });
const conditionOf = (text: string, leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return JSON.stringify(result.mechanics);
};

describe("alternative conditions", () => {
  const list = "In your Shooting phase, if any of the following apply, this unit’s ranged attacks have +1 **AP**:\rThis unit is within range of an **objective**.\rThe target of that attack is within range of an **objective**.";
  const listLeaves = () => placed(list,
    ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["this unit’s ranged attacks have", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }],
    ["+1 **AP", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1 }],
    ["This unit is within range of an **objective", "unit-position", onObjective("this-unit")],
    ["The target of that attack is within range of an **objective", "unit-position", onObjective("target")]);

  it("makes each line after \"if any of the following apply:\" one alternative", () => {
    const mechanics = conditionOf(list, listLeaves());
    expect(mechanics).toContain('"operator":"or"');
    expect(mechanics).toMatch(/"operator":"or","operands":\[\{"type":"within".*"subject":"defender"/u);
  });

  it("keeps two conditions on one list line together", () => {
    const text = "If any of the following apply, add 1 to the Hit roll:\rThis unit is within range of an **objective** and is below its Starting Strength.\rThe target is within range of an **objective**.";
    const folded = foldAlternativeConditions(placed(text,
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["This unit is within range of an **objective", "unit-position", onObjective("this-unit")],
      ["is below its Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "this-unit", negated: false }],
      ["The target is within range of an **objective", "unit-position", onObjective("target")]), text);
    const anyOf = folded.find((leaf) => leaf.family_id === "__any-of")!;
    expect((anyOf.parameters.alternatives as CompileLeaf[][]).map((line) => line.length)).toEqual([2, 1]);
  });

  it("joins conditions written with \"or\" between them", () => {
    const text = "Each time this unit makes an attack that targets a unit within range of an objective marker or below its Starting Strength, add 1 to the Hit roll.";
    const mechanics = conditionOf(text, placed(text,
      ["makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["within range of an objective marker", "unit-position", onObjective("target")],
      ["below its Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "target", negated: false }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]));
    expect(mechanics).toContain('"operator":"or"');
  });

  it("leaves conditions joined by \"and\", and lists that are not conditional, alone", () => {
    const and = "If this unit is within range of an objective marker and below its Starting Strength, add 1 to the Hit roll.";
    const andLeaves = placed(and,
      ["this unit is within range of an objective marker", "unit-position", onObjective("this-unit")],
      ["below its Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "this-unit", negated: false }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(foldAlternativeConditions(andLeaves, and)).toEqual(andLeaves);
    const menu = "This unit gains one or more of the following abilities:\rThis unit is within range of an **objective**.\rThe target is within range of an **objective**.";
    const menuLeaves = placed(menu,
      ["This unit is within range of an **objective", "unit-position", onObjective("this-unit")],
      ["The target is within range of an **objective", "unit-position", onObjective("target")]);
    expect(foldAlternativeConditions(menuLeaves, menu)).toEqual(menuLeaves);
  });

  it("refuses a conditional list that holds an effect, rather than guessing which lines are alternatives", () => {
    const text = "If any of the following apply:\rThis unit is within range of an **objective**.\rAdd 1 to the Hit roll.";
    expect(() => foldAlternativeConditions(placed(text,
      ["This unit is within range of an **objective", "unit-position", onObjective("this-unit")],
      ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text)).toThrow(/not a condition/u);
  });
});
