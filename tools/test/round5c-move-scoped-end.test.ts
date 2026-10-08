import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/round5c/contracts.js";

/**
 * move-must-end version 3 (move_types) and the trigger-move end restriction: "…, and cannot end
 * that move within Engagement Range of them" after a move-ended trigger with no make-move. Every
 * leaf is fabricated wording. Each case pins one binding or one refusal.
 */

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion = currentFamilyVersion(familyId)): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: offset };
}

const trigger = (moves?: string[]) => leaf("EVENT", "event", { kind: "move-ended", ...(moves ? { move_types: moves } : {}) });
const through = (passthrough: unknown = "models") => leaf("EFFECT", "move-through", { subject: "this-model", passthrough });
const permit = () => leaf("EFFECT", "eligibility-permission", { subject: "this-model", activity: "move", allow: true, despite: ["engaged"] });
const cannotEnd = (match = "all") => leaf("RESTRICTION", "move-must-end", { match, polarity: "cannot" });
const engaged = (extra: Record<string, unknown> = {}) => leaf("CONDITION", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false, ...extra });

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}
function refused(leaves: CompileLeaf[]): string {
  const result = compileLeaves(leaves);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join("; ");
}

describe("move-must-end version 3 (move_types)", () => {
  it("is the current version, takes move_types, and refuses an unknown or empty list", () => {
    expect(currentFamilyVersion("move-must-end")).toBe(3);
    const canonical = normalizeFingerprintParameters("move-must-end", { match: "all", polarity: "cannot", move_types: ["advance", "normal"] }, 3);
    expect(canonical.move_types).toEqual(["normal", "advance"]);
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", move_types: ["pile-in"] }, 3)).toThrow();
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", move_types: [] }, 3)).toThrow();
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", move_types: ["normal", "normal"] }, 3)).toThrow();
  });

  it("keeps version 2 leaves exactly as they were", () => {
    const v2 = normalizeFingerprintParameters("move-must-end", { match: "all", polarity: "cannot" }, 2);
    expect(v2).toEqual({ match: "all", polarity: "cannot" });
  });
});

