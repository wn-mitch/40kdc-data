import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording only. Range is a weapon characteristic, so a weapon-property scope binds it
// the way it binds Attacks or Strength (the scope's weapon type and recipient go onto the stat).
// characteristic-set cannot name Range (its CHARACTERISTICS list omits it), so Range reaches the
// compiler only through characteristic-modifier.

type Piece = [phrase: string, role: string, family: string, parameters: Record<string, unknown>];

/** Leaves at the byte offsets of their phrases, in order, as the workbench stores them. */
function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, role, family_id, parameters]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at), "utf8");
    return {
      role: familyRole(family_id, currentFamilyVersion(family_id)), family_id, family_version: currentFamilyVersion(family_id), parameters,
      start_byte, end_byte: start_byte + Buffer.byteLength(phrase, "utf8"), fragment: "RAW_TEXT",
    };
  });
}

const run = (text: string, pieces: Piece[]) => compileLeaves(leavesIn(text, pieces), text);
const errorsOf = (text: string, pieces: Piece[]) => {
  const result = run(text, pieces);
  return result.ok ? [] : result.errors;
};
const scopeRanged: Piece = ["Ranged attacks", "CONDITION", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }];

describe("Semantic authoring Range under a weapon-property scope", () => {
  it("binds a Range modifier to the scope's weapon type and recipient", () => {
    const text = "Ranged attacks: +6 Range.";
    const result = run(text, [scopeRanged, ["+6 Range", "EFFECT", "characteristic-modifier", { characteristics: ["Range"], operation: "improve", value: 6 }]]);
    expect(result.ok).toBe(true);
    const json = JSON.stringify((result as { mechanics: unknown }).mechanics);
    expect(json).toContain('"stat":"Range"');
    expect(json).toContain('"weapons":{"type":"ranged"}');
    expect(json).toContain('"value":6');
  });

  it("keeps refusing a model characteristic under a weapon scope", () => {
    const text = "Ranged attacks: +1 T.";
    expect(errorsOf(text, [scopeRanged, ["+1 T", "EFFECT", "characteristic-modifier", { characteristics: ["T"], operation: "improve", value: 1 }]]))
      .toContain("An attack-property scope cannot modify a model characteristic.");
  });

  it("refuses a model characteristic beside Range in one modifier", () => {
    const text = "Ranged attacks: +1 T and Range.";
    expect(errorsOf(text, [scopeRanged, ["+1 T and Range", "EFFECT", "characteristic-modifier", { characteristics: ["T", "Range"], operation: "improve", value: 1 }]]))
      .toContain("An attack-property scope cannot modify a model characteristic.");
  });

  it("binds a Range modifier through the stat-first hoist of an open scope", () => {
    const text = "Ranged weapons equipped by non-CHARACTER models in this unit have +6 Range.";
    const result = run(text, [
      ["Ranged weapons equipped by", "CONDITION", "weapon-property-scope", { subject: "antecedent", weapon_type: "ranged" }],
      ["non-CHARACTER models", "CONDITION", "unit-filter", { side: "friendly", excluded_keywords: ["CHARACTER"], level: "model" }],
      ["in this unit", "CONDITION", "membership", { relation: "in", of: "this-unit" }],
      ["have +6 Range", "EFFECT", "characteristic-modifier", { characteristics: ["Range"], operation: "improve", value: 6 }],
    ]);
    expect(result.ok ? [] : (result as { errors: string[] }).errors).toEqual([]);
    const json = JSON.stringify((result as { mechanics: unknown }).mechanics);
    expect(json).toContain('"stat":"Range"');
    expect(json).toContain('"member_of":"this-unit"');
  });

  it("refuses a characteristic-set on Range, so a set cannot reach the Range scope path", () => {
    const version = currentFamilyVersion("characteristic-set");
    expect(() => normalizeFingerprintParameters("characteristic-set", { subject: "this-unit", characteristic: "Range", value: 6 }, version)).toThrow();
  });
});
