import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { prefillFromSource, type PrefillFamily } from "../src/round5c/leaf-prefill.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";

/**
 * Batch 4 (movement, placement & economy) — economy half: resource-gain, resource-spend,
 * resource-die, the extended sticky-objective@2, stratagem-cost, apply-mark, army-construction.
 * Split out of round5c-compile.test.ts per the leaf-family batching brief; the movement half
 * lives in round5c-compile-movement.test.ts.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion = 1): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: offset };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

/** The compiled entry on a real authored base must validate against the ability schema, lint, and render. */
function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

describe("Round 5C economy-family compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("compiles resource-gain to cp-gain for command-point, resource-gain for any other pool", () => {
    expect(compiled([leaf("EFFECT", "resource-gain", { pool: "command-point", amount: 1 })]).mechanics.effect)
      .toEqual({ type: "cp-gain", target: "this-model", modifier: { amount: 1 } });
    expect(compiled([leaf("EFFECT", "resource-gain", { pool: "pain-token-pool", amount: 1 })]).mechanics.effect)
      .toEqual({ type: "resource-gain", target: "this-model", modifier: { pool: "pain-token-pool", amount: 1 } });
    expect(rendered(base(), [leaf("EFFECT", "resource-gain", { pool: "fate-dice-pool", amount: "D3" })]).length).toBeGreaterThan(0);
  });

  it("compiles resource-spend to the resource-spend fragment, amount all included", () => {
    expect(compiled([leaf("EFFECT", "resource-spend", { pool: "miracle-dice-pool", amount: 1 })]).mechanics.effect)
      .toEqual({ type: "resource-spend", target: "this-model", modifier: { pool: "miracle-dice-pool", amount: 1 } });
    expect(compiled([leaf("EFFECT", "resource-spend", { pool: "blood-tithe-pool", amount: "all" })]).mechanics.effect)
      .toEqual({ type: "resource-spend", target: "this-model", modifier: { pool: "blood-tithe-pool", amount: "all" } });
    expect(rendered(base(), [leaf("EFFECT", "resource-spend", { pool: "battle-focus-pool", amount: 2 })]).length).toBeGreaterThan(0);
  });

  it("compiles resource-spend's face and pair/triple/single/run requirement, mutually exclusive", () => {
    expect(compiled([leaf("EFFECT", "resource-spend", { pool: "blessings-of-khorne-pool", amount: 1, face: 6 })]).mechanics.effect)
      .toEqual({ type: "resource-spend", target: "this-model", modifier: { pool: "blessings-of-khorne-pool", amount: 1, face: 6 } });
    expect(compiled([leaf("EFFECT", "resource-spend", { pool: "blessings-of-khorne-pool", amount: 3, requirement_type: "triple", requirement_min: 5 })]).mechanics.effect)
      .toEqual({ type: "resource-spend", target: "this-model", modifier: { pool: "blessings-of-khorne-pool", amount: 3, requirement: { type: "triple", min_value: 5 } } });
    expect(() => normalizeFingerprintParameters("resource-spend", { pool: "blessings-of-khorne-pool", amount: 1, face: 6, requirement_type: "pair", requirement_min: 4 }))
      .toThrow(/mutually exclusive/u);
    expect(() => normalizeFingerprintParameters("resource-spend", { pool: "blessings-of-khorne-pool", amount: 1, requirement_type: "pair" })).toThrow(/must be given together/u);
    expect(rendered(base(), [leaf("EFFECT", "resource-spend", { pool: "blessings-of-khorne-pool", amount: 2, requirement_type: "pair", requirement_min: 4 })]).length).toBeGreaterThan(0);
  });

  it("checks spend_gate for self-consistency but never compiles it", () => {
    expect(compiled([leaf("EFFECT", "resource-spend", { pool: "blessings-of-khorne-pool", amount: 1, spend_gate: "none" })]).mechanics.effect)
      .toEqual({ type: "resource-spend", target: "this-model", modifier: { pool: "blessings-of-khorne-pool", amount: 1 } });
    expect(compiled([leaf("EFFECT", "resource-spend", { pool: "blessings-of-khorne-pool", amount: 1, spend_gate: "face", face: 6 })]).mechanics.effect)
      .toEqual({ type: "resource-spend", target: "this-model", modifier: { pool: "blessings-of-khorne-pool", amount: 1, face: 6 } });
    expect(() => normalizeFingerprintParameters("resource-spend", { pool: "blessings-of-khorne-pool", amount: 1, spend_gate: "face" })).toThrow(/spend_gate face needs a face/u);
    expect(() => normalizeFingerprintParameters("resource-spend", { pool: "blessings-of-khorne-pool", amount: 1, spend_gate: "none", face: 6 })).toThrow(/spend_gate none conflicts/u);
  });

  it("compiles resource-die to an add or a substitute, value and rolls folded in only when authored", () => {
    expect(compiled([leaf("EFFECT", "resource-die", { pool: "miracle-dice-pool", operation: "add", value: "rolled" })]).mechanics.effect)
      .toEqual({ type: "resource-die", target: "this-model", modifier: { pool: "miracle-dice-pool", operation: "add", value: "rolled" } });
    expect(compiled([leaf("EFFECT", "resource-die", { pool: "miracle-dice-pool", operation: "substitute", rolls: ["hit", "wound"] })]).mechanics.effect)
      .toEqual({ type: "resource-die", target: "this-model", modifier: { pool: "miracle-dice-pool", operation: "substitute", rolls: ["hit", "wound"] } });
    expect(rendered(base(), [leaf("EFFECT", "resource-die", { pool: "miracle-dice-pool", operation: "add", value: 6 })]).length).toBeGreaterThan(0);
  });

  it("extends sticky-objective to an optional subject, v1 leaves still meaning this-unit", () => {
    expect(compiled([leaf("EFFECT", "sticky-objective", {})]).mechanics.effect).toEqual({ type: "objective-sticky", target: "this-unit" });
    expect(compiled([leaf("EFFECT", "sticky-objective", {}, 2)]).mechanics.effect).toEqual({ type: "objective-sticky", target: "this-unit" });
    expect(compiled([leaf("EFFECT", "sticky-objective", { subject: "this-model" }, 2)]).mechanics.effect).toEqual({ type: "objective-sticky", target: "this-model" });
    expect(() => normalizeFingerprintParameters("sticky-objective", { subject: "this-model" }, 1)).toThrow(/sticky-objective parameters must be exactly:/u);
    expect(rendered(base(), [leaf("EFFECT", "sticky-objective", { subject: "this-model" }, 2)]).length).toBeGreaterThan(0);
  });

  it("compiles stratagem-cost, amount required unless the operation waives the cost", () => {
    expect(compiled([leaf("EFFECT", "stratagem-cost", { of: "stratagem", operation: "decrease", amount: 1 })]).mechanics.effect)
      .toEqual({ type: "cost-modifier", target: "this-unit", modifier: { of: "stratagem", operation: "decrease", amount: 1 } });
    expect(compiled([leaf("EFFECT", "stratagem-cost", { of: "stratagem", operation: "waive", applies_to: "used-by-this-unit" })]).mechanics.effect)
      .toEqual({ type: "cost-modifier", target: "this-unit", modifier: { of: "stratagem", operation: "waive", applies_to: "used-by-this-unit" } });
    expect(() => normalizeFingerprintParameters("stratagem-cost", { of: "stratagem", operation: "decrease" })).toThrow(/amount is required/u);
    expect(() => normalizeFingerprintParameters("stratagem-cost", { of: "stratagem", operation: "waive", amount: 1 })).toThrow(/must be omitted/u);
    expect(() => normalizeFingerprintParameters("stratagem-cost", { of: "stratagem", operation: "multiply", amount: 1 })).toThrow(/stratagem-cost.amount/u);
    expect(rendered(base(), [leaf("EFFECT", "stratagem-cost", { of: "stratagem", operation: "multiply", amount: 2 })]).length).toBeGreaterThan(0);
  });

  it("compiles apply-mark to designate, clear only ever true", () => {
    expect(compiled([leaf("EFFECT", "apply-mark", { subject: "this-unit", tag: "spotted" })]).mechanics.effect)
      .toEqual({ type: "designate", target: "this-unit", modifier: { tag: "spotted" } });
    expect(compiled([leaf("EFFECT", "apply-mark", { subject: "this-model", tag: "afflicted", clear: true })]).mechanics.effect)
      .toEqual({ type: "designate", target: "this-model", modifier: { tag: "afflicted", clear: true } });
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "spotted", clear: false })).toThrow(/must be true, or omitted/u);
    expect(rendered(base(), [leaf("EFFECT", "apply-mark", { subject: "this-unit", tag: "quarry" })]).length).toBeGreaterThan(0);
  });

  it("reads tag from the designation registry, so an unregistered tag is refused", () => {
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "not-a-real-designation" })).toThrow(/apply-mark.tag/u);
    // A newly registered id (any entry the registry lists) needs no family change to compile.
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "hidden" })).not.toThrow();
  });

  it("compiles army-construction to army-rule, with and led_by folded in only when authored", () => {
    expect(compiled([leaf("EFFECT", "army-construction", { rule: "warlord-required" })]).mechanics.effect)
      .toEqual({ type: "army-rule", target: "this-unit", modifier: { rule: "warlord-required" } });
    expect(compiled([leaf("EFFECT", "army-construction", { rule: "composition", with_keywords: ["CHARACTER"], max: 3 })]).mechanics.effect)
      .toEqual({ type: "army-rule", target: "this-unit", modifier: { rule: "composition", with: { all_of: ["CHARACTER"] }, max: 3 } });
    expect(compiled([leaf("EFFECT", "army-construction", { rule: "attachment", led_by: "Chapter Master" })]).mechanics.effect)
      .toEqual({ type: "army-rule", target: "this-unit", modifier: { rule: "attachment", led_by: "Chapter Master" } });
    expect(rendered(base(), [leaf("EFFECT", "army-construction", { rule: "unique" })]).length).toBeGreaterThan(0);
  });

  it("renders each family's English distinctly", () => {
    expect(previewLeaf({ family_id: "resource-gain", parameters: { pool: "command-point", amount: 1 } }).text).toMatch(/CP/u);
    expect(previewLeaf({ family_id: "resource-spend", parameters: { pool: "miracle-dice-pool", amount: 1 } }).text).toMatch(/spend/iu);
    expect(previewLeaf({ family_id: "army-construction", parameters: { rule: "warlord-required" } }).text).toMatch(/Warlord/u);
  });
});

