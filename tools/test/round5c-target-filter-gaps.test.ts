import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

// Fabricated wording only. The compiler reads the punctuation and joining words between leaves,
// so each shape keeps the structure of a record with invented words.

type Piece = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
}

function mechanicsOf(text: string, pieces: Piece[]): Record<string, any> {
  const result = compileLeaves(placed(text, pieces), text);
  if (!result.ok) throw new Error(`expected a compiled record, got: ${result.errors.join(" | ")}`);
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, pieces: Piece[]): string[] {
  const result = compileLeaves(placed(text, pieces), text);
  return result.ok ? [] : result.errors;
}

const keyword = (word: string): Record<string, unknown> => ({ keywords: [word], subject: "this-unit", negated: false });
const damage: Record<string, unknown> = { subject: "attack", characteristics: ["D"], operation: "add", value: 1, weapon_type: "all" };
const has = (word: string) => ({ type: "has-keyword", parameters: { all_of: [word] } });
const defenderHas = (words: string[]) => ({ type: "has-keyword", parameters: { subject: "defender", any_of: words } });

describe("an attack-target filter after a condition names the target the attack named (compile-unit-filters.ts)", () => {
  const text = "Until the end of the phase, each time an attack made by a model in your unit is allocated to an enemy model, if your unit has the ALPHA keyword and that enemy model is not a BETA or GAMMA, add 1 to the Damage characteristic of that attack. If your unit has the DELTA keyword and that enemy model is a BETA or GAMMA, add 1 to the Damage characteristic of that attack instead.";
  const pieces: Piece[] = [
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["attack made by a model in your unit", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["enemy model", "unit-filter", { side: "enemy", level: "model" }],
    ["your unit has the ALPHA keyword", "unit-keyword", keyword("ALPHA")],
    ["that enemy model is not a BETA or GAMMA", "unit-filter", { side: "enemy", excluded_keywords: ["BETA", "GAMMA"], level: "model" }],
    ["add 1 to the Damage characteristic of that attack", "characteristic-modifier", damage],
    ["your unit has the DELTA keyword", "unit-keyword", keyword("DELTA")],
    ["that enemy model is a BETA or GAMMA", "unit-filter", { side: "enemy", any_keywords: ["BETA", "GAMMA"], level: "model" }],
    ["add 1 to the Damage characteristic of that attack", "characteristic-modifier", damage],
    ["instead", "instead", {}],
  ];

  it("gates each damage bonus on its own unit keyword and the defender's keywords", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Record<string, any>[];
    expect(steps).toHaveLength(2);
    expect(steps[1]!.condition).toEqual({ operator: "and", operands: [has("DELTA"), defenderHas(["BETA", "GAMMA"])] });
    expect(JSON.stringify(steps[0]!.condition)).toContain('"subject":"defender","all_of":["BETA"]');
  });

  it("does not let the first sentence's gate guard the instead sentence", () => {
    const steps = mechanicsOf(text, pieces).effect.steps as Record<string, any>[];
    expect(JSON.stringify(steps[1]!.condition)).not.toContain("ALPHA");
    expect(JSON.stringify(steps[0]!.condition)).toContain("ALPHA");
  });

  it("keeps the refusal when no attack names the target", () => {
    const bare = "If your unit has the ALPHA keyword and that enemy model is a BETA, add 1 to the Damage characteristic of this unit.";
    const errors = errorsOf(bare, [
      ["your unit has the ALPHA keyword", "unit-keyword", keyword("ALPHA")],
      ["that enemy model is a BETA", "unit-filter", { side: "enemy", keywords: ["BETA"], level: "model" }],
      ["add 1 to the Damage characteristic of this unit", "characteristic-modifier", { ...damage, subject: "this-unit" }],
    ]);
    expect(errors.join(" ")).toContain("A unit-filter needs a select-unit or attack right before it");
  });

  it("keeps the refusal when the filter names the other side than the attack's target", () => {
    const wrongSide = pieces.map((piece): Piece => piece[0] === "that enemy model is a BETA or GAMMA" ? [piece[0], piece[1], { ...piece[2], side: "friendly" }] : piece);
    expect(errorsOf(text, wrongSide).join(" ")).toContain("A unit-filter needs a select-unit or attack right before it");
  });
});
