import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

/**
 * Batch 7b, effects half: test, test-exemption, destruction-rule, datasheet-swap,
 * characteristic-resolution, borrow-weapons, select-weapon.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: 1, parameters, start_byte: offset };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

describe("Round 5C test-family compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("compiles a bare battle-shock test against a fixed target, the most common authored shape", () => {
    expect(compiled([leaf("EFFECT", "test", { target: "this-unit", test: "battle-shock" })]).mechanics.effect)
      .toEqual({ type: "test", target: "this-unit", modifier: { test: "battle-shock" } });
    // "selected-unit" is a legal fixed target too, but (like any effect naming it) needs an
    // accompanying select-unit leaf, the same rule every other family's target follows.
    expect(compiled([
      leaf("EVENT", "select-unit", { scope: "enemy", distance: "any", visible: false }),
      leaf("EFFECT", "test", { target: "selected-unit", test: "battle-shock" }),
    ]).mechanics.effect).toEqual({ type: "select-units", selector: { owner: "enemy", count: 1 }, effect: { type: "test", target: "selected-unit", modifier: { test: "battle-shock" } } });
    expect(rendered(base(), [leaf("EFFECT", "test", { target: "this-unit", test: "battle-shock" })]).length).toBeGreaterThan(0);
  });

  it("compiles an enemy-within filter target, engagement and inches ranges, matching disease-of-mirth-chaos-daemons' shape", () => {
    expect(compiled([leaf("EFFECT", "test", { target: "enemy", range: "engagement", test: "battle-shock" })]).mechanics.effect)
      .toEqual({ type: "test", target: { owner: "enemy", within: { range: "engagement" } }, modifier: { test: "battle-shock" } });
    expect(compiled([leaf("EFFECT", "test", { target: "enemy", range: "inches", within_inches: 6, test: "battle-shock" })]).mechanics.effect)
      .toEqual({ type: "test", target: { owner: "enemy", within: { range: { inches: 6 } } }, modifier: { test: "battle-shock" } });
  });

  it("folds require/exclude keywords and a modifier/count/per, matching repulsed-by-weakness's shape", () => {
    expect(compiled([leaf("EFFECT", "test", {
      target: "enemy", range: "engagement", exclude_keywords: ["MONSTER", "VEHICLE"], test: "desperate-escape", per: "model",
    })]).mechanics.effect).toEqual({
      type: "test", target: { owner: "enemy", within: { range: "engagement" }, none_of: ["MONSTER", "VEHICLE"] }, modifier: { test: "desperate-escape", per: "model" },
    });
    expect(compiled([leaf("EFFECT", "test", { target: "this-unit", test: "battle-shock", modifier: -1 })]).mechanics.effect)
      .toMatchObject({ modifier: { test: "battle-shock", modifier: -1 } });
  });

  it("compiles test-exemption with its window", () => {
    expect(compiled([leaf("EFFECT", "test-exemption", { target: "this-unit", test: "battle-shock", window: "phase" })]).mechanics.effect)
      .toEqual({ type: "test-exemption", target: "this-unit", modifier: { test: "battle-shock", window: "phase" } });
    expect(rendered(base(), [leaf("EFFECT", "test-exemption", { target: "this-unit", test: "battle-shock", window: "phase" })]).length).toBeGreaterThan(0);
  });

  it("refuses range/within_inches/of on a fixed (non-filtered) target", () => {
    expect(() => normalizeFingerprintParameters("test", { target: "this-unit", test: "battle-shock", range: "engagement" }, 1)).toThrow();
  });

  it("reproduces terror-made-manifest-chaos-space-marines' test node exactly (its own within.of names a friendly-keyword filter, not a fixed role)", () => {
    const entry = authored("chaos-space-marines", "terror-made-manifest-chaos-space-marines");
    const steps = (entry.effect as { steps: Array<{ effect: unknown }> }).steps;
    expect(compiled([leaf("EFFECT", "test", {
      target: "enemy", range: "inches", within_inches: 12, of_owner: "friendly", of_keywords: ["HERETIC ASTARTES"], test: "battle-shock", modifier: -1,
    })]).mechanics.effect).toEqual(steps[0]!.effect);
  });

  it("reproduces powers-of-da-waaagh-orks' test node exactly (nested under for-each-unit; target here is its own \"selected-unit\" binding, not this family's, so pinned as this-unit)", () => {
    const entries = JSON.parse(readFileSync(join(dataRoot, "orks", "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
    const entry = entries.find((item) => item.ability_id === "powers-of-da-waaagh-orks")!;
    const find = (node: unknown, kind: string): Record<string, unknown> | undefined => {
      if (Array.isArray(node)) { for (const item of node) { const hit = find(item, kind); if (hit) return hit; } return undefined; }
      if (node === null || typeof node !== "object") return undefined;
      const record = node as Record<string, unknown>;
      if (record.type === kind) return record;
      for (const value of Object.values(record)) { const hit = find(value, kind); if (hit) return hit; }
      return undefined;
    };
    const real = find(entry.effect, "test")!;
    const compiledNode = compiled([leaf("EFFECT", "test", {
      target: "this-unit", test: "battle-shock", modifier: -1, scaling_per: 10, scaling_of: "models-in-bearer-unit", scaling_round: "down",
    })]).mechanics.effect as Record<string, unknown>;
    expect(compiledNode.modifier).toEqual(real.modifier);
    expect(compiledNode.scaling).toEqual(real.scaling);
  });

  it("refuses of and of_owner together, and of_keywords without of_owner", () => {
    expect(() => normalizeFingerprintParameters("test", { target: "enemy", range: "inches", within_inches: 6, of: "this-model", of_owner: "friendly", test: "battle-shock" }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("test", { target: "enemy", range: "inches", within_inches: 6, of_keywords: ["X"], test: "battle-shock" }, 2)).toThrow();
  });

  it("reproduces using-sir-hekhtur-imperial-knights' destruction-rule step exactly (the ability's third sequence step)", () => {
    const entry = authored("imperial-knights", "using-sir-hekhtur-imperial-knights");
    const steps = (entry.effect as { steps: unknown[] }).steps;
    expect(compiled([leaf("EFFECT", "destruction-rule", { target: "this-unit", also: "this-model" })]).mechanics.effect).toEqual(steps.at(-1));
    expect(rendered(base(), [leaf("EFFECT", "destruction-rule", { target: "this-unit", also: "this-model" })]).length).toBeGreaterThan(0);
  });

  it("compiles datasheet-swap", () => {
    expect(compiled([leaf("EFFECT", "datasheet-swap", { target: "this-unit", datasheet: "possessed-chaos-space-marines" })]).mechanics.effect)
      .toEqual({ type: "datasheet-swap", target: "this-unit", modifier: { datasheet: "possessed-chaos-space-marines" } });
    expect(rendered(base(), [leaf("EFFECT", "datasheet-swap", { target: "this-unit", datasheet: "possessed-chaos-space-marines" })]).length).toBeGreaterThan(0);
  });

  it("compiles characteristic-resolution, tie required only for the majority rule", () => {
    expect(compiled([leaf("EFFECT", "characteristic-resolution", { target: "this-unit", stat: "T", rule: "majority", tie: "highest" })]).mechanics.effect)
      .toEqual({ type: "characteristic-resolution", target: "this-unit", modifier: { stat: "T", rule: "majority", tie: "highest" } });
    expect(compiled([leaf("EFFECT", "characteristic-resolution", { target: "this-unit", stat: "AP", rule: "highest", applies_to: "wound-roll" })]).mechanics.effect)
      .toEqual({ type: "characteristic-resolution", target: "this-unit", modifier: { stat: "AP", rule: "highest", applies_to: "wound-roll" } });
    expect(() => normalizeFingerprintParameters("characteristic-resolution", { target: "this-unit", stat: "T", rule: "highest", tie: "highest" }, 1)).toThrow();
    expect(rendered(base(), [leaf("EFFECT", "characteristic-resolution", { target: "this-unit", stat: "T", rule: "majority", tie: "highest" })]).length).toBeGreaterThan(0);
  });

  it("compiles borrow-weapons (Firing Deck)", () => {
    expect(compiled([leaf("EFFECT", "borrow-weapons", { target: "this-unit", max_models: 2, weapon_type: "ranged" })]).mechanics.effect)
      .toEqual({ type: "borrow-weapons", target: "this-unit", modifier: { max_models: 2, weapon_type: "ranged" } });
    expect(rendered(base(), [leaf("EFFECT", "borrow-weapons", { target: "this-unit", max_models: 2 })]).length).toBeGreaterThan(0);
  });

  it("compiles select-weapon binding a name", () => {
    expect(compiled([leaf("EFFECT", "select-weapon", { target: "this-unit", bind_as: "chosen_weapon", weapon_type: "melee" })]).mechanics.effect)
      .toEqual({ type: "select-weapon", target: "this-unit", modifier: { bind_as: "chosen_weapon", weapon_type: "melee" } });
    expect(rendered(base(), [leaf("EFFECT", "select-weapon", { target: "this-unit", bind_as: "chosen_weapon" })]).length).toBeGreaterThan(0);
  });
});
