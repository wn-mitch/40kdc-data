import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

// Fabricated wording only. The compiler reads the punctuation and joining words between leaves,
// so each shape keeps the structure of a record with invented words.

type Piece = [wording: string, family: string, parameters: Record<string, unknown>];

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanicsOf(text: string, pieces: Piece[]): Record<string, any> {
  const result = compileLeaves(placed(text, pieces), text);
  if (!result.ok) throw new Error(`expected a compiled record, got: ${result.errors.join(" | ")}`);
  return result.mechanics;
}

function errorsOf(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(placed(text, pieces), text);
  return result.ok ? [] : result.errors;
}

const stat = (characteristic: string, value: number): Record<string, unknown> => ({ subject: "this-unit", characteristics: [characteristic], operation: "add", value });
const keyword = (word: string, subject = "this-unit"): Record<string, unknown> => ({ keywords: [word], subject, negated: false });
const hasKeyword = (word: string) => ({ type: "has-keyword", parameters: { all_of: [word] } });
const notShocked = { operator: "not", operands: [{ type: "unit-state", parameters: { state: "battle-shocked" } }] };
const shockedState: Record<string, unknown> = { states: ["battle-shocked"], subject: "this-unit", negated: true };

describe("an If-led sentence gates its own sentence only (compile-instead-scope.ts sentenceIfGates)", () => {
  it("scopes each If-led list item's condition to its own item", () => {
    const text = "While this unit is calm: If this unit has KEYA, this unit has +1 OC. If this unit has KEYB, this unit has +3 OC.";
    const mechanics = mechanicsOf(text, [
      ["While this unit is calm", "unit-state", shockedState],
      ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
      ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
      ["If this unit has KEYB", "unit-keyword", keyword("KEYB")],
      ["this unit has +3 OC", "characteristic-modifier", stat("OC", 3)],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: notShocked, effect: { type: "sequence", steps: [
      { type: "conditional", condition: hasKeyword("KEYA"), effect: { type: "stat-modifier", modifier: { value: 1 } } },
      { type: "conditional", condition: hasKeyword("KEYB"), effect: { type: "stat-modifier", modifier: { value: 3 } } },
    ] } });
  });

  it("stops an If-led condition at its sentence when a later sentence opens a moment", () => {
    const text = "At the start of the phase. If it is a KEYA unit, it has +1 OC. When this unit is set up, if it is a KEYB unit it has +2 OC.";
    const mechanics = mechanicsOf(text, [
      ["At the start of the phase", "event", { kind: "phase-start", phase: "any" }],
      ["If it is a KEYA unit", "unit-keyword", keyword("KEYA", "antecedent")],
      ["it has +1 OC", "characteristic-modifier", stat("OC", 1)],
      ["When this unit is set up", "event", { kind: "set-up" }],
      ["if it is a KEYB unit", "unit-keyword", keyword("KEYB", "antecedent")],
      ["it has +2 OC", "characteristic-modifier", stat("OC", 2)],
    ]);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps[0]).toMatchObject({ type: "ability-part", effect: { type: "conditional", condition: hasKeyword("KEYA") } });
    expect(steps[1]).toMatchObject({ type: "ability-part", trigger: { event: "set-up" }, effect: { type: "conditional", condition: hasKeyword("KEYB") } });
  });

  it("keeps the ability-wide gate when the next sentence only continues the first", () => {
    const text = "If this unit has KEYA, this unit has +1 OC. This unit has +3 M.";
    const mechanics = mechanicsOf(text, [
      ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
      ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
      ["This unit has +3 M", "characteristic-modifier", stat("M", 3)],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA"), effect: { type: "sequence" } });
  });

  it("keeps the gate on a colon-introduced list", () => {
    const text = "If this unit has KEYA, this unit gets these:\n■ If this unit has KEYB, this unit has +1 OC.";
    const mechanics = mechanicsOf(text, [
      ["If this unit has KEYA", "unit-keyword", keyword("KEYA")],
      ["this unit gets these", "characteristic-modifier", stat("OC", 2)],
      ["If this unit has KEYB", "unit-keyword", keyword("KEYB")],
      ["this unit has +1 OC", "characteristic-modifier", stat("OC", 1)],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: hasKeyword("KEYA") });
  });
});
