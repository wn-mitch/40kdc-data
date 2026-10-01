import { describe, expect, it } from "vitest";
import { compileLeaves, leafFragment, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";
import { mapToLatest } from "../src/round5c/family-versions.js";
import { prefillFromSource } from "../src/round5c/leaf-prefill.js";
import { leafSurfaceKey, normalizedProjection } from "../src/round5c/matching.js";
import { matchesAt } from "../src/round5c/retrieval.js";

const family = REVIEWED_FAMILY_REGISTRY.find((item) => item.id === "characteristic-modifier" && !item.deprecated)!;
function adjustment(parameters: Record<string, unknown>): CompileLeaf {
  return { role: "EFFECT", family_id: family.id, family_version: family.version, parameters, start_byte: 0 };
}

// Fabricated notation fixtures; no ability prose.
describe("signed stat adjustments", () => {
  it.each([
    ["+2A", "A", "improve", 2], ["+2 A", "A", "improve", 2], ["+3 **S**", "S", "improve", 3],
    ["−2BS", "BS", "worsen", 2], ["-2 BS", "BS", "worsen", 2], ["–3 **AP**", "AP", "worsen", 3],
    ["+2 WS", "WS", "improve", 2], ["+3 AP", "AP", "improve", 3], ["+2 **Ld.**", "Ld", "improve", 2],
    ["+3 SV", "Sv", "improve", 3], ["+2OC", "OC", "improve", 2],
    ["+22 A", "A", "improve", 22],
  ])("reads %s without inventing a recipient or weapon scope", (text, stat, operation, value) => {
    const parameters = prefillFromSource(family, String(text));
    expect(normalizeFingerprintParameters(family.id, parameters, family.version)).toEqual({ characteristics: [stat], operation, value });
    expect(compileLeaves([adjustment(parameters)])).toMatchObject({ ok: false, errors: ["Stat adjustment needs a reviewed recipient."] });
    expect(leafFragment(adjustment(parameters)).kind).toBe("implicit");
  });

  it.each(["6 A", "2+ WS", "+2 Attendants", "D3+2 A"])("does not turn %s into a signed stat bonus", (text) => {
    expect(prefillFromSource(family, text)).not.toHaveProperty("operation");
  });

  it("requires a weapon scope rather than silently affecting all weapons", () => {
    const parameters = { ...prefillFromSource(family, "+2 S"), subject: "this-model" };
    expect(compileLeaves([adjustment(parameters)])).toMatchObject({ ok: false, errors: ["Stat adjustment needs a reviewed weapon scope."] });
    expect(compileLeaves([adjustment({ ...parameters, weapon_type: "ranged" })])).toMatchObject({ ok: true, mechanics: { effect: {
      type: "stat-modifier", target: "this-model", modifier: { stat: "S", operation: "improve", value: 2, weapon_type: "ranged" },
    } } });
  });

  it("does not demand a weapon scope for a model characteristic", () => {
    expect(compileLeaves([adjustment({ ...prefillFromSource(family, "-2 OC"), subject: "this-unit" })])).toMatchObject({ ok: true, mechanics: { effect: {
      type: "stat-modifier", target: "this-unit", modifier: { stat: "OC", operation: "worsen", value: 2 },
    } } });
  });

  it("retains the reviewed model and melee binding through the family migration", () => {
    const parameters = { subject: "this-model", characteristics: ["AP"], operation: "improve", value: 2, weapon_type: "melee" };
    const migrated = mapToLatest(family.id, 4, parameters)!;
    expect(migrated.version).toBe(currentFamilyVersion(family.id));
    expect(compileLeaves([adjustment(migrated.parameters)])).toMatchObject({ ok: true, mechanics: { effect: {
      type: "stat-modifier", target: "this-model", modifier: { stat: "AP", operation: "improve", value: 2, weapon_type: "melee" },
    } } });
  });

  it("previews a legacy singular-stat adjustment with its reviewed model", () => {
    expect(leafFragment({
      role: "EFFECT", family_id: family.id, family_version: 1, start_byte: 0,
      parameters: { subject: "this-model", characteristic: "S", operation: "add", value: 2 },
    })).toEqual({ kind: "effect", node: {
      type: "stat-modifier", target: "this-model", modifier: { stat: "S", operation: "add", value: 2 },
    } });
  });

  it.each(["-2 A", "–2 A", "−2 A"])("keeps the sign of %s distinct from positive and unsigned values", (negative) => {
    const source = `+2 A; ${negative}; 2 A; D3${negative}`;
    const matches = matchesAt(normalizedProjection(source), leafSurfaceKey(negative));
    expect(matches.map(({ start_byte, end_byte }) => Buffer.from(source).subarray(start_byte, end_byte).toString())).toEqual([negative]);
  });
});
