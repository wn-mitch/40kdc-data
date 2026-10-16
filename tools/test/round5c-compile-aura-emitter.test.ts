import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";

type Node = Record<string, unknown>;

let offset = 0;
function leaf(role: string, family_id: string, parameters: Record<string, unknown>, family_version: number, fragment: string): CompileLeaf {
  offset += 10;
  return { role, family_id, family_version, parameters, fragment, start_byte: offset };
}

function compiled(leaves: CompileLeaf[]): Node {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Node;
}

describe("Round 5C aura-emitter compiler", () => {
  it("keeps consumable option auras disjoint for Titanic's conditional radius", () => {
    const effect = compiled([
      leaf("EFFECT", "stance-select-open", { scope: "army", mode: "consumable" }, 1, "A"),
      leaf("EVENT", "named-option", { label: "Rite Alpha" }, 3, "B"),
      leaf("CONDITION", "aura-emitter", { side: "friendly", keywords: ["WORLD EATERS"], any_keywords: ["MONSTER", "TITANIC"] }, 1, "B"),
      leaf("CONDITION", "unit-filter", { side: "friendly", any_keywords: ["JAKHALS", "GOREMONGERS"] }, 16, "B"),
      leaf("CONDITION", "aura-range", { inches: 6, conditional_range: { inches: 9, keywords: ["TITANIC"] } }, 4, "B"),
      leaf("CONDITION", "unit-keyword", { keywords: ["TITANIC"], subject: "this-model" }, 1, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-unit" }, 1, "B"),
      leaf("EVENT", "named-option", { label: "Rite Beta" }, 3, "C"),
      leaf("CONDITION", "aura-emitter", { side: "friendly", keywords: ["WORLD EATERS"], any_keywords: ["MONSTER", "TITANIC"] }, 1, "C"),
      leaf("CONDITION", "unit-filter", { side: "friendly", any_keywords: ["JAKHALS", "GOREMONGERS"] }, 16, "C"),
      leaf("CONDITION", "aura-range", { inches: 6, conditional_range: { inches: 9, keywords: ["TITANIC"] } }, 4, "C"),
      leaf("CONDITION", "unit-keyword", { keywords: ["TITANIC"], subject: "this-model" }, 1, "C"),
      leaf("EFFECT", "fights-first", { subject: "this-unit" }, 1, "C"),
    ]);
    expect(effect.type).toBe("stance-select");
    const options = effect.options as Node[];
    expect(options).toHaveLength(2);
    for (const option of options) {
      const optionEffect = option.effect as Node;
      expect(optionEffect.type).toBe("sequence");
      const steps = optionEffect.steps as Node[];
      expect(steps.map((step) => step.type)).toEqual(["aura", "aura"]);
      expect((steps[0]!.modifier as Node).range).toEqual({ inches: 6 });
      expect((steps[1]!.modifier as Node).range).toEqual({ inches: 9 });
      expect((steps[0]!.modifier as Node).emitter_filter).toMatchObject({
        owner: "friendly", all_of: ["WORLD EATERS"], any_of: ["MONSTER", "TITANIC"], none_of: ["TITANIC"],
      });
      expect((steps[1]!.modifier as Node).emitter_filter).toMatchObject({
        owner: "friendly", all_of: ["WORLD EATERS", "TITANIC"], any_of: ["MONSTER", "TITANIC"],
      });
    }
  });
});
