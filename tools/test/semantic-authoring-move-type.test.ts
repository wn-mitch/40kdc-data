import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Special Move Types: a move-type-open folds the leaves after it, by their move-type-section markers,
// into one move-type node. Fabricated leaves; no rule prose.

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, fragment?: string): CompileLeaf {
  offset += 10;
  const version = currentFamilyVersion(familyId);
  return { role, family_id: familyId, family_version: version, parameters: normalizeFingerprintParameters(familyId, parameters, version), start_byte: offset, ...(fragment !== undefined ? { fragment } : {}) };
}
const section = (name: string, fragment?: string) => leaf("EVENT", "move-type-section", { section: name }, fragment);
const noCharge = (fragment?: string) => leaf("EFFECT", "eligibility-permission", { subject: "this-unit", activity: "declare-charge", allow: false }, fragment);

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Record<string, unknown>;
}

describe("move-type-open", () => {
  it("folds each section's leaves into its field, and the next opener starts the next move type", () => {
    const effect = compiled([
      leaf("RESTRICTION", "rules-bundle-marker", {}, "A"),
      leaf("EFFECT", "move-type-open", { name: "Example Drop Move", move_type: "disembark", mode: "shock", setup_inches: 3 }, "B"),
      section("eligible", "C"),
      leaf("CONDITION", "unit-state", { states: ["embarked"], subject: "this-unit", negated: false }, "C"),
      leaf("CONDITION", "unit-state", { states: ["on-battlefield"], subject: "bearer-transport", negated: false }, "C"),
      section("effect", "D"),
      section("after", "E"),
      noCharge("E"),
      leaf("EFFECT", "move-type-open", { name: "Example Jet Move", move_type: "pulse-jet", distance_dice: "D6+18" }, "F"),
      section("after", "G"),
      noCharge("G"),
    ]);
    expect(effect.type).toBe("rules-bundle");
    const [drop, jet] = effect.steps as Array<Record<string, unknown>>;
    expect(drop).toMatchObject({ type: "move-type", name: "Example Drop Move", move_type: "disembark", mode: "shock", setup_distance: { inches: 3 } });
    expect((drop!.eligible_if as Record<string, unknown>).operator).toBe("and");
    expect(drop!.after).toMatchObject({ type: "permission", target: "this-unit", modifier: { activity: "declare-charge", allow: false } });
    expect(drop).not.toHaveProperty("before");
    expect(jet).toMatchObject({ type: "move-type", name: "Example Jet Move", move_type: "pulse-jet", distance: "D6+18" });
    expect(jet).not.toHaveProperty("eligible_if");
  });

  it("keeps each after-effect's own duration", () => {
    const effect = compiled([
      leaf("EFFECT", "move-type-open", { name: "Example Jet Move", move_type: "pulse-jet", distance_dice: "D6+18" }, "A"),
      section("after", "B"),
      noCharge("B"),
      leaf("DURATION", "duration", { endpoint: "end-of-turn" }, "B"),
    ]);
    expect(effect).toMatchObject({ type: "move-type", after: { type: "ability-part", duration: "turn", effect: { type: "permission", modifier: { activity: "declare-charge", allow: false } } } });
  });

  it("reads 'your unit must be unengaged' after the move as where the move ends", () => {
    const effect = compiled([
      leaf("EFFECT", "move-type-open", { name: "Example Jet Move", move_type: "pulse-jet", distance_dice: "D6+18" }, "A"),
      section("while", "B"),
      leaf("EFFECT", "move-through", { subject: "this-unit", passthrough: ["models", "all-terrain"], ignore_vertical: true }, "B"),
      section("after", "C"),
      leaf("CONDITION", "unit-state", { states: ["engaged"], subject: "this-unit", negated: true }, "C"),
    ]);
    const steps = (effect.while as Record<string, unknown>).steps as Array<Record<string, unknown>>;
    expect(steps.at(-1)).toEqual({ type: "move-modifier", target: "this-unit", modifier: { no_end_in_engagement: true } });
    expect(effect).not.toHaveProperty("after");
  });

  it("refuses a disembark without its mode, a part without a section marker, and an effect section with leaves", () => {
    const fails = (leaves: CompileLeaf[]) => compileLeaves(leaves).ok;
    expect(fails([leaf("EFFECT", "move-type-open", { name: "X", move_type: "disembark" }), section("after"), noCharge()])).toBe(false);
    expect(fails([leaf("EFFECT", "move-type-open", { name: "X", move_type: "pulse-jet" }), noCharge()])).toBe(false);
    expect(fails([leaf("EFFECT", "move-type-open", { name: "X", move_type: "pulse-jet" }), section("effect"), noCharge()])).toBe(false);
    expect(fails([leaf("EFFECT", "move-type-open", { name: "X", move_type: "pulse-jet" }), section("eligible"), noCharge()])).toBe(false);
  });
});
