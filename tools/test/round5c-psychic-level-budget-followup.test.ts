import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

// Fabricated wording only. Each case mirrors the leaf shape of one psychic-level record: a psyker
// level printed in the name (a NAME leaf), psychic heading costs in the body, and the body's effects.

function leaf(family: string, parameters: Record<string, unknown>, phrase: string, text: string, fragment = "RAW_TEXT"): CompileLeaf {
  const start = Buffer.byteLength(text.slice(0, text.indexOf(phrase)), "utf8");
  const version = currentFamilyVersion(family);
  return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: start + Buffer.byteLength(phrase, "utf8"), fragment };
}

/** The name leaf: "psyker level N" inside the record's name. */
function nameLeaf(name: string, level: number): CompileLeaf {
  const phrase = `psyker level ${level}`;
  return { ...leaf("characteristic-set", { subject: "this-model", characteristic: "psyker-level", value: level }, phrase, name, "NAME"), fragment: "NAME" };
}

describe("Round 5C psychic-level follow-up shapes (fabricated)", () => {
  it("compiles the two-cost shape with the name's psyker level (10444, 10535, 10568 mirror)", () => {
    const name = "Fabricated Warden (psyker level 3)";
    const text = "**Beta Ward (psychic level 2)**\nIn your Shooting phase, roll one D6 (psychic). On a 4+, this unit has +1 Sv.\n**Gamma Ward (psychic level 1)**\nIn your Fight phase, roll two D6 (psychic). On a 5+, this unit has +1 Ld.";
    const result = compileLeaves([
      nameLeaf(name, 3),
      leaf("psychic-level-cost", { level: 2 }, "psychic level 2", text),
      leaf("phase-window", { phase: "shooting", turn: "your" }, "In your Shooting phase", text),
      leaf("dice-roll", { dice: "D6", roll_var: "psychic" }, "roll one D6 (psychic)", text),
      leaf("roll-result", { from: 4, to: 6 }, "On a 4+", text),
      leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }, "this unit has +1 Sv", text),
      leaf("psychic-level-cost", { level: 1 }, "psychic level 1", text),
      leaf("phase-window", { phase: "fight", turn: "your" }, "In your Fight phase", text),
      leaf("dice-roll", { dice: "D6", roll_var: "psychic" }, "roll two D6 (psychic)", text),
      leaf("roll-result", { from: 5, to: 6 }, "On a 5+", text),
      leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["Ld"], operation: "improve", value: 1, weapon_type: "all" }, "this unit has +1 Ld", text),
    ], text, { name });
    expect(result.ok ? [] : (result as { errors: string[] }).errors).toEqual([]);
    const json = JSON.stringify((result as { mechanics: unknown }).mechanics);
    expect(json).toContain('"stat":"psyker-level"');
    expect(json).toContain('"value":3');
  });

  it("refuses the psychic cost shape when the name's psyker level leaf is present but the name is absent", () => {
    const name = "Fabricated Warden (psyker level 3)";
    const text = "**Beta Ward (psychic level 2)**\nIn your Shooting phase, this unit has +1 Sv.";
    const result = compileLeaves([nameLeaf(name, 3), leaf("psychic-level-cost", { level: 2 }, "psychic level 2", text)], text);
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/record's name/);
  });

  it("compiles the ranged Range shape with a one-cost heading and the name's psyker level (10472 mirror)", () => {
    const name = "Fabricated Sergeant (psyker level 1)";
    const text = "**Delta Hex (psychic level 1)**\nRoll one D6 (psychic). On a 4+, this unit's ranged attacks have +6 Range.";
    const scope = leaf("weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }, "this unit's ranged attacks", text);
    const result = compileLeaves([
      nameLeaf(name, 1),
      leaf("psychic-level-cost", { level: 1 }, "psychic level 1", text),
      leaf("dice-roll", { dice: "D6", roll_var: "psychic" }, "Roll one D6 (psychic)", text),
      leaf("roll-result", { from: 4, to: 6 }, "On a 4+", text),
      { ...scope, role: "CONDITION" },
      leaf("characteristic-modifier", { characteristics: ["Range"], operation: "improve", value: 6 }, "have +6 Range", text),
    ], text, { name });
    expect(result.ok ? [] : (result as { errors: string[] }).errors).toEqual([]);
    expect(JSON.stringify((result as { mechanics: unknown }).mechanics)).toContain('"stat":"Range"');
  });
});
