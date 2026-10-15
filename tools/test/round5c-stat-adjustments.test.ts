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

  it("reads an explicit attack-property recipient and scope without guessing missing qualifiers", () => {
    const scopeFamily = REVIEWED_FAMILY_REGISTRY.find((item) => item.id === "weapon-property-scope")!;
    const parameters = prefillFromSource(scopeFamily, "This unit’s ranged attacks have");
    expect(normalizeFingerprintParameters(scopeFamily.id, parameters, scopeFamily.version)).toEqual({
      subject: "this-unit", weapon_type: "ranged",
    });
    expect(prefillFromSource(scopeFamily, "Ranged attacks have")).toEqual({});
    expect(prefillFromSource(scopeFamily, "This unit has")).toEqual({});
    expect(() => normalizeFingerprintParameters(scopeFamily.id, { subject: "this-unit" }, scopeFamily.version)).toThrow();
  });

  it.each(["-2 A", "‐2 A", "‑2 A", "‒2 A", "–2 A", "—2 A", "−2 A"])("keeps the sign of %s distinct from positive and unsigned values", (negative) => {
    const source = `+2 A; ${negative}; 2 A; D3${negative}`;
    const matches = matchesAt(normalizedProjection(source), leafSurfaceKey(negative));
    expect(matches.map(({ start_byte, end_byte }) => Buffer.from(source).subarray(start_byte, end_byte).toString())).toEqual([negative]);
  });

  it.each(["**‑2 A**", "(‐2 A)", "**− 2A**"])("preserves the operator inside %s rather than matching unsigned values", (negative) => {
    const source = `+2 A; ${negative}; 2 A`;
    const key = leafSurfaceKey(negative);
    expect(/^[−-]/u.test(key)).toBe(true);
    const found = matchesAt(normalizedProjection(source), key)
      .map(({ start_byte, end_byte }) => Buffer.from(source).subarray(start_byte, end_byte).toString());
    expect(found).toEqual([negative.replace(/^[*(]+|[*)]+$/gu, "")]);
    expect(prefillFromSource(family, negative.replace(/[()]/gu, ""))).toMatchObject({ operation: "worsen", value: 2 });
  });
});

describe("separately scoped characteristic setters", () => {
  const setter = (parameters: Record<string, unknown>, start = 1): CompileLeaf => ({
    role: "EFFECT", family_id: "characteristic-set", family_version: 3, parameters, start_byte: start,
  });
  const scope = (parameters: Record<string, unknown>): CompileLeaf => ({
    role: "CONDITION", family_id: "weapon-property-scope", family_version: 1, parameters, start_byte: 0,
  });

  it("accepts the operand without guessing who or which weapons it changes", () => {
    const leaf = setter(normalizeFingerprintParameters("characteristic-set", { characteristic: "A", value: 3 }, 3));
    expect(leaf.parameters).toEqual({ characteristic: "A", value: 3 });
    expect(compileLeaves([leaf])).toMatchObject({ ok: false, errors: ["Characteristic setter needs a reviewed recipient."] });
    expect(leafFragment(leaf).kind).toBe("implicit");
    expect(compileLeaves([setter({ characteristic: "A", value: 3, subject: "this-unit" })]))
      .toMatchObject({ ok: false, errors: ["A weapon characteristic setter needs a reviewed weapon scope."] });
  });

  it.each([3, 4])("sets melee Attacks to %s without turning it into a bonus or affecting ranged weapons", (value) => {
    expect(compileLeaves([
      scope({ subject: "this-unit", weapon_type: "melee" }),
      setter({ characteristic: "A", value }),
    ])).toMatchObject({ ok: true, mechanics: { effect: {
      type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "set", value, weapon_type: "melee" },
    } } });
  });

  it("keeps a separately selected recipient rather than modifying the ability's own unit", () => {
    expect(compileLeaves([
      { role: "EVENT", family_id: "select-unit", family_version: currentFamilyVersion("select-unit"), parameters: { scope: "friendly", distance: "any", visible: false }, start_byte: 0 },
      scope({ subject: "selected-unit", weapon_type: "ranged" }),
      setter({ characteristic: "S", value: 5 }),
    ])).toMatchObject({ ok: true, mechanics: { effect: {
      type: "select-units", effect: {
        type: "stat-modifier", target: "selected-unit", modifier: { stat: "S", operation: "set", value: 5, weapon_type: "ranged" },
      },
    } } });
  });

  it("rejects conflicting recipients and scopes, and model stats in a weapon prefix", () => {
    const prefix = scope({ subject: "this-unit", weapon_type: "melee" });
    expect(compileLeaves([prefix, setter({ characteristic: "A", value: 3, subject: "this-model" })])).toMatchObject({ ok: false });
    expect(compileLeaves([prefix, setter({ characteristic: "A", value: 3, weapon_type: "ranged" })])).toMatchObject({ ok: false });
    expect(compileLeaves([prefix, setter({ characteristic: "T", value: 3 })])).toMatchObject({ ok: false });
    expect(() => normalizeFingerprintParameters("characteristic-set", { characteristic: "T", value: 3, weapon_type: "melee" }, 3)).toThrow();
  });

  it("does not let a weapon prefix cross a sentence boundary", () => {
    const prefix = { ...scope({ subject: "this-unit", weapon_type: "melee" }), end_byte: 1, fragment: "RAW_TEXT" };
    const value = { ...setter({ characteristic: "A", value: 3 }, 3), fragment: "RAW_TEXT" };
    expect(compileLeaves([prefix, value], "x. y")).toMatchObject({ ok: false });
  });

  it("retains model-only setter bindings through version migration", () => {
    const migrated = mapToLatest("characteristic-set", 2, { subject: "this-model", characteristic: "M", value: 7 })!;
    expect(compileLeaves([{ ...setter(migrated.parameters), family_version: migrated.version }])).toMatchObject({ ok: true, mechanics: { effect: {
      type: "stat-modifier", target: "this-model", modifier: { stat: "M", operation: "set", value: 7 },
    } } });
  });
});

it("preserves the historical all-weapons setter while refusing to assume that scope for a new bare leaf", () => {
  const migrated = mapToLatest("characteristic-set", 2, { subject: "this-model", characteristic: "A", value: 3 })!;
  expect(compileLeaves([{ role: "EFFECT", family_id: "characteristic-set", family_version: migrated.version, parameters: migrated.parameters, start_byte: 0 }]))
    .toMatchObject({ ok: true, mechanics: { effect: {
      type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "set", value: 3 },
    } } });
  expect(normalizeFingerprintParameters("characteristic-set", { characteristic: "A", value: 3 }, 3))
    .toEqual({ characteristic: "A", value: 3 });
});
