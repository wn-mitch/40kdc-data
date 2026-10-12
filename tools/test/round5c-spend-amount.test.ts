import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/family-extensions.js";
import { FAMILY_EXTENSIONS_19_SPEND_AMOUNT } from "../src/round5c/family-extensions-19-spend-amount.js";
import { createValidator } from "../src/schema-loader.js";

/** The version of resource-spend this file's extension defines, found by its extension (later ones may sit above it). */
function spendVersion(): number {
  for (let version = currentFamilyVersion("resource-spend"); version > 1; version -= 1) {
    const extension = familyExtension("resource-spend", version);
    if (extension !== undefined && FAMILY_EXTENSIONS_19_SPEND_AMOUNT.includes(extension)) return version;
  }
  throw new Error("The spend-amount extension is not registered.");
}

const leafOf = (amount: unknown, extra: Record<string, unknown> = {}) => ({ pool: "blood-tithe-pool", amount, ...extra });

describe("resource-spend amount one-or-more", () => {
  it("is accepted at the extension's version and refused at the one before", () => {
    const version = spendVersion();
    expect(normalizeFingerprintParameters("resource-spend", leafOf("one-or-more"), version)).toEqual(leafOf("one-or-more"));
    expect(() => normalizeFingerprintParameters("resource-spend", leafOf("one-or-more"), version - 1)).toThrow();
    expect(normalizeFingerprintParameters("resource-spend", leafOf("one-or-more"), currentFamilyVersion("resource-spend"))).toEqual(leafOf("one-or-more"));
  });

  it("keeps every amount the previous version accepted", () => {
    const version = spendVersion();
    for (const amount of [2, "all", { source: "any number" }]) {
      expect(normalizeFingerprintParameters("resource-spend", leafOf(amount), version)).toEqual(leafOf(amount));
    }
    expect(normalizeFingerprintParameters("resource-spend", { pool: "yp-pool", amount: "one-or-more", spend_gate: "face", face: 3 }, version)).toMatchObject({ amount: "one-or-more", face: 3 });
  });

  it("refuses a cap spelled as an amount, since the DSL has no largest-amount field", () => {
    for (const amount of ["up-to-2", "at-most-2", "any", "some"]) {
      expect(() => normalizeFingerprintParameters("resource-spend", leafOf(amount), currentFamilyVersion("resource-spend"))).toThrow();
    }
  });

  it("lowers to the DSL's one-or-more spend, which validates", () => {
    const text = "You can spend one or more tokens.";
    const start = Buffer.from(text).indexOf("spend");
    const version = currentFamilyVersion("resource-spend");
    const leaf: CompileLeaf = { role: familyRole("resource-spend", version), family_id: "resource-spend", family_version: version, parameters: leafOf("one-or-more"), start_byte: start, end_byte: Buffer.byteLength(text) - 1, fragment: "RAW_TEXT" };
    const result = compileLeaves([leaf], text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = (result.mechanics as unknown as { effect: Record<string, any> }).effect;
    expect(effect).toEqual({ type: "resource-spend", target: "this-model", modifier: { pool: "blood-tithe-pool", amount: "one-or-more" } });
    expect(createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!(effect)).toBe(true);
  });
});
