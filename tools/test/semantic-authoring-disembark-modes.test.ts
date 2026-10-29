import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
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

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-disembark", name: "Sprite Drop" });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

describe("disembark modes", () => {
  it("a shock disembark move by the units embarked within this unit", () => {
    const text = "When this unit ends an advance move, units embarked within this unit can make a shock disembark move.";
    const mechanics = mechanicsOf(text,
      ["this unit ends an advance move", "event", { kind: "move-ended", move_types: ["advance"] }],
      ["units embarked within this unit", "unit-filter", { side: "friendly", embarked_in: "this-unit" }],
      ["can make a shock disembark move", "make-move", { subject: "filtered-units", move_type: "disembark", mode: "shock" }]);
    expect(JSON.stringify(mechanics.effect)).toContain('"mode":"shock"');
    expect(mechanics.effect.modifier ?? mechanics.effect.effect?.modifier).toMatchObject({ move_type: "disembark", mode: "shock" });
  });

  it("a unit selected to make a disembark move of a named mode carries the mode on the trigger", () => {
    const text = "When a friendly FABLED SPRITE unit is selected to make a tactical disembark move from this unit, this unit suffers 1 mortal wound.";
    const mechanics = mechanicsOf(text,
      ["friendly FABLED SPRITE unit", "unit-filter", { side: "friendly", keywords: ["FABLED SPRITE"], embarked_in: "this-unit" }],
      ["is selected to make a tactical disembark move from this unit", "event", { kind: "selected", to: "move", move_types: ["disembark"], mode: "tactical" }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }]);
    expect(mechanics.trigger.filter).toMatchObject({ to: "move", move_types: ["disembark"], mode: "tactical" });
  });

  it("refuses a mode on any moment but a selected-to-disembark one", () => {
    const version = currentFamilyVersion("event");
    expect(() => normalizeFingerprintParameters("event", { kind: "selected", to: "move", move_types: ["advance"], mode: "tactical" }, version)).toThrow(/move_types \[disembark\]/u);
    expect(() => normalizeFingerprintParameters("event", { kind: "move-ended", move_types: ["disembark"], mode: "tactical" }, version)).toThrow(/kind selected/u);
    expect(() => normalizeFingerprintParameters("make-move", { subject: "this-unit", move_type: "normal", mode: "shock" }, currentFamilyVersion("make-move"))).toThrow(/needs move_type disembark/u);
  });

  it("a disembark permission despite the Transport having Advanced reads as the Transport's move, not the unit's", () => {
    const text = "This unit can disembark from a TRANSPORT after it has Advanced.";
    const mechanics = mechanicsOf(text, ["This unit can disembark from a TRANSPORT after it has Advanced", "eligibility-permission", { subject: "this-unit", activity: "disembark", allow: true, despite: ["transport-advanced"] }]);
    expect(mechanics.effect.modifier.despite).toEqual(["transport-advanced"]);
    expect(describeAbility(mechanics as never)).toContain("eligible to disembark even if its Transport Advanced this turn");
    const version = currentFamilyVersion("eligibility-permission");
    expect(() => normalizeFingerprintParameters("eligibility-permission", { subject: "this-unit", activity: "declare-charge", allow: true, despite: ["transport-advanced"] }, version)).toThrow(/only to activity: disembark/u);
  });
});
