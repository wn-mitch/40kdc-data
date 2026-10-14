import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";

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

/** The compiled entry on a real authored base must validate, lint, and render. */
function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

describe("Round 5C batch-3 families: targeting, eligibility and unit-state effects", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("compiles eligibility-permission to permission, with despite and as_if", () => {
    const cases: Array<[CompileLeaf, Record<string, unknown>]> = [
      [leaf("EFFECT", "eligibility-permission", { subject: "this-unit", activity: "fall-back", allow: true }),
        { type: "permission", target: "this-unit", modifier: { activity: "fall-back", allow: true } }],
      [leaf("EFFECT", "eligibility-permission", { subject: "this-model", activity: "shoot", allow: false }),
        { type: "permission", target: "this-model", modifier: { activity: "shoot", allow: false } }],
      [leaf("EFFECT", "eligibility-permission", { subject: "this-unit", activity: "use-stratagem", allow: true, despite: ["stratagem-used-this-phase"], stratagem: "tank-shock" }),
        { type: "permission", target: "this-unit", modifier: { activity: "use-stratagem", allow: true, despite: ["stratagem-used-this-phase"], stratagem: "tank-shock" } }],
      [leaf("EFFECT", "eligibility-permission", { subject: "this-unit", activity: "shoot", allow: true, as_if: "shooting-phase" }),
        { type: "permission", target: "this-unit", modifier: { activity: "shoot", allow: true, as_if: "shooting-phase" } }],
    ];
    for (const [input, expected] of cases) {
      expect(compiled([input]).mechanics.effect).toEqual(expected);
      expect(rendered(base(), [input]).length).toBeGreaterThan(0);
    }
  });

  it("rejects eligibility-permission parameters outside the closed vocabulary", () => {
    expect(() => normalizeFingerprintParameters("eligibility-permission", { subject: "this-unit", activity: "teleport", allow: true })).toThrow();
  });

  it("requires the stratagem id exactly when despite includes stratagem-used-this-phase", () => {
    expect(() => normalizeFingerprintParameters("eligibility-permission", { subject: "this-unit", activity: "use-stratagem", allow: true, despite: ["stratagem-used-this-phase"] })).toThrow();
    expect(() => normalizeFingerprintParameters("eligibility-permission", { subject: "this-unit", activity: "shoot", allow: true, stratagem: "tank-shock" })).toThrow();
  });

  it("compiles targeting-restriction to targeting, subject enemy-units becomes an owner filter", () => {
    const cases: Array<[CompileLeaf, Record<string, unknown>]> = [
      [leaf("EFFECT", "targeting-restriction", { subject: "this-unit", may: "cannot-target", kind: "shoot", weapon_type: "all" }),
        { type: "targeting", target: "this-unit", modifier: { may: "cannot-target", kind: "shoot" } }],
      [leaf("EFFECT", "targeting-restriction", { subject: "enemy-units", may: "must-target", kind: "attack", weapon_type: "all" }),
        { type: "targeting", target: { owner: "enemy" }, modifier: { may: "must-target", kind: "attack" } }],
      [leaf("EFFECT", "targeting-restriction", { subject: "this-model", may: "target", kind: "shoot", weapon_type: "ranged", range: 12 }),
        { type: "targeting", target: "this-model", modifier: { may: "target", kind: "shoot", weapon_type: "ranged", range: { inches: 12 } } }],
    ];
    for (const [input, expected] of cases) {
      expect(compiled([input]).mechanics.effect).toEqual(expected);
      expect(rendered(base(), [input]).length).toBeGreaterThan(0);
    }
  });

  it("rejects a targeting-restriction range when may is must-target", () => {
    expect(() => normalizeFingerprintParameters("targeting-restriction", { subject: "this-unit", may: "must-target", kind: "shoot", weapon_type: "all", range: 6 })).toThrow();
  });

  it("compiles counts-as, rule-state and damage-reduction", () => {
    const cases: Array<[CompileLeaf, Record<string, unknown>]> = [
      [leaf("EFFECT", "counts-as", { subject: "this-unit", within: 3 }),
        { type: "counts-as", target: "this-unit", modifier: { within: { inches: 3 } } }],
      [leaf("EFFECT", "rule-state", { subject: "this-unit", direction: "suppressed", rule_kind: "core-rule", rule: "charge-bonus" }),
        { type: "rule-state", target: "this-unit", modifier: { direction: "suppressed", rule_kind: "core-rule", rule: "charge-bonus" } }],
      [leaf("EFFECT", "rule-state", { subject: "this-model", direction: "granted", rule_kind: "keyword", rule: "FLY" }),
        { type: "rule-state", target: "this-model", modifier: { direction: "granted", rule_kind: "keyword", rule: "FLY" } }],
      [leaf("EFFECT", "damage-reduction", { subject: "this-unit", reduction: "1", weapon_type: "all" }),
        { type: "damage-reduction", target: "this-unit", modifier: { reduction: 1 } }],
      [leaf("EFFECT", "damage-reduction", { subject: "this-unit", reduction: "half", weapon_type: "ranged" }),
        { type: "damage-reduction", target: "this-unit", modifier: { reduction: "half", weapon_type: "ranged" } }],
    ];
    for (const [input, expected] of cases) {
      expect(compiled([input]).mechanics.effect).toEqual(expected);
      expect(rendered(base(), [input]).length).toBeGreaterThan(0);
    }
  });

  it("rejects rule-state.rule spelled the wrong case for its rule_kind", () => {
    expect(() => normalizeFingerprintParameters("rule-state", { subject: "this-unit", direction: "granted", rule_kind: "keyword", rule: "fly" })).toThrow();
    expect(() => normalizeFingerprintParameters("rule-state", { subject: "this-unit", direction: "granted", rule_kind: "ability", rule: "Fights First" })).toThrow();
  });

  it("compiles return-models, destroy-models, split-unit, add-unit and battle-shock-state", () => {
    const cases: Array<[CompileLeaf, Record<string, unknown>]> = [
      [leaf("EFFECT", "return-models", { subject: "this-unit", count: "D3" }),
        { type: "return-models", target: "this-unit", modifier: { count: "D3" } }],
      [leaf("EFFECT", "return-models", { subject: "this-unit", count: "1", wounds_remaining: "D3", model_keyword: "BODYGUARD" }),
        { type: "return-models", target: "this-unit", modifier: { count: 1, wounds_remaining: "D3", model_keyword: "BODYGUARD" } }],
      [leaf("EFFECT", "destroy-models", { recipient: "this-unit", count: "1" }),
        { type: "destroy-models", target: "this-unit", modifier: { count: 1 } }],
      [leaf("EFFECT", "destroy-models", { recipient: "defender", count: "all", remove_from_play: true }),
        { type: "destroy-models", target: "defender", modifier: { count: "all", remove_from_play: true } }],
      [leaf("EFFECT", "split-unit", { mode: "model" }),
        { type: "split-unit", target: "this-unit", modifier: { by: "model" } }],
      [leaf("EFFECT", "split-unit", { mode: "counts", model_counts: [5, 5] }),
        { type: "split-unit", target: "this-unit", modifier: { model_counts: [5, 5] } }],
      [leaf("EFFECT", "add-unit", { source: "datasheet", datasheet: "blue-horrors", count: "2" }),
        { type: "add-unit", target: "this-unit", modifier: { datasheet: "blue-horrors", count: 2 } }],
      [leaf("EFFECT", "add-unit", { source: "copy-of-destroyed", count: "1" }),
        { type: "add-unit", target: "this-unit", modifier: { copy_of: "event-object", count: 1 } }],
      [leaf("EFFECT", "battle-shock-state", { recipient: "this-unit", set: true }),
        { type: "state-change", target: "this-unit", modifier: { state: "battle-shocked", set: true } }],
      [leaf("EFFECT", "battle-shock-state", { recipient: "defender", set: false }),
        { type: "state-change", target: "defender", modifier: { state: "battle-shocked", set: false } }],
    ];
    for (const [input, expected] of cases) {
      expect(compiled([input]).mechanics.effect).toEqual(expected);
      expect(rendered(base(), [input]).length).toBeGreaterThan(0);
    }
  });

  it("compiles regain-wounds@3 with the new amounts and per", () => {
    const cases: Array<[CompileLeaf, Record<string, unknown>]> = [
      [leaf("EFFECT", "regain-wounds", { subject: "this-model", amount: "D3+1" }, 3),
        { type: "heal", target: "this-model", modifier: { amount: "D3+1" } }],
      [leaf("EFFECT", "regain-wounds", { subject: "this-unit", amount: "D6", per: "model" }, 3),
        { type: "heal", target: "this-unit", modifier: { amount: "D6", per: "model" } }],
    ];
    for (const [input, expected] of cases) {
      expect(compiled([input]).mechanics.effect).toEqual(expected);
      expect(rendered(base(), [input]).length).toBeGreaterThan(0);
    }
  });

  it("round-trips leaf parameters to readable describer English", () => {
    const previews: Array<[string, Record<string, unknown>, number, RegExp]> = [
      ["eligibility-permission", { subject: "this-unit", activity: "fall-back", allow: true }, 1, /eligible to fall back/iu],
      ["targeting-restriction", { subject: "this-unit", may: "cannot-target", kind: "shoot", weapon_type: "all" }, 1, /cannot target/iu],
      ["counts-as", { subject: "this-unit", within: 3 }, 1, /counts as being within/iu],
      ["rule-state", { subject: "this-unit", direction: "granted", rule_kind: "keyword", rule: "FLY" }, 1, /gains the fly keyword/iu],
      ["damage-reduction", { subject: "this-unit", reduction: "half", weapon_type: "all" }, 1, /halve the damage/iu],
      ["return-models", { subject: "this-unit", count: "D3" }, 1, /return .* to the unit/iu],
      ["destroy-models", { recipient: "this-unit", count: "1" }, 1, /destroy/iu],
      ["split-unit", { mode: "model" }, 1, /split the unit/iu],
      ["add-unit", { source: "datasheet", datasheet: "blue-horrors", count: "2" }, 1, /add/iu],
      ["battle-shock-state", { recipient: "this-unit", set: true }, 1, /battle-shocked/iu],
      ["regain-wounds", { subject: "this-model", amount: "D3+1" }, 3, /regains up to/iu],
    ];
    for (const [family_id, parameters, family_version, expected] of previews) {
      const preview = previewLeaf({ family_id, family_version, parameters });
      expect(preview.problem).toBeNull();
      expect(preview.text).toMatch(expected);
    }
  });
});
