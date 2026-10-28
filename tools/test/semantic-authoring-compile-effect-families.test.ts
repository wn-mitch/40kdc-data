import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { prefillFromSource, type PrefillFamily } from "../src/semantic-authoring/leaf-prefill.js";
import { previewLeaf } from "../src/semantic-authoring/leaf-preview.js";

/**
 * Effect-family compilers: targeting, eligibility and unit-state effects (batch 3), and the
 * movement/placement and economy families (batch 4). Each family compiles on its own and renders on a
 * real authored base.
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

describe("Semantic authoring batch-3 families: targeting, eligibility and unit-state effects", () => {
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
        { type: "targeting", target: "this-model", modifier: { may: "target", kind: "shoot", weapons: { type: "ranged" }, range: { inches: 12 } } }],
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
        { type: "damage-reduction", target: "this-unit", modifier: { reduction: "half", weapons: { type: "ranged" } } }],
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
        { type: "return-models", target: { level: "model", member_of: "this-unit", all_of: ["BODYGUARD"] }, modifier: { count: 1, wounds_remaining: "D3" } }],
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
      // Version 5: "regains all of its lost wounds" is the full heal.
      [leaf("EFFECT", "regain-wounds", { subject: "this-model", amount: "all" }, 5),
        { type: "heal", target: "this-model", modifier: { amount: "full" } }],
    ];
    for (const [input, expected] of cases) {
      expect(compiled([input]).mechanics.effect).toEqual(expected);
      expect(rendered(base(), [input]).length).toBeGreaterThan(0);
    }
  });

  it("compiles ignore-modifiers@4 rolls left out of an \"any roll\" list, on the rolls kind only", () => {
    const params = { subject: "this-unit", what: ["characteristics", "rolls"], rolls: ["all"], except_rolls: ["save"] };
    expect(compiled([leaf("EFFECT", "ignore-modifiers", params, 4)]).mechanics.effect).toEqual({
      type: "sequence",
      steps: [
        { type: "ignore-modifiers", target: "this-unit", modifier: { what: "characteristics" } },
        { type: "ignore-modifiers", target: "this-unit", modifier: { what: "rolls", rolls: ["all"], except_rolls: ["save"] } },
      ],
    });
    expect(rendered(base(), [leaf("EFFECT", "ignore-modifiers", params, 4)])).toMatch(/except saving throw rolls/u);
    const normalize = (input: Record<string, unknown>) => normalizeFingerprintParameters("ignore-modifiers", input, 4);
    // Leaving a roll out only means something against "any roll".
    expect(() => normalize({ subject: "this-unit", what: ["rolls"], rolls: ["hit"], except_rolls: ["save"] })).toThrow(/rolls must be all or any/u);
    expect(() => normalize({ subject: "this-unit", what: ["rolls"], rolls: ["all"], except_rolls: ["all"] })).toThrow();
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

describe("Semantic authoring movement-family compiler", () => {
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

  it("lowers an unlimited Advance ceiling as a move modifier without inventing a distance", () => {
    expect(compiled([leaf("EFFECT", "move-distance", {
      subject: "this-unit", move_types: ["advance"], maximum: "unlimited",
    }, 2)]).mechanics.effect).toEqual({
      type: "move-modifier",
      target: "this-unit",
      modifier: { applies_to_moves: ["advance"], maximum: "unlimited" },
    });
    expect(normalizeFingerprintParameters("move-distance", {
      subject: "this-unit", move_types: ["advance"], maximum: "unlimited",
    }, 2)).toEqual({ subject: "this-unit", move_types: ["advance"], maximum: "unlimited" });
    expect(() => normalizeFingerprintParameters("move-distance", {
      subject: "this-unit", move_types: ["advance"], maximum: "unlimited", bonus: 1,
    }, 2)).toThrow(/mutually exclusive/u);
    expect(() => normalizeFingerprintParameters("move-distance", {
      subject: "this-unit", move_types: ["normal"], maximum: "unlimited",
    }, 2)).toThrow(/exactly one advance/u);
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
      modifier: { to: "battlefield", from: "strategic-reserves", min_enemy_distance: { inches: 9 }, round_offset: -1 },
    });
    expect(rendered(base(), [leaf("EFFECT", "set-up", { subject: "this-unit", to: "battlefield", from: "transport" })]).length).toBeGreaterThan(0);
  });

  it("compiles battlefield-marker to place or relocate, target carrying who places it", () => {
    expect(compiled([leaf("EFFECT", "battlefield-marker", { subject: "this-unit", label: "cult-ambush-marker" })]).mechanics.effect)
      .toEqual({ type: "marker", target: "this-unit", modifier: { label: "cult-ambush-marker" } });
    expect(compiled([leaf("EFFECT", "battlefield-marker", { subject: "this-model", label: "beacon-marker", operation: "relocate", distance: 6 })]).mechanics.effect)
      .toEqual({ type: "marker", target: "this-model", modifier: { label: "beacon-marker", operation: "relocate", distance: { inches: 6 } } });
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

describe("Semantic authoring movement-family prefill", () => {
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

describe("Semantic authoring economy-family compiler", () => {
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

  it("lowers the leaf's normal-move roll to the DSL roll-kind normal", () => {
    expect(compiled([leaf("EFFECT", "resource-die", { pool: "miracle-dice-pool", operation: "substitute", rolls: ["normal-move", "advance"] })]).mechanics.effect)
      .toEqual({ type: "resource-die", target: "this-model", modifier: { pool: "miracle-dice-pool", operation: "substitute", rolls: ["normal", "advance"] } });
  });

  it("extends sticky-objective to an optional subject, v1 leaves still meaning this-unit", () => {
    expect(compiled([leaf("EFFECT", "sticky-objective", {})]).mechanics.effect).toEqual({ type: "objective-sticky", target: "this-unit" });
    expect(compiled([leaf("EFFECT", "sticky-objective", {}, 2)]).mechanics.effect).toEqual({ type: "objective-sticky", target: "this-unit" });
    expect(compiled([leaf("EFFECT", "sticky-objective", { subject: "this-model" }, 2)]).mechanics.effect).toEqual({ type: "objective-sticky", target: "this-model" });
    expect(() => normalizeFingerprintParameters("sticky-objective", { subject: "this-model" }, 1)).toThrow(/sticky-objective parameters must be exactly:/u);
    expect(rendered(base(), [leaf("EFFECT", "sticky-objective", { subject: "this-model" }, 2)]).length).toBeGreaterThan(0);
  });

  it("lets sticky-objective@3 name each unit a for-each loop reaches, which v2 refuses", () => {
    expect(normalizeFingerprintParameters("sticky-objective", { subject: "recipient" }, 3)).toEqual({ subject: "recipient" });
    expect(() => normalizeFingerprintParameters("sticky-objective", { subject: "recipient" }, 2)).toThrow(/sticky-objective\.subject/u);
    expect(compiled([leaf("EFFECT", "sticky-objective", { subject: "recipient" }, 3)]).mechanics.effect).toEqual({ type: "objective-sticky", target: "recipient" });
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

  it("compiles apply-mark to designate, including the Vengeful Dead token state", () => {
    expect(compiled([leaf("EFFECT", "apply-mark", { subject: "this-unit", tag: "spotted" })]).mechanics.effect)
      .toEqual({ type: "designate", target: "this-unit", modifier: { tag: "spotted" } });
    expect(compiled([leaf("EFFECT", "apply-mark", { subject: "this-unit", tag: "vengeful-dead" })]).mechanics.effect)
      .toEqual({ type: "designate", target: "this-unit", modifier: { tag: "vengeful-dead" } });
    expect(compiled([leaf("EFFECT", "apply-mark", { subject: "this-model", tag: "afflicted", clear: true })]).mechanics.effect)
      .toEqual({ type: "designate", target: "this-model", modifier: { tag: "afflicted", clear: true } });
    expect(() => normalizeFingerprintParameters("designated-filter", {
      subject: "this-unit", tag: "vengeful-dead",
    })).not.toThrow();
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

describe("Semantic authoring economy-family prefill", () => {
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
