import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { foldReturnedModelExclusions } from "../src/round5c/compile-returned-model-exclusions.js";

type Piece = [phrase: string, family: string, parameters: Record<string, unknown>];
const restore = (phrase: string, count = "1", extra = {}): Piece => [phrase, "return-models", { subject: "this-unit", count, ...extra }];
const exclude = (phrase = "excluding HERO models", keywords = ["HERO"]): Piece => [phrase, "returned-model-exclusion", { keywords }];

function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, family_id, parameters]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at));
    return {
      role: family_id === "returned-model-exclusion" ? "CONDITION" : "EFFECT",
      family_id, family_version: currentFamilyVersion(family_id), parameters,
      start_byte, end_byte: start_byte + Buffer.byteLength(phrase), fragment: "RAW_TEXT",
    };
  });
}

function effect(text: string, pieces: Piece[]) {
  const result = compileLeaves(leavesIn(text, pieces), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect;
}

function failed(text: string, pieces: Piece[]) {
  const result = compileLeaves(leavesIn(text, pieces), text);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("returned-model exclusions", () => {
  it("excludes individual models without gating their entire attached unit", () => {
    const text = "Sample squad: recover two models (excluding HERO models).";
    expect(effect(text, [restore("recover two models", "2", { wounds_remaining: "1", model_keyword: "SCOUT", bodyguard_only: true }), exclude()]))
      .toEqual({ type: "return-models", target: "this-unit", modifier: { count: 2, wounds_remaining: 1, model_keyword: "SCOUT", bodyguard_only: true, exclude_model_keyword: ["HERO"] } });
  });

  it("binds a qualifier preceding the passive restoration verb", () => {
    const text = "One sample model (excluding HERO models) is recovered.";
    expect(effect(text, [exclude(), restore("is recovered")]))
      .toEqual({ type: "return-models", target: "this-unit", modifier: { count: 1, exclude_model_keyword: ["HERO"] } });
  });

  it("keeps eligibility local to each alternative restoration", () => {
    const text = "Recover one model (excluding HERO models) or recover three models (excluding SCOUT models).";
    const restored = foldReturnedModelExclusions(leavesIn(text, [
      restore("Recover one model"), exclude(), restore("recover three models", "3"), exclude("excluding SCOUT models", ["SCOUT"]),
    ]), text);
    expect(restored.map((leaf) => leaf.parameters)).toEqual([
      { subject: "this-unit", count: "1", exclude_model_keyword: ["HERO"] },
      { subject: "this-unit", count: "3", exclude_model_keyword: ["SCOUT"] },
    ]);
  });

  it("does not carry an exclusion into a neighboring independent restoration", () => {
    const text = "Recover one model (excluding HERO models) and recover two models.";
    expect(effect(text, [restore("Recover one model"), exclude(), restore("recover two models", "2")]))
      .toEqual({ type: "sequence", steps: [
        { type: "return-models", target: "this-unit", modifier: { count: 1, exclude_model_keyword: ["HERO"] } },
        { type: "return-models", target: "this-unit", modifier: { count: 2 } },
      ] });
  });

  it.each([".", ";", ":", " or ", " and "])("rejects an orphan across the %s clause boundary", (separator) => {
    const text = `Recover one model${separator} excluding HERO models.`;
    expect(failed(text, [restore("Recover one model"), exclude()])[0]).toMatch(/own clause/u);
  });

  it("requires source evidence rather than binding across an unknown sentence boundary", () => {
    const leaves = leavesIn("Recover one model. Excluding HERO models.", [restore("Recover one model"), exclude("Excluding HERO models")]);
    expect(compileLeaves(leaves).ok).toBe(false);
  });

  it("does not skip an intervening non-restoration effect or another source fragment", () => {
    const text = "Recover one model, add one hit, excluding HERO models.";
    expect(failed(text, [restore("Recover one model"), ["add one hit", "roll-modifier", { roll: "hit", operation: "add", value: 1 }], exclude()])[0])
      .toMatch(/own clause/u);
    const source = "Recover one model excluding HERO models.";
    const leaves = leavesIn(source, [restore("Recover one model"), exclude()]);
    leaves[1] = { ...leaves[1]!, fragment: "RESTRICTIONS" };
    expect(compileLeaves(leaves, source).ok).toBe(false);
  });

  it("refuses two possible owners rather than guessing", () => {
    expect(failed("Recover one model excluding HERO models recover two models.", [restore("Recover one model"), exclude(), restore("recover two models", "2")])[0])
      .toMatch(/two possible restoration effects/u);
  });

  it("combines exclusions without changing the reviewed input leaves", () => {
    const text = "Recover one model excluding HERO models, excluding SCOUT models.";
    const leaves = leavesIn(text, [restore("Recover one model"), exclude(), exclude("excluding SCOUT models", ["SCOUT"])]);
    const before = structuredClone(leaves);
    expect(foldReturnedModelExclusions(leaves, text)[0]?.parameters.exclude_model_keyword).toEqual(["HERO", "SCOUT"]);
    expect(leaves).toEqual(before);
  });

  it("does not treat a conjunction inside a reviewed qualifier as a clause boundary", () => {
    const text = "Recover one model excluding HERO or SCOUT models, excluding VEHICLE models.";
    expect(effect(text, [restore("Recover one model"), exclude("excluding HERO or SCOUT models", ["HERO", "SCOUT"]), exclude("excluding VEHICLE models", ["VEHICLE"])]))
      .toEqual({ type: "return-models", target: "this-unit", modifier: { count: 1, exclude_model_keyword: ["HERO", "SCOUT", "VEHICLE"] } });
  });

  it("validates keyword sets without accepting unit-wide predicates", () => {
    expect(normalizeFingerprintParameters("returned-model-exclusion", { keywords: ["**scout**", "hero"] }, 1))
      .toEqual({ keywords: ["HERO", "SCOUT"] });
    for (const parameters of [{ keywords: [] }, { keywords: [null] }, { keywords: ["HERO", "hero"] }, { keywords: ["HERO"], subject: "this-unit" }]) {
      expect(() => normalizeFingerprintParameters("returned-model-exclusion", parameters, 1)).toThrow();
    }
  });
});
