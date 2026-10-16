import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

type Node = Record<string, any>;

function leaf(familyId: string, parameters: Record<string, unknown>, familyVersion = currentFamilyVersion(familyId)): CompileLeaf {
  return { role: familyRole(familyId, familyVersion), family_id: familyId, family_version: familyVersion, parameters, start_byte: 0 };
}

function inSentences(sentences: Array<Array<[CompileLeaf, string]>>): { leaves: CompileLeaf[]; sourceText: string } {
  const leaves: CompileLeaf[] = [];
  let sourceText = "";
  for (const sentence of sentences) {
    sentence.forEach(([item, text], index) => {
      if (index > 0) sourceText += " ";
      const start = Buffer.byteLength(sourceText);
      sourceText += text;
      leaves.push({ ...item, start_byte: start, end_byte: start + Buffer.byteLength(text) });
    });
    sourceText += ". ";
  }
  return { leaves, sourceText };
}

function moveModifiers(node: unknown, found: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) moveModifiers(item, found);
    return found;
  }
  if (node === null || typeof node !== "object") return found;
  const value = node as Node;
  if (value.type === "move-modifier") found.push(value);
  for (const child of Object.values(value)) moveModifiers(child, found);
  return found;
}

describe("selected Advance move-end restrictions", () => {
  it("binds the strict endpoint to the selected Advance without creating a move", () => {
    const { leaves, sourceText } = inSentences([
      [[leaf("event", { kind: "selected", move_types: ["advance"], to: "move" }, 29), "when this unit is selected to make an Advance move"]],
      [[leaf("move-distance", { subject: "this-unit", move_types: ["advance"], maximum: "unlimited" }, 2), "that Advance has no maximum distance"]],
      [[leaf("move-through", { subject: "this-unit", passthrough: "models" }, 4), "this unit can move through all types of model"]],
      [
        [leaf("move-must-end", { match: "all" }, 4), "after moving this unit must be"],
        [
          leaf("unit-position", { kind: "beyond", inches: 8, of: "matching-unit", subject: "this-unit", negated: false, of_side: "enemy" }, 25),
          "more than 8 inches horizontally from all enemy units",
        ],
      ],
    ]);
    const result = compileLeaves(leaves, sourceText);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.mechanics.trigger).toEqual({ event: "selected", filter: { move_types: ["advance"], to: "move" } });
    const modifiers = moveModifiers(result.mechanics.effect).map((item) => item.modifier);
    expect(modifiers).toContainEqual({ applies_to_moves: ["advance"], maximum: "unlimited" });
    expect(modifiers).toContainEqual({ passthrough: ["models"] });

    const endpoint = modifiers.find((modifier) => modifier.ends_when !== undefined);
    expect(endpoint).toMatchObject({
      applies_to_moves: ["advance"],
      ends_when: {
        operator: "not",
        operands: [{ type: "matches", parameters: {
          filter: { within: { of: { owner: "enemy" }, range: { inches: 8 } } },
        } }],
      },
    });
    expect(endpoint.ends_when.operands[0].parameters.subject ?? "this-unit").toBe("this-unit");
    expect(moveModifiers(result.mechanics.effect).some((item) => item.type === "move")).toBe(false);
    expect(JSON.stringify(result.mechanics)).not.toContain("advanced-this-phase");
  });
});
