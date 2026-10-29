import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// "This unit cannot target a unit it was near at the start of the turn": a restriction on the
// unit that targets, covering only targets with that history. Wording is fabricated.

const FAMILY = "targeting-restriction";
const NEAR = { by: "this-unit", target: "enemy-units", may: "cannot-target", kind: "attack", weapon_type: "all", target_history: ["engaged-with-by-at-turn-start"] };
const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters(FAMILY, parameters, currentFamilyVersion(FAMILY));
const validate = () => createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

const ENGAGED = { type: "unit-state", parameters: { subject: "this-unit", state: "engaged", with: "ability-unit", at: "turn-start" } };
const attackedBy = (kind: string) => ({ type: "happened", parameters: { event: "targets-selected", subject: { owner: "any", excluding: "ability-unit" }, object: "this-unit", filter: { kind }, window: "phase" } });

describe("targeting-restriction version 6: target history, kinds and after_moves", () => {
  it("accepts the history, several kinds and moves on the by form, in canonical order", () => {
    expect(currentFamilyVersion(FAMILY)).toBe(6);
    expect(normalize(NEAR)).toEqual(NEAR);
    const { kind: _kind, ...noKind } = NEAR;
    expect(normalize({ ...noKind, kinds: ["charge", "shoot"], after_moves: ["fall-back", "advance"], target_history: ["charged-by-another-unit-this-phase", "attacked-by-another-unit-this-phase"] })).toEqual({
      ...noKind, kinds: ["shoot", "charge"], after_moves: ["advance", "fall-back"], target_history: ["attacked-by-another-unit-this-phase", "charged-by-another-unit-this-phase"],
    });
  });

  it("refuses history on the subject form, kind with kinds, one kind as kinds, and unknown values", () => {
    const { by: _by, target: _target, ...bare } = NEAR;
    expect(() => normalize({ ...bare, subject: "this-unit" })).toThrow(/need the by form/);
    expect(() => normalize({ ...NEAR, kinds: ["shoot", "charge"] })).toThrow(/either kind or kinds/);
    const { kind: _kind, ...noKind } = NEAR;
    expect(() => normalize({ ...noKind, kinds: ["shoot"] })).toThrow(/two or more kinds/);
    expect(() => normalize({ ...NEAR, target_history: ["near-at-some-point"] })).toThrow();
    expect(() => normalize({ ...NEAR, after_moves: ["normal"] })).toThrow();
  });
});

describe("a history restriction through compileLeaves", () => {
  it("puts the history on the target as a condition naming the unit that targets as ability-unit", () => {
    const text = "Fixture rule. This unit cannot target a unit it was near at the start of the turn, or one another unit attacked this phase.";
    const leaf = { ...NEAR, target_history: ["engaged-with-by-at-turn-start", "attacked-by-another-unit-this-phase"] };
    const result = compileLeaves(placed(text, ["This unit cannot target a unit it was near at the start of the turn, or one another unit attacked this phase", FAMILY, leaf]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = { type: "targeting", target: "this-unit", modifier: { by: "this-unit", may: "cannot-target", kind: "attack", target: { owner: "enemy" }, target_condition: { operator: "or", operands: [ENGAGED, attackedBy("attack")] } } };
    expect(result.mechanics.effect).toEqual(effect);
    expect(validate()(effect)).toBe(true);
  });

  it("lowers several kinds to one restriction each, held only in a turn the unit made one of the moves", () => {
    const text = "Fixture rule. When it shoots or charges after Advancing or Falling Back, it cannot target a unit another unit charged this phase.";
    const { kind: _kind, ...noKind } = NEAR;
    const leaf = { ...noKind, kinds: ["shoot", "charge"], weapon_type: "all", after_moves: ["advance", "fall-back"], target_history: ["charged-by-another-unit-this-phase"] };
    const result = compileLeaves(placed(text, ["it cannot target a unit another unit charged this phase", FAMILY, leaf]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const step = (kind: string) => ({ type: "targeting", target: "this-unit", modifier: { by: "this-unit", may: "cannot-target", kind, target: { owner: "enemy" }, target_condition: attackedBy("charge") } });
    const moved = (move: string) => ({ type: "happened", parameters: { event: "move-ended", subject: "this-unit", filter: { move_types: [move] }, window: "turn" } });
    const effect = { type: "conditional", condition: { operator: "or", operands: [moved("advance"), moved("fall-back")] }, effect: { type: "sequence", steps: [step("shoot"), step("charge")] } };
    expect(result.mechanics.effect).toEqual(effect);
    expect(validate()(effect)).toBe(true);
  });

  it("refuses a history relative to a unit other than this one", () => {
    const text = "Fixture rule. Enemy units cannot target a unit they were near at the start of the turn.";
    const leaf = { ...NEAR, by: "enemy-units", target: "this-unit" };
    const result = compileLeaves(placed(text, ["Enemy units cannot target a unit they were near at the start of the turn", FAMILY, leaf]), text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("; ")).toMatch(/relative to this unit or model/);
  });

});
