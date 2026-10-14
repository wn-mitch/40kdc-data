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
 * Batch 4 (movement, placement & economy) — movement half: make-move, move-through, set-up,
 * battlefield-marker, transport-capacity. Split out of round5c-compile.test.ts per the leaf-family
 * batching brief; the economy half lives in round5c-compile-economy.test.ts.
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

describe("Round 5C movement-family compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("compiles make-move to the move fragment, distance and ends_within folded in only when authored", () => {
    expect(compiled([leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal" })]).mechanics.effect)
      .toEqual({ type: "move", target: "this-unit", modifier: { move_type: "normal" } });
    expect(compiled([leaf("EFFECT", "make-move", { subject: "this-model", move_type: "pile-in", distance: 3 })]).mechanics.effect)
      .toEqual({ type: "move", target: "this-model", modifier: { move_type: "pile-in", distance: 3 } });
    expect(compiled([leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "advance", distance: "D6", ends_within_inches: 9 })]).mechanics.effect)
      .toEqual({ type: "move", target: "this-unit", modifier: { move_type: "advance", distance: "D6", ends_within: { range: { inches: 9 } } } });
    expect(rendered(base(), [leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "charge", distance: 12 })]).length).toBeGreaterThan(0);
  });

  it("accepts a dice expression outside the sampled enum, since normalize reads the full pattern", () => {
    expect(() => normalizeFingerprintParameters("make-move", { subject: "this-unit", move_type: "advance", distance: "D3+3" })).not.toThrow();
    expect(() => normalizeFingerprintParameters("make-move", { subject: "this-unit", move_type: "advance", distance: "not-a-distance" })).toThrow(/make-move.distance/u);
  });

  it("compiles move-through to a move-modifier with an array passthrough token", () => {
    expect(compiled([leaf("EFFECT", "move-through", { subject: "this-unit", passthrough: "models" })]).mechanics.effect)
      .toEqual({ type: "move-modifier", target: "this-unit", modifier: { passthrough: ["models"] } });
    expect(compiled([leaf("EFFECT", "move-through", {
      subject: "this-model", passthrough: "tall-terrain", applies_to_moves: ["advance", "charge"], ignore_vertical: true,
    })]).mechanics.effect).toEqual({
      type: "move-modifier", target: "this-model",
      modifier: { passthrough: ["tall-terrain"], applies_to_moves: ["advance", "charge"], ignore_vertical: true },
    });
    expect(rendered(base(), [leaf("EFFECT", "move-through", { subject: "this-unit", passthrough: "non-titanic-models" })]).length).toBeGreaterThan(0);
  });

  it("refuses ignore_vertical: false, since the DSL only ever says it is true", () => {
    expect(() => normalizeFingerprintParameters("move-through", { subject: "this-unit", passthrough: "models", ignore_vertical: false }))
      .toThrow(/must be true, or omitted/u);
  });

  it("compiles set-up to the battlefield or Strategic Reserves, with the optional placement fields", () => {
    expect(compiled([leaf("EFFECT", "set-up", { subject: "this-unit", to: "strategic-reserves" })]).mechanics.effect)
      .toEqual({ type: "set-up", target: "this-unit", modifier: { to: "strategic-reserves" } });
    expect(compiled([leaf("EFFECT", "set-up", {
      subject: "this-unit", to: "battlefield", from: "strategic-reserves", min_enemy_distance: 9, round_offset: -1,
    })]).mechanics.effect).toEqual({
      type: "set-up", target: "this-unit",
      modifier: { to: "battlefield", from: "strategic-reserves", min_enemy_distance: 9, round_offset: -1 },
    });
    expect(rendered(base(), [leaf("EFFECT", "set-up", { subject: "this-unit", to: "battlefield", from: "transport" })]).length).toBeGreaterThan(0);
  });

  it("compiles battlefield-marker to place or relocate, target carrying who places it", () => {
    expect(compiled([leaf("EFFECT", "battlefield-marker", { subject: "this-unit", label: "cult-ambush-marker" })]).mechanics.effect)
      .toEqual({ type: "marker", target: "this-unit", modifier: { label: "cult-ambush-marker" } });
    expect(compiled([leaf("EFFECT", "battlefield-marker", { subject: "this-model", label: "beacon-marker", operation: "relocate", distance: 6 })]).mechanics.effect)
      .toEqual({ type: "marker", target: "this-model", modifier: { label: "beacon-marker", operation: "relocate", distance: 6 } });
    expect(rendered(base(), [leaf("EFFECT", "battlefield-marker", { subject: "this-unit", label: "cult-ambush-marker" })]).length).toBeGreaterThan(0);
  });

  it("compiles transport-capacity's grouped-models shape, always on this-unit", () => {
    expect(compiled([leaf("EFFECT", "transport-capacity", { shape: "grouped-models", subject_kind: "unit-models", models_per_group: 1, spaces_per_group: 1, rounding: "up" })]).mechanics.effect)
      .toEqual({ type: "transport-capacity", target: "this-unit", modifier: { occupancy_kind: "grouped-models", subject_kind: "unit-models", models_per_group: 1, spaces_per_group: 1, rounding: "up" } });
    expect(compiled([leaf("EFFECT", "transport-capacity", { shape: "grouped-models", subject_kind: "single-model", model_keyword: "Gunner", models_per_group: 1, spaces_per_group: 2, rounding: "down" })]).mechanics.effect)
      .toEqual({ type: "transport-capacity", target: "this-unit", modifier: { occupancy_kind: "grouped-models", subject_kind: "single-model", model_keyword: "Gunner", models_per_group: 1, spaces_per_group: 2, rounding: "down" } });
    expect(rendered(base(), [leaf("EFFECT", "transport-capacity", { shape: "grouped-models", subject_kind: "unit-models", models_per_group: 2, spaces_per_group: 1, rounding: "up" })]).length).toBeGreaterThan(0);
  });

  it("refuses single-model grouped-models with models_per_group other than 1", () => {
    expect(() => normalizeFingerprintParameters("transport-capacity", { shape: "grouped-models", subject_kind: "single-model", models_per_group: 2, spaces_per_group: 1, rounding: "up" }))
      .toThrow(/models_per_group must be 1/u);
  });

  it("compiles transport-capacity's fixed-model-spaces shape, with an optional eligibility kind+keyword pair", () => {
    expect(compiled([leaf("EFFECT", "transport-capacity", { shape: "fixed-model-spaces", subject_kind: "unit-models", spaces_per_model: 1 })]).mechanics.effect)
      .toEqual({ type: "transport-capacity", target: "this-unit", modifier: { occupancy_kind: "fixed-model-spaces", subject_kind: "unit-models", spaces_per_model: 1 } });
    expect(compiled([leaf("EFFECT", "transport-capacity", {
      shape: "fixed-model-spaces", subject_kind: "unit-models", spaces_per_model: 2,
      transport_eligibility_kind: "requires-capacity-keyword", transport_eligibility_keyword: "Firestorm Ridgerunner",
    })]).mechanics.effect).toEqual({
      type: "transport-capacity", target: "this-unit",
      modifier: { occupancy_kind: "fixed-model-spaces", subject_kind: "unit-models", spaces_per_model: 2, transport_eligibility: { requires_capacity_keyword: "Firestorm Ridgerunner" } },
    });
    expect(compiled([leaf("EFFECT", "transport-capacity", {
      shape: "fixed-model-spaces", subject_kind: "single-model", spaces_per_model: 1,
      transport_eligibility_kind: "embark-as-keyword", transport_eligibility_keyword: "Beast Snagga",
    })]).mechanics.effect).toEqual({
      type: "transport-capacity", target: "this-unit",
      modifier: { occupancy_kind: "fixed-model-spaces", subject_kind: "single-model", spaces_per_model: 1, transport_eligibility: { embark_as_keyword: "Beast Snagga" } },
    });
    expect(() => normalizeFingerprintParameters("transport-capacity", { shape: "fixed-model-spaces", subject_kind: "unit-models", spaces_per_model: 1, transport_eligibility_kind: "embark-as-keyword" }))
      .toThrow(/must be given together/u);
    expect(rendered(base(), [leaf("EFFECT", "transport-capacity", { shape: "fixed-model-spaces", subject_kind: "single-model", spaces_per_model: 1 })]).length).toBeGreaterThan(0);
  });

  it("compiles transport-capacity's equivalent-model shape, equivalent_by saying which field applies", () => {
    expect(compiled([leaf("EFFECT", "transport-capacity", { shape: "equivalent-model", subject_kind: "unit-models", equivalent_by: "keyword", equivalent_model_keyword: "Ork Boy" })]).mechanics.effect)
      .toEqual({ type: "transport-capacity", target: "this-unit", modifier: { occupancy_kind: "equivalent-model", subject_kind: "unit-models", equivalent_model_keyword: "Ork Boy" } });
    expect(compiled([leaf("EFFECT", "transport-capacity", { shape: "equivalent-model", subject_kind: "single-model", equivalent_by: "count", equivalent_model_count: 3 })]).mechanics.effect)
      .toEqual({ type: "transport-capacity", target: "this-unit", modifier: { occupancy_kind: "equivalent-model", subject_kind: "single-model", equivalent_model_count: 3 } });
    expect(() => normalizeFingerprintParameters("transport-capacity", { shape: "equivalent-model", subject_kind: "unit-models", equivalent_by: "keyword" })).toThrow(/equivalent_by keyword needs/u);
    expect(() => normalizeFingerprintParameters("transport-capacity", { shape: "equivalent-model", subject_kind: "unit-models", equivalent_by: "keyword", equivalent_model_keyword: "Ork Boy", equivalent_model_count: 1 }))
      .toThrow(/equivalent_by keyword needs/u);
    expect(rendered(base(), [leaf("EFFECT", "transport-capacity", { shape: "equivalent-model", subject_kind: "unit-models", equivalent_by: "count", equivalent_model_count: 1 })]).length).toBeGreaterThan(0);
  });

  it("compiles transport-capacity's capacity shape, the Transport's own capacity and eligibility", () => {
    expect(compiled([leaf("EFFECT", "transport-capacity", { shape: "capacity", capacity: 6 })]).mechanics.effect)
      .toEqual({ type: "transport-capacity", target: "this-unit", modifier: { capacity: 6 } });
    expect(compiled([leaf("EFFECT", "transport-capacity", { shape: "capacity", capacity: 12, capacity_keywords: ["CHARACTER"] })]).mechanics.effect)
      .toEqual({ type: "transport-capacity", target: "this-unit", modifier: { capacity: 12, eligible: { all_of: ["CHARACTER"] } } });
    expect(rendered(base(), [leaf("EFFECT", "transport-capacity", { shape: "capacity", capacity: 6 })]).length).toBeGreaterThan(0);
  });

  it("renders each family's English distinctly from its neighbors", () => {
    expect(previewLeaf({ family_id: "make-move", parameters: { subject: "this-unit", move_type: "advance", distance: 6 } }).text).toMatch(/Advance/u);
    expect(previewLeaf({ family_id: "set-up", parameters: { subject: "this-unit", to: "strategic-reserves" } }).text).toMatch(/Strategic Reserves/u);
    expect(previewLeaf({ family_id: "battlefield-marker", parameters: { subject: "this-unit", label: "cult-ambush-marker" } }).text).toMatch(/marker/u);
  });
});

describe("Round 5C movement-family prefill", () => {
  const family = (id: string) => REVIEWED_FAMILY_REGISTRY.find((item) => item.id === id && item.version === currentFamilyVersion(id)) as unknown as PrefillFamily;
  const prefill = (id: string, text: string) => prefillFromSource(family(id), text);

  it("reads make-move's move kind and a named inch distance from regular wording", () => {
    expect(prefill("make-move", "this unit can Advance up to 6\"")).toMatchObject({ subject: "this-unit", move_type: "advance", distance: 6 });
    expect(prefill("make-move", "the bearer can make a Normal move")).toMatchObject({ subject: "this-model", move_type: "normal" });
    expect(prefill("make-move", "this unit can Fall Back and Charge in the same turn")).toMatchObject({ move_type: "fall-back" });
  });

  it("reads set-up's to and from from Strategic Reserves wording", () => {
    expect(prefill("set-up", "this unit can be set up again on the battlefield")).toMatchObject({ to: "battlefield" });
    expect(prefill("set-up", "set this unit up into Strategic Reserves")).toMatchObject({ to: "strategic-reserves" });
    expect(prefill("set-up", "this unit can be set up from Strategic Reserves")).toMatchObject({ from: "strategic-reserves" });
  });
});