describe("Round 5C economy-family prefill", () => {
  const family = (id: string) => REVIEWED_FAMILY_REGISTRY.find((item) => item.id === id && item.version === currentFamilyVersion(id)) as unknown as PrefillFamily;
  const prefill = (id: string, text: string) => prefillFromSource(family(id), text);

  it("reads a named CP amount as command-point for both resource families", () => {
    expect(prefill("resource-gain", "you gain 1CP")).toEqual({ pool: "command-point", amount: 1 });
    expect(prefill("resource-spend", "you can spend 2CP")).toEqual({ pool: "command-point", amount: 2 });
  });

  it("reads army-construction's rule from its fixed phrases", () => {
    expect(prefill("army-construction", "this unit must be your Warlord")).toMatchObject({ rule: "warlord-required" });
    expect(prefill("army-construction", "this unit cannot be your Warlord")).toMatchObject({ rule: "warlord-forbidden" });
    expect(prefill("army-construction", "your army can include only one of this unit")).toMatchObject({ rule: "unique" });
  });

  it("reads stratagem-cost's operation from reduce/increase/waive wording", () => {
    expect(prefill("stratagem-cost", "the Stratagem costs 1CP less")).toMatchObject({ operation: "decrease", of: "stratagem" });
    expect(prefill("stratagem-cost", "that Stratagem can be used without paying its CP cost")).toMatchObject({ operation: "waive", of: "stratagem" });
  });
});
