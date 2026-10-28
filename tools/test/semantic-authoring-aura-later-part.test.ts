import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording only; no rules text.

function leaf(text: string, wording: string, family: string, version: number, parameters: Record<string, unknown>): CompileLeaf {
  const start = Buffer.from(text).indexOf(Buffer.from(wording));
  if (start < 0) throw new Error(`"${wording}" is not in the text`);
  return {
    role: familyRole(family, version), family_id: family, family_version: version,
    parameters: normalizeFingerprintParameters(family, parameters, version),
    start_byte: start, end_byte: start + Buffer.byteLength(wording), fragment: "RAW_TEXT",
  };
}

type Node = Record<string, any>;

describe("an aura whose record goes on to a later moment", () => {
  const text = "While an enemy unit is within 6\" of this model, worsen the Leadership characteristic of models in that unit by 1. "
    + "In addition, in the Battle-shock step of your opponent's Command phase, if such an enemy unit is below its Starting Strength, it must take a Battle-shock test.";
  const leaves = () => [
    leaf(text, "enemy unit", "unit-filter", 18, { side: "enemy" }),
    leaf(text, "within 6\" of this model", "aura-range", 6, { inches: 6, of: "this-model" }),
    leaf(text, "worsen the Leadership characteristic of models in that unit by 1", "characteristic-modifier", 19,
      { subject: "antecedent", characteristics: ["Ld"], operation: "worsen", value: 1, weapon_type: "all" }),
    leaf(text, "in the Battle-shock step of your opponent's Command phase", "event", 35, { kind: "step-started", step: "battle-shock", turn: "opponent" }),
    leaf(text, "such an enemy unit is below its Starting Strength", "unit-state", 17, { states: ["below-starting-strength"], subject: "antecedent", negated: false }),
    leaf(text, "it must take a Battle-shock test", "test", 3, { target: "antecedent", test: "battle-shock" }),
  ];

  it("keeps the aura on the first part and gives it to the later part that names its recipient", () => {
    const result = compileLeaves(leaves(), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const [first, later] = (result.mechanics.effect as Node).steps as Node[];
    // The first part's change reaches only enemy units in the aura, not a recipient no node binds.
    expect(first).toMatchObject({ type: "aura", target: "enemy-within-aura", modifier: { range: { inches: 6 }, eligible: { owner: "enemy" } } });
    expect(first!.modifier.effect).toMatchObject({ type: "stat-modifier", target: "recipient", modifier: { stat: "Ld" } });
    // "such an enemy unit" in the later moment's part is an enemy unit in the same aura.
    expect(later).toMatchObject({ type: "ability-part", trigger: { event: "step-started" } });
    expect(later!.effect).toMatchObject({ type: "aura", target: "enemy-within-aura", modifier: { range: { inches: 6 } } });
    expect(later!.effect.modifier.effect).toMatchObject({
      type: "conditional", condition: { type: "strength", parameters: { subject: "recipient" } }, effect: { type: "test", target: "recipient" },
    });
  });

  it("refuses a unit-filter over the words after \"such\", which would name every enemy unit", () => {
    const list = leaves();
    const at = list.findIndex((item) => item.family_id === "unit-state");
    const filter = leaf(text, "enemy unit is below", "unit-filter", 18, { side: "enemy" });
    const state = leaf(text, "below its Starting Strength", "unit-state", 17, { states: ["below-starting-strength"], subject: "antecedent", negated: false });
    list.splice(at, 1, { ...filter, end_byte: filter.start_byte + Buffer.byteLength("enemy unit") }, state);
    const result = compileLeaves(list, text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("; ")).toMatch(/follows "such"/u);
  });

  it("leaves a later part that names no recipient outside the aura", () => {
    const own = "While an enemy unit is within 6\" of this model, worsen the Leadership characteristic of models in that unit by 1. "
      + "In addition, in the Battle-shock step of your opponent's Command phase, this model must take a Battle-shock test.";
    const result = compileLeaves([
      leaf(own, "enemy unit", "unit-filter", 18, { side: "enemy" }),
      leaf(own, "within 6\" of this model", "aura-range", 6, { inches: 6, of: "this-model" }),
      leaf(own, "worsen the Leadership characteristic of models in that unit by 1", "characteristic-modifier", 19,
        { subject: "antecedent", characteristics: ["Ld"], operation: "worsen", value: 1, weapon_type: "all" }),
      leaf(own, "in the Battle-shock step of your opponent's Command phase", "event", 35, { kind: "step-started", step: "battle-shock", turn: "opponent" }),
      leaf(own, "this model must take a Battle-shock test", "test", 3, { target: "this-unit", test: "battle-shock" }),
    ], own);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const steps = (result.mechanics.effect as Node).steps as Node[];
    const later = steps.find((step) => step.type === "ability-part")!;
    expect(later.effect).toMatchObject({ type: "test", target: "this-unit" });
  });

  it("refuses an aura that only describes a later moment's unit, rather than drop its range", () => {
    const own = "Add 1 to this model's Move characteristic, and each time a friendly unit within 9\" of this model is destroyed, you gain 1 Pain token.";
    const result = compileLeaves([
      leaf(own, "Add 1 to this model's Move characteristic", "characteristic-modifier", 19,
        { subject: "this-model", characteristics: ["M"], operation: "add", value: 1, weapon_type: "all" }),
      leaf(own, "friendly unit", "unit-filter", 18, { side: "friendly" }),
      leaf(own, "within 9\" of this model", "aura-range", 6, { inches: 9, of: "this-model" }),
      leaf(own, "is destroyed", "event", 35, { kind: "unit-destroyed" }),
      leaf(own, "you gain 1 Pain token", "resource-gain", 4, { pool: "pain-token-pool", amount: 1 }),
    ], own);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("; ")).toMatch(/aura .* reaches no effect's recipient/u);
  });
});

describe("an aura printed in a later sentence of one part", () => {
  const text = "This unit's attacks have extra punch. While an enemy unit is within 6\" of this unit, worsen the Leadership characteristic of models in that unit by 1.";
  const leaves = () => [
    leaf(text, "This unit's attacks have extra punch", "core-ability-grant", 6, { subject: "this-unit", ability: "stealth" }),
    leaf(text, "enemy unit", "unit-filter", 18, { side: "enemy" }),
    leaf(text, "within 6\" of this unit", "aura-range", 6, { inches: 6, of: "this-unit" }),
    leaf(text, "worsen the Leadership characteristic of models in that unit by 1", "characteristic-modifier", 19,
      { subject: "antecedent", characteristics: ["Ld"], operation: "worsen", value: 1, weapon_type: "all" }),
  ];

  it("reaches only its own sentence's effects; the earlier sentence's effect stays outside the aura", () => {
    const result = compileLeaves(leaves(), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = result.mechanics.effect as Node;
    expect(effect.type).toBe("sequence");
    const [own, aura] = effect.steps as Node[];
    expect(own).toMatchObject({ type: "ability-grant", target: "this-unit" });
    expect(aura).toMatchObject({ type: "aura", target: "enemy-within-aura", modifier: { range: { inches: 6 } } });
    expect(aura!.modifier.effect).toMatchObject({ type: "stat-modifier", target: "recipient", modifier: { stat: "Ld" } });
  });
});
