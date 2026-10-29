import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { foldReturnedModelExclusions } from "../src/semantic-authoring/compile-returned-model-exclusions.js";
import { dslUnitFilter } from "../src/semantic-authoring/compile-unit-filter-dsl.js";
import { selectUnit, wrapLeaderTarget } from "../src/semantic-authoring/compile-wrappers.js";
import { trigger } from "../src/semantic-authoring/compile-triggers.js";

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
      .toEqual({ type: "return-models", target: { level: "model", member_of: "this-unit", all_of: ["SCOUT"], none_of: ["HERO"], attachment_role: "bodyguard" }, modifier: { count: 2, wounds_remaining: 1 } });
  });

  it("binds a qualifier preceding the passive restoration verb", () => {
    const text = "One sample model (excluding HERO models) is recovered.";
    expect(effect(text, [exclude(), restore("is recovered")]))
      .toEqual({ type: "return-models", target: { level: "model", member_of: "this-unit", none_of: ["HERO"] }, modifier: { count: 1 } });
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
        { type: "return-models", target: { level: "model", member_of: "this-unit", none_of: ["HERO"] }, modifier: { count: 1 } },
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
      .toEqual({ type: "return-models", target: { level: "model", member_of: "this-unit", none_of: ["HERO", "SCOUT", "VEHICLE"] }, modifier: { count: 1 } });
  });

  it("validates keyword sets without accepting unit-wide predicates", () => {
    expect(normalizeFingerprintParameters("returned-model-exclusion", { keywords: ["**scout**", "hero"] }, 1))
      .toEqual({ keywords: ["HERO", "SCOUT"] });
    for (const parameters of [{ keywords: [] }, { keywords: [null] }, { keywords: ["HERO", "hero"] }, { keywords: ["HERO"], subject: "this-unit" }]) {
      expect(() => normalizeFingerprintParameters("returned-model-exclusion", parameters, 1)).toThrow();
    }
  });

  it("preserves Bodyguard membership on an explicitly selected unit without keyword surrogates", () => {
    const text = "Select a friendly unit. Recover a Bodyguard model.";
    const leaves = leavesIn(text, [
      ["Select a friendly unit", "select-unit", { scope: "friendly", distance: "any" }],
      ["Recover a Bodyguard model", "return-models", { subject: "selected-unit", count: "1", bodyguard_only: true }],
    ]);
    leaves[0]!.role = "EVENT";
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.effect).toEqual({
      type: "select-units", selector: { filter: { owner: "friendly" }, count: { min: 1, max: 1 } },
      effect: { type: "return-models", target: { level: "model", member_of: "selected-unit", attachment_role: "bodyguard" }, modifier: { count: 1 } },
    });
  });

  it("lowers bounded model selections with explicit origins and shared allowances", () => {
    const selection: CompileLeaf = {
      role: "EFFECT", family_id: "select-unit", family_version: 6, start_byte: 0,
      parameters: { scope: "friendly", target_kind: "model", count: 2, up_to: true, distance: "within", inches: 9,
        within_of: "squad", visible_to: "observer", filter: { keywords: ["CHARACTER"], membership: "selected-unit" } },
    };
    expect(selectUnit(selection, { type: "no-effect" }, { selectionLimit: { count: 1, period: "turn" } })).toEqual({
      type: "select-units",
      selector: {
        filter: { owner: "friendly", level: "model", member_of: "selected-unit", all_of: ["CHARACTER"],
          within: { range: { inches: 9 }, of: { selection_var: "squad" } }, visible: { to: { selection_var: "observer" } } },
        count: { min: 0, max: 2 }, limit: { count: 1, period: "turn" },
      },
      effect: { type: "no-effect" },
    });
  });

  it("keeps attachment roles separate from CHARACTER and Leader capability", () => {
    const parameters = normalizeFingerprintParameters("unit-filter", {
      side: "friendly", level: "model", keywords: ["CHARACTER"], attachment_role: "bodyguard", member_of: "selected-unit",
    }, 16);
    const filter: CompileLeaf = { role: "CONDITION", family_id: "unit-filter", family_version: 16, parameters, start_byte: 0 };
    expect(dslUnitFilter(filter)).toEqual({ owner: "friendly", level: "model", all_of: ["CHARACTER"], attachment_role: "bodyguard", member_of: "selected-unit" });
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", attachment_role: "bodyguard" }, 16)).toThrow(/models/);
    const old = { side: "friendly", keywords: ["SCOUT"] };
    expect(normalizeFingerprintParameters("unit-filter", old, 16)).toEqual(normalizeFingerprintParameters("unit-filter", old, 15));
  });

  it("grants a model-bound ordinary definition to every attached Leader", () => {
    const leaf: CompileLeaf = { role: "CONDITION", family_id: "leader-target", family_version: 1, start_byte: 0,
      parameters: { leader_keywords: ["CHARACTER"] } };
    const effect = { type: "sequence", steps: [
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "T", operation: "add", value: 1 } },
      { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } },
    ] };
    expect(wrapLeaderTarget(leaf, effect)).toEqual({
      type: "ability-grant", target: { level: "model", member_of: "this-unit", attachment_role: "leader", all_of: ["CHARACTER"] },
      modifier: { definition: { type: "ability-part", duration: "while-leading", effect: { type: "sequence", steps: [
        { type: "stat-modifier", target: "this-model", modifier: { stat: "T", operation: "add", value: 1 } },
        { type: "re-roll", target: "this-model", modifier: { roll: "hit", subset: "ones" } },
      ] } } },
    });
    expect(effect.steps.every((step) => step.target === "this-unit")).toBe(true);
  });

  it("binds separate weapon and model characteristics to their own Bodyguard recipient filters", () => {
    const text = "Raise S for Bodyguard models in the unit; raise T for Bodyguard models in the unit.";
    const leaves = leavesIn(text, [
      ["Raise S for", "characteristic-modifier", { subject: "antecedent", characteristics: ["S"], operation: "add", value: 1, weapon_type: "melee" }],
      ["Bodyguard models in the unit", "unit-filter", { side: "friendly", level: "model", attachment_role: "bodyguard", member_of: "this-unit" }],
      ["raise T for", "characteristic-modifier", { subject: "antecedent", characteristics: ["T"], operation: "add", value: 1 }],
      ["Bodyguard models in the unit", "unit-filter", { side: "friendly", level: "model", attachment_role: "bodyguard", member_of: "this-unit" }],
    ]);
    for (const leaf of leaves) if (leaf.family_id === "unit-filter") leaf.role = "CONDITION";
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const target = { owner: "friendly", level: "model", attachment_role: "bodyguard", member_of: "this-unit" };
    expect(result.mechanics.effect).toEqual({ type: "sequence", steps: [
      { type: "stat-modifier", target, modifier: { stat: "S", operation: "add", value: 1, weapons: { type: "melee" } } },
      { type: "stat-modifier", target, modifier: { stat: "T", operation: "add", value: 1 } },
    ] });
  });

  it("keeps the destroying attack classification correlated with its model-destroyed event", () => {
    const parameters = normalizeFingerprintParameters("event", { kind: "model-destroyed", attack_type: "melee" }, 29);
    expect(trigger({ role: "EVENT", family_id: "event", family_version: 29, parameters, start_byte: 0 })).toEqual({
      event: "model-destroyed", object: "model-in-this-unit", filter: { attack_type: "melee" },
    });
    expect(() => normalizeFingerprintParameters("event", { kind: "model-destroyed", attack_type: "melee" }, 28)).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "battle-started", attack_type: "melee" }, 29)).toThrow();
  });
});
