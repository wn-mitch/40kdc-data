import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";
import { describeEffect } from "../src/translate/index.js";

/** Leaves in source order at the current version of their family. */
function leaves(...items: Array<[string, Record<string, unknown>]>): CompileLeaf[] {
  return items.map(([family, parameters], index) => {
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: index * 10, end_byte: index * 10 + 5 };
  });
}

/** The single effect `list` compiles to. */
function effectOf(list: CompileLeaf[]): Record<string, unknown> {
  const result = compileLeaves(list);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as { effect: Record<string, unknown> }).effect;
}

describe("regain-wounds per one-model", () => {
  it("compiles one model regaining wounds apart from each model and the unit", () => {
    const heal = (per?: string) => effectOf(leaves(["regain-wounds", { subject: "this-unit", amount: "3", ...(per ? { per } : {}) }]));
    expect(heal("one-model")).toMatchObject({ type: "heal", target: "this-unit", modifier: { amount: 3, per: "one-model" } });
    expect(heal("model")).toMatchObject({ modifier: { amount: 3, per: "model" } });
    expect((heal().modifier as Record<string, unknown>).per).toBeUndefined();
  });

  it("renders \"one model in\" for one-model and \"each model in\" for model", () => {
    const text = (per: string) => describeEffect({ type: "heal", target: "this-unit", modifier: { amount: 3, per } } as never);
    expect(text("one-model")).toBe("One model in the unit regains up to 3 lost wounds.");
    expect(text("model")).toBe("Each model in the unit regains up to 3 lost wounds.");
  });

  it("keeps one-model out of the retired version and carries version 8 leaves forward unchanged", () => {
    const current = currentFamilyVersion("regain-wounds");
    expect(() => normalizeFingerprintParameters("regain-wounds", { subject: "this-unit", amount: "3", per: "one-model" }, current - 1)).toThrow();
    expect(mapToLatest("regain-wounds", current - 1, { subject: "this-unit", amount: "3", per: "model" }))
      .toEqual({ family: "regain-wounds", version: current, parameters: { subject: "this-unit", amount: "3", per: "model" } });
  });
});

describe("return-models model_name", () => {
  it("returns only models with that profile name, as a model-level filter on the unit", () => {
    const effect = effectOf(leaves(["return-models", { subject: "this-unit", count: "1", model_name: " Healer Twin " }]));
    expect(effect).toMatchObject({ type: "return-models", modifier: { count: 1 } });
    expect(effect.target).toEqual({ level: "model", member_of: "this-unit", model_names: ["Healer Twin"] });
  });

  it("leaves an unnamed return on the unit itself", () => {
    expect(effectOf(leaves(["return-models", { subject: "this-unit", count: "1" }])).target).toBe("this-unit");
  });

  it("refuses a name on a single model and a blank name", () => {
    const version = currentFamilyVersion("return-models");
    expect(() => normalizeFingerprintParameters("return-models", { subject: "this-model", count: "1", model_name: "Healer Twin" }, version)).toThrow(/this-model/u);
    expect(() => normalizeFingerprintParameters("return-models", { subject: "this-unit", count: "1", model_name: "   " }, version)).toThrow();
    expect(() => normalizeFingerprintParameters("return-models", { subject: "this-unit", count: "1", model_name: "Healer Twin" }, version - 1)).toThrow();
  });
});