describe("trigger-move end restriction (no_end_in_engagement)", () => {
  it("compiles a trigger's move-ended restriction with the trigger's move kinds and the bound unit", () => {
    const mechanics = compiled([
      trigger(["normal", "advance", "fall-back"]), through(), permit(), cannotEnd(), engaged(),
    ]);
    expect(JSON.stringify(mechanics)).toContain(JSON.stringify({
      type: "move-modifier", target: "this-model",
      modifier: { no_end_in_engagement: true, applies_to_moves: ["normal", "advance", "fall-back"] },
    }));
    expect(JSON.stringify(mechanics)).not.toContain("ends_when");
  });

  it("omits applies_to_moves when the trigger names no move kinds (every move)", () => {
    const mechanics = compiled([trigger(), through(), permit(), cannotEnd(), engaged()]);
    expect(JSON.stringify(mechanics)).toContain('"modifier":{"no_end_in_engagement":true}');
  });

  it("binds the unit from the move permission when no move-through precedes it", () => {
    const mechanics = compiled([trigger(["advance"]), permit(), cannotEnd(), engaged()]);
    expect(JSON.stringify(mechanics)).toContain('"target":"this-model","modifier":{"no_end_in_engagement":true,"applies_to_moves":["advance"]}');
  });

  it("carries a typed excluded passthrough and still ends on every enemy unit (excluded set resolved)", () => {
    const passthrough = { kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] };
    const mechanics = compiled([trigger(["normal"]), through(passthrough), permit(), cannotEnd(), engaged()]);
    const text = JSON.stringify(mechanics);
    expect(text).toContain(JSON.stringify({ kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] }));
    expect(text).toContain('"no_end_in_engagement":true');
  });

  it("narrows to the restriction's own move kinds, a subset of the trigger's", () => {
    const mechanics = compiled([
      trigger(["normal", "advance", "charge"]), through(), permit(),
      leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "cannot", move_types: ["normal", "advance"] }), engaged(),
    ]);
    expect(JSON.stringify(mechanics)).toContain('"modifier":{"no_end_in_engagement":true,"applies_to_moves":["normal","advance"]}');
  });

  it("keeps the restriction's move kinds when the trigger names none", () => {
    const mechanics = compiled([
      trigger(), through(), permit(),
      leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "cannot", move_types: ["normal", "advance", "fall-back"] }), engaged(),
    ]);
    expect(JSON.stringify(mechanics)).toContain('"applies_to_moves":["normal","advance","fall-back"]');
  });

  it("refuses a restriction that names a move kind the trigger does not name", () => {
    const errors = refused([
      trigger(["normal", "advance"]), through(), permit(),
      leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "cannot", move_types: ["normal", "charge"] }), engaged(),
    ]);
    expect(errors).toMatch(/does not name/u);
  });

  it("refuses a move_types list on a restriction that follows a make-move, rather than dropping it", () => {
    const errors = refused([
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }, 2),
      leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "cannot", move_types: ["normal"] }), engaged(),
    ]);
    expect(errors).toMatch(/move types/u);
  });

  it("refuses a must restriction with no move before it (the deployment-zone form stays refused)", () => {
    const errors = refused([trigger(), through(), permit(), leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "must" }), engaged()]);
    expect(errors).toMatch(/has no move before it/u);
  });

  it("refuses a restriction with no condition, or with more than one", () => {
    expect(refused([trigger(), through(), permit(), cannotEnd()])).toMatch(/exactly one condition/u);
    expect(refused([trigger(), through(), permit(), cannotEnd(), engaged(), engaged()])).toMatch(/exactly one condition/u);
  });

  it("refuses a negated engaged condition under cannot (a double negative)", () => {
    expect(refused([trigger(), through(), permit(), cannotEnd(), engaged({ negated: true })])).toMatch(/negated/u);
  });

  it("refuses a with or at qualifier, which narrows the referent", () => {
    expect(refused([trigger(), through(), permit(), cannotEnd(), engaged({ with: "this-unit" })])).toMatch(/qualifier/u);
    expect(refused([trigger(), through(), permit(), cannotEnd(), engaged({ at: "turn-start" })])).toMatch(/qualifier/u);
  });

  it("refuses a condition other than engaged with this unit", () => {
    expect(refused([trigger(), through(), permit(), cannotEnd(), leaf("CONDITION", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: false })])).toMatch(/covers only "engaged"/u);
  });

  it("refuses when no move-ended trigger precedes the restriction", () => {
    expect(refused([through(), permit(), cannotEnd(), engaged()])).toMatch(/no move-ended trigger/u);
  });

  it("refuses when no move-through or move permission binds the unit", () => {
    expect(refused([trigger(), cannotEnd(), engaged()])).toMatch(/to bind its unit/u);
  });
});

describe("trigger-move end restriction, binding by the source text", () => {
  // Byte offsets come from the sentence text, so the stop between the move and the restriction is real.
  function withText(sentence: string, separator: string) {
    const text = `${sentence}${separator}cannot end that move within Engagement Range of them.`;
    const at = (phrase: string) => text.indexOf(phrase);
    const restriction = at("cannot end that move");
    const condition = at("within Engagement Range");
    const leaves: CompileLeaf[] = [
      { role: "EVENT", family_id: "event", family_version: currentFamilyVersion("event"), parameters: { kind: "move-ended" }, start_byte: 0, end_byte: 0 },
      { role: "EFFECT", family_id: "move-through", family_version: currentFamilyVersion("move-through"), parameters: { subject: "this-model", passthrough: "models" }, start_byte: 0, end_byte: sentence.length },
      { role: "RESTRICTION", family_id: "move-must-end", family_version: currentFamilyVersion("move-must-end"), parameters: { match: "all", polarity: "cannot" }, start_byte: restriction, end_byte: restriction + "cannot end that move".length },
      { role: "CONDITION", family_id: "unit-state", family_version: currentFamilyVersion("unit-state"), parameters: { states: ["engaged"], subject: "this-unit", negated: false }, start_byte: condition, end_byte: text.length - 1 },
    ];
    return compileLeaves(leaves, text);
  }

  it("binds the move-through in the same sentence, across a comma", () => {
    const result = withText("It can move through models", ", but ");
    expect(result.ok).toBe(true);
  });

  it("refuses to bind across a full stop, since the restriction is then a different sentence", () => {
    const result = withText("It can move through models", ". It ");
    expect(result.ok ? "" : result.errors.join()).toMatch(/to bind its unit/u);
  });
});
